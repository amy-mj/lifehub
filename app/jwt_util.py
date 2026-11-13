"""JWT(HS256) — hono/jwt 와 상호 호환.

외부 라이브러리 없이 표준 HS256 을 구현합니다.
Node 가 발급한 토큰을 Python 이 검증할 수 있고, 그 반대도 가능합니다.
(기존 사용자 세션을 끊지 않고 런타임을 교체하기 위한 조건)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

_HASH = hashlib.sha256


def _b64url(data: bytes) -> str:
    return base64.b64encode(data).decode().replace("+", "-").replace("/", "_").rstrip("=")


def _unb64url(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)
    return base64.b64decode(s)


def sign(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64url(json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode())
    p = _b64url(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
    signing_input = f"{h}.{p}".encode()
    sig = _b64url(hmac.new(secret.encode(), signing_input, _HASH).digest())
    return f"{h}.{p}.{sig}"


def verify(token: str, secret: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("malformed token")
        h, p, s = parts
        signing_input = f"{h}.{p}".encode()
        expected = _b64url(hmac.new(secret.encode(), signing_input, _HASH).digest())
        if not hmac.compare_digest(expected, s):
            raise ValueError("signature mismatch")
        payload = json.loads(_unb64url(p))
        exp = payload.get("exp")
        if exp is not None and float(exp) < time.time():
            raise ValueError("token expired")
        return payload
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValueError("invalid token") from exc


def create_token(user_id: int, secret: str, ttl_seconds: int = 60 * 60 * 24 * 30) -> str:
    now = int(time.time())
    return sign({"sub": user_id, "iat": now, "exp": now + ttl_seconds}, secret)
