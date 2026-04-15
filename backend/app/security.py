import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

ALGORITHM = "HS256"


def get_secret_key() -> str:
    return os.getenv("JWT_SECRET", "change-me")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 150_000)
    return f"{salt}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    salt, saved = stored_hash.split("$", 1)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 150_000)
    return hmac.compare_digest(derived.hex(), saved)


def create_access_token(data: dict[str, Any], expires_minutes: int = 60 * 12) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    payload["exp"] = expire
    return jwt.encode(payload, get_secret_key(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])
