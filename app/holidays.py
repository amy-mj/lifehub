"""한국 공휴일 + 대체공휴일 계산 엔진 — TypeScript(holidays.ts) 원본의 파이썬 이식.

대체공휴일 규칙(현행, 근사) — 원본과 동일
  - 설날/추석 연휴: 일요일과 겹치면 연휴 다음 첫 비공휴일
  - 어린이날/삼일절/광복절/개천절/한글날/성탄절: 토·일과 겹치면 다음 첫 비공휴일
  - 부처님오신날: 토·일과 겹치면 다음 첫 비공휴일
  - 신정/현충일: 대체공휴일 없음
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List

from lunar import lunar_to_solar

FIXED = [
    (1, 1, "신정"),
    (3, 1, "삼일절"),
    (5, 5, "어린이날"),
    (6, 6, "현충일"),
    (8, 15, "광복절"),
    (10, 3, "개천절"),
    (10, 9, "한글날"),
    (12, 25, "성탄절"),
]

SUBSTITUTE_SOLAR = {"삼일절", "어린이날", "광복절", "개천절", "한글날", "성탄절"}
SUBSTITUTE_LUNAR = {"부처님오신날"}


def _ymd(y: int, m: int, d: int) -> str:
    return f"{y:04d}-{m:02d}-{d:02d}"


def _parse(iso: str) -> date:
    y, m, d = (int(x) for x in iso.split("-"))
    return date(y, m, d)


def _dow(iso: str) -> int:
    """JS getUTCDay() 와 동일: 0=일요일 ... 6=토요일"""
    return (_parse(iso).weekday() + 1) % 7


def _add_days(iso: str, n: int) -> str:
    dt = _parse(iso) + timedelta(days=n)
    return _ymd(dt.year, dt.month, dt.day)


def build_year(year: int) -> List[dict]:
    mp: Dict[str, str] = {}

    def put(iso: str, name: str) -> None:
        if iso not in mp:
            mp[iso] = name

    # 양력 고정 공휴일
    for m, d, name in FIXED:
        put(_ymd(year, m, d), name)

    # 음력 명절
    seol = lunar_to_solar(year, 1, 1)
    seol_iso = _ymd(seol["year"], seol["month"], seol["day"])
    put(seol_iso, "설날")
    put(_add_days(seol_iso, -1), "설날 연휴")
    put(_add_days(seol_iso, 1), "설날 연휴")

    chuseok = lunar_to_solar(year, 8, 15)
    chu_iso = _ymd(chuseok["year"], chuseok["month"], chuseok["day"])
    put(chu_iso, "추석")
    put(_add_days(chu_iso, -1), "추석 연휴")
    put(_add_days(chu_iso, 1), "추석 연휴")

    buddha = lunar_to_solar(year, 4, 8)
    put(_ymd(buddha["year"], buddha["month"], buddha["day"]), "부처님오신날")

    # 초기 공휴일 목록 (원본과 동일하게 모두 PUBLIC)
    holidays: List[dict] = [{"date": k, "name": v, "kind": "PUBLIC"} for k, v in mp.items()]

    def is_holiday(iso: str) -> bool:
        return iso in mp

    def next_free(frm: str) -> str:
        d = _add_days(frm, 1)
        while is_holiday(d) or _dow(d) == 0 or _dow(d) == 6:
            d = _add_days(d, 1)
        return d

    # 설날/추석 연휴: 일요일 포함 시 다음 비공휴일
    for base_name, base_iso in (("설날", seol_iso), ("추석", chu_iso)):
        block = [_add_days(base_iso, -1), base_iso, _add_days(base_iso, 1)]
        if any(_dow(x) == 0 for x in block):
            sub = next_free(block[2])
            holidays.append({"date": sub, "name": f"{base_name} 대체공휴일", "kind": "SUBSTITUTE"})
            mp[sub] = f"{base_name} 대체공휴일"

    # 단일 공휴일 대체 규칙 (스냅샷 순회 — 원본과 동일)
    for h in list(holidays):
        if h["kind"] != "PUBLIC":
            continue
        base = h["name"].replace(" 연휴", "")
        if not (base in SUBSTITUTE_SOLAR or base in SUBSTITUTE_LUNAR):
            continue
        dow = _dow(h["date"])
        if dow == 0 or dow == 6:
            sub = next_free(h["date"])
            if sub not in mp:
                holidays.append({"date": sub, "name": f"{base} 대체공휴일", "kind": "SUBSTITUTE"})
                mp[sub] = f"{base} 대체공휴일"

    # 중복 제거(날짜 기준 최초 항목 유지) + 정렬
    uniq: Dict[str, dict] = {}
    for h in holidays:
        if h["date"] not in uniq:
            uniq[h["date"]] = h
    return sorted(uniq.values(), key=lambda x: x["date"])


_year_cache: Dict[int, List[dict]] = {}


def holidays_for_year(year: int) -> List[dict]:
    if year not in _year_cache:
        _year_cache[year] = build_year(year)
    return _year_cache[year]


def holiday_map(years: List[int], custom: List[dict] | None = None) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for y in years:
        for h in holidays_for_year(y):
            out[h["date"]] = h["name"]
    for h in custom or []:
        out[h["date"]] = h["name"]
    return out


def is_holiday(iso: str, custom_map: Dict[str, str] | None = None) -> str | None:
    y = int(iso[:4])
    for h in holidays_for_year(y):
        if h["date"] == iso:
            return h["name"]
    if custom_map and iso in custom_map:
        return custom_map[iso]
    return None


def adjust_for_holiday(iso: str, rule: str, custom_map: Dict[str, str] | None = None) -> dict:
    """공과금 납부일 보정. rule: NONE | BEFORE | AFTER | POSTPONE"""
    if not rule or rule == "NONE":
        return {"date": iso, "moved": 0, "reason": ""}

    custom_map = custom_map or {}

    def is_non_work(d: str) -> bool:
        return _dow(d) == 0 or _dow(d) == 6 or bool(is_holiday(d, custom_map))

    if not is_non_work(iso):
        return {"date": iso, "moved": 0, "reason": ""}

    if rule == "BEFORE":
        d, moved = _add_days(iso, -1), 1
        while is_non_work(d):
            d = _add_days(d, -1)
            moved += 1
        return {"date": d, "moved": -moved, "reason": "휴일 직전 평일로 이동"}

    d, moved = _add_days(iso, 1), 1
    while is_non_work(d):
        d = _add_days(d, 1)
        moved += 1
    reason = "휴일 다음 평일로 자동 이월" if rule == "POSTPONE" else "휴일 다음 평일로 이동"
    return {"date": d, "moved": moved, "reason": reason}
