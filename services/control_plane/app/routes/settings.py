"""Self-service settings surface — /v1/settings/*.

Every authenticated user (admin, operator, viewer) manages their own
profile, UI preferences, and personal API tokens here. No admin role
is required — but the surface is strictly scoped to the caller.

Sub-surfaces:

* Profile        — GET / PATCH the caller's User (name, MFA flag).
* Password       — POST change-password with old-password proof.
* Preferences    — GET / PUT UserPreference blob (theme, density, …).
* API tokens     — GET / POST / DELETE the caller's own api_keys rows.

Invariant
---------
Every mutation emits an ``audit_log`` row in the same transaction
(blueprint Invariant #1). Plaintext secrets are never logged.
"""

from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import CurrentUser
from app.errors import ApiError
from app.models import ApiKey, User, UserPreference
from app.security import hash_password, verify_password

router = APIRouter(prefix="/v1/settings", tags=["settings"])

_PREFIX_ALPHABET = string.ascii_lowercase + string.digits
_PREFIX_LENGTH = 8
_BODY_BYTES = 32
ALLOWED_TOKEN_SCOPES = frozenset(
    {
        "webhooks:write",
        "webhooks:read",
        "signals:read",
        "signals:write",
        "execution:read",
        "execution:write",
        "ops:read",
        "admin:read",
    }
)
_MIN_PASSWORD_LEN = 12


# ─────────────────────────────────────────────────────────────────────
# Profile
# ─────────────────────────────────────────────────────────────────────


class ProfileOut(BaseModel):
    id: str
    email: EmailStr
    displayName: str
    roles: list[str]
    mfaEnabled: bool
    disabled: bool
    createdAt: datetime
    lastLoginAt: datetime | None

    model_config = {"populate_by_name": True, "from_attributes": True}


class ProfilePatchIn(BaseModel):
    displayName: str | None = Field(default=None, min_length=1, max_length=120)
    mfaEnabled: bool | None = None

    model_config = {"populate_by_name": True}


def _profile_out(row: User) -> ProfileOut:
    return ProfileOut(
        id=row.id,
        email=row.email,
        displayName=row.display_name,
        roles=list(row.roles or []),
        mfaEnabled=row.mfa_enabled,
        disabled=row.disabled,
        createdAt=row.created_at,
        lastLoginAt=row.last_login_at,
    )


@router.get("/profile", response_model=ProfileOut)
async def get_profile(user: CurrentUser) -> ProfileOut:
    return _profile_out(user)


@router.patch("/profile", response_model=ProfileOut)
async def update_profile(
    payload: ProfilePatchIn,
    request: Request,
    user: CurrentUser,
    db: DbSession,
) -> ProfileOut:
    row = await db.scalar(select(User).where(User.id == user.id))
    # user fixture guarantees row exists — defense in depth only
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="settings.profile_not_found",
            message="profile not found",
        )
    changed: dict[str, Any] = {}
    if payload.displayName is not None and payload.displayName != row.display_name:
        row.display_name = payload.displayName
        changed["displayName"] = payload.displayName
    if payload.mfaEnabled is not None and payload.mfaEnabled != row.mfa_enabled:
        row.mfa_enabled = payload.mfaEnabled
        changed["mfaEnabled"] = payload.mfaEnabled
    if changed:
        await log_event(
            db,
            request=request,
            actor_user_id=user.id,
            actor_email=user.email,
            action="profile.update",
            resource_type="user",
            resource_id=user.id,
            outcome="success",
            details=changed,
        )
    await db.commit()
    await db.refresh(row)
    return _profile_out(row)


# ─────────────────────────────────────────────────────────────────────
# Password
# ─────────────────────────────────────────────────────────────────────


class PasswordChangeIn(BaseModel):
    currentPassword: str = Field(min_length=1)
    newPassword: str = Field(min_length=_MIN_PASSWORD_LEN, max_length=256)

    model_config = {"populate_by_name": True}


class PasswordChangeOut(BaseModel):
    ok: bool = True


@router.post("/password", response_model=PasswordChangeOut)
async def change_password(
    payload: PasswordChangeIn,
    request: Request,
    user: CurrentUser,
    db: DbSession,
) -> PasswordChangeOut:
    row = await db.scalar(select(User).where(User.id == user.id))
    if row is None or not verify_password(row.password_hash, payload.currentPassword):
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="settings.password_mismatch",
            message="current password incorrect",
        )
    if verify_password(row.password_hash, payload.newPassword):
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="settings.password_unchanged",
            message="new password must differ from current",
        )
    row.password_hash = hash_password(payload.newPassword)
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="password.change",
        resource_type="user",
        resource_id=user.id,
        outcome="success",
    )
    await db.commit()
    return PasswordChangeOut(ok=True)


# ─────────────────────────────────────────────────────────────────────
# Preferences
# ─────────────────────────────────────────────────────────────────────


class PreferencesOut(BaseModel):
    preferences: dict[str, Any]
    updatedAt: datetime | None

    model_config = {"populate_by_name": True}


class PreferencesPutIn(BaseModel):
    preferences: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


_PREF_PAYLOAD_BYTES_CAP = 32 * 1024  # 32 KB hard cap per user blob


def _pref_out(row: UserPreference | None) -> PreferencesOut:
    if row is None:
        return PreferencesOut(preferences={}, updatedAt=None)
    return PreferencesOut(
        preferences=dict(row.preferences or {}),
        updatedAt=row.updated_at,
    )


