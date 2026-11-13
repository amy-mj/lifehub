"""메모 라우트 — TypeScript(notes.ts) 원본의 이식."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from db import json_list, log_activity
from deps import current_user_id
from helpers import error, jbody, open_conn

router = APIRouter()


def serialize(n: dict) -> dict:
    return {**n, "tags": json_list(n.get("tags"), [])}


def _dumps(value) -> str:
    return json.dumps(value if value is not None else [], ensure_ascii=False)


@router.get("")
@router.get("/")
async def list_notes(
    request: Request,
    user_id: int = Depends(current_user_id),
):
    params = request.query_params
    note_type = params.get("note_type")
    tag_filter = params.get("tags")
    search = params.get("search")

    sql = "SELECT * FROM notes WHERE user_id = ?"
    args: list = [user_id]
    if note_type:
        sql += " AND note_type = ?"
        args.append(note_type)
    if search:
        sql += " AND (title LIKE ? OR content LIKE ?)"
        args.extend([f"%{search}%", f"%{search}%"])
    sql += " ORDER BY created_at DESC"

    conn = open_conn()
    try:
        items = [serialize(dict(r)) for r in conn.execute(sql, tuple(args)).fetchall()]
    finally:
        conn.close()

    if tag_filter:
        wanted = [t.strip() for t in tag_filter.split(",") if t.strip()]
        items = [n for n in items if any(w in n["tags"] for w in wanted)]

    return {"total": len(items), "items": items}


@router.get("/{note_id}")
async def get_note(note_id: str, user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        row = conn.execute(
            "SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)
        ).fetchone()
        if not row:
            return error("메모를 찾을 수 없습니다.", 404)
        return serialize(dict(row))
    finally:
        conn.close()


@router.post("")
@router.post("/")
async def create_note(request: Request, user_id: int = Depends(current_user_id)):
    body = await jbody(request)
    note_type = body.get("note_type") or "TEXT"
    if note_type == "TEXT" and not body.get("content"):
        return error("내용은 필수입니다.", 400)
    if note_type == "LINK" and not body.get("link_url"):
        return error("링크 URL은 필수입니다.", 400)

    conn = open_conn()
    try:
        cur = conn.execute(
            "INSERT INTO notes (user_id, title, content, note_type, link_url, og_title, og_desc, tags) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                body.get("title") or "",
                body.get("content") or "",
                note_type,
                body.get("link_url") or None,
                body.get("og_title") or None,
                body.get("og_desc") or None,
                _dumps(body.get("tags")),
            ),
        )
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
        content = body.get("content")
        log_activity(
            conn,
            user_id,
            "create",
            "note",
            body.get("title") or (str(content)[:20] if content else ""),
        )
        return JSONResponse(serialize(dict(row)), status_code=201)
    finally:
        conn.close()


@router.put("/{note_id}")
async def update_note(note_id: str, request: Request, user_id: int = Depends(current_user_id)):
    body = await jbody(request)
    fields: list[str] = []
    values: list = []
    for key in ("title", "content", "link_url"):
        if key in body:
            fields.append(f"{key} = ?")
            values.append(body[key])
    if "tags" in body:
        fields.append("tags = ?")
        values.append(_dumps(body["tags"]))
    fields.append("updated_at = datetime('now')")
    values.extend([note_id, user_id])

    conn = open_conn()
    try:
        conn.execute(f"UPDATE notes SET {', '.join(fields)} WHERE id = ? AND user_id = ?", tuple(values))
        row = conn.execute(
            "SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)
        ).fetchone()
        if not row:
            return error("메모를 찾을 수 없습니다.", 404)
        return serialize(dict(row))
    finally:
        conn.close()


@router.delete("/{note_id}")
async def delete_note(note_id: str, user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        conn.execute("DELETE FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id))
        return {"message": "삭제되었습니다."}
    finally:
        conn.close()
