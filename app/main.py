"""LifeHub FastAPI 애플리케이션.

원본(Hono/Cloudflare Workers)의 라우팅 구조를 그대로 재현합니다.
프론트엔드(public/static/app.js)는 API = '/api' 를 사용하므로 경로를 동일하게 맞춥니다.

  /api/health              헬스체크
  /api/auth/*              인증 (JWT 불필요)
  /api/{tags,calendar,notes,checklist,goals,dashboard,settings}   JWT 필요
  /static/*                정적 파일
  그 외                     SPA 셸(index) 반환
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from db import DB_PATH, connect, ensure_schema, exec_script

from routes import auth, calendar, checklist, dashboard, goals, notes, settings, tags

BASE_DIR = Path(__file__).resolve().parent.parent  # pyserver/
PUBLIC_DIR = BASE_DIR / "public"
STATIC_DIR = PUBLIC_DIR / "static"

SHELL_HTML = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<meta name="theme-color" content="#6366f1" />
<link rel="icon" href="/favicon.ico" type="image/svg+xml" />
<title>LifeHub · 개인 관리</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { theme: { extend: { fontFamily: { sans: ['Pretendard','system-ui','-apple-system','sans-serif'] } } } }
</script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
<link href="/static/style.css" rel="stylesheet" />
</head>
<body class="bg-slate-50 text-slate-800">
<div id="root" class="min-h-screen"></div>
<div id="toast" class="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 space-y-2"></div>
<div id="modal-root"></div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="/static/app.js"></script>
</body>
</html>"""

FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<rect width="32" height="32" rx="8" fill="#6366f1"/>'
    '<path d="M16 7l2.5 6.5L25 16l-6.5 2.5L16 25l-2.5-6.5L7 16l6.5-2.5z" fill="#fff"/></svg>'
)


def _seed_if_needed() -> None:
    """SEED_DEMO=1 이고 데모 계정이 없을 때만 시드 주입."""
    seed_file = BASE_DIR / "seed.sql"
    if not seed_file.exists():
        return
    conn = connect()
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM users WHERE email = ?", ("demo@lifehub.app",)
        ).fetchone()
        if row and row[0] == 0:
            exec_script(conn, seed_file.read_text(encoding="utf-8"))
            print("[seed] 데모 데이터를 주입했습니다. (demo@lifehub.app / demo1234)")
        else:
            print("[seed] 데모 계정이 이미 존재하여 시드를 건너뜁니다.")
    except Exception as exc:  # noqa: BLE001 — 시드는 편의 기능
        print(f"[seed] 시드 실패: {exc}")
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        ensure_schema(conn)
    finally:
        conn.close()

    if os.environ.get("SEED_DEMO") == "1":
        _seed_if_needed()

    if not os.environ.get("JWT_SECRET"):
        print(
            "[warn] JWT_SECRET 이 설정되지 않았습니다. 기본 개발용 시크릿을 사용합니다.\n"
            "       운영 환경에서는 반드시 JWT_SECRET 을 설정하세요."
        )
    print(f"LifeHub (FastAPI) 시작 — DB: {DB_PATH}")
    yield


app = FastAPI(title="LifeHub", lifespan=lifespan, docs_url=None, redoc_url=None)

# 정적 파일 (public/static/* → /static/*)
if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/favicon.ico")
async def favicon():
    return Response(
        content=FAVICON_SVG,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/health")
async def health():
    from datetime import datetime, timezone

    return {
        "status": "ok",
        # 원본 Node 엔트리(src/server.ts)의 기본값과 동일하게 맞춥니다.
        "app": os.environ.get("APP_NAME", "LifeHub 개인 관리"),
        "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


# 인증 (JWT 불필요)
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# 이하 JWT 필요 (각 라우트가 Depends(current_user_id) 로 검증)
app.include_router(tags.router, prefix="/api/tags", tags=["tags"])
app.include_router(calendar.router, prefix="/api/calendar", tags=["calendar"])
app.include_router(notes.router, prefix="/api/notes", tags=["notes"])
app.include_router(checklist.router, prefix="/api/checklist", tags=["checklist"])
app.include_router(goals.router, prefix="/api/goals", tags=["goals"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
async def spa_shell(full_path: str, request: Request):
    """SPA 셸. /api/* 나 /static/* 는 위에서 처리되므로 여기 도달하지 않습니다."""
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    return HTMLResponse(SHELL_HTML)
