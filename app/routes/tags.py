"""태그 라우트 — TypeScript(tags.ts) 원본의 이식."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from deps import current_user_id
from helpers import error, jbody, open_conn

router = APIRouter()


@router.get("")
@router.get("/")
async def list_tags(user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        rows = conn.execute(
            "SELECT id, name, color, created_at FROM tags WHERE user_id = ? ORDER BY name ASC",
            (user_id,),
        ).fetchall()
        items = [dict(r) for r in rows]
        return {"total": len(items), "items": items}
    finally:
        conn.close()


@router.post("")
@router.post("/")
async def create_tag(request: Request, user_id: int = Depends(current_user_id)):
    body = await jbody(request)
    name = body.get("name")
    if not name:
        return error("태그명은 필수입니다.", 400)
    conn = open_conn()
    try:
        dup = conn.execute(
            "SELECT id FROM tags WHERE user_id = ? AND name = ?", (user_id, str(name))
        ).fetchone()
        if dup:
            return error("이미 존재하는 태그입니다.", 409)
        cur = conn.execute(
            "INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)",
            (user_id, str(name), body.get("color") or "#6366f1"),
        )
        row = conn.execute("SELECT * FROM tags WHERE id = ?", (cur.lastrowid,)).fetchone()
        return JSONResponse(dict(row), status_code=201)
    finally:
        conn.close()


@router.put("/{tag_id}")
async def update_tag(tag_id: str, request: Request, user_id: int = Depends(current_user_id)):
    body = await jbody(request)
    name = body.get("name")
    color = body.get("color")
    conn = open_conn()
    try:
        conn.execute(
            "UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) "
            "WHERE id = ? AND user_id = ?",
            (name, color, tag_id, user_id),
        )
        row = conn.execute(
            "SELECT * FROM tags WHERE id = ? AND user_id = ?", (tag_id, user_id)
        ).fetchone()
        if not row:
            return error("태그를 찾을 수 없습니다.", 404)
        return dict(row)
    finally:
        conn.close()


@router.delete("/{tag_id}")
async def delete_tag(tag_id: str, user_id: int = Depends(current_user_id)):
    conn = open_conn()
    try:
        conn.execute("DELETE FROM tags WHERE id = ? AND user_id = ?", (tag_id, user_id))
        return {"message": "삭제되었습니다."}
    finally:
        conn.close()
