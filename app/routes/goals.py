"""목표 라우트 — TypeScript(goals.ts) 원본의 이식.

주의: compute_progress 는 원본의 동작을 그대로 옮겼습니다.
      source_label 이 있는 경우 원본은 기간(start/end) 필터를 적용하지 않고
      전체 데이터를 집계합니다. 이는 원본의 실제 동작이므로 의도적으로 유지합니다.
"""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from db import json_list, log_activity
from deps import current_user_id
from helpers import error, jbody, open_conn

router = APIRouter()


def serialize(g: dict) -> dict:
    return {**g, "tags": json_list(g.get("tags"), [])}


def date_only(value) -> str:
    if not value:
        return ""
    return str(value)[:10]


def _dumps(value) -> str:
    return json.dumps(value if value is not None else [], ensure_ascii=False)


def _parse_ms(value) -> float | None:
    """JS new Date(x).getTime() 근사 — 실패 시 None (isNaN 대응)."""
    if not value:
        return None
    text = str(value).strip().replace(" ", "T")
    for candidate in (text, text[:19], text[:16], text[:10]):
        try:
            return datetime.fromisoformat(candidate).timestamp() * 1000
        except ValueError:
            continue
    return None


def compute_progress(conn, user_id: int, goal: dict) -> dict:
    start = date_only(goal.get("start_date"))
    end = date_only(goal.get("end_date"))
    current = 0
    detail: dict = {}
    source = goal.get("source")

    if source == "CHECKLIST":
        sql = "SELECT COUNT(*) AS c FROM checklist_items WHERE user_id = ? AND is_completed = 1"
        params: list = [user_id]
        if start:
            sql += " AND date(completed_at) >= date(?)"
            params.append(start)
        if end:
            sql += " AND date(completed_at) <= date(?)"
            params.append(end)
        rows = conn.execute(sql, tuple(params)).fetchall()

        if goal.get("source_label"):
            all_rows = conn.execute(
                "SELECT labels FROM checklist_items WHERE user_id = ? AND is_completed = 1",
                (user_id,),
            ).fetchall()
            current = sum(
                1 for r in all_rows if goal["source_label"] in json_list(r["labels"], [])
            )
        else:
            current = rows[0]["c"] if rows else 0
        detail["completed_checklist"] = current
        detail["label"] = goal.get("source_label") or None

    elif source == "EVENT":
        sql = "SELECT start_time, end_time FROM calendar_events WHERE user_id = ?"
        params = [user_id]
        if start:
            sql += " AND date(start_time) >= date(?)"
            params.append(start)
        if end:
            sql += " AND date(start_time) <= date(?)"
            params.append(end)
        rows = conn.execute(sql, tuple(params)).fetchall()

        minutes = 0.0
        for e in rows:
            s = _parse_ms(e["start_time"])
            en = _parse_ms(e["end_time"] or e["start_time"])
            if s is not None and en is not None and en > s:
                minutes += (en - s) / 60000

        if goal.get("source_label"):
            all_rows = conn.execute(
                "SELECT start_time, end_time, tags FROM calendar_events WHERE user_id = ?",
                (user_id,),
            ).fetchall()
            minutes = 0.0
            for e in all_rows:
                if goal["source_label"] not in json_list(e["tags"], []):
                    continue
                s = _parse_ms(e["start_time"])
                en = _parse_ms(e["end_time"] or e["start_time"])
                if s is not None and en is not None and en > s:
                    minutes += (en - s) / 60000

        current = round((minutes / 60) * 10) / 10
        detail["hours"] = current

    elif source == "NOTE":
        sql = "SELECT COUNT(*) AS c FROM notes WHERE user_id = ?"
        params = [user_id]
        if start:
            sql += " AND date(created_at) >= date(?)"
            params.append(start)
        if end:
            sql += " AND date(created_at) <= date(?)"
            params.append(end)

        if goal.get("source_label"):
            all_rows = conn.execute(
                "SELECT tags FROM notes WHERE user_id = ?", (user_id,)
            ).fetchall()
            current = sum(
                1 for r in all_rows if goal["source_label"] in json_list(r["tags"], [])
            )
        else:
            rows = conn.execute(sql, tuple(params)).fetchall()
            current = rows[0]["c"] if rows else 0
        detail["note_count"] = current

    else:  # MANUAL
        current = goal.get("current_value") or 0

    target = goal.get("target_value") or 1
    try:
        target = float(target)
    except (TypeError, ValueError):
        target = 1.0
    pct = min(100, round((current / target) * 1000) / 10)

    if pct >= 100:
        status = "COMPLETED"
    elif pct >= 97:
        status = "ALMOST"
    elif pct > 0:
        status = "IN_PROGRESS"
    else:
        status = "NOT_STARTED"

    return {"current": current, "pct": pct, "status": status, "detail": detail}


