"""라우트 공용 헬퍼."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from db import connect, ensure_schema


def open_conn() -> sqlite3.Connection:
    """스키마 보장 후 연결 반환 (원본의 요청 전 ensureSchema 대응)."""
    conn = connect()
    ensure_schema(conn)
    return conn


async def jbody(request: Request) -> dict:
    """본문 JSON 파싱. 실패하면 빈 dict — Hono 의 .catch(() => ({})) 와 동일."""
    try:
        raw = await request.body()
        if not raw:
            return {}
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, UnicodeDecodeError):
        return {}


def error(detail: str, status: int) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def to_bool(value: Any) -> bool:
    """JS 의 !! 연산자와 동일."""
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value not in ("", "0", "false", "False")
    return bool(value)


def parse_ms(value: Any) -> float | None:
    """JS new Date(x).getTime() 근사 — 실패 시 None (isNaN 대응)."""
    if not value:
        return None
    text = str(value).strip().replace(" ", "T")
    for candidate in (text, text[:19], text[:16], text[:10]):
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.timestamp() * 1000
        except ValueError:
            continue
    return None
