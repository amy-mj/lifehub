#!/usr/bin/env python3
"""TS(Node) ↔ Python(FastAPI) 쓰기(CRUD) 차등 테스트.

조회 테스트(diff_test.py)가 "읽기가 같은가"를 본다면, 이 스크립트는
"쓰기가 같은가"를 봅니다. 두 서버에 **완전히 동일한 순서로 같은 요청**을 보내고
응답과 최종 DB 상태를 비교합니다.

핵심 전제: 두 서버가 동일한 DB 스냅샷에서 출발하므로 AUTOINCREMENT 로 채번되는
id 도 동일해야 합니다. id 가 갈라지면 그 자체가 불일치 신호입니다.

사용:
  python3 write_test.py --ts http://localhost:3600 --py http://localhost:3500

종료코드: 0 = 전부 일치, 1 = 불일치
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

import requests

DEMO_EMAIL = "demo@lifehub.app"
DEMO_PASSWORD = "demo1234"

# 응답에서 매번 달라지는 필드 (비교 제외)
VOLATILE_KEYS = {"created_at", "updated_at", "time", "completed_at"}

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
DIM = "\033[2m"
RESET = "\033[0m"


def strip_volatile(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: strip_volatile(v) for k, v in sorted(obj.items()) if k not in VOLATILE_KEYS}
    if isinstance(obj, list):
        return [strip_volatile(x) for x in obj]
    return obj


class Pair:
    """두 서버에 같은 요청을 보내고 응답을 비교합니다."""

    def __init__(self, ts: str, py: str) -> None:
        self.ts = ts.rstrip("/")
        self.py = py.rstrip("/")
        self.ts_token = self._login(self.ts)
        self.py_token = self._login(self.py)
        self.passed = 0
        self.failed: list[str] = []

    @staticmethod
    def _login(base: str) -> str:
        r = requests.post(
            f"{base}/api/auth/login",
            json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
            timeout=10,
        )
        r.raise_for_status()
        return r.json()["access_token"]

    def _send(self, base: str, token: str, method: str, path: str, body: Any) -> tuple[int, Any]:
        r = requests.request(
            method,
            f"{base}{path}",
            headers={"Authorization": f"Bearer {token}"},
            json=body,
            timeout=20,
        )
        try:
            return r.status_code, r.json()
        except Exception:  # noqa: BLE001
            return r.status_code, r.text

    def call(self, label: str, method: str, path: str, body: Any = None) -> Any:
        """양쪽에 동일 요청 → 응답 비교. Python 쪽 body 를 반환(후속 요청에 재사용)."""
        ts_code, ts_body = self._send(self.ts, self.ts_token, method, path, body)
        py_code, py_body = self._send(self.py, self.py_token, method, path, body)

        a, b = strip_volatile(ts_body), strip_volatile(py_body)
        if ts_code == py_code and a == b:
            self.passed += 1
            print(f"  {GREEN}OK{RESET}   {method:<6} {label:<44} {DIM}({ts_code}){RESET}")
        else:
            self.failed.append(f"{method} {label}")
            print(f"  {RED}FAIL{RESET} {method:<6} {label}")
            print(f"       status: ts={ts_code} py={py_code}")
            self._explain(a, b)
        return py_body

    def _explain(self, a: Any, b: Any) -> None:
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
                        print(f"       {YELLOW}{path}.{k}{RESET}: ts 없음 / py={y[k]!r}")
                        shown["n"] += 1
                    elif k not in y:
                        print(f"       {YELLOW}{path}.{k}{RESET}: py 없음 / ts={x[k]!r}")
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
                print(f"       {YELLOW}{path}{RESET}: ts={xs[:80]} py={ys[:80]}")
                shown["n"] += 1

        walk(a, b, "root", 0)

    def report(self) -> int:
        total = self.passed + len(self.failed)
        print()
        if not self.failed:
            print(f"{GREEN}쓰기 전부 일치: {self.passed}/{total}{RESET}")
            return 0
        print(f"{RED}쓰기 불일치 {len(self.failed)}건 / 전체 {total}{RESET}")
        for f in self.failed:
            print(f"  - {f}")
        return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ts", default="http://localhost:3600")
    ap.add_argument("--py", default="http://localhost:3500")
    args = ap.parse_args()

    p = Pair(args.ts, args.py)

    print("\n[1] 태그 CRUD")
    tag = p.call("POST /api/tags", "POST", "/api/tags", {"name": "차등테스트", "color": "#ef4444"})
    tid = tag.get("id")
    if tid:
        p.call("PUT /api/tags/{id}", "PUT", f"/api/tags/{tid}", {"name": "차등테스트2", "color": "#22c55e"})
        p.call("DELETE /api/tags/{id}", "DELETE", f"/api/tags/{tid}")

    print("\n[2] 노트 CRUD")
    note = p.call(
        "POST /api/notes",
        "POST",
        "/api/notes",
        {
            "title": "차등 노트",
            "content": "본문입니다",
            "note_type": "TEXT",
            "tags": ["work"],
        },
    )
    nid = note.get("id")
    if nid:
        p.call("GET /api/notes/{id}", "GET", f"/api/notes/{nid}")
        p.call("PUT /api/notes/{id}", "PUT", f"/api/notes/{nid}", {"title": "수정된 노트", "content": "수정 본문"})
        p.call("GET /api/notes/{id} (수정 후)", "GET", f"/api/notes/{nid}")

    print("\n[3] 체크리스트 CRUD + 반복 재생성")
    item = p.call(
        "POST /api/checklist",
        "POST",
        "/api/checklist",
        {"title": "차등 할일", "labels": ["운동"], "recurrence": "DAILY"},
    )
    cid = item.get("id")
    if cid:
        # 반복 항목 완료 → 새 항목 자동 생성 (regenerated)
        p.call("PATCH /api/checklist/{id}/complete", "PATCH", f"/api/checklist/{cid}/complete")
        # 다시 열기 (재생성 없음)
        p.call("PATCH /api/checklist/{id}/complete (해제)", "PATCH", f"/api/checklist/{cid}/complete")
        p.call("PUT /api/checklist/{id}", "PUT", f"/api/checklist/{cid}", {"title": "차등 할일 수정"})
        p.call("DELETE /api/checklist/{id}", "DELETE", f"/api/checklist/{cid}")

    print("\n[4] 일정 CRUD (반복 포함)")
    ev = p.call(
        "POST /api/calendar/events",
        "POST",
        "/api/calendar/events",
        {
            "title": "차등 일정",
            "start_time": "2026-11-20T09:00:00",
            "end_time": "2026-11-20T10:00:00",
            "recurrence": "WEEKLY",
            "tags": ["work"],
        },
    )
    eid = ev.get("id")
    if eid:
        p.call(
            "PUT /api/calendar/events/{id}",
            "PUT",
            f"/api/calendar/events/{eid}",
            {"title": "차등 일정 수정", "recurrence_interval": 2},
        )
        p.call(
            "POST /api/calendar/check-conflicts",
            "POST",
            "/api/calendar/check-conflicts",
            {"start_time": "2026-11-20T09:30:00", "end_time": "2026-11-20T10:30:00"},
        )
        p.call("DELETE /api/calendar/events/{id}", "DELETE", f"/api/calendar/events/{eid}")

    print("\n[5] 목표 CRUD")
    goal = p.call(
        "POST /api/goals",
        "POST",
        "/api/goals",
        {
            "title": "차등 목표",
            "goal_level": "WEEKLY",
            "target_value": 5,
            "measurement_type": "COUNT",
            "measurement_unit": "회",
            "source": "CHECKLIST",
            "source_label": "운동",
            "start_date": "2026-11-01",
            "end_date": "2026-11-30",
            "tags": ["운동"],
        },
    )
    gid = goal.get("id")
    if gid:
        p.call("GET /api/goals/{id}/progress", "GET", f"/api/goals/{gid}/progress")
        p.call("PUT /api/goals/{id}", "PUT", f"/api/goals/{gid}", {"target_value": 10})
        p.call("DELETE /api/goals/{id}", "DELETE", f"/api/goals/{gid}")

    print("\n[6] 커스텀 휴일 CRUD")
    hol = p.call(
        "POST /api/calendar/holidays",
        "POST",
        "/api/calendar/holidays",
        {"date": "2026-11-21", "name": "차등 휴일"},
    )
    p.call("GET /api/calendar/holidays?year=2026", "GET", "/api/calendar/holidays?year=2026")
    hid = hol.get("id") if isinstance(hol, dict) else None
    if hid:
        p.call("DELETE /api/calendar/holidays/{id}", "DELETE", f"/api/calendar/holidays/{hid}")
    else:
        # 원본 TS 는 id 를 응답에 넣지 않으므로 DB 에서 찾아 삭제
        print(f"       {DIM}(POST 응답에 id 없음 → 삭제 단계 생략, 양쪽 동일 동작){RESET}")

    print("\n[7] 설정 PUT")
    p.call("PUT /api/settings", "PUT", "/api/settings", {"theme": "dark", "week_start": "monday"})
    p.call("GET /api/settings (수정 후)", "GET", "/api/settings")

    print("\n[8] 에러 케이스 (검증 실패 응답 동일성)")
    p.call("POST /api/tags (이름 없음)", "POST", "/api/tags", {})
    p.call("POST /api/notes (제목 없음)", "POST", "/api/notes", {"content": "x"})
    p.call("POST /api/checklist (제목 없음)", "POST", "/api/checklist", {})
    p.call("POST /api/calendar/events (시간 없음)", "POST", "/api/calendar/events", {"title": "x"})
    p.call("GET /api/notes/99999 (없는 id)", "GET", "/api/notes/99999")
    p.call("GET /api/goals/99999/progress (없는 id)", "GET", "/api/goals/99999/progress")

    print("\n[9] 쓰기 후 목록 재조회 (정합성)")
    p.call("GET /api/tags (최종)", "GET", "/api/tags")
    p.call("GET /api/notes (최종)", "GET", "/api/notes")
    p.call("GET /api/checklist (최종)", "GET", "/api/checklist")
    p.call("GET /api/goals (최종)", "GET", "/api/goals")

    return p.report()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except requests.exceptions.RequestException as exc:
        print(f"{RED}요청 실패: {exc}{RESET}")
        sys.exit(2)
