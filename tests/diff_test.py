#!/usr/bin/env python3
"""TS(Node) ↔ Python(FastAPI) 응답 1:1 차등 테스트.

두 서버를 같은 시드로 띄운 뒤, 모든 조회 API 의 응답을 정규화 비교합니다.
휘발성 필드(created_at/updated_at/time)는 제거하고, 나머지는 완전 일치를 요구합니다.

사용:
  python3 diff_test.py --ts http://localhost:3600 --py http://localhost:3500

종료코드: 0 = 전부 일치, 1 = 불일치 존재
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

import requests

DEMO_EMAIL = "demo@lifehub.app"
DEMO_PASSWORD = "demo1234"

# 비교에서 제외할 휘발성 키 (값이 매번 달라짐)
VOLATILE_KEYS = {"created_at", "updated_at", "time", "generated_at"}
VOLATILE_ITEM_KEYS = {"created_at", "updated_at"}

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
DIM = "\033[2m"
RESET = "\033[0m"


def strip_volatile(obj: Any) -> Any:
    """재귀적으로 휘발성 키를 제거하고 dict 키를 정렬합니다."""
    if isinstance(obj, dict):
        return {
            k: strip_volatile(v)
            for k, v in sorted(obj.items())
            if k not in VOLATILE_KEYS
        }
    if isinstance(obj, list):
        return [strip_volatile(x) for x in obj]
    return obj


def login(base: str) -> str:
    r = requests.post(
        f"{base}/api/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"{base} 로그인 실패: {data}")
    return token


class Comparator:
    def __init__(self, ts: str, py: str) -> None:
        self.ts = ts.rstrip("/")
        self.py = py.rstrip("/")
        self.ts_token = login(self.ts)
        self.py_token = login(self.py)
        self.passed = 0
        self.failed: list[str] = []

    def _get(self, base: str, token: str, path: str) -> tuple[int, Any]:
        r = requests.get(
            f"{base}{path}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        try:
            body = r.json()
        except Exception:  # noqa: BLE001
            body = r.text
        return r.status_code, body

    def check(self, label: str, path: str) -> None:
        ts_code, ts_body = self._get(self.ts, self.ts_token, path)
        py_code, py_body = self._get(self.py, self.py_token, path)

        ts_norm = strip_volatile(ts_body)
        py_norm = strip_volatile(py_body)

        if ts_code == py_code and ts_norm == py_norm:
            self.passed += 1
            size = len(json.dumps(ts_norm, ensure_ascii=False))
            print(f"  {GREEN}OK{RESET}   {label:<48} {DIM}({ts_code}, {size}B){RESET}")
            return

        self.failed.append(label)
        print(f"  {RED}FAIL{RESET} {label}")
        print(f"       status: ts={ts_code} py={py_code}")
        self._explain(ts_norm, py_norm)

    def _explain(self, a: Any, b: Any, prefix: str = "", depth: int = 0) -> None:
        """첫 불일치 지점을 최대 5개까지 짚어줍니다."""
        shown = {"n": 0}

        def walk(x: Any, y: Any, path: str, d: int) -> None:
            if shown["n"] >= 5 or d > 6:
                return
            if type(x) is not type(y):  # noqa: E721
                print(f"       {YELLOW}{path}{RESET}: type ts={type(x).__name__} py={type(y).__name__}")
                shown["n"] += 1
                return
            if isinstance(x, dict):
                for k in sorted(set(x) | set(y)):
                    if k not in x:
                        print(f"       {YELLOW}{path}.{k}{RESET}: ts 에 없음 / py={y[k]!r}")
                        shown["n"] += 1
                    elif k not in y:
                        print(f"       {YELLOW}{path}.{k}{RESET}: py 에 없음 / ts={x[k]!r}")
                        shown["n"] += 1
                    else:
                        walk(x[k], y[k], f"{path}.{k}", d + 1)
            elif isinstance(x, list):
                if len(x) != len(y):
                    print(f"       {YELLOW}{path}{RESET}: 길이 ts={len(x)} py={len(y)}")
                    shown["n"] += 1
                for i in range(min(len(x), len(y))):
                    walk(x[i], y[i], f"{path}[{i}]", d + 1)
            elif x != y:
                xs, ys = repr(x), repr(y)
                if len(xs) > 90:
                    xs = xs[:90] + "…"
                if len(ys) > 90:
                    ys = ys[:90] + "…"
                print(f"       {YELLOW}{path}{RESET}: ts={xs} py={ys}")
                shown["n"] += 1

        walk(a, b, prefix or "root", depth)

    def report(self) -> int:
        total = self.passed + len(self.failed)
        print()
        if not self.failed:
            print(f"{GREEN}전부 일치: {self.passed}/{total}{RESET}")
            return 0
        print(f"{RED}불일치 {len(self.failed)}건 / 전체 {total}{RESET}")
        for f in self.failed:
            print(f"  - {f}")
        return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ts", default="http://localhost:3600")
    ap.add_argument("--py", default="http://localhost:3500")
    args = ap.parse_args()

    cmp = Comparator(args.ts, args.py)

    print("\n[1] 단순 조회")
    cmp.check("GET /api/health", "/api/health")
    cmp.check("GET /api/tags", "/api/tags")
    cmp.check("GET /api/notes", "/api/notes")
    cmp.check("GET /api/notes/1", "/api/notes/1")
    cmp.check("GET /api/checklist", "/api/checklist")
    cmp.check("GET /api/checklist?labels=영어", "/api/checklist?labels=%EC%98%81%EC%96%B4")
    cmp.check("GET /api/checklist?labels=work,운동", "/api/checklist?labels=work,%EC%9A%B4%EB%8F%99")
    cmp.check("GET /api/checklist/labels/stats", "/api/checklist/labels/stats")
    cmp.check("GET /api/goals", "/api/goals")
    cmp.check("GET /api/goals/1/progress", "/api/goals/1/progress")
    cmp.check("GET /api/goals/2/progress", "/api/goals/2/progress")
    cmp.check("GET /api/settings", "/api/settings")
    cmp.check("GET /api/calendar/recurring-list", "/api/calendar/recurring-list")
    cmp.check(
        "GET /api/calendar/recurring-list?frequency=WEEKLY",
        "/api/calendar/recurring-list?frequency=WEEKLY",
    )

    print("\n[2] 달력 — 반복 전개 (핵심 위험 지점)")
    ranges = [
        ("2026-11-01", "2026-11-30"),
        ("2026-01-01", "2026-12-31"),
        ("2025-06-01", "2027-06-30"),
        ("2026-02-25", "2026-03-05"),
        ("2026-01-25", "2026-02-05"),
    ]
    for s, e in ranges:
        cmp.check(
            f"GET /api/calendar/events {s}~{e}",
            f"/api/calendar/events?start_date={s}&end_date={e}",
        )
    cmp.check(
        "GET /api/calendar/events tags=work",
        "/api/calendar/events?start_date=2026-11-01&end_date=2026-11-30&tags=work",
    )
    # 실제 데이터(2026년)를 전부 덮는 넓은 범위 — 음력 테이블 범위(1900~2050) 안이므로 엄격 비교
    cmp.check(
        "GET /api/calendar/events (2020~2035 넓은 범위)",
        "/api/calendar/events?start_date=2020-01-01&end_date=2035-12-31",
    )

    print("\n[3] 음력 / 공휴일")
    for d in ["2026-11-13", "2026-01-01", "2024-02-10", "2033-02-01", "2025-10-06"]:
        cmp.check(f"GET /api/calendar/lunar date={d}", f"/api/calendar/lunar?date={d}")
    for y, m in [(2026, 11), (2026, 2), (2025, 1), (2027, 7)]:
        cmp.check(
            f"GET /api/calendar/lunar-month {y}-{m:02d}",
            f"/api/calendar/lunar-month?year={y}&month={m}",
        )
    for y in [2024, 2025, 2026, 2027, 2030]:
        cmp.check(f"GET /api/calendar/holidays year={y}", f"/api/calendar/holidays?year={y}")

    print("\n[4] 대시보드")
    for p in ["today", "week", "month"]:
        cmp.check(f"GET /api/dashboard/stats?period={p}", f"/api/dashboard/stats?period={p}")
    cmp.check("GET /api/dashboard/stats (기본)", "/api/dashboard/stats")
    cmp.check("GET /api/dashboard/heatmap", "/api/dashboard/heatmap")

    return cmp.report()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except requests.exceptions.RequestException as exc:
        print(f"{RED}요청 실패: {exc}{RESET}")
        print("두 서버가 떠 있는지 확인하세요.")
        sys.exit(2)