@router.get("")
@router.get("/")
async def list_goals(request: Request, user_id: int = Depends(current_user_id)):
    level = request.query_params.get("goal_level")
    status = request.query_params.get("status")
    sql = "SELECT * FROM goals WHERE user_id = ?"
    args: list = [user_id]
    if level:
        sql += " AND goal_level = ?"
        args.append(level)
    if status:
        sql += " AND status = ?"
        args.append(status)
    sql += " ORDER BY created_at DESC"

    conn = open_conn()
    try:
        rows = conn.execute(sql, tuple(args)).fetchall()
        items = []
        for g in rows:
            gd = dict(g)
            p = compute_progress(conn, user_id, gd)
            items.append(
                {
                    **serialize(gd),
                    "current_value": p["current"],
                    "progress_percentage": p["pct"],
                    "status": p["status"],
                }
            )
        return {"total": len(items), "items": items}
    finally:
        conn.close()


@router.get("/{goal_id}/progress")
async def goal_progress(goal_id: str, user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        row = conn.execute(
            "SELECT * FROM goals WHERE id = ? AND user_id = ?", (goal_id, user_id)
        ).fetchone()
        if not row:
            return error("목표를 찾을 수 없습니다.", 404)
        g = dict(row)
        p = compute_progress(conn, user_id, g)
        return {
            "id": g["id"],
            "title": g["title"],
            "target_value": g["target_value"],
            "current_value": p["current"],
            "progress_percentage": p["pct"],
            "status": p["status"],
            "calculation_detail": p["detail"],
        }
    finally:
        conn.close()


@router.post("")
@router.post("/")
async def create_goal(request: Request, user_id: int = Depends(current_user_id)):
    b = await jbody(request)
    if not b.get("title"):
        return error("목표 제목은 필수입니다.", 400)

    conn = open_conn()
    try:
        cur = conn.execute(
            """INSERT INTO goals
               (user_id, title, description, goal_level, parent_id, target_value,
                measurement_type, measurement_unit, source, source_label,
                start_date, end_date, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                str(b["title"]),
                b.get("description") or "",
                b.get("goal_level") or "MONTHLY",
                b.get("parent_id") or None,
                float(b.get("target_value") or 100),
                b.get("measurement_type") or "COUNT",
                b.get("measurement_unit") or "count",
                b.get("source") or "CHECKLIST",
                b.get("source_label") or None,
                b.get("start_date") or None,
                b.get("end_date") or None,
                _dumps(b.get("tags")),
            ),
        )
        row = conn.execute("SELECT * FROM goals WHERE id = ?", (cur.lastrowid,)).fetchone()
        log_activity(conn, user_id, "create", "goal", str(b["title"]))
        return JSONResponse(serialize(dict(row)), status_code=201)
    finally:
        conn.close()


@router.put("/{goal_id}")
async def update_goal(goal_id: str, request: Request, user_id: int = Depends(current_user_id)):
    b = await jbody(request)
    fields: list[str] = []
    values: list = []
    for key in (
        "title",
        "description",
        "goal_level",
        "parent_id",
        "target_value",
        "current_value",
        "measurement_type",
        "measurement_unit",
        "source",
        "source_label",
        "start_date",
        "end_date",
        "status",
    ):
        if key in b:
            fields.append(f"{key} = ?")
            values.append(b[key])
    if "tags" in b:
        fields.append("tags = ?")
        values.append(_dumps(b["tags"]))
    fields.append("updated_at = datetime('now')")
    values.extend([goal_id, user_id])

    conn = open_conn()
    try:
        conn.execute(
            f"UPDATE goals SET {', '.join(fields)} WHERE id = ? AND user_id = ?", tuple(values)
        )
        row = conn.execute(
            "SELECT * FROM goals WHERE id = ? AND user_id = ?", (goal_id, user_id)
        ).fetchone()
        if not row:
            return error("목표를 찾을 수 없습니다.", 404)
        return serialize(dict(row))
    finally:
        conn.close()


@router.delete("/{goal_id}")
async def delete_goal(goal_id: str, user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        conn.execute("DELETE FROM goals WHERE id = ? AND user_id = ?", (goal_id, user_id))
        return {"message": "삭제되었습니다."}
    finally:
        conn.close()
