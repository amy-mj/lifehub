"""달력 라우트 — TypeScript(calendar.ts) 원본의 이식.

주의: 반복 일정 전개는 JS Date.UTC 의 '오버플로 정규화' 동작에 의존합니다.
      (예: Date.UTC(2026,0,32) → 2월 1일, 1/31 + 1개월 → 3/3 이 되어 '월 불일치'로 스킵)
      아래 date_utc() 가 그 동작을 그대로 재현합니다.
"""
from __future__ import annotations

import calendar as pycal
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

import holidays as H
import lunar as L
from db import json_list, log_activity
from deps import current_user_id
from helpers import error, jbody, open_conn, to_bool

router = APIRouter()


# ── JS Date.UTC 호환 헬퍼 ──────────────────────────────────────


def date_utc(year: int, month0: int, day: int) -> date:
    """JS Date.UTC(y, m0, d) 와 동일하게 월/일 오버플로를 정규화합니다."""
    total = year * 12 + month0
    yy, mm = total // 12, total % 12 + 1
    return date(yy, mm, 1) + timedelta(days=day - 1)


def iso_of(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def date_part(value: Any) -> str:
    """'YYYY-MM-DD' 부분만 추출.

    원본 JS 는 split('T')[0] 이지만, 실제 데이터에는 SQLite 형식인
    'YYYY-MM-DD HH:MM:SS'(공백 구분)가 섞여 있으므로 공백도 함께 처리합니다.
    """
    text = str(value).strip()
    for sep in ("T", " "):
        text = text.split(sep)[0]
    return text


def parse_iso(iso: str) -> date:
    y, m, d = (int(x) for x in date_part(iso).split("-"))
    return date(y, m, d)


# ── 직렬화 ─────────────────────────────────────────────────────


def serialize(e: dict) -> dict:
    return {
        **e,
        "tags": json_list(e.get("tags"), []),
        "is_all_day": to_bool(e.get("is_all_day")),
        "is_lunar": to_bool(e.get("is_lunar")),
        "is_utility": to_bool(e.get("is_utility")),
        "holiday_rule": e.get("holiday_rule") or "NONE",
        "recur_basis": e.get("recur_basis") or "SOLAR",
    }


# ── 반복 전개 ──────────────────────────────────────────────────


def expand_recurrence(e: dict, start_date: str, end_date: str) -> list[dict]:
    out: list[dict] = []
    rec = e.get("recurrence") or "NONE"
    try:
        interval = max(1, int(e.get("recurrence_interval") or 1))
    except (TypeError, ValueError):
        interval = 1
    base_date = date_part(e.get("start_time"))
    start = parse_iso(start_date)
    end = parse_iso(end_date)

    if rec == "NONE":
        if start <= parse_iso(base_date) <= end:
            out.append({"date": base_date, "ev": e})
        return out

    by, bm, bd = (int(x) for x in base_date.split("-"))

    # ── 음력(LUNAR) 기준 반복: 매월·매년만 음력 달력에 종속 ──
    if e.get("recur_basis") == "LUNAR" and rec in ("MONTHLY", "YEARLY"):
        bl = L.solar_to_lunar(by, bm, bd)
        is_yearly = rec == "YEARLY"
        for k in range(600):
            if is_yearly:
                ly = bl.year + k * interval
                maxd = L.lunar_month_length(ly, bl.month, bl.is_leap)
                dd = min(bl.day, maxd) if maxd > 0 else bl.day
                iso = L.lunar_to_solar_str(ly, bl.month, dd, bl.is_leap)
            else:
                ll = L.add_lunar_months(bl.year, bl.month, bl.is_leap, bl.day, k * interval)
                iso = L.lunar_to_solar_str(ll["year"], ll["month"], ll["day"], ll["isLeap"])
            d = parse_iso(iso)
            if d > end:
                break
            if d >= start:
                out.append({"date": iso, "ev": e})
        return out

    if rec == "DAILY":
        t = date(by, bm, bd)
        step = timedelta(days=interval)
        while t <= end:
            if t >= start:
                out.append({"date": iso_of(t), "ev": e})
            t += step
    elif rec == "WEEKLY":
        t = date(by, bm, bd)
        step = timedelta(days=interval * 7)
        while t <= end:
            if t >= start:
                out.append({"date": iso_of(t), "ev": e})
            t += step
    elif rec == "MONTHLY":
        for k in range(120):
            dt = date_utc(by, bm - 1 + k * interval, bd)
            if (dt.month - 1) != ((bm - 1 + k * interval) % 12 + 12) % 12:
                continue  # 말일 오버플로(예: 1/31 → 3/3) 는 원본과 동일하게 건너뜀
            if dt > end:
                break
            if dt >= start:
                out.append({"date": iso_of(dt), "ev": e})
    elif rec == "YEARLY":
        for k in range(30):
            dt = date_utc(by + k * interval, bm - 1, bd)
            if dt > end:
                break
            if dt >= start:
                out.append({"date": iso_of(dt), "ev": e})
    return out


def custom_holiday_map(conn, user_id: int) -> dict[str, str]:
    rows = conn.execute("SELECT date, name FROM holidays WHERE user_id = ?", (user_id,)).fetchall()
    return {r["date"]: r["name"] for r in rows}


# ── 일정 목록 ──────────────────────────────────────────────────


@router.get("/events")
async def list_events(request: Request, user_id: int = Depends(current_user_id)):
    params = request.query_params
    start = params.get("start_date") or "1970-01-01"
    end = params.get("end_date") or "2999-12-31"
    tag_filter = params.get("tags")

    conn = open_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM calendar_events WHERE user_id = ?", (user_id,)
        ).fetchall()
        custom = custom_holiday_map(conn, user_id)
    finally:
        conn.close()

    years = [int(start[:4]), int(end[:4])]
    hmap = H.holiday_map(
        years,
        [{"date": d, "name": n, "kind": "CUSTOM"} for d, n in custom.items()],
    )

    items: list[dict] = []
    for raw in rows:
        e = serialize(dict(raw))
        for occ in expand_recurrence(e, start, end):
            occ_date = occ["date"]
            display_date = occ_date
            moved_info = None
            if e["is_utility"] and e.get("holiday_rule") and e["holiday_rule"] != "NONE":
                adj = H.adjust_for_holiday(occ_date, e["holiday_rule"], custom)
                display_date = adj["date"]
                if adj["moved"] != 0:
                    moved_info = {
                        "from": occ_date,
                        "rule": e["holiday_rule"],
                        "reason": adj["reason"],
                    }
            if display_date < start or display_date > end:
                continue
            items.append(
                {
                    **occ["ev"],
                    "occurrence_date": display_date,
                    "original_date": occ_date,
                    "holiday_moved": moved_info,
                    "holiday_name": hmap.get(display_date) or None,
                }
            )

    if tag_filter:
        wanted = [t.strip() for t in tag_filter.split(",") if t.strip()]
        items = [i for i in items if any(w in i["tags"] for w in wanted)]

    items.sort(key=lambda i: i["occurrence_date"] + (i.get("start_time") or ""))
    return {"total": len(items), "items": items}


