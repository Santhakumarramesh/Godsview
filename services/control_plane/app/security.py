"""Password hashing + JWT issuance/verification helpers."""

from __future__ import annotations

import base64
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import JWTError, jwt

from app.config import Settings

_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(hash_: str, plain: str) -> bool:
    try:
        return _hasher.verify(hash_, plain)
    except VerifyMismatchError:
        return False


def needs_rehash(hash_: str) -> bool:
    return _hasher.check_needs_rehash(hash_)


TokenType = Literal["access", "refresh"]


def issue_token(
    *,
    settings: Settings,
    user_id: str,
    email: str,
    roles: list[str],
    token_type: TokenType,
) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    ttl = (
        settings.jwt_access_ttl_seconds
        if token_type == "access"
        else settings.jwt_refresh_ttl_seconds
    )
    expires_at = now + timedelta(seconds=ttl)
    jti = uuid.uuid4().hex
    payload: dict[str, Any] = {
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "sub": user_id,
        "email": email,
        "roles": roles,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": jti,
    }
    token = jwt.encode(
        payload,
        settings.jwt_signing_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    return token, expires_at


def verify_token(*, settings: Settings, token: str, expected_type: TokenType) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_signing_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
        )
    except JWTError as exc:
        raise ValueError(f"invalid token: {exc}") from exc
    if payload.get("type") != expected_type:
        raise ValueError(f"expected {expected_type} token, got {payload.get('type')}")
    return payload


def hash_refresh_token(token: str) -> str:
    """Stable sha256 digest used as the DB key for refresh tokens."""
    digest = hashlib.sha256(token.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
