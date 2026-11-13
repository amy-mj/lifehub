"""인증 의존성 — TypeScript(auth.ts) 원본의 이식.

원본은 Hono 미들웨어로 /api/* 전체에 JWT 를 적용하고 /api/auth/* 만 제외합니다.
파이썬에서는 FastAPI 의존성으로 같은 역할을 합니다.
"""
from __future__ import annotations

import os

from fastapi import Depends, Header, HTTPException

import jwt_util

DEFAULT_SECRET = "lifehub-dev-secret-change-me-in-production"


def get_secret() -> str:
    return os.environ.get("JWT_SECRET") or DEFAULT_SECRET


def current_user_id(authorization: str | None = Header(default=None)) -> int:
    """Authorization: Bearer <token> 검증 후 userId 반환."""
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    try:
        payload = jwt_util.verify(token, get_secret())
    except ValueError:
        raise HTTPException(status_code=401, detail="유효하지 않거나 만료된 토큰입니다.")
    return int(payload["sub"])


AuthDep = Depends(current_user_id)
