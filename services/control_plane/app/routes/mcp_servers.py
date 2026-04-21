"""Admin-only /admin/mcp CRUD — the MCP server registry.

The control plane owns the registry; actual runtime plumbing (stdio
vs http vs sse transports) lands in later phases. Secrets are stored
as opaque references into a secret manager — never inline — which is
why this surface has no "secret reveal" step.

Invariants
----------
* One name per row, enforced at the DB layer (``uq_mcp_servers_name``).
* ``transport`` ∈ {stdio, http, sse}; ``auth_mode`` ∈ {none, bearer, hmac, mTLS}.
* An ``http``/``sse`` transport requires ``endpointUrl``; ``stdio``
  requires ``command``.
* Every mutation writes an ``audit_log`` row in the same transaction.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Request, status
from pydantic import AnyHttpUrl, BaseModel, Field
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser
from app.errors import ApiError
from app.models import McpServer

router = APIRouter(prefix="/admin/mcp", tags=["mcp"])

ALLOWED_TRANSPORTS = frozenset({"stdio", "http", "sse"})
ALLOWED_AUTH_MODES = frozenset({"none", "bearer", "hmac", "mtls"})
ALLOWED_SCOPES = frozenset(
    {"read:tools", "write:tools", "read:resources", "ops:read"}
)


class McpOut(BaseModel):
    id: str
    name: str
    transport: str
    endpointUrl: str | None = None
    command: str | None = None
    authMode: str
    secretRef: str | None = None
    scopes: list[str]
    active: bool
    createdAt: datetime
    updatedAt: datetime

    model_config = {"populate_by_name": True, "from_attributes": True}


class McpListOut(BaseModel):
    servers: list[McpOut]
    total: int


class McpCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    transport: str
    endpointUrl: AnyHttpUrl | None = None
    command: str | None = Field(default=None, max_length=1024)
    authMode: str = "none"
    secretRef: str | None = Field(default=None, max_length=255)
    scopes: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class McpPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    endpointUrl: AnyHttpUrl | None = None
    command: str | None = None
    authMode: str | None = None
    secretRef: str | None = None
    scopes: list[str] | None = None
    active: bool | None = None

    model_config = {"populate_by_name": True}


def _to_out(row: McpServer) -> McpOut:
    return McpOut(
        id=row.id,
        name=row.name,
        transport=row.transport,
        endpointUrl=row.endpoint_url,
        command=row.command,
        authMode=row.auth_mode,
        secretRef=row.secret_ref,
        scopes=list(row.scopes or []),
        active=row.active,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def _validate_transport(value: str) -> str:
    if value not in ALLOWED_TRANSPORTS:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="mcp.invalid_transport",
            message=f"unknown transport '{value}'",
            details=[
                {
                    "path": "body.transport",
                    "issue": f"expected one of {sorted(ALLOWED_TRANSPORTS)}",
                }
            ],
        )
    return value


def _validate_auth_mode(value: str) -> str:
    if value not in ALLOWED_AUTH_MODES:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="mcp.invalid_auth_mode",
            message=f"unknown auth mode '{value}'",
            details=[
                {
                    "path": "body.authMode",
                    "issue": f"expected one of {sorted(ALLOWED_AUTH_MODES)}",
                }
            ],
        )
    return value


def _validate_scopes(scopes: list[str]) -> list[str]:
    unknown = [s for s in scopes if s not in ALLOWED_SCOPES]
    if unknown:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="mcp.invalid_scope",
            message=f"unknown scopes: {sorted(set(unknown))}",
            details=[
                {"path": "body.scopes", "issue": f"unknown scope '{s}'"}
                for s in unknown
            ],
        )
    return list(dict.fromkeys(scopes))


def _validate_transport_pairing(
    *, transport: str, endpoint_url: str | None, command: str | None
) -> None:
    if transport in {"http", "sse"} and not endpoint_url:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="mcp.endpoint_required",
            message=f"transport '{transport}' requires endpointUrl",
            details=[
                {
                    "path": "body.endpointUrl",
                    "issue": "required for http/sse transports",
                }
            ],
        )
    if transport == "stdio" and not command:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="mcp.command_required",
            message="transport 'stdio' requires command",
            details=[
                {"path": "body.command", "issue": "required for stdio transport"}
            ],
        )


@router.get("", response_model=McpListOut)
async def list_mcp_servers(admin: AdminUser, db: DbSession) -> McpListOut:
    rows = (await db.scalars(select(McpServer).order_by(McpServer.created_at))).all()
    return McpListOut(servers=[_to_out(r) for r in rows], total=len(rows))


@router.post("", response_model=McpOut, status_code=status.HTTP_201_CREATED)
async def create_mcp_server(
    payload: McpCreateIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> McpOut:
    transport = _validate_transport(payload.transport)
    auth_mode = _validate_auth_mode(payload.authMode)
    scopes = _validate_scopes(payload.scopes)
    _validate_transport_pairing(
        transport=transport,
        endpoint_url=str(payload.endpointUrl) if payload.endpointUrl else None,
        command=payload.command,
    )
    existing = await db.scalar(select(McpServer).where(McpServer.name == payload.name))
    if existing is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="mcp.name_exists",
            message=f"mcp server with name '{payload.name}' already exists",
        )
    row = McpServer(
        id=f"mcp_{uuid.uuid4().hex}",
        name=payload.name,
        transport=transport,
        endpoint_url=str(payload.endpointUrl) if payload.endpointUrl else None,
        command=payload.command,
        auth_mode=auth_mode,
        secret_ref=payload.secretRef,
        scopes=scopes,
        active=True,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="mcp.create",
        resource_type="mcp_server",
        resource_id=row.id,
        outcome="success",
        details={
            "name": payload.name,
            "transport": transport,
            "authMode": auth_mode,
            "scopes": scopes,
        },
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.patch("/{mcp_id}", response_model=McpOut)
async def update_mcp_server(
    mcp_id: str,
    payload: McpPatchIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> McpOut:
    row = await db.scalar(select(McpServer).where(McpServer.id == mcp_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="mcp.not_found",
            message=f"mcp server '{mcp_id}' not found",
        )
    if payload.name is not None and payload.name != row.name:
        clash = await db.scalar(
            select(McpServer).where(
                McpServer.name == payload.name, McpServer.id != row.id
            )
        )
        if clash is not None:
            raise ApiError(
                status_code=status.HTTP_409_CONFLICT,
                code="mcp.name_exists",
                message=f"mcp server with name '{payload.name}' already exists",
            )
        row.name = payload.name
    if payload.endpointUrl is not None:
        row.endpoint_url = str(payload.endpointUrl)
    if payload.command is not None:
        row.command = payload.command
    if payload.authMode is not None:
        row.auth_mode = _validate_auth_mode(payload.authMode)
    if payload.secretRef is not None:
        row.secret_ref = payload.secretRef
    if payload.scopes is not None:
        row.scopes = _validate_scopes(payload.scopes)
    if payload.active is not None:
        row.active = payload.active
    # Re-check transport pairing after any url/command swap.
    _validate_transport_pairing(
        transport=row.transport,
        endpoint_url=row.endpoint_url,
        command=row.command,
    )
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="mcp.update",
        resource_type="mcp_server",
        resource_id=row.id,
        outcome="success",
        details=payload.model_dump(exclude_none=True, by_alias=True),
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.delete("/{mcp_id}", response_model=McpOut)
async def deactivate_mcp_server(
    mcp_id: str,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> McpOut:
    row = await db.scalar(select(McpServer).where(McpServer.id == mcp_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="mcp.not_found",
            message=f"mcp server '{mcp_id}' not found",
        )
    row.active = False
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="mcp.deactivate",
        resource_type="mcp_server",
        resource_id=row.id,
        outcome="success",
        details={"name": row.name},
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)
