"""비밀번호 해싱 — TypeScript(crypto.ts) 원본과 바이트 단위 호환.

형식: pbkdf2$<iterations>$<b64url(salt)>$<b64url(hash)>
기존(TS/Node) DB 의 해시를 그대로 검증할 수 있어 사용자 비밀번호 재설정이 필요 없습니다.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

ITERATIONS = 100000
_HASH_LEN = 32


def _b64url(data: bytes) -> str:
    return base64.b64encode(data).decode().replace("+", "-").replace("/", "_").rstrip("=")


def _unb64url(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)
    return base64.b64decode(s)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS, _HASH_LEN)
    return f"pbkdf2${ITERATIONS}${_b64url(salt)}${_b64url(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if len(parts) != 4 or parts[0] != "pbkdf2":
            return False
        iterations = int(parts[1])
        salt = _unb64url(parts[2])
        expected = parts[3]
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations, _HASH_LEN)
        actual = _b64url(dk)
        if len(actual) != len(expected):
            return False
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False
