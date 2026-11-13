"""체크리스트 라우트 — TypeScript(checklist.ts) 원본의 이식."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from db import json_list, log_activity, now_iso
from deps import current_user_id
from helpers import error, jbody, open_conn, to_bool

router = APIRouter()


def serialize(i: dict) -> dict:
    return {
        **i,
        "labels": json_list(i.get("labels"), []),
        "is_completed": to_bool(i.get("is_completed")),
    }


def _dumps(value) -> str:
    return json.dumps(value if value is not None else [], ensure_ascii=False)


@router.get("")
@router.get("/")
async def list_items(request: Request, user_id: int = Depends(current_user_id)):
    label_filter = request.query_params.get("labels")
    conn = open_conn()
    try:
        items = [
            serialize(dict(r))
            for r in conn.execute(
                "SELECT * FROM checklist_items WHERE user_id = ? ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
        ]
    finally:
        conn.close()

    if label_filter:
        wanted = [t.strip() for t in label_filter.split(",") if t.strip()]
        items = [i for i in items if any(w in i["labels"] for w in wanted)]

    pending = [i for i in items if not i["is_completed"]]
    completed = [i for i in items if i["is_completed"]]
    return {
        "pending": {"total": len(pending), "items": pending},
        "completed": {"total": len(completed), "items": completed},
    }


@router.get("/labels/stats")
async def label_stats(user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        rows = conn.execute(
            "SELECT labels, is_completed FROM checklist_items WHERE user_id = ?", (user_id,)
        ).fetchall()
    finally:
        conn.close()

    stats: dict[str, dict[str, int]] = {}
    for r in rows:
        for label in json_list(r["labels"], []):
            if label not in stats:
                stats[label] = {"total": 0, "completed": 0}
            stats[label]["total"] += 1
            if to_bool(r["is_completed"]):
                stats[label]["completed"] += 1

    labels = [
        {
            "name": name,
            "total": s["total"],
            "completed": s["completed"],
            "completion_rate": round((s["completed"] / s["total"]) * 100) if s["total"] else 0,
        }
        for name, s in stats.items()
    ]
    return {"labels": labels}


@router.post("")
@router.post("/")
async def create_item(request: Request, user_id: int = Depends(current_user_id)):
    body = await jbody(request)
    if not body.get("title"):
        return error("제목은 필수입니다.", 400)
    conn = open_conn()
    try:
        cur = conn.execute(
            "INSERT INTO checklist_items (user_id, title, description, labels, recurrence) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                user_id,
                str(body["title"]),
                body.get("description") or "",
                _dumps(body.get("labels")),
                body.get("recurrence") or "NONE",
            ),
        )
        row = conn.execute("SELECT * FROM checklist_items WHERE id = ?", (cur.lastrowid,)).fetchone()
        log_activity(conn, user_id, "create", "checklist", str(body["title"]))
        return JSONResponse(serialize(dict(row)), status_code=201)
    finally:
        conn.close()


@router.patch("/{item_id}/complete")
async def toggle_complete(item_id: str, user_id: int = Depends(current_user_id)):
    # 주의: 원본은 완료 여부를 반전(!)시킵니다. 완료 시 반복 항목을 재생성합니다.
    conn = open_conn()
    try:
        row = conn.execute(
            "SELECT * FROM checklist_items WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).fetchone()
        if not row:
            return error("항목을 찾을 수 없습니다.", 404)
        row = dict(row)

        next_state = not to_bool(row.get("is_completed"))
        conn.execute(
            "UPDATE checklist_items SET is_completed = ?, completed_at = ?, "
            "updated_at = datetime('now') WHERE id = ? AND user_id = ?",
            (1 if next_state else 0, now_iso() if next_state else None, item_id, user_id),
        )

        created = None
        if next_state and row.get("recurrence") and row["recurrence"] != "NONE":
            cur = conn.execute(
                "INSERT INTO checklist_items (user_id, title, description, labels, recurrence) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    user_id,
                    row["title"],
                    row.get("description") or "",
                    row.get("labels"),
                    row["recurrence"],
                ),
            )
            created = conn.execute(
                "SELECT * FROM checklist_items WHERE id = ?", (cur.lastrowid,)
            ).fetchone()

        updated = conn.execute(
            "SELECT * FROM checklist_items WHERE id = ?", (item_id,)
        ).fetchone()
        log_activity(
            conn, user_id, "complete" if next_state else "reopen", "checklist", row["title"]
        )
        return {
            **serialize(dict(updated)),
            "regenerated": serialize(dict(created)) if created else None,
        }
    finally:
        conn.close()


@router.put("/{item_id}")
async def update_item(item_id: str, request: Request, user_id: int = Depends(current_user_id)):
    body = await jbody(request)
    fields: list[str] = []
    values: list = []
    for key in ("title", "description", "recurrence"):
        if key in body:
            fields.append(f"{key} = ?")
            values.append(body[key])
    if "labels" in body:
        fields.append("labels = ?")
        values.append(_dumps(body["labels"]))
    fields.append("updated_at = datetime('now')")
    values.extend([item_id, user_id])

    conn = open_conn()
    try:
        conn.execute(
            f"UPDATE checklist_items SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
            tuple(values),
        )
        row = conn.execute(
            "SELECT * FROM checklist_items WHERE id = ? AND user_id = ?", (item_id, user_id)
        ).fetchone()
        if not row:
            return error("항목을 찾을 수 없습니다.", 404)
        return serialize(dict(row))
    finally:
        conn.close()


@router.delete("/{item_id}")
async def delete_item(item_id: str, user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        conn.execute("DELETE FROM checklist_items WHERE id = ? AND user_id = ?", (item_id, user_id))
        return {"message": "삭제되었습니다."}
    finally:
        conn.close()
