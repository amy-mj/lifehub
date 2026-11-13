"""SQLite 접근 계층 — TypeScript(db.ts) 원본의 이식.

원본은 Cloudflare D1(c.env.DB)을 사용합니다. 파이썬 서버에서는 표준 sqlite3 로
같은 스키마/쿼리를 그대로 실행합니다. D1 과 SQLite 는 같은 SQL 방언이므로
SQL 문장을 수정할 필요가 없습니다.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

DB_PATH = os.environ.get("DB_PATH", "./data/lifehub.db")

_init_lock = threading.Lock()
_initialized = False

SCHEMA_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#6366f1',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, name)
    )""",
    """CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        location TEXT,
        is_all_day INTEGER DEFAULT 0,
        is_lunar INTEGER DEFAULT 0,
        reminder_time INTEGER DEFAULT 0,
        recurrence TEXT DEFAULT 'NONE',
        recurrence_interval INTEGER DEFAULT 1,
        is_utility INTEGER DEFAULT 0,
        holiday_rule TEXT DEFAULT 'NONE',
        link_url TEXT,
        recur_basis TEXT DEFAULT 'SOLAR',
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_events_user_start ON calendar_events(user_id, start_time)",
    """CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT,
        content TEXT,
        note_type TEXT DEFAULT 'TEXT',
        link_url TEXT,
        og_title TEXT,
        og_desc TEXT,
        media_key TEXT,
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_notes_user_created ON notes(user_id, created_at)",
    """CREATE TABLE IF NOT EXISTS checklist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        labels TEXT DEFAULT '[]',
        is_completed INTEGER DEFAULT 0,
        recurrence TEXT DEFAULT 'NONE',
        completed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_checklist_user ON checklist_items(user_id, is_completed)",
    """CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        goal_level TEXT DEFAULT 'MONTHLY',
        parent_id INTEGER,
        target_value REAL DEFAULT 100,
        current_value REAL DEFAULT 0,
        measurement_type TEXT DEFAULT 'COUNT',
        measurement_unit TEXT DEFAULT 'count',
        source TEXT DEFAULT 'CHECKLIST',
        source_label TEXT,
        start_date TEXT,
        end_date TEXT,
        status TEXT DEFAULT 'IN_PROGRESS',
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_goals_user_level ON goals(user_id, goal_level)",
    """CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        kind TEXT DEFAULT 'INFO',
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS settings (
        user_id INTEGER PRIMARY KEY,
        data TEXT DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now'))
    )""",
    """CREATE TABLE IF NOT EXISTS holidays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT DEFAULT 'CUSTOM',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, date)
    )""",
    """CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        entity TEXT,
        detail TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at)",
]

# 기존 DB 에 신규 컬럼 보강 (원본 ensureColumn 과 동일 대상)
COLUMN_PATCHES = [
    ("calendar_events", "is_utility", "INTEGER DEFAULT 0"),
    ("calendar_events", "holiday_rule", "TEXT DEFAULT 'NONE'"),
    ("calendar_events", "link_url", "TEXT"),
    ("calendar_events", "recur_basis", "TEXT DEFAULT 'SOLAR'"),
    ("checklist_items", "description", "TEXT"),
]


def connect() -> sqlite3.Connection:
    """요청 단위 연결 생성. autocommit(격리 없음)으로 D1 과 동작을 맞춥니다."""
    conn = sqlite3.connect(DB_PATH, timeout=5.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    """스키마 보장 (idempotent). 원본 ensureSchema 와 동일한 순서/내용."""
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        for stmt in SCHEMA_STATEMENTS:
            conn.execute(stmt)
        for table, column, definition in COLUMN_PATCHES:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            except sqlite3.OperationalError:
                pass  # 이미 존재
        _initialized = True


# ── 조회 헬퍼 (D1 의 .all() / .first() / .run() 대응) ──────────────


def all_rows(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> list[dict]:
    cur = conn.execute(sql, tuple(params))
    return [dict(r) for r in cur.fetchall()]


def first_row(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> dict | None:
    cur = conn.execute(sql, tuple(params))
    row = cur.fetchone()
    return dict(row) if row is not None else None


def scalar(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> Any:
    cur = conn.execute(sql, tuple(params))
    row = cur.fetchone()
    return row[0] if row is not None else None


def run(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> tuple[int, int]:
    """(last_row_id, changes) 반환 — D1 의 meta.last_row_id / meta.changes 대응."""
    cur = conn.execute(sql, tuple(params))
    return int(cur.lastrowid or 0), int(cur.rowcount if cur.rowcount is not None else 0)


def exec_script(conn: sqlite3.Connection, sql: str) -> None:
    conn.executescript(sql)


def log_activity(
    conn: sqlite3.Connection, user_id: int, action: str, entity: str, detail: str = ""
) -> None:
    """활동 로그. 실패는 무시 (원본과 동일)."""
    try:
        conn.execute(
            "INSERT INTO activity_log (user_id, action, entity, detail) VALUES (?, ?, ?, ?)",
            (user_id, action, entity, detail),
        )
    except sqlite3.Error:
        pass


# ── 값 변환 헬퍼 ────────────────────────────────────────────────


def json_list(value: Any, fallback: list | None = None) -> list:
    """TEXT 로 저장된 JSON 배열 파싱 (원본 json<T>() 대응)."""
    if not value:
        return fallback if fallback is not None else []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else (fallback if fallback is not None else [])
    except (ValueError, TypeError):
        return fallback if fallback is not None else []


def now_iso() -> str:
    """JS 의 new Date().toISOString() 과 동일 포맷 (밀리초 + Z)."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
