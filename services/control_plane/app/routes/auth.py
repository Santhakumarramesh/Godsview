"""Auth routes: login, refresh, logout, me."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update

from app.audit import log_event
from app.config import Settings, get_settings
from app.db import DbSession
from app.deps import CurrentUser
from app.errors import ApiError
from app.models import RefreshToken, User
from app.security import (
    hash_refresh_token,
    issue_token,
    verify_password,
    verify_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    mfa_code: str | None = Field(default=None, alias="mfaCode")


class TokenPair(BaseModel):
    accessToken: str
    refreshToken: str
    accessExpiresAt: datetime
    refreshExpiresAt: datetime


class RefreshRequest(BaseModel):
    refreshToken: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    displayName: str
    roles: list[str]
    mfaEnabled: bool
    createdAt: datetime
    lastLoginAt: datetime | None


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        displayName=user.display_name,
        roles=list(user.roles or []),
        mfaEnabled=user.mfa_enabled,
        createdAt=user.created_at,
        lastLoginAt=user.last_login_at,
    )


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest,
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenPair:
    user = await db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or user.disabled or not verify_password(user.password_hash, payload.password):
        await log_event(
            db,
            request=request,
            actor_user_id=None,
            actor_email=str(payload.email).lower(),
            action="auth.login",
            resource_type="user",
            resource_id=None,
            outcome="denied",
            details={"reason": "invalid_credentials"},
        )
        await db.commit()
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message="invalid email or password",
        )

    access_token, access_exp = issue_token(
        settings=settings,
        user_id=user.id,
        email=user.email,
        roles=list(user.roles or []),
        token_type="access",
    )
    refresh_token, refresh_exp = issue_token(
        settings=settings,
        user_id=user.id,
        email=user.email,
        roles=list(user.roles or []),
        token_type="refresh",
    )
    stored = RefreshToken(
        id=f"rft_{uuid.uuid4().hex}",
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=refresh_exp,
        user_agent=request.headers.get("user-agent"),
        source_ip=(request.client.host if request.client else None),
    )
    db.add(stored)
    await db.execute(update(User).where(User.id == user.id).values(last_login_at=datetime.now(UTC)))
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="auth.login",
        resource_type="user",
        resource_id=user.id,
        outcome="success",
        details={},
    )
    await db.commit()

    return TokenPair(
        accessToken=access_token,
        refreshToken=refresh_token,
        accessExpiresAt=access_exp,
        refreshExpiresAt=refresh_exp,
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    payload: RefreshRequest,
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenPair:
    try:
        claims = verify_token(
            settings=settings, token=payload.refreshToken, expected_type="refresh"
        )
    except ValueError as exc:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message=str(exc),
        ) from exc

    digest = hash_refresh_token(payload.refreshToken)
    stored = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == digest))
    if stored is None or stored.revoked_at is not None:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message="refresh token revoked or unknown",
        )

    user = await db.scalar(select(User).where(User.id == claims["sub"]))
    if user is None or user.disabled:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthenticated",
            message="user unavailable",
        )

    # rotate: revoke old, issue new
    stored.revoked_at = datetime.now(UTC)
    access_token, access_exp = issue_token(
        settings=settings,
        user_id=user.id,
        email=user.email,
        roles=list(user.roles or []),
        token_type="access",
    )
    refresh_token, refresh_exp = issue_token(
        settings=settings,
        user_id=user.id,
        email=user.email,
        roles=list(user.roles or []),
        token_type="refresh",
    )
    new_stored = RefreshToken(
        id=f"rft_{uuid.uuid4().hex}",
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=refresh_exp,
        user_agent=request.headers.get("user-agent"),
        source_ip=(request.client.host if request.client else None),
    )
    db.add(new_stored)
    await db.commit()

    return TokenPair(
        accessToken=access_token,
        refreshToken=refresh_token,
        accessExpiresAt=access_exp,
        refreshExpiresAt=refresh_exp,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    user: CurrentUser,
    request: Request,
    db: DbSession,
) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="auth.logout",
        resource_type="user",
        resource_id=user.id,
        outcome="success",
    )
    await db.commit()


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return _user_out(user)
