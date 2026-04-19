"""Admin-only /admin/webhooks CRUD with HMAC secret rotation.

Webhooks register the other side of the TradingView/alerting/broker
integrations: the platform issues an HMAC secret, the caller saves
it, and every inbound delivery must carry the matching
``X-Godsview-Signature`` header. Only the hash of the secret is
persisted; the plaintext is returned exactly once on create and once
per rotation.

Rotation keeps a single-active-secret-at-a-time model (keeps the
ingest path fast). Operators who need a grace window should manage
the cutover at the HMAC-verifier layer in a later phase.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Request, status
from pydantic import AnyHttpUrl, BaseModel, Field
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser
from app.errors import ApiError
from app.models import Webhook
from app.security import hash_password

router = APIRouter(prefix="/admin/webhooks", tags=["webhooks"])

ALLOWED_SOURCES = frozenset(
    {"tradingview", "alpaca", "generic", "internal", "test"}
)
ALLOWED_SCOPES = frozenset(
    {"signals:ingest", "signals:read", "orders:ingest", "ops:read"}
)

_SECRET_BYTES = 32


class WebhookOut(BaseModel):
    id: str
    name: str
    source: str
    targetUrl: str | None = None
    scopes: list[str]
    active: bool
    createdAt: datetime
    updatedAt: datetime
    lastDeliveryAt: datetime | None = None

    model_config = {"populate_by_name": True, "from_attributes": True}


class WebhookListOut(BaseModel):
    webhooks: list[WebhookOut]
    total: int


class WebhookCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    source: str
    targetUrl: AnyHttpUrl | None = None
    scopes: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class WebhookPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    targetUrl: AnyHttpUrl | None = None
    scopes: list[str] | None = None
    active: bool | None = None

    model_config = {"populate_by_name": True}


class WebhookCreateOut(WebhookOut):
    """Includes the plaintext HMAC secret (shown once)."""

    secret: str


class WebhookRotateOut(BaseModel):
    id: str
    secret: str
    rotatedAt: datetime

    model_config = {"populate_by_name": True}


def _to_out(row: Webhook) -> WebhookOut:
    return WebhookOut(
        id=row.id,
        name=row.name,
        source=row.source,
        targetUrl=row.target_url,
        scopes=list(row.scopes or []),
        active=row.active,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
        lastDeliveryAt=row.last_delivery_at,
    )


def _validate_source(source: str) -> str:
    if source not in ALLOWED_SOURCES:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="webhooks.invalid_source",
            message=f"unknown source '{source}'",
            details=[{"path": "body.source", "issue": f"expected one of {sorted(ALLOWED_SOURCES)}"}],
        )
    return source


def _validate_scopes(scopes: list[str]) -> list[str]:
    unknown = [s for s in scopes if s not in ALLOWED_SCOPES]
    if unknown:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="webhooks.invalid_scope",
            message=f"unknown scopes: {sorted(set(unknown))}",
            details=[
                {"path": "body.scopes", "issue": f"unknown scope '{s}'"} for s in unknown
            ],
        )
    return list(dict.fromkeys(scopes))


def _mint_secret() -> str:
    return f"whsec_{secrets.token_urlsafe(_SECRET_BYTES)}"


@router.get("", response_model=WebhookListOut)
async def list_webhooks(admin: AdminUser, db: DbSession) -> WebhookListOut:
    rows = (await db.scalars(select(Webhook).order_by(Webhook.created_at))).all()
    return WebhookListOut(webhooks=[_to_out(r) for r in rows], total=len(rows))


@router.post("", response_model=WebhookCreateOut, status_code=status.HTTP_201_CREATED)
async def create_webhook(
    payload: WebhookCreateIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> WebhookCreateOut:
    source = _validate_source(payload.source)
    scopes = _validate_scopes(payload.scopes)
    existing = await db.scalar(select(Webhook).where(Webhook.name == payload.name))
    if existing is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="webhooks.name_exists",
            message=f"webhook with name '{payload.name}' already exists",
        )
    secret = _mint_secret()
    row = Webhook(
        id=f"wh_{uuid.uuid4().hex}",
        name=payload.name,
        source=source,
        target_url=str(payload.targetUrl) if payload.targetUrl else None,
        secret_hash=hash_password(secret),
        scopes=scopes,
        active=True,
        created_by=admin.id,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="webhook.create",
        resource_type="webhook",
        resource_id=row.id,
        outcome="success",
        details={"name": payload.name, "source": source, "scopes": scopes},
    )
    await db.commit()
    await db.refresh(row)
    return WebhookCreateOut(**_to_out(row).model_dump(by_alias=True), secret=secret)


@router.patch("/{webhook_id}", response_model=WebhookOut)
async def update_webhook(
    webhook_id: str,
    payload: WebhookPatchIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> WebhookOut:
    row = await db.scalar(select(Webhook).where(Webhook.id == webhook_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="webhooks.not_found",
            message=f"webhook '{webhook_id}' not found",
        )
    if payload.name is not None and payload.name != row.name:
        clash = await db.scalar(
            select(Webhook).where(Webhook.name == payload.name, Webhook.id != row.id)
        )
        if clash is not None:
            raise ApiError(
                status_code=status.HTTP_409_CONFLICT,
                code="webhooks.name_exists",
                message=f"webhook with name '{payload.name}' already exists",
            )
        row.name = payload.name
    if payload.targetUrl is not None:
        row.target_url = str(payload.targetUrl)
    if payload.scopes is not None:
        row.scopes = _validate_scopes(payload.scopes)
    if payload.active is not None:
        row.active = payload.active
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="webhook.update",
        resource_type="webhook",
        resource_id=row.id,
        outcome="success",
        details=payload.model_dump(exclude_none=True, by_alias=True),
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.post("/{webhook_id}/rotate-secret", response_model=WebhookRotateOut)
async def rotate_webhook_secret(
    webhook_id: str,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> WebhookRotateOut:
    row = await db.scalar(select(Webhook).where(Webhook.id == webhook_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="webhooks.not_found",
            message=f"webhook '{webhook_id}' not found",
        )
    new_secret = _mint_secret()
    row.secret_hash = hash_password(new_secret)
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="webhook.rotate_secret",
        resource_type="webhook",
        resource_id=row.id,
        outcome="success",
        details={"name": row.name},
    )
    await db.commit()
    await db.refresh(row)
    return WebhookRotateOut(id=row.id, secret=new_secret, rotatedAt=row.updated_at)


@router.delete("/{webhook_id}", response_model=WebhookOut)
async def deactivate_webhook(
    webhook_id: str,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> WebhookOut:
    row = await db.scalar(select(Webhook).where(Webhook.id == webhook_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="webhooks.not_found",
            message=f"webhook '{webhook_id}' not found",
        )
    row.active = False
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="webhook.deactivate",
        resource_type="webhook",
        resource_id=row.id,
        outcome="success",
        details={"name": row.name},
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)
