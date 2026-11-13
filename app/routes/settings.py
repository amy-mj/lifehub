"""설정 라우트 — TypeScript(settings.ts) 원본의 이식."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request

from deps import current_user_id
from helpers import jbody, open_conn

router = APIRouter()

DEFAULTS = {
    "lunar_display": False,
    "week_start": "monday",
    "theme": "light",
    "accent": "#6366f1",
    "font_size": "medium",
    "notify_enabled": True,
    "quiet_hours": "22:00-07:00",
    "conflict_tolerance": 30,
    "cloud_provider": "google",
    "timezone": "Asia/Seoul",
    "default_map": "naver",
    "default_link_open": "system",
}


@router.get("")
@router.get("/")
async def get_settings(user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        row = conn.execute(
            "SELECT data FROM settings WHERE user_id = ?", (user_id,)
        ).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO settings (user_id, data) VALUES (?, ?)",
                (user_id, json.dumps(DEFAULTS, ensure_ascii=False)),
            )
            return DEFAULTS
        stored = {}
        try:
            parsed = json.loads(row["data"] or "{}")
            stored = parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            stored = {}
        return {**DEFAULTS, **stored}
    finally:
        conn.close()


@router.put("")
@router.put("/")
async def put_settings(request: Request, user_id: int = Depends(current_user_id)):
    body = await jbody(request)
    conn = open_conn()
    try:
        existing = conn.execute(
            "SELECT data FROM settings WHERE user_id = ?", (user_id,)
        ).fetchone()
        stored = {}
        if existing:
            try:
                parsed = json.loads(existing["data"] or "{}")
                stored = parsed if isinstance(parsed, dict) else {}
            except (ValueError, TypeError):
                stored = {}

        merged = {**DEFAULTS, **stored, **body}
        if existing:
            conn.execute(
                "UPDATE settings SET data = ?, updated_at = datetime('now') WHERE user_id = ?",
                (json.dumps(merged, ensure_ascii=False), user_id),
            )
        else:
            conn.execute(
                "INSERT INTO settings (user_id, data) VALUES (?, ?)",
                (user_id, json.dumps(merged, ensure_ascii=False)),
            )
        return merged
    finally:
        conn.close()
