"""Admin-only /v1/users CRUD.

Creating, updating, deactivating, and re-activating operator accounts.
Every mutation emits a matching audit_log row in the same transaction
per Invariant #1 in docs/blueprint/03-db-schema.md.

Password handling:
  - On create, the caller supplies the initial password; it is hashed
    with Argon2id before being persisted. The raw password is never
    logged (audit details omit it).
  - PATCH does not accept a password field — password changes go
    through the user's own `/v1/auth/me` or a future `/v1/auth/password`
    reset flow. This keeps the admin surface narrower than the self-
    service one.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser
from app.errors import ApiError
from app.models import User
from app.security import hash_password

router = APIRouter(prefix="/admin/users", tags=["users"])

ALLOWED_ROLES = frozenset({"admin", "operator", "analyst", "viewer"})


class UserOut(BaseModel):
    id: str
    email: EmailStr
    displayName: str
    roles: list[str]
    mfaEnabled: bool
    disabled: bool
    createdAt: datetime
    lastLoginAt: datetime | None

    model_config = {"populate_by_name": True, "from_attributes": True}


class UserListOut(BaseModel):
    users: list[UserOut]
    total: int


class UserCreateIn(BaseModel):
    email: EmailStr
    displayName: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)
    roles: list[str] = Field(default_factory=lambda: ["viewer"])

    model_config = {"populate_by_name": True}


class UserPatchIn(BaseModel):
    displayName: str | None = Field(default=None, min_length=1, max_length=120)
    roles: list[str] | None = None
    disabled: bool | None = None
    mfaEnabled: bool | None = None

    model_config = {"populate_by_name": True}


def _to_out(row: User) -> UserOut:
    return UserOut(
        id=row.id,
        email=row.email,
        displayName=row.display_name,
        roles=list(row.roles or []),
        mfaEnabled=row.mfa_enabled,
        disabled=row.disabled,
        createdAt=row.created_at,
        lastLoginAt=row.last_login_at,
    )


def _validate_roles(roles: list[str]) -> list[str]:
    unknown = [r for r in roles if r not in ALLOWED_ROLES]
    if unknown:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="users.invalid_role",
            message=f"unknown roles: {sorted(set(unknown))}",
            details=[
                {"path": "body.roles", "issue": f"unknown role '{r}'"} for r in unknown
            ],
        )
    return list(dict.fromkeys(roles))  # de-dupe preserving order


@router.get("", response_model=UserListOut)
async def list_users(user: AdminUser, db: DbSession) -> UserListOut:
    rows = (await db.scalars(select(User).order_by(User.created_at))).all()
    return UserListOut(users=[_to_out(r) for r in rows], total=len(rows))


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> UserOut:
    email_norm = payload.email.lower()
    existing = await db.scalar(select(User).where(User.email == email_norm))
    if existing is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="users.email_exists",
            message=f"user with email '{email_norm}' already exists",
        )
    roles = _validate_roles(payload.roles) if payload.roles else ["viewer"]
    row = User(
        id=f"usr_{uuid.uuid4().hex}",
        email=email_norm,
        display_name=payload.displayName,
        password_hash=hash_password(payload.password),
        roles=roles,
        mfa_enabled=False,
        disabled=False,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="user.create",
        resource_type="user",
        resource_id=row.id,
        outcome="success",
        details={"email": email_norm, "roles": roles},
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    payload: UserPatchIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> UserOut:
    row = await db.scalar(select(User).where(User.id == user_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="users.not_found",
            message=f"user '{user_id}' not found",
        )

    before = {
        "displayName": row.display_name,
        "roles": list(row.roles or []),
        "disabled": row.disabled,
        "mfaEnabled": row.mfa_enabled,
    }

    if payload.displayName is not None:
        row.display_name = payload.displayName
    if payload.roles is not None:
        row.roles = _validate_roles(payload.roles)
    if payload.disabled is not None:
        row.disabled = payload.disabled
    if payload.mfaEnabled is not None:
        row.mfa_enabled = payload.mfaEnabled

    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="user.update",
        resource_type="user",
        resource_id=row.id,
        outcome="success",
        details={
            "before": before,
            "after": payload.model_dump(exclude_none=True, by_alias=True),
        },
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.delete("/{user_id}", response_model=UserOut)
async def deactivate_user(
    user_id: str,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> UserOut:
    """Soft-delete: flip `disabled=true`. We never hard-delete users
    so the audit_log FK remains valid."""
    row = await db.scalar(select(User).where(User.id == user_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="users.not_found",
            message=f"user '{user_id}' not found",
        )
    if row.id == admin.id:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="users.cannot_self_deactivate",
            message="an admin cannot deactivate themselves",
        )
    row.disabled = True
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="user.deactivate",
        resource_type="user",
        resource_id=row.id,
        outcome="success",
        details={"email": row.email},
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)
