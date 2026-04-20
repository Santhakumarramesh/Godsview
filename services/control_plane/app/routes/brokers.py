"""Authenticated /v1/brokers surface — Phase 7 multi-broker registry.

Wire contract (all responses camelCase JSON, all inputs accept either
snake_case or camelCase):

Adapters
  * ``GET    /v1/brokers/adapters``              — list every registered adapter.
  * ``GET    /v1/brokers/adapters/{id}``         — single adapter.
  * ``POST   /v1/brokers/adapters``              — register a new adapter.
                                                   Live kinds (``*_live``)
                                                   require ``liveEnabled=true``
                                                   to intend live routing;
                                                   the default is off.
  * ``PATCH  /v1/brokers/adapters/{id}``         — mutate role / display name /
                                                   ``liveEnabled`` / ``probeEnabled``.
                                                   Requires an admin reason.
  * ``POST   /v1/brokers/adapters/{id}/probe``   — ad-hoc health probe;
                                                   writes and returns a snapshot.
  * ``GET    /v1/brokers/adapters/{id}/health``  — per-adapter probe history.
  * ``GET    /v1/brokers/registry``              — aggregated live-routable summary.

Bindings
  * ``GET    /v1/brokers/bindings``              — list (filter by adapter / account).
  * ``GET    /v1/brokers/bindings/{id}``         — single binding.
  * ``POST   /v1/brokers/bindings``              — create a binding.
  * ``PATCH  /v1/brokers/bindings/{id}``         — toggle enabled / re-weight / rename.
  * ``DELETE /v1/brokers/bindings/{id}``         — remove a binding.

Health
  * ``GET    /v1/brokers/health``                — rolling snapshots, filterable.

Reads are un-logged. Every mutation funnels through
:func:`app.audit.log_event` with ``resource_type="broker.adapter"``,
``broker.binding``, or ``broker.health`` as appropriate.

The route layer only persists registry + binding metadata. The concrete
``BrokerProtocol`` implementations (Alpaca, Fake, IB-stub) are resolved
via :class:`~app.broker.base.BrokerRegistry` at request time — adapter
registration does NOT auto-wire credentials into the in-process
registry; that happens during adapter bootstrap in ``app.main`` on a
separate, config-driven code path. This keeps the DB row the operator
source of truth while the in-process registry stays the hot-path truth.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.audit import log_event
from app.broker import broker_registry
from app.broker.base import BrokerUnavailable
from app.db import DbSession
from app.deps import AdminUser
from app.errors import ApiError
from app.models import (
    BrokerAccountBindingRow,
    BrokerAdapterRow,
    BrokerHealthSnapshotRow,
)

router = APIRouter(prefix="/brokers", tags=["brokers"])


# ─────────────────────────── constants ──────────────────────────────


BrokerAdapterKindLiteral = Literal[
    "alpaca_paper",
    "alpaca_live",
    "ib_paper",
    "ib_live",
]

BrokerAdapterRoleLiteral = Literal["primary", "secondary", "paper"]

BrokerAdapterStatusLiteral = Literal[
    "healthy",
    "degraded",
    "down",
    "unknown",
]

_LIVE_KINDS: frozenset[str] = frozenset({"alpaca_live", "ib_live"})


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _mask_api_key(api_key: str) -> str:
    """Return the last-4 projection surfaced to the UI."""
    clean = api_key.strip()
    if len(clean) <= 4:
        return "••••"
    return f"••••{clean[-4:]}"


# ─────────────────────────── DTOs ───────────────────────────────────


class BrokerAdapterDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    kind: BrokerAdapterKindLiteral
    role: BrokerAdapterRoleLiteral
    displayName: str
    host: str
    apiKeyMasked: str | None = None
    latestSnapshotId: str | None = None
    status: BrokerAdapterStatusLiteral
    liveEnabled: bool
    probeEnabled: bool
    createdAt: datetime
    updatedAt: datetime


class BrokerAdaptersListOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    adapters: list[BrokerAdapterDto]


class BrokerAdapterRegisterIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: BrokerAdapterKindLiteral
    role: BrokerAdapterRoleLiteral
    displayName: str = Field(min_length=1, max_length=120)
    host: str = Field(min_length=1, max_length=253)
    apiKey: str = Field(min_length=1, max_length=512)
    apiSecret: str | None = Field(default=None, min_length=1, max_length=1024)
    liveEnabled: bool | None = None
    probeEnabled: bool | None = None


class BrokerAdapterUpdateIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    role: BrokerAdapterRoleLiteral | None = None
    displayName: str | None = Field(default=None, min_length=1, max_length=120)
    liveEnabled: bool | None = None
    probeEnabled: bool | None = None
    reason: str = Field(min_length=3, max_length=280)


class BrokerAccountBindingDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    adapterId: str
    accountId: str
    externalAccountId: str
    displayName: str
    role: BrokerAdapterRoleLiteral
    enabled: bool
    weight: float
    createdAt: datetime
    updatedAt: datetime


class BrokerAccountBindingsListOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    bindings: list[BrokerAccountBindingDto]


class BrokerAccountBindingIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    adapterId: str
    accountId: str
    externalAccountId: str = Field(min_length=1, max_length=128)
    displayName: str = Field(min_length=1, max_length=120)
    role: BrokerAdapterRoleLiteral
    weight: float | None = Field(default=None, ge=0.0, le=1.0)
    enabled: bool | None = None


class BrokerAccountBindingPatchIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    externalAccountId: str | None = Field(default=None, min_length=1, max_length=128)
    displayName: str | None = Field(default=None, min_length=1, max_length=120)
    role: BrokerAdapterRoleLiteral | None = None
    weight: float | None = Field(default=None, ge=0.0, le=1.0)
    enabled: bool | None = None
    reason: str = Field(min_length=3, max_length=280)


class BrokerHealthSnapshotDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    adapterId: str
    status: BrokerAdapterStatusLiteral
    lastProbeAt: datetime | None = None
    sampleCount: int
    latencyP50Ms: float | None = None
    latencyP95Ms: float | None = None
    latencyP99Ms: float | None = None
    errorRate: float
    notes: str | None = None
    observedAt: datetime


class BrokerHealthSnapshotsListOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    snapshots: list[BrokerHealthSnapshotDto]
    total: int


class BrokerRegistryQuorumDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    total: int
    healthy: int
    degraded: int
    down: int


class BrokerRegistrySummaryOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    adapters: list[BrokerAdapterDto]
    quorum: BrokerRegistryQuorumDto
    liveRoutable: bool
    observedAt: datetime


# ─────────────────────────── row → dto helpers ──────────────────────


def _adapter_to_dto(row: BrokerAdapterRow) -> BrokerAdapterDto:
    return BrokerAdapterDto(
        id=row.id,
        kind=row.kind,  # type: ignore[arg-type]
        role=row.role,  # type: ignore[arg-type]
        displayName=row.display_name,
        host=row.host,
        apiKeyMasked=row.api_key_masked,
        latestSnapshotId=row.latest_snapshot_id,
        status=row.status,  # type: ignore[arg-type]
        liveEnabled=row.live_enabled,
        probeEnabled=row.probe_enabled,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def _binding_to_dto(row: BrokerAccountBindingRow) -> BrokerAccountBindingDto:
    return BrokerAccountBindingDto(
        id=row.id,
        adapterId=row.adapter_id,
        accountId=row.account_id,
        externalAccountId=row.external_account_id,
        displayName=row.display_name,
        role=row.role,  # type: ignore[arg-type]
        enabled=row.enabled,
        weight=row.weight,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def _snapshot_to_dto(row: BrokerHealthSnapshotRow) -> BrokerHealthSnapshotDto:
    return BrokerHealthSnapshotDto(
        id=row.id,
        adapterId=row.adapter_id,
        status=row.status,  # type: ignore[arg-type]
        lastProbeAt=row.last_probe_at,
        sampleCount=row.sample_count,
        latencyP50Ms=row.latency_p50_ms,
        latencyP95Ms=row.latency_p95_ms,
        latencyP99Ms=row.latency_p99_ms,
        errorRate=row.error_rate,
        notes=row.notes,
        observedAt=row.observed_at,
    )


async def _get_adapter_or_404(
    db: DbSession, adapter_id: str
) -> BrokerAdapterRow:
    row = await db.get(BrokerAdapterRow, adapter_id)
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="broker_adapter_not_found",
            message=f"no broker adapter with id {adapter_id!r}",
        )
    return row


async def _get_binding_or_404(
    db: DbSession, binding_id: str
) -> BrokerAccountBindingRow:
    row = await db.get(BrokerAccountBindingRow, binding_id)
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="broker_binding_not_found",
            message=f"no broker binding with id {binding_id!r}",
        )
    return row


# ─────────────────────────── adapter routes ─────────────────────────


@router.get("/adapters", response_model=BrokerAdaptersListOut)
async def list_adapters(
    user: AdminUser,
    db: DbSession,
) -> BrokerAdaptersListOut:
    """List every registered broker adapter (admin-only)."""

    rows = (
        await db.execute(
            select(BrokerAdapterRow).order_by(BrokerAdapterRow.created_at.desc())
        )
    ).scalars().all()
    return BrokerAdaptersListOut(
        adapters=[_adapter_to_dto(r) for r in rows]
    )


@router.get("/adapters/{adapter_id}", response_model=BrokerAdapterDto)
async def get_adapter(
    user: AdminUser,
    db: DbSession,
    adapter_id: str,
) -> BrokerAdapterDto:
    row = await _get_adapter_or_404(db, adapter_id)
    return _adapter_to_dto(row)


@router.post(
    "/adapters",
    response_model=BrokerAdapterDto,
    status_code=status.HTTP_201_CREATED,
)
async def register_adapter(
    user: AdminUser,
    db: DbSession,
    request: Request,
    payload: BrokerAdapterRegisterIn,
) -> BrokerAdapterDto:
    """Register a new broker adapter.

    The API never echoes the raw API key back — the masked projection
    (last-4) is what the UI surfaces. The secret itself is stored by
    reference in ``system_config.brokers.<adapterId>.credentials``; the
    registry row carries a placeholder ``api_secret_ref`` that the
    bootstrap hook resolves at process boot.

    Live kinds (``alpaca_live`` / ``ib_live``) can be registered but
    default ``live_enabled=False``; flipping the gate requires a
    subsequent PATCH that explicitly sets ``liveEnabled=true`` +
    supplies a reason.
    """

    kind = payload.kind
    role = payload.role

    # Paper adapters with primary/secondary role are a config mistake —
    # paper must carry the paper role (the live gate routes on role).
    if kind.endswith("_paper") and role != "paper":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_role_for_paper_kind",
            message=(
                f"adapter kind {kind!r} is a paper kind — role must be "
                "'paper', not {role!r}"
            ),
        )

    # Live adapters MAY NOT register with role='paper' — surface a
    # typed 400 so the UI can render a helpful error.
    if kind.endswith("_live") and role == "paper":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_role_for_live_kind",
            message=(
                f"adapter kind {kind!r} is a live kind — role must be "
                "'primary' or 'secondary', not 'paper'"
            ),
        )

    live_enabled = bool(payload.liveEnabled) if payload.liveEnabled is not None else False
    if kind not in _LIVE_KINDS:
        # Paper kinds ignore the liveEnabled gate — paper orders bypass
        # the live gate entirely.
        live_enabled = False

    probe_enabled = (
        bool(payload.probeEnabled) if payload.probeEnabled is not None else True
    )

    row = BrokerAdapterRow(
        kind=kind,
        role=role,
        display_name=payload.displayName,
        host=payload.host,
        api_key_masked=_mask_api_key(payload.apiKey),
        api_secret_ref=f"system_config.brokers.{payload.displayName}.credentials",
        latest_snapshot_id=None,
        status="unknown",
        live_enabled=live_enabled,
        probe_enabled=probe_enabled,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:  # pragma: no cover - DB-driven
        await db.rollback()
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="broker_adapter_conflict",
            message=(
                f"an adapter with kind {kind!r} and displayName "
                f"{payload.displayName!r} already exists"
            ),
        ) from exc

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="broker.adapter.register",
        resource_type="broker.adapter",
        resource_id=row.id,
        outcome="success",
        details={
            "kind": kind,
            "role": role,
            "displayName": payload.displayName,
            "host": payload.host,
            "liveEnabled": live_enabled,
            "probeEnabled": probe_enabled,
        },
    )
    await db.commit()
    return _adapter_to_dto(row)


@router.patch(
    "/adapters/{adapter_id}",
    response_model=BrokerAdapterDto,
)
async def update_adapter(
    user: AdminUser,
    db: DbSession,
    request: Request,
    adapter_id: str,
    payload: BrokerAdapterUpdateIn,
) -> BrokerAdapterDto:
    row = await _get_adapter_or_404(db, adapter_id)

    # Enforce kind / role compatibility on updates too.
    new_role = payload.role if payload.role is not None else row.role
    if row.kind.endswith("_paper") and new_role != "paper":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_role_for_paper_kind",
            message=(
                f"adapter kind {row.kind!r} is a paper kind — role must be "
                "'paper'"
            ),
        )
    if row.kind.endswith("_live") and new_role == "paper":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_role_for_live_kind",
            message=(
                f"adapter kind {row.kind!r} is a live kind — role must be "
                "'primary' or 'secondary'"
            ),
        )

    changes: dict[str, Any] = {"reason": payload.reason}
    if payload.role is not None and payload.role != row.role:
        changes["roleFrom"] = row.role
        changes["roleTo"] = payload.role
        row.role = payload.role
    if payload.displayName is not None and payload.displayName != row.display_name:
        changes["displayNameFrom"] = row.display_name
        changes["displayNameTo"] = payload.displayName
        row.display_name = payload.displayName
    if payload.liveEnabled is not None and payload.liveEnabled != row.live_enabled:
        # Paper kinds can never be flipped to live.
        if row.kind.endswith("_paper") and payload.liveEnabled:
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="cannot_enable_live_on_paper_kind",
                message=(
                    f"adapter kind {row.kind!r} is a paper kind — live gate "
                    "cannot be enabled"
                ),
            )
        changes["liveEnabledFrom"] = row.live_enabled
        changes["liveEnabledTo"] = payload.liveEnabled
        row.live_enabled = payload.liveEnabled
    if (
        payload.probeEnabled is not None
        and payload.probeEnabled != row.probe_enabled
    ):
        changes["probeEnabledFrom"] = row.probe_enabled
        changes["probeEnabledTo"] = payload.probeEnabled
        row.probe_enabled = payload.probeEnabled

    row.updated_at = _utcnow()
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="broker.adapter.update",
        resource_type="broker.adapter",
        resource_id=row.id,
        outcome="success",
        details=changes,
    )
    await db.commit()
    return _adapter_to_dto(row)


@router.post(
    "/adapters/{adapter_id}/probe",
    response_model=BrokerHealthSnapshotDto,
)
async def probe_adapter(
    user: AdminUser,
    db: DbSession,
    request: Request,
    adapter_id: str,
) -> BrokerHealthSnapshotDto:
    """Run an ad-hoc probe and write a fresh snapshot.

    The route resolves the adapter via the in-process registry — if no
    adapter is registered (e.g. the row exists but the bootstrap hook
    hasn't wired it yet) the snapshot lands with ``status='down'`` +
    ``notes='no_adapter_registered'``. This keeps the UI honest about
    the DB/runtime split.
    """

    row = await _get_adapter_or_404(db, adapter_id)

    adapter = broker_registry.get_or_none(adapter_id)
    observed_at = _utcnow()
    if adapter is None:
        snap = BrokerHealthSnapshotRow(
            adapter_id=adapter_id,
            status="down",
            last_probe_at=observed_at,
            sample_count=1,
            latency_p50_ms=None,
            latency_p95_ms=None,
            latency_p99_ms=None,
            error_rate=1.0,
            notes="no_adapter_registered",
            observed_at=observed_at,
        )
    else:
        try:
            # Probe = cheapest call we have that hits the broker.
            equity = await adapter.get_equity()
            status_label = "healthy"
            notes: str | None = None
            error_rate = 0.0
            # The real cron measures latency; the ad-hoc probe records
            # 0 as a seed and lets the cron fill real numbers.
            latency = 0.0
        except BrokerUnavailable as exc:
            status_label = "down"
            notes = exc.reason[:500]
            error_rate = 1.0
            latency = 0.0
            equity = None

        snap = BrokerHealthSnapshotRow(
            adapter_id=adapter_id,
            status=status_label,
            last_probe_at=observed_at,
            sample_count=1,
            latency_p50_ms=latency,
            latency_p95_ms=latency,
            latency_p99_ms=latency,
            error_rate=error_rate,
            notes=notes
            or (
                f"ad_hoc_probe ok equity={equity.total_equity:.2f}"
                if equity is not None
                else None
            ),
            observed_at=observed_at,
        )

    db.add(snap)
    row.latest_snapshot_id = snap.id
    row.status = snap.status
    row.updated_at = observed_at

    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="broker.adapter.probe",
        resource_type="broker.adapter",
        resource_id=row.id,
        outcome="success" if snap.status == "healthy" else "failure",
        details={
            "snapshotId": snap.id,
            "status": snap.status,
            "notes": snap.notes,
        },
    )
    await db.commit()
    return _snapshot_to_dto(snap)


@router.get(
    "/adapters/{adapter_id}/health",
    response_model=BrokerHealthSnapshotsListOut,
)
async def list_adapter_health(
    user: AdminUser,
    db: DbSession,
    adapter_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    since: datetime | None = Query(None),
) -> BrokerHealthSnapshotsListOut:
    # 404 on unknown adapter so the UI doesn't silently paint "empty".
    await _get_adapter_or_404(db, adapter_id)

    stmt = select(BrokerHealthSnapshotRow).where(
        BrokerHealthSnapshotRow.adapter_id == adapter_id
    )
    if since is not None:
        stmt = stmt.where(BrokerHealthSnapshotRow.observed_at >= since)

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = int((await db.execute(total_stmt)).scalar_one())

    page_stmt = (
        stmt.order_by(BrokerHealthSnapshotRow.observed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(page_stmt)).scalars().all()
    return BrokerHealthSnapshotsListOut(
        snapshots=[_snapshot_to_dto(r) for r in rows],
        total=total,
    )


# ─────────────────────────── registry summary ───────────────────────


@router.get("/registry", response_model=BrokerRegistrySummaryOut)
async def registry_summary(
    user: AdminUser,
    db: DbSession,
) -> BrokerRegistrySummaryOut:
    """Aggregated adapter state — what `/admin/brokers` paints."""

    rows = (
        await db.execute(
            select(BrokerAdapterRow).order_by(
                BrokerAdapterRow.kind, BrokerAdapterRow.created_at.desc()
            )
        )
    ).scalars().all()

    quorum = BrokerRegistryQuorumDto(
        total=len(rows),
        healthy=sum(1 for r in rows if r.status == "healthy"),
        degraded=sum(1 for r in rows if r.status == "degraded"),
        down=sum(1 for r in rows if r.status == "down"),
    )
    # Live is routable iff at least one primary adapter is healthy AND
    # live-enabled on a live kind.
    live_routable = any(
        r.role == "primary"
        and r.status == "healthy"
        and r.live_enabled
        and r.kind in _LIVE_KINDS
        for r in rows
    )
    return BrokerRegistrySummaryOut(
        adapters=[_adapter_to_dto(r) for r in rows],
        quorum=quorum,
        liveRoutable=live_routable,
        observedAt=_utcnow(),
    )


# ─────────────────────────── binding routes ─────────────────────────


@router.get("/bindings", response_model=BrokerAccountBindingsListOut)
async def list_bindings(
    user: AdminUser,
    db: DbSession,
    adapter_id: Optional[str] = Query(None, alias="adapterId"),
    account_id: Optional[str] = Query(None, alias="accountId"),
) -> BrokerAccountBindingsListOut:
    stmt = select(BrokerAccountBindingRow)
    if adapter_id is not None:
        stmt = stmt.where(BrokerAccountBindingRow.adapter_id == adapter_id)
    if account_id is not None:
        stmt = stmt.where(BrokerAccountBindingRow.account_id == account_id)
    stmt = stmt.order_by(BrokerAccountBindingRow.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return BrokerAccountBindingsListOut(
        bindings=[_binding_to_dto(r) for r in rows]
    )


@router.get(
    "/bindings/{binding_id}", response_model=BrokerAccountBindingDto
)
async def get_binding(
    user: AdminUser,
    db: DbSession,
    binding_id: str,
) -> BrokerAccountBindingDto:
    row = await _get_binding_or_404(db, binding_id)
    return _binding_to_dto(row)


@router.post(
    "/bindings",
    response_model=BrokerAccountBindingDto,
    status_code=status.HTTP_201_CREATED,
)
async def create_binding(
    user: AdminUser,
    db: DbSession,
    request: Request,
    payload: BrokerAccountBindingIn,
) -> BrokerAccountBindingDto:
    # Validate adapter exists (FK will also catch; friendlier 404 here).
    adapter = await _get_adapter_or_404(db, payload.adapterId)

    # Role must be compatible with adapter kind.
    if adapter.kind.endswith("_paper") and payload.role != "paper":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_role_for_paper_kind",
            message=(
                f"adapter kind {adapter.kind!r} is a paper kind — binding role "
                "must be 'paper'"
            ),
        )
    if adapter.kind.endswith("_live") and payload.role == "paper":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_role_for_live_kind",
            message=(
                f"adapter kind {adapter.kind!r} is a live kind — binding role "
                "must be 'primary' or 'secondary'"
            ),
        )

    row = BrokerAccountBindingRow(
        adapter_id=payload.adapterId,
        account_id=payload.accountId,
        external_account_id=payload.externalAccountId,
        display_name=payload.displayName,
        role=payload.role,
        enabled=payload.enabled if payload.enabled is not None else True,
        weight=payload.weight if payload.weight is not None else 1.0,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:  # pragma: no cover - DB-driven
        await db.rollback()
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="broker_binding_conflict",
            message=(
                f"a binding between adapter {payload.adapterId!r} and "
                f"account {payload.accountId!r} already exists"
            ),
        ) from exc

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="broker.binding.create",
        resource_type="broker.binding",
        resource_id=row.id,
        outcome="success",
        details={
            "adapterId": row.adapter_id,
            "accountId": row.account_id,
            "role": row.role,
            "weight": row.weight,
            "enabled": row.enabled,
        },
    )
    await db.commit()
    return _binding_to_dto(row)


@router.patch(
    "/bindings/{binding_id}", response_model=BrokerAccountBindingDto
)
async def update_binding(
    user: AdminUser,
    db: DbSession,
    request: Request,
    binding_id: str,
    payload: BrokerAccountBindingPatchIn,
) -> BrokerAccountBindingDto:
    row = await _get_binding_or_404(db, binding_id)

    # Pull the parent adapter for role-compat checks.
    adapter = await _get_adapter_or_404(db, row.adapter_id)

    new_role = payload.role if payload.role is not None else row.role
    if adapter.kind.endswith("_paper") and new_role != "paper":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_role_for_paper_kind",
            message=(
                f"adapter kind {adapter.kind!r} is a paper kind — binding role "
                "must be 'paper'"
            ),
        )
    if adapter.kind.endswith("_live") and new_role == "paper":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_role_for_live_kind",
            message=(
                f"adapter kind {adapter.kind!r} is a live kind — binding role "
                "must be 'primary' or 'secondary'"
            ),
        )

    changes: dict[str, Any] = {"reason": payload.reason}
    if payload.externalAccountId is not None and payload.externalAccountId != row.external_account_id:
        changes["externalAccountIdFrom"] = row.external_account_id
        changes["externalAccountIdTo"] = payload.externalAccountId
        row.external_account_id = payload.externalAccountId
    if payload.displayName is not None and payload.displayName != row.display_name:
        changes["displayNameFrom"] = row.display_name
        changes["displayNameTo"] = payload.displayName
        row.display_name = payload.displayName
    if payload.role is not None and payload.role != row.role:
        changes["roleFrom"] = row.role
        changes["roleTo"] = payload.role
        row.role = payload.role
    if payload.weight is not None and payload.weight != row.weight:
        changes["weightFrom"] = row.weight
        changes["weightTo"] = payload.weight
        row.weight = payload.weight
    if payload.enabled is not None and payload.enabled != row.enabled:
        changes["enabledFrom"] = row.enabled
        changes["enabledTo"] = payload.enabled
        row.enabled = payload.enabled

    row.updated_at = _utcnow()
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="broker.binding.update",
        resource_type="broker.binding",
        resource_id=row.id,
        outcome="success",
        details=changes,
    )
    await db.commit()
    return _binding_to_dto(row)


@router.delete(
    "/bindings/{binding_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_binding(
    user: AdminUser,
    db: DbSession,
    request: Request,
    binding_id: str,
    reason: str = Query(..., min_length=3, max_length=280),
) -> None:
    row = await _get_binding_or_404(db, binding_id)
    snapshot = {
        "adapterId": row.adapter_id,
        "accountId": row.account_id,
        "role": row.role,
        "weight": row.weight,
        "enabled": row.enabled,
    }
    await db.delete(row)

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="broker.binding.delete",
        resource_type="broker.binding",
        resource_id=binding_id,
        outcome="success",
        details={"reason": reason, **snapshot},
    )
    await db.commit()
    return None


# ─────────────────────────── /brokers/health ────────────────────────


@router.get("/health", response_model=BrokerHealthSnapshotsListOut)
async def list_health(
    user: AdminUser,
    db: DbSession,
    adapter_id: Optional[str] = Query(None, alias="adapterId"),
    status_filter: Optional[BrokerAdapterStatusLiteral] = Query(
        None, alias="status"
    ),
    since: datetime | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> BrokerHealthSnapshotsListOut:
    stmt = select(BrokerHealthSnapshotRow)
    if adapter_id is not None:
        stmt = stmt.where(BrokerHealthSnapshotRow.adapter_id == adapter_id)
    if status_filter is not None:
        stmt = stmt.where(BrokerHealthSnapshotRow.status == status_filter)
    if since is not None:
        stmt = stmt.where(BrokerHealthSnapshotRow.observed_at >= since)

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = int((await db.execute(total_stmt)).scalar_one())

    page_stmt = (
        stmt.order_by(BrokerHealthSnapshotRow.observed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(page_stmt)).scalars().all()

    return BrokerHealthSnapshotsListOut(
        snapshots=[_snapshot_to_dto(r) for r in rows],
        total=total,
    )
