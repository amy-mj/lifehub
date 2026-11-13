"""음력 ↔ 양력 변환 엔진 — TypeScript(lunar.ts) 원본의 파이썬 이식.

데이터: 1900~2050년 한국(KARI) 음력 테이블 (원본과 동일 비트 인코딩)
  - bit 0~3 : 윤월 번호 (0이면 윤달 없음)
  - bit 4~15: 1~12월 대소(1=30일)
  - bit 16  : 윤달이 30일인지
기준일: 1900-01-31 = 음력 1900-01-01
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

LUNAR_INFO = [
    0x4BD8, 0x4AE0, 0xA570, 0x54D5, 0xD260, 0xD950, 0x16554, 0x56A0, 0x9AD0, 0x55D2,
    0x4AE0, 0xA5B6, 0xA4D0, 0xD250, 0xDA95, 0xB550, 0x56A0, 0xADA2, 0x95D0, 0x4BB7,
    0x49B0, 0xA4B0, 0xB4B5, 0x6A90, 0xAD40, 0xBB54, 0x2B60, 0x95B0, 0x5372, 0x4970,
    0x6566, 0xE4A0, 0xEA50, 0x16A95, 0x5B50, 0x2B60, 0x18AE3, 0x92E0, 0x1C8D7, 0xC950,
    0xD4A0, 0x1D8A6, 0xB690, 0x56D0, 0x125B4, 0x25D0, 0x92D0, 0xD2B2, 0xA950, 0xD557,
    0xB4A0, 0xB550, 0x15555, 0x4DB0, 0x25B0, 0x18573, 0x52B0, 0xA9B8, 0x6950, 0x6AA0,
    0xAEA6, 0xAB50, 0x4B60, 0xAAE4, 0xA570, 0x5270, 0x7263, 0xD950, 0x6B57, 0x56A0,
    0x9AD0, 0x4DD5, 0x4AE0, 0xA4E0, 0xD4D4, 0xD250, 0xD598, 0xB540, 0xD6A0, 0x195A6,
    0x95B0, 0x49B0, 0xA9B4, 0xA4B0, 0xB27A, 0x6A50, 0x6D40, 0xB756, 0x2B60, 0x95B0,
    0x4B75, 0x4970, 0x64B0, 0x74A3, 0xEA50, 0x6D98, 0x5AD0, 0x2B60, 0x96E5, 0x92E0,
    0xC960, 0xE954, 0xD4A0, 0xDA50, 0x7552, 0x56C0, 0xABB7, 0x25D0, 0x92D0, 0xCAB5,
    0xA950, 0xB4A0, 0x1B4A3, 0xB550, 0x55D9, 0x4BA0, 0xA5B0, 0x5575, 0x52B0, 0xA950,
    0xB954, 0x6AA0, 0xAD50, 0x6B52, 0x4B60, 0xA6E6, 0xA570, 0x5270, 0x6A65, 0xD930,
    0x5AA0, 0xB6A3, 0x96D0, 0x4AFB, 0x4AE0, 0xA4D0, 0x1D0D6, 0xD250, 0xD520, 0xDD45,
    0xB6A0, 0x96D0, 0x55B2, 0x49B0, 0xA577, 0xA4B0, 0xB250, 0x1B255, 0x6D40, 0xADA0,
    0x18B63,
]

BASE_DATE = date(1900, 1, 31)

GAN = list("갑을병정무기경신임계")
ZHI = list("자축인묘진사오미신유술해")
LUNAR_DAY_NAMES = [
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
]


@dataclass(frozen=True)
class LunarDate:
    year: int
    month: int
    day: int
    is_leap: bool
    month_name: str
    day_name: str


LUNAR_MIN_YEAR = 1900
LUNAR_MAX_YEAR = 1900 + len(LUNAR_INFO) - 1  # 2050


def in_lunar_range(year: int) -> bool:
    """음력 테이블이 실제로 커버하는 연도인지 확인합니다."""
    return LUNAR_MIN_YEAR <= year <= LUNAR_MAX_YEAR


def _info(year: int) -> int:
    """연도별 음력 비트 테이블.

    ⚠️ 원본(JS)은 범위 밖 인덱스에서 `undefined` 를 얻고,
       `undefined & n` 이 0 으로 강제 변환되어 **조용히 틀린 값**을 냈습니다.
    파이썬은 음수 인덱스를 허용해 `LUNAR_INFO[-1]` 이 마지막 원소를 반환하므로
    (예: year=1899 → 2050년 데이터를 사용) 훨씬 더 위험합니다.
    따라서 범위 밖은 명시적으로 0 으로 처리해 최소한 '음력 정보 없음'으로
    일관되게 동작하도록 합니다. 실제 사용 경로(/lunar, /holidays)에서는
    in_lunar_range() 로 먼저 걸러냅니다.
    """
    if not in_lunar_range(year):
        return 0
    return LUNAR_INFO[year - LUNAR_MIN_YEAR]


def l_year_days(year: int) -> int:
    total = 348
    info = _info(year)
    i = 0x8000
    while i > 0x8:
        total += 1 if info & i else 0
        i >>= 1
    return total + leap_days(year)


def leap_month(year: int) -> int:
    return _info(year) & 0xF


def leap_days(year: int) -> int:
    if leap_month(year):
        return 30 if _info(year) & 0x10000 else 29
    return 0


def month_days(year: int, month: int) -> int:
    return 30 if _info(year) & (0x10000 >> month) else 29


def solar_to_lunar(y: int, m: int, d: int) -> LunarDate:
    offset = (date(y, m, d) - BASE_DATE).days
    ly = 1900
    while ly < LUNAR_MAX_YEAR + 1 and offset > 0:
        days = l_year_days(ly)
        if offset < days:
            break
        offset -= days
        ly += 1

    leap = leap_month(ly)
    is_leap = False
    lm = 1
    while lm < 13 and offset > 0:
        if leap > 0 and lm == leap + 1 and not is_leap:
            lm -= 1
            is_leap = True
            days = leap_days(ly)
        else:
            days = month_days(ly, lm)
        if is_leap and lm == leap + 1:
            is_leap = False
        if offset < days:
            break
        offset -= days
        lm += 1

    ld = offset + 1
    month_name = ("윤" if is_leap else "") + f"{lm}월"
    day_name = LUNAR_DAY_NAMES[ld - 1] if 1 <= ld <= 30 else str(ld)
    return LunarDate(ly, lm, ld, is_leap, month_name, day_name)


def lunar_to_solar(ly: int, lm: int, ld: int, is_leap: bool = False) -> dict:
    offset = 0
    for i in range(1900, min(ly, LUNAR_MAX_YEAR + 1)):
        offset += l_year_days(i)
    leap = leap_month(ly)
    added = False
    for i in range(1, lm):
        if leap > 0 and i == leap and not added:
            offset += leap_days(ly)
            added = True
        offset += month_days(ly, i)
    if is_leap and leap == lm:
        offset += month_days(ly, lm)
    offset += ld - 1
    dt = BASE_DATE + timedelta(days=offset)
    return {"year": dt.year, "month": dt.month, "day": dt.day}


def ganzhi_year(year: int) -> str:
    return GAN[(year - 4) % 10] + ZHI[(year - 4) % 12]


def lunar_month_length(year: int, month: int, is_leap: bool = False) -> int:
    if year < 1900 or year > 2050:
        return 30
    if is_leap:
        return leap_days(year)
    return month_days(year, month)


def next_lunar_month(year: int, month: int, is_leap: bool) -> dict:
    leap = leap_month(year)
    if not is_leap and leap == month:
        return {"year": year, "month": month, "isLeap": True, "days": leap_days(year)}
    ny, nm = year, month + 1
    if nm > 12:
        ny, nm = year + 1, 1
    return {"year": ny, "month": nm, "isLeap": False, "days": month_days(ny, nm)}


def add_lunar_months(year: int, month: int, is_leap: bool, day: int, n: int) -> dict:
    y, m, l, d = year, month, is_leap, day
    for _ in range(n):
        nx = next_lunar_month(y, m, l)
        y, m, l = nx["year"], nx["month"], nx["isLeap"]
        if d > nx["days"]:
            d = nx["days"]
    return {"year": y, "month": m, "day": d, "isLeap": l}


def lunar_to_solar_str(year: int, month: int, day: int, is_leap: bool = False) -> str:
    s = lunar_to_solar(year, month, day, is_leap)
    return f"{s['year']:04d}-{s['month']:02d}-{s['day']:02d}"
