"""Admin system-config KV routes."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Request, status
from pydantic import BaseModel
from sqlalchemy import delete, select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import SystemConfig

router = APIRouter(prefix="/admin/system/config", tags=["system-config"])


class SystemConfigOut(BaseModel):
    key: str
    value: Any
    description: str
    updatedAt: datetime
    updatedBy: str


class SystemConfigListOut(BaseModel):
    entries: list[SystemConfigOut]


class SystemConfigUpsert(BaseModel):
    value: Any
    description: str | None = None


def _to_out(row: SystemConfig) -> SystemConfigOut:
    return SystemConfigOut(
        key=row.key,
        value=row.value,
        description=row.description,
        updatedAt=row.updated_at,
        updatedBy=row.updated_by,
    )


@router.get("", response_model=SystemConfigListOut)
async def list_config(user: CurrentUser, db: DbSession) -> SystemConfigListOut:
    rows = (await db.scalars(select(SystemConfig).order_by(SystemConfig.key))).all()
    return SystemConfigListOut(entries=[_to_out(r) for r in rows])


@router.get("/{key}", response_model=SystemConfigOut)
async def get_config(key: str, user: CurrentUser, db: DbSession) -> SystemConfigOut:
    row = await db.scalar(select(SystemConfig).where(SystemConfig.key == key))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"config '{key}' not found",
        )
    return _to_out(row)


@router.put("/{key}", response_model=SystemConfigOut)
async def upsert_config(
    key: str,
    payload: SystemConfigUpsert,
    request: Request,
    user: AdminUser,
    db: DbSession,
) -> SystemConfigOut:
    row = await db.scalar(select(SystemConfig).where(SystemConfig.key == key))
    if row is None:
        row = SystemConfig(
            key=key,
            value=payload.value,
            description=payload.description or "",
            updated_by=user.email,
        )
        db.add(row)
        action = "system_config.create"
    else:
        row.value = payload.value
        if payload.description is not None:
            row.description = payload.description
        row.updated_by = user.email
        action = "system_config.update"
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action=action,
        resource_type="system_config",
        resource_id=key,
        outcome="success",
        details={"description_set": payload.description is not None},
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(
    key: str,
    request: Request,
    user: AdminUser,
    db: DbSession,
) -> None:
    row = await db.scalar(select(SystemConfig).where(SystemConfig.key == key))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="not_found",
            message=f"config '{key}' not found",
        )
    await db.execute(delete(SystemConfig).where(SystemConfig.key == key))
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="system_config.delete",
        resource_type="system_config",
        resource_id=key,
        outcome="success",
    )
    await db.commit()
