"""대시보드 라우트 — TypeScript(dashboard.ts) 원본의 이식."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request

from deps import current_user_id
from helpers import open_conn, parse_ms

router = APIRouter()


def day_key(offset: int) -> str:
    """원본 dayKey(): 로컬 시각에서 offset 일 전 → UTC 기준 YYYY-MM-DD.

    JS 는 setDate 로 로컬 날짜를 이동한 뒤 toISOString(UTC) 으로 자릅니다.
    컨테이너 TZ 가 UTC 인 경우 로컬=UTC 이므로 그대로 계산됩니다.
    """
    local_now = datetime.now().astimezone()
    shifted = local_now - timedelta(days=offset)
    return shifted.astimezone(timezone.utc).strftime("%Y-%m-%d")


def _scalar(conn, sql: str, params: tuple):
    row = conn.execute(sql, params).fetchone()
    return row[0] if row is not None else 0


@router.get("/stats")
async def stats(request: Request, user_id: int = Depends(current_user_id)):
    period = request.query_params.get("period") or "week"
    days = 1 if period == "today" else 30 if period == "month" else 7

    conn = open_conn()
    try:
        cl_total = _scalar(
            conn, "SELECT COUNT(*) AS c FROM checklist_items WHERE user_id = ?", (user_id,)
        )
        cl_done = _scalar(
            conn,
            "SELECT COUNT(*) AS c FROM checklist_items WHERE user_id = ? AND is_completed = 1 "
            "AND date(completed_at) >= date(?)",
            (user_id, day_key(days - 1)),
        )
        memo_count = _scalar(
            conn,
            "SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND date(created_at) >= date(?)",
            (user_id, day_key(days - 1)),
        )

        events = conn.execute(
            "SELECT start_time, end_time FROM calendar_events WHERE user_id = ?", (user_id,)
        ).fetchall()

        from_iso = day_key(days - 1)
        from_dt = datetime.fromisoformat(from_iso).replace(tzinfo=timezone.utc).timestamp() * 1000

        minutes = 0.0
        for e in events:
            s = parse_ms(e["start_time"])
            en = parse_ms(e["end_time"] or e["start_time"])
            if s is not None and s >= from_dt and en is not None and en > s:
                minutes += (en - s) / 60000

        daily = []
        for i in range(days - 1, -1, -1):
            key = day_key(i)
            cc = _scalar(
                conn,
                "SELECT COUNT(*) AS c FROM checklist_items WHERE user_id = ? "
                "AND is_completed = 1 AND date(completed_at) = date(?)",
                (user_id, key),
            )
            mc = _scalar(
                conn,
                "SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND date(created_at) = date(?)",
                (user_id, key),
            )
            ac = _scalar(
                conn,
                "SELECT COUNT(*) AS c FROM activity_log WHERE user_id = ? AND date(created_at) = date(?)",
                (user_id, key),
            )
            daily.append(
                {"date": key, "completed_count": cc, "memos": mc, "activity": ac}
            )

        goal_rows = conn.execute(
            "SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC LIMIT 5", (user_id,)
        ).fetchall()
        goals = []
        for g in goal_rows:
            target = g["target_value"] or 1
            try:
                target = float(target)
            except (TypeError, ValueError):
                target = 1.0
            pct = min(100, round(((g["current_value"] or 0) / target) * 100))
            goals.append(
                {
                    "id": g["id"],
                    "title": g["title"],
                    "goal_level": g["goal_level"],
                    "progress": pct,
                    "status": g["status"],
                }
            )

        activity = conn.execute(
            "SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
            (user_id,),
        ).fetchall()
        recent_activity = [dict(r) for r in activity]
    finally:
        conn.close()

    return {
        "period": period,
        "summary": {
            "total_checklist": cl_total,
            "completed_checklist": cl_done,
            "completion_rate": round((cl_done / cl_total) * 100) if cl_total else 0,
            "memos_created": memo_count,
            "calendar_hours": round((minutes / 60) * 10) / 10,
        },
        "goals": goals,
        "daily_breakdown": daily,
        "recent_activity": recent_activity,
    }


@router.get("/heatmap")
async def heatmap(request: Request, user_id: int = Depends(current_user_id)):
    try:
        days = int(request.query_params.get("days") or 91)
    except ValueError:
        days = 91
    days = min(365, days)

    cells = []
    conn = open_conn()
    try:
        for i in range(days - 1, -1, -1):
            key = day_key(i)
            cc = _scalar(
                conn,
                "SELECT COUNT(*) AS c FROM checklist_items WHERE user_id = ? "
                "AND is_completed = 1 AND date(completed_at) = date(?)",
                (user_id, key),
            )
            mc = _scalar(
                conn,
                "SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND date(created_at) = date(?)",
                (user_id, key),
            )
            cells.append({"date": key, "count": cc + mc})
    finally:
        conn.close()

    # 스트릭(연속 달성) — 최신 날짜부터 역순으로
    streak = 0
    for cell in reversed(cells):
        if cell["count"] > 0:
            streak += 1
        else:
            break

    return {"days": days, "cells": cells, "streak": streak}
