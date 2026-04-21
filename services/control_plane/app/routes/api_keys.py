"""Admin-only /admin/api-keys CRUD with creation-time reveal.

API keys are opaque bearer credentials that callers use on the public
data/execution surface. To keep them non-retrievable after creation,
the plaintext is generated server-side, returned exactly once in the
``201 Created`` body, and never logged. Only the Argon2id hash and a
short random ``prefix`` (used for lookup + audit friendliness) land
in the DB.

Wire shape (plaintext):
    gv_sk_<prefix>_<body>

The prefix is 8 lowercase-alnum chars; the body is 32 url-safe bytes
of ``secrets.token_urlsafe``. Callers must save the returned
``plaintext`` immediately — subsequent GETs only return metadata.

Invariants
----------
* Every mutation emits an ``audit_log`` row in the same transaction
  (blueprint Invariant #1) — password/plaintext is never recorded.
* Revocation is soft: ``revoked_at`` is set but the row remains so
  audit trails and FK integrity are preserved.
* Admin role required for all operations; the creator can optionally
  assign the key to another user via ``ownerUserId``.
"""

from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser
from app.errors import ApiError
from app.models import ApiKey, User
from app.security import hash_password

router = APIRouter(prefix="/admin/api-keys", tags=["api-keys"])

_PREFIX_ALPHABET = string.ascii_lowercase + string.digits
_PREFIX_LENGTH = 8
_BODY_BYTES = 32
ALLOWED_SCOPES = frozenset(
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


class ApiKeyOut(BaseModel):
    id: str
    name: str
    prefix: str
    ownerUserId: str
    scopes: list[str]
    createdAt: datetime
    lastUsedAt: datetime | None
    revokedAt: datetime | None

    model_config = {"populate_by_name": True, "from_attributes": True}


class ApiKeyListOut(BaseModel):
    apiKeys: list[ApiKeyOut]
    total: int


class ApiKeyCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(default_factory=list)
    ownerUserId: str | None = None

    model_config = {"populate_by_name": True}


class ApiKeyCreateOut(ApiKeyOut):
    """Response body for ``POST /admin/api-keys``.

    ``plaintext`` is populated only on creation and is the full bearer
    token (``gv_sk_<prefix>_<body>``). Callers must save it immediately.
    """

    plaintext: str


def _to_out(row: ApiKey) -> ApiKeyOut:
    return ApiKeyOut(
        id=row.id,
        name=row.name,
        prefix=row.prefix,
        ownerUserId=row.owner_user_id,
        scopes=list(row.scopes or []),
        createdAt=row.created_at,
        lastUsedAt=row.last_used_at,
        revokedAt=row.revoked_at,
    )


def _validate_scopes(scopes: list[str]) -> list[str]:
    unknown = [s for s in scopes if s not in ALLOWED_SCOPES]
    if unknown:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="api_keys.invalid_scope",
            message=f"unknown scopes: {sorted(set(unknown))}",
            details=[
                {"path": "body.scopes", "issue": f"unknown scope '{s}'"}
                for s in unknown
            ],
        )
    return list(dict.fromkeys(scopes))


def _mint_token() -> tuple[str, str]:
    """Return ``(prefix, plaintext)``; the plaintext embeds the prefix."""
    prefix = "".join(secrets.choice(_PREFIX_ALPHABET) for _ in range(_PREFIX_LENGTH))
    body = secrets.token_urlsafe(_BODY_BYTES)
    plaintext = f"gv_sk_{prefix}_{body}"
    return prefix, plaintext


@router.get("", response_model=ApiKeyListOut)
async def list_api_keys(user: AdminUser, db: DbSession) -> ApiKeyListOut:
    rows = (await db.scalars(select(ApiKey).order_by(ApiKey.created_at))).all()
    return ApiKeyListOut(apiKeys=[_to_out(r) for r in rows], total=len(rows))


@router.post("", response_model=ApiKeyCreateOut, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    payload: ApiKeyCreateIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> ApiKeyCreateOut:
    owner_id = payload.ownerUserId or admin.id
    if owner_id != admin.id:
        owner = await db.scalar(select(User).where(User.id == owner_id))
        if owner is None:
            raise ApiError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="api_keys.owner_not_found",
                message=f"owner user '{owner_id}' not found",
            )
    scopes = _validate_scopes(payload.scopes)
    # unique-name-per-owner is enforced at the DB layer, but we
    # fail fast with a nicer error so clients don't have to race.
    name_clash = await db.scalar(
        select(ApiKey).where(
            ApiKey.owner_user_id == owner_id, ApiKey.name == payload.name
        )
    )
    if name_clash is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="api_keys.name_exists",
            message=f"api key with name '{payload.name}' already exists for this owner",
        )
    prefix, plaintext = _mint_token()
    row = ApiKey(
        id=f"ak_{uuid.uuid4().hex}",
        owner_user_id=owner_id,
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
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="api_key.create",
        resource_type="api_key",
        resource_id=row.id,
        outcome="success",
        details={
            "name": payload.name,
            "prefix": prefix,
            "owner_user_id": owner_id,
            "scopes": scopes,
        },
    )
    await db.commit()
    await db.refresh(row)
    out = _to_out(row)
    return ApiKeyCreateOut(**out.model_dump(by_alias=True), plaintext=plaintext)


@router.delete("/{api_key_id}", response_model=ApiKeyOut)
async def revoke_api_key(
    api_key_id: str,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> ApiKeyOut:
    row = await db.scalar(select(ApiKey).where(ApiKey.id == api_key_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="api_keys.not_found",
            message=f"api key '{api_key_id}' not found",
        )
    if row.revoked_at is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="api_keys.already_revoked",
            message=f"api key '{api_key_id}' was already revoked",
        )
    row.revoked_at = datetime.utcnow()
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="api_key.revoke",
        resource_type="api_key",
        resource_id=row.id,
        outcome="success",
        details={"name": row.name, "prefix": row.prefix},
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)
