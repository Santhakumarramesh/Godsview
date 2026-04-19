"""Feature-flag admin routes."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import FeatureFlag

router = APIRouter(prefix="/admin/flags", tags=["flags"])


class FlagOut(BaseModel):
    key: str
    enabled: bool
    description: str
    scope: str
    scopeRef: str | None = Field(default=None, alias="scope_ref")
    updatedAt: datetime
    updatedBy: str

    model_config = {"populate_by_name": True, "from_attributes": True}


class FlagListOut(BaseModel):
    flags: list[FlagOut]


class FlagPatch(BaseModel):
    enabled: bool | None = None
    description: str | None = None


def _to_out(row: FeatureFlag) -> FlagOut:
    return FlagOut(
        key=row.key,
        enabled=row.enabled,
        description=row.description,
        scope=row.scope,
        scopeRef=row.scope_ref,
        updatedAt=row.updated_at,
        updatedBy=row.updated_by,
    )


@router.get("", response_model=FlagListOut)
async def list_flags(user: CurrentUser, db: DbSession) -> FlagListOut:
    rows = (await db.scalars(select(FeatureFlag).order_by(FeatureFlag.key))).all()
    return FlagListOut(flags=[_to_out(r) for r in rows])


@router.get("/{key}", response_model=FlagOut)
async def get_flag(key: str, user: CurrentUser, db: DbSession) -> FlagOut:
    row = await db.scalar(select(FeatureFlag).where(FeatureFlag.key == key))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"flag '{key}' not found",
        )
    return _to_out(row)


@router.patch("/{key}", response_model=FlagOut)
async def update_flag(
    key: str,
    patch: FlagPatch,
    request: Request,
    user: AdminUser,
    db: DbSession,
) -> FlagOut:
    row = await db.scalar(select(FeatureFlag).where(FeatureFlag.key == key))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"flag '{key}' not found",
        )
    if patch.enabled is not None:
        row.enabled = patch.enabled
    if patch.description is not None:
        row.description = patch.description
    row.updated_by = user.email
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="flag.update",
        resource_type="feature_flag",
        resource_id=key,
        outcome="success",
        details=patch.model_dump(exclude_none=True),
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)