@router.post("/events")
async def create_event(request: Request, user_id: int = Depends(current_user_id)):
    b = await jbody(request)
    if not b.get("title") or not b.get("start_time"):
        return error("제목과 시작 시간은 필수입니다.", 400)

    import json as _json

    conn = open_conn()
    try:
        cur = conn.execute(
            """INSERT INTO calendar_events
               (user_id, title, description, start_time, end_time, location, link_url,
                is_all_day, is_lunar, reminder_time, recurrence, recurrence_interval,
                recur_basis, is_utility, holiday_rule, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                str(b["title"]),
                b.get("description") or "",
                str(b["start_time"]),
                b.get("end_time") or b["start_time"],
                b.get("location") or "",
                b.get("link_url") or "",
                1 if to_bool(b.get("is_all_day")) else 0,
                1 if to_bool(b.get("is_lunar")) else 0,
                int(b.get("reminder_time") or 0),
                b.get("recurrence") or "NONE",
                int(b.get("recurrence_interval") or 1),
                b.get("recur_basis") or "SOLAR",
                1 if to_bool(b.get("is_utility")) else 0,
                b.get("holiday_rule") or "NONE",
                _json.dumps(b.get("tags") or [], ensure_ascii=False),
            ),
        )
        row = conn.execute(
            "SELECT * FROM calendar_events WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        log_activity(conn, user_id, "create", "event", str(b["title"]))
        return JSONResponse(serialize(dict(row)), status_code=201)
    finally:
        conn.close()


@router.put("/events/{event_id}")
async def update_event(event_id: str, request: Request, user_id: int = Depends(current_user_id)):
    b = await jbody(request)
    import json as _json

    fields: list[str] = []
    values: list = []
    for key in (
        "title",
        "description",
        "start_time",
        "end_time",
        "location",
        "link_url",
        "reminder_time",
        "recurrence",
        "recurrence_interval",
        "recur_basis",
        "holiday_rule",
    ):
        if key in b:
            fields.append(f"{key} = ?")
            values.append(b[key])
    for key in ("is_all_day", "is_lunar", "is_utility"):
        if key in b:
            fields.append(f"{key} = ?")
            values.append(1 if to_bool(b[key]) else 0)
    if "tags" in b:
        fields.append("tags = ?")
        values.append(_json.dumps(b["tags"], ensure_ascii=False))
    fields.append("updated_at = datetime('now')")
    values.extend([event_id, user_id])

    conn = open_conn()
    try:
        conn.execute(
            f"UPDATE calendar_events SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
            tuple(values),
        )
        row = conn.execute(
            "SELECT * FROM calendar_events WHERE id = ? AND user_id = ?", (event_id, user_id)
        ).fetchone()
        if not row:
            return error("일정을 찾을 수 없습니다.", 404)
        return serialize(dict(row))
    finally:
        conn.close()


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        conn.execute(
            "DELETE FROM calendar_events WHERE id = ? AND user_id = ?", (event_id, user_id)
        )
        return {"message": "삭제되었습니다."}
    finally:
        conn.close()


@router.post("/check-conflicts")
async def check_conflicts(request: Request, user_id: int = Depends(current_user_id)):
    b = await jbody(request)
    start_time = b.get("start_time")
    end_time = b.get("end_time")
    exclude_id = b.get("exclude_id")
    if not start_time or not end_time:
        return error("시간 범위가 필요합니다.", 400)

    conn = open_conn()
    try:
        rows = conn.execute(
            """SELECT * FROM calendar_events
               WHERE user_id = ? AND datetime(start_time) < datetime(?)
                 AND datetime(COALESCE(end_time, start_time)) > datetime(?)
                 AND (? IS NULL OR id != ?)""",
            (user_id, end_time, start_time, exclude_id, exclude_id),
        ).fetchall()
        conflicting = [serialize(dict(r)) for r in rows]
        return {
            "has_conflict": len(conflicting) > 0,
            "conflict_count": len(conflicting),
            "conflicting_events": conflicting,
        }
    finally:
        conn.close()


@router.get("/recurring-list")
async def recurring_list(request: Request, user_id: int = Depends(current_user_id)):
    freq = request.query_params.get("frequency")
    sql = "SELECT * FROM calendar_events WHERE user_id = ? AND recurrence != 'NONE'"
    args: list = [user_id]
    if freq:
        sql += " AND recurrence = ?"
        args.append(freq)
    sql += " ORDER BY start_time ASC"

    conn = open_conn()
    try:
        rows = conn.execute(sql, tuple(args)).fetchall()
        items = [serialize(dict(r)) for r in rows]
        return {"total": len(items), "items": items}
    finally:
        conn.close()


@router.post("/recurring-delete")
async def recurring_delete(request: Request, user_id: int = Depends(current_user_id)):
    b = await jbody(request)
    ids = b.get("ids")
    if not isinstance(ids, list) or not ids:
        return error("삭제할 항목이 없습니다.", 400)
    placeholders = ",".join("?" for _ in ids)
    conn = open_conn()
    try:
        conn.execute(
            f"DELETE FROM calendar_events WHERE user_id = ? AND id IN ({placeholders})",
            tuple([user_id, *ids]),
        )
        return {"message": f"{len(ids)}개 삭제되었습니다."}
    finally:
        conn.close()


@router.get("/lunar")
async def lunar_convert(request: Request):
    params = request.query_params
    d = params.get("date") or iso_of(datetime.now(timezone.utc).date())
    try:
        y, m, dd = (int(x) for x in d.split("-"))
    except (ValueError, TypeError):
        return error("date=YYYY-MM-DD 형식이 필요합니다.", 400)
    if not y or not m or not dd:
        return error("date=YYYY-MM-DD 형식이 필요합니다.", 400)

    lunar = L.solar_to_lunar(y, m, dd)
    return {
        "solar": d,
        "lunar": {
            "year": lunar.year,
            "month": lunar.month,
            "day": lunar.day,
            "isLeap": lunar.is_leap,
            "monthName": lunar.month_name,
            "dayName": lunar.day_name,
        },
        "ganzhi": L.ganzhi_year(y),
    }


@router.get("/lunar-month")
async def lunar_month(request: Request):
    params = request.query_params
    today = datetime.now(timezone.utc).date()
    try:
        year = int(params.get("year") or 0) or today.year
    except ValueError:
        year = today.year
    try:
        month = int(params.get("month") or 0) or today.month
    except ValueError:
        month = today.month

    days = pycal.monthrange(year, month)[1]
    cells = []
    for d in range(1, days + 1):
        solar = f"{year}-{month:02d}-{d:02d}"
        lunar = L.solar_to_lunar(year, month, d)
        label = (
            f"{'윤' if lunar.is_leap else ''}{lunar.month}월"
            if lunar.day == 1
            else str(lunar.day)
        )
        cells.append(
            {
                "solar": solar,
                "day": d,
                "lunar": {
                    "year": lunar.year,
                    "month": lunar.month,
                    "day": lunar.day,
                    "isLeap": lunar.is_leap,
                    "monthName": lunar.month_name,
                    "dayName": lunar.day_name,
                },
                "label": label,
            }
        )
    return {"year": year, "month": month, "cells": cells}


@router.get("/holidays")
async def list_holidays(request: Request, user_id: int = Depends(current_user_id)):
    try:
        year = int(request.query_params.get("year") or 0) or datetime.now(timezone.utc).year
    except ValueError:
        year = datetime.now(timezone.utc).year

    builtin = H.holidays_for_year(year)
    conn = open_conn()
    try:
        custom_rows = conn.execute(
            "SELECT * FROM holidays WHERE user_id = ? ORDER BY date ASC", (user_id,)
        ).fetchall()
    finally:
        conn.close()

    merged = list(builtin) + [
        {"id": r["id"], "date": r["date"], "name": r["name"], "kind": "CUSTOM"}
        for r in custom_rows
    ]
    merged.sort(key=lambda h: h["date"])
    return {"year": year, "holidays": merged}


@router.post("/holidays")
async def add_holiday(request: Request, user_id: int = Depends(current_user_id)):
    b = await jbody(request)
    hdate = b.get("date")
    name = b.get("name")
    if not hdate or not name:
        return error("날짜와 이름은 필수입니다.", 400)

    conn = open_conn()
    try:
        dup = conn.execute(
            "SELECT id FROM holidays WHERE user_id = ? AND date = ?", (user_id, hdate)
        ).fetchone()
        if dup:
            conn.execute(
                "UPDATE holidays SET name = ? WHERE user_id = ? AND date = ?",
                (name, user_id, hdate),
            )
        else:
            conn.execute(
                "INSERT INTO holidays (user_id, date, name, kind) VALUES (?, ?, ?, ?)",
                (user_id, hdate, name, "CUSTOM"),
            )
        log_activity(conn, user_id, "create", "holiday", str(name))
        return JSONResponse({"date": hdate, "name": name, "kind": "CUSTOM"}, status_code=201)
    finally:
        conn.close()


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(holiday_id: str, user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        conn.execute(
            "DELETE FROM holidays WHERE id = ? AND user_id = ?", (holiday_id, user_id)
        )
        return {"message": "삭제되었습니다."}
    finally:
        conn.close()
