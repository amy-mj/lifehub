"""인증 라우트 — TypeScript(auth.ts) 원본의 이식."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import crypto_util
import jwt_util
from deps import get_secret
from helpers import error, jbody, open_conn
from db import log_activity

router = APIRouter()


@router.post("/register")
async def register(request: Request):
    body = await jbody(request)
    email = body.get("email")
    username = body.get("username")
    password = body.get("password")
    if not email or not username or not password:
        return error("이메일, 사용자명, 비밀번호는 필수입니다.", 400)
    if len(str(password)) < 6:
        return error("비밀번호는 6자 이상이어야 합니다.", 400)

    conn = open_conn()
    try:
        email_norm = str(email).lower()
        if conn.execute("SELECT id FROM users WHERE email = ?", (email_norm,)).fetchone():
            return error("이미 등록된 이메일입니다.", 409)

        password_hash = crypto_util.hash_password(str(password))
        cur = conn.execute(
            "INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
            (email_norm, str(username), password_hash),
        )
        user_id = int(cur.lastrowid or 0)
        user = conn.execute(
            "SELECT id, email, username, created_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()

        log_activity(conn, user_id, "register", "user", str(username))
        token = jwt_util.create_token(user_id, get_secret())
        return JSONResponse(
            {"access_token": token, "token_type": "bearer", "user": dict(user)},
            status_code=201,
        )
    finally:
        conn.close()


@router.post("/login")
async def login(request: Request):
    body = await jbody(request)
    email = body.get("email")
    password = body.get("password")
    if not email or not password:
        return error("이메일과 비밀번호를 입력하세요.", 400)

    conn = open_conn()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (str(email).lower(),)
        ).fetchone()
        if not row:
            return error("이메일 또는 비밀번호가 올바르지 않습니다.", 401)

        row = dict(row)
        if not crypto_util.verify_password(str(password), row["password_hash"]):
            return error("이메일 또는 비밀번호가 올바르지 않습니다.", 401)

        token = jwt_util.create_token(int(row["id"]), get_secret())
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {"id": row["id"], "email": row["email"], "username": row["username"]},
        }
    finally:
        conn.close()


@router.post("/logout")
async def logout():
    return {"message": "로그아웃되었습니다."}