@router.get("/preferences", response_model=PreferencesOut)
async def get_preferences(user: CurrentUser, db: DbSession) -> PreferencesOut:
    row = await db.scalar(
        select(UserPreference).where(UserPreference.user_id == user.id)
    )
    return _pref_out(row)


@router.put("/preferences", response_model=PreferencesOut)
async def put_preferences(
    payload: PreferencesPutIn,
    request: Request,
    user: CurrentUser,
    db: DbSession,
) -> PreferencesOut:
    import json

    serialized = json.dumps(payload.preferences)
    if len(serialized.encode("utf-8")) > _PREF_PAYLOAD_BYTES_CAP:
        raise ApiError(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            code="settings.preferences_too_large",
            message=f"preferences payload exceeds {_PREF_PAYLOAD_BYTES_CAP} bytes",
        )
    row = await db.scalar(
        select(UserPreference).where(UserPreference.user_id == user.id)
    )
    if row is None:
        row = UserPreference(user_id=user.id, preferences=payload.preferences)
        db.add(row)
    else:
        row.preferences = payload.preferences
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="preferences.update",
        resource_type="user_preference",
        resource_id=user.id,
        outcome="success",
        details={"keys": sorted(payload.preferences.keys())},
    )
    await db.commit()
    await db.refresh(row)
    return _pref_out(row)


# ─────────────────────────────────────────────────────────────────────
# Personal API tokens
# ─────────────────────────────────────────────────────────────────────


class SelfApiTokenOut(BaseModel):
    id: str
    name: str
    prefix: str
    scopes: list[str]
    createdAt: datetime
    lastUsedAt: datetime | None
    revokedAt: datetime | None

    model_config = {"populate_by_name": True, "from_attributes": True}


class SelfApiTokenListOut(BaseModel):
    tokens: list[SelfApiTokenOut]
    total: int


class SelfApiTokenCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class SelfApiTokenCreateOut(SelfApiTokenOut):
    """Creation response — ``plaintext`` is revealed exactly once."""

    plaintext: str


def _token_out(row: ApiKey) -> SelfApiTokenOut:
    return SelfApiTokenOut(
        id=row.id,
        name=row.name,
        prefix=row.prefix,
        scopes=list(row.scopes or []),
        createdAt=row.created_at,
        lastUsedAt=row.last_used_at,
        revokedAt=row.revoked_at,
    )


def _validate_token_scopes(scopes: list[str]) -> list[str]:
    unknown = [s for s in scopes if s not in ALLOWED_TOKEN_SCOPES]
    if unknown:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="settings.token_invalid_scope",
            message=f"unknown scopes: {sorted(set(unknown))}",
        )
    return list(dict.fromkeys(scopes))


def _mint_token() -> tuple[str, str]:
    prefix = "".join(
        secrets.choice(_PREFIX_ALPHABET) for _ in range(_PREFIX_LENGTH)
    )
    body = secrets.token_urlsafe(_BODY_BYTES)
    plaintext = f"gv_sk_{prefix}_{body}"
    return prefix, plaintext


@router.get("/api-tokens", response_model=SelfApiTokenListOut)
async def list_self_tokens(
    user: CurrentUser, db: DbSession
) -> SelfApiTokenListOut:
    rows = (
        await db.scalars(
            select(ApiKey)
            .where(ApiKey.owner_user_id == user.id)
            .order_by(ApiKey.created_at)
        )
    ).all()
    return SelfApiTokenListOut(tokens=[_token_out(r) for r in rows], total=len(rows))


@router.post(
    "/api-tokens",
    response_model=SelfApiTokenCreateOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_self_token(
    payload: SelfApiTokenCreateIn,
    request: Request,
    user: CurrentUser,
    db: DbSession,
) -> SelfApiTokenCreateOut:
    scopes = _validate_token_scopes(payload.scopes)
    name_clash = await db.scalar(
        select(ApiKey).where(
            ApiKey.owner_user_id == user.id, ApiKey.name == payload.name
        )
    )
    if name_clash is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="settings.token_name_exists",
            message=f"api token with name '{payload.name}' already exists",
        )
    prefix, plaintext = _mint_token()
    row = ApiKey(
        id=f"ak_{uuid.uuid4().hex}",
        owner_user_id=user.id,
        name=payload.name,
        prefix=prefix,
        hash=hash_password(plaintext),
        scopes=scopes,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="api_token.create",
        resource_type="api_key",
        resource_id=row.id,
        outcome="success",
        details={"name": payload.name, "prefix": prefix, "scopes": scopes},
    )
    await db.commit()
    await db.refresh(row)
    out = _token_out(row)
    return SelfApiTokenCreateOut(
        **out.model_dump(by_alias=True), plaintext=plaintext
    )


@router.delete("/api-tokens/{token_id}", response_model=SelfApiTokenOut)
async def revoke_self_token(
    token_id: str,
    request: Request,
    user: CurrentUser,
    db: DbSession,
) -> SelfApiTokenOut:
    row = await db.scalar(select(ApiKey).where(ApiKey.id == token_id))
    if row is None or row.owner_user_id != user.id:
        # owner-scoped: don't leak existence of other users' tokens.
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="settings.token_not_found",
            message=f"api token '{token_id}' not found",
        )
    if row.revoked_at is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="settings.token_already_revoked",
            message="api token was already revoked",
        )
    row.revoked_at = datetime.now(timezone.utc)
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="api_token.revoke",
        resource_type="api_key",
        resource_id=row.id,
        outcome="success",
        details={"name": row.name, "prefix": row.prefix},
    )
    await db.commit()
    await db.refresh(row)
    return _token_out(row)
