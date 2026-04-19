"""Authenticated /v1/orderflow surface — order-book + delta ingest + reads.

Phase 3 PR3 scope
-----------------
  * ``POST /v1/orderflow/ingest`` — admin-only DepthSnapshot + DeltaBar
    ingest. Persists the envelope into ``depth_snapshots`` and/or
    ``delta_bars`` and fans the snapshot out to any future order-flow
    subscribers (real-time bridge lands in Phase 4).
  * ``GET  /v1/orderflow/symbols/{id}/depth`` — paginated snapshot
    history with ISO-8601 from/to bounds.
  * ``GET  /v1/orderflow/symbols/{id}/delta`` — DeltaBar series filtered
    by ``tf`` + optional time window.

Detector-output reads (events, walls, clusters, rolled-up state) are
stubbed with empty payloads in this PR — they become live in PR4 once
the detector pipeline is wired. Keeping the endpoints present now lets
the web app ship typed stubs without a follow-up client release.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, select

from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import DeltaBar, DepthSnapshot, Symbol

router = APIRouter(prefix="/orderflow", tags=["orderflow"])

_ALLOWED_TFS = frozenset(
    {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"}
)
_ALLOWED_SOURCES = frozenset(
    {"bookmap", "databento", "alpaca", "replay", "synthetic"}
)


# ─────────────────────────── DTOs ────────────────────────────────────


class DepthLevelDto(BaseModel):
    model_config = {"populate_by_name": True}

    price: float
    size: float = Field(ge=0)
    orders: int | None = None


class DepthSnapshotIn(BaseModel):
    model_config = {"populate_by_name": True}

    symbolId: str = Field(..., min_length=1)
    t: datetime
    bids: list[DepthLevelDto] = []
    asks: list[DepthLevelDto] = []
    delta: float = 0.0
    last: float
    source: Literal[
        "bookmap", "databento", "alpaca", "replay", "synthetic"
    ] = "synthetic"


class DepthSnapshotOut(DepthSnapshotIn):
    id: str


class DeltaBarIn(BaseModel):
    model_config = {"populate_by_name": True}

    symbolId: str = Field(..., min_length=1)
    tf: str
    t: datetime
    buyVolume: float = Field(0.0, ge=0)
    sellVolume: float = Field(0.0, ge=0)
    delta: float = 0.0
    cumulativeDelta: float = 0.0


class DeltaBarOut(DeltaBarIn):
    pass


class OrderFlowIngestIn(BaseModel):
    model_config = {"populate_by_name": True}

    snapshot: DepthSnapshotIn | None = None
    deltaBar: DeltaBarIn | None = None


class OrderFlowIngestOut(BaseModel):
    model_config = {"populate_by_name": True}

    delivered: int
    symbolId: str
    acceptedAt: datetime


class DepthSnapshotsOut(BaseModel):
    model_config = {"populate_by_name": True}

    symbolId: str
    snapshots: list[DepthSnapshotOut]
    total: int


class DeltaBarsOut(BaseModel):
    model_config = {"populate_by_name": True}

    symbolId: str
    tf: str
    bars: list[DeltaBarOut]


class OrderFlowEventsOut(BaseModel):
    """Empty envelope in PR3 — fields populated by PR4 detectors."""

    model_config = {"populate_by_name": True}

    symbolId: str
    imbalances: list[dict[str, Any]] = []
    absorptions: list[dict[str, Any]] = []
    exhaustions: list[dict[str, Any]] = []


class BookStructuresOut(BaseModel):
    """Empty envelope in PR3 — fields populated by PR4 detectors."""

    model_config = {"populate_by_name": True}

    symbolId: str
    walls: list[dict[str, Any]] = []
    clusters: list[dict[str, Any]] = []
    asOf: datetime


class OrderFlowStateOut(BaseModel):
    """Rolled-up detector state; PR3 returns a zero-valued shell so the
    apps/web typed client never sees a 404 while the pipeline is still
    being wired."""

    model_config = {"populate_by_name": True}

    symbolId: str
    asOf: datetime
    lastDelta: float = 0.0
    cumulativeDelta: float = 0.0
    activeImbalance: dict[str, Any] | None = None
    recentAbsorption: list[dict[str, Any]] = []
    recentExhaustion: list[dict[str, Any]] = []
    walls: list[dict[str, Any]] = []
    clusters: list[dict[str, Any]] = []
    netBias: Literal["long", "short", "neutral"] = "neutral"


# ─────────────────────────── helpers ────────────────────────────────


def _snapshot_id() -> str:
    return f"dep_{uuid.uuid4().hex}"


def _validate_tf(tf: str) -> str:
    if tf not in _ALLOWED_TFS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_timeframe",
            message=f"unknown tf: {tf}",
        )
    return tf


async def _load_symbol_or_404(db: DbSession, symbol_id: str) -> Symbol:
    sym = await db.scalar(select(Symbol).where(Symbol.id == symbol_id))
    if sym is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="symbol_not_found",
            message=f"symbol {symbol_id} does not exist",
        )
    return sym


def _snapshot_to_dto(row: DepthSnapshot) -> DepthSnapshotOut:
    return DepthSnapshotOut(
        id=row.id,
        symbolId=row.symbol_id,
        t=row.t,
        bids=[DepthLevelDto(**lvl) for lvl in (row.bids or [])],
        asks=[DepthLevelDto(**lvl) for lvl in (row.asks or [])],
        delta=row.delta,
        last=row.last,
        source=row.source,  # type: ignore[arg-type]
    )


def _delta_bar_to_dto(row: DeltaBar) -> DeltaBarOut:
    return DeltaBarOut(
        symbolId=row.symbol_id,
        tf=row.tf,
        t=row.t,
        buyVolume=row.buy_volume,
        sellVolume=row.sell_volume,
        delta=row.delta,
        cumulativeDelta=row.cumulative_delta,
    )


# ─────────────────────────── routes ─────────────────────────────────


@router.post(
    "/ingest",
    response_model=OrderFlowIngestOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest(
    body: OrderFlowIngestIn,
    user: AdminUser,
    db: DbSession,
) -> OrderFlowIngestOut:
    """Persist a DepthSnapshot + / or DeltaBar for a known symbol.

    At least one of ``snapshot`` / ``deltaBar`` must be supplied. The
    ``symbolId`` is taken from whichever sub-payload is present (they
    must agree if both are supplied).
    """

    if body.snapshot is None and body.deltaBar is None:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="empty_payload",
            message="at least one of snapshot / deltaBar is required",
        )

    symbol_id: str
    if body.snapshot is not None and body.deltaBar is not None:
        if body.snapshot.symbolId != body.deltaBar.symbolId:
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="symbol_id_mismatch",
                message="snapshot.symbolId and deltaBar.symbolId disagree",
            )
        symbol_id = body.snapshot.symbolId
    else:
        symbol_id = (
            body.snapshot.symbolId
            if body.snapshot is not None
            else body.deltaBar.symbolId  # type: ignore[union-attr]
        )

    await _load_symbol_or_404(db, symbol_id)

    if body.snapshot is not None:
        snap = body.snapshot
        row = DepthSnapshot(
            id=_snapshot_id(),
            symbol_id=snap.symbolId,
            t=snap.t,
            bids=[lvl.model_dump(exclude_none=True) for lvl in snap.bids],
            asks=[lvl.model_dump(exclude_none=True) for lvl in snap.asks],
            delta=snap.delta,
            last=snap.last,
            source=snap.source,
        )
        db.add(row)

    if body.deltaBar is not None:
        dbar = body.deltaBar
        _validate_tf(dbar.tf)
        dbar_row = DeltaBar(
            symbol_id=dbar.symbolId,
            tf=dbar.tf,
            t=dbar.t,
            buy_volume=dbar.buyVolume,
            sell_volume=dbar.sellVolume,
            delta=dbar.delta,
            cumulative_delta=dbar.cumulativeDelta,
        )
        db.add(dbar_row)

    await db.commit()

    # The fan-out hub for order-flow subscribers lands in PR4.
    # For now we return delivered=0 so the client contract stays stable.
    return OrderFlowIngestOut(
        delivered=0,
        symbolId=symbol_id,
        acceptedAt=datetime.now().astimezone(),
    )


@router.get(
    "/symbols/{symbol_id}/depth",
    response_model=DepthSnapshotsOut,
)
async def get_depth(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
    from_ts: datetime | None = Query(None, alias="fromTs"),
    to_ts: datetime | None = Query(None, alias="toTs"),
    limit: int = Query(200, ge=1, le=2000),
) -> DepthSnapshotsOut:
    await _load_symbol_or_404(db, symbol_id)

    conds = [DepthSnapshot.symbol_id == symbol_id]
    if from_ts is not None:
        conds.append(DepthSnapshot.t >= from_ts)
    if to_ts is not None:
        conds.append(DepthSnapshot.t < to_ts)

    stmt = (
        select(DepthSnapshot)
        .where(and_(*conds))
        .order_by(desc(DepthSnapshot.t))
        .limit(limit)
    )
    rows = (await db.scalars(stmt)).all()
    return DepthSnapshotsOut(
        symbolId=symbol_id,
        snapshots=[_snapshot_to_dto(r) for r in rows],
        total=len(rows),
    )


@router.get(
    "/symbols/{symbol_id}/delta",
    response_model=DeltaBarsOut,
)
async def get_delta_bars(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
    tf: str = Query(..., min_length=1),
    from_ts: datetime | None = Query(None, alias="fromTs"),
    to_ts: datetime | None = Query(None, alias="toTs"),
    limit: int = Query(500, ge=1, le=5000),
) -> DeltaBarsOut:
    _validate_tf(tf)
    await _load_symbol_or_404(db, symbol_id)

    conds = [DeltaBar.symbol_id == symbol_id, DeltaBar.tf == tf]
    if from_ts is not None:
        conds.append(DeltaBar.t >= from_ts)
    if to_ts is not None:
        conds.append(DeltaBar.t < to_ts)

    stmt = (
        select(DeltaBar)
        .where(and_(*conds))
        .order_by(DeltaBar.t.asc())
        .limit(limit)
    )
    rows = (await db.scalars(stmt)).all()
    return DeltaBarsOut(
        symbolId=symbol_id,
        tf=tf,
        bars=[_delta_bar_to_dto(r) for r in rows],
    )


@router.get(
    "/symbols/{symbol_id}/events",
    response_model=OrderFlowEventsOut,
)
async def get_events(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
) -> OrderFlowEventsOut:
    # PR3 returns an empty envelope. PR4 wires the detector output here.
    await _load_symbol_or_404(db, symbol_id)
    return OrderFlowEventsOut(symbolId=symbol_id)


@router.get(
    "/symbols/{symbol_id}/book",
    response_model=BookStructuresOut,
)
async def get_book_structures(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
) -> BookStructuresOut:
    await _load_symbol_or_404(db, symbol_id)
    return BookStructuresOut(
        symbolId=symbol_id,
        asOf=datetime.now().astimezone(),
    )


@router.get(
    "/symbols/{symbol_id}/state",
    response_model=OrderFlowStateOut,
)
async def get_state(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
) -> OrderFlowStateOut:
    await _load_symbol_or_404(db, symbol_id)
    return OrderFlowStateOut(
        symbolId=symbol_id,
        asOf=datetime.now().astimezone(),
    )
