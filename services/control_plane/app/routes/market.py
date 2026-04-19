"""Authenticated /v1/market surface — symbols registry + structure reads.

Endpoints
---------

  * ``GET  /v1/market/symbols``                — paginated symbol list.
  * ``GET  /v1/market/symbols/{id}``           — symbol detail.
  * ``POST /v1/market/symbols``                — admin-only create.
  * ``GET  /v1/market/symbols/{id}/structure/events``
        paginated structure-event history for the web Market Symbols
        detail page.
  * ``GET  /v1/market/symbols/{id}/structure/zones``
        active (un-violated / un-mitigated) OBs + FVGs. Filters by
        timeframe when ``tf`` is supplied.
  * ``GET  /v1/market/symbols/{id}/context``
        most recent ``MarketContext`` snapshot produced by the PR6
        Fusion Engine, or 404 if none has been generated yet.

Wire contracts
--------------
All response bodies are strict projections of the typed DTOs in
``packages/types/src/market.ts`` and ``packages/types/src/structure.ts``.
Field names use camelCase via Pydantic ``populate_by_name=True`` so
the frontend can deserialise without a rename layer.

Authorisation
-------------
All routes require a valid bearer token (Phase 1 auth). Create is
admin-only; reads are open to any authenticated operator.
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
from app.models import (
    Fvg,
    MarketContext,
    OrderBlock,
    StructureEvent,
    Symbol,
)
from app.realtime import QuoteMessage, get_quote_hub

router = APIRouter(prefix="/market", tags=["market"])

_ALLOWED_TFS = frozenset(
    {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"}
)
_ALLOWED_ASSET_CLASSES = frozenset(
    {"equity", "crypto", "forex", "futures", "index"}
)


# ─────────────────────────── DTOs ────────────────────────────────────


class SymbolOut(BaseModel):
    id: str
    ticker: str
    exchange: str
    assetClass: str
    displayName: str
    tickSize: float
    lotSize: float
    quoteCurrency: str
    sessionTz: str
    active: bool
    createdAt: datetime

    model_config = {"populate_by_name": True, "from_attributes": True}


class SymbolListOut(BaseModel):
    symbols: list[SymbolOut]
    total: int


class SymbolCreateIn(BaseModel):
    ticker: str = Field(min_length=1, max_length=32)
    exchange: str = Field(min_length=1, max_length=32)
    assetClass: Literal["equity", "crypto", "forex", "futures", "index"]
    displayName: str = Field(min_length=1, max_length=120)
    tickSize: float = Field(gt=0)
    lotSize: float = Field(default=1.0, gt=0)
    quoteCurrency: str = Field(min_length=3, max_length=3)
    sessionTz: str = Field(default="America/New_York", max_length=64)

    model_config = {"populate_by_name": True}


class PivotOut(BaseModel):
    kind: str
    price: float
    t: datetime
    barIndex: int

    model_config = {"populate_by_name": True}


class StructureEventOut(BaseModel):
    id: str
    symbolId: str
    tf: str
    kind: str
    direction: str
    level: float
    brokenPivot: PivotOut
    confirmationT: datetime
    confidence: float
    detectedAt: datetime

    model_config = {"populate_by_name": True}


class StructureEventListOut(BaseModel):
    events: list[StructureEventOut]
    total: int


class OrderBlockOut(BaseModel):
    id: str
    symbolId: str
    tf: str
    direction: str
    high: float
    low: float
    t: datetime
    strength: float
    retested: bool
    violated: bool
    structureEventId: str | None = None
    detectedAt: datetime

    model_config = {"populate_by_name": True, "from_attributes": True}


class FvgOut(BaseModel):
    id: str
    symbolId: str
    tf: str
    direction: str
    top: float
    bottom: float
    t: datetime
    mitigated: bool
    mitigatedAt: datetime | None = None
    detectedAt: datetime

    model_config = {"populate_by_name": True, "from_attributes": True}


class StructureZonesOut(BaseModel):
    orderBlocks: list[OrderBlockOut]
    fvgs: list[FvgOut]


class MarketContextOut(BaseModel):
    symbolId: str
    htfBias: str
    ltfBias: str
    conflict: bool
    recentEvents: list[Any]
    activeOrderBlocks: list[Any]
    activeFvgs: list[Any]
    generatedAt: datetime

    model_config = {"populate_by_name": True}


class QuotePublishIn(BaseModel):
    """Admin payload that fans out a single Quote tick over /ws/quotes.

    Mirrors ``QuoteSchema`` from ``packages/types/src/market.ts`` so an
    operator MCP / replay tool can reuse the same shape end-to-end.
    """

    symbolId: str = Field(..., min_length=1)
    bid: float
    ask: float
    last: float
    bidSize: float = Field(..., ge=0)
    askSize: float = Field(..., ge=0)
    t: datetime

    model_config = {"populate_by_name": True}


class QuotePublishOut(BaseModel):
    delivered: int
    symbolId: str


# ─────────────────────────── helpers ─────────────────────────────────


def _symbol_id() -> str:
    return f"sym_{uuid.uuid4().hex}"


def _validate_tf_filter(tf: str | None) -> str | None:
    if tf is None:
        return None
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


def _structure_event_to_dto(ev: StructureEvent) -> StructureEventOut:
    return StructureEventOut(
        id=ev.id,
        symbolId=ev.symbol_id,
        tf=ev.tf,
        kind=ev.kind,
        direction=ev.direction,
        level=ev.level,
        brokenPivot=PivotOut(
            kind=ev.broken_pivot_kind,
            price=ev.broken_pivot_price,
            t=ev.broken_pivot_t,
            barIndex=ev.broken_pivot_bar_index,
        ),
        confirmationT=ev.confirmation_t,
        confidence=ev.confidence,
        detectedAt=ev.detected_at,
    )


def _ob_to_dto(ob: OrderBlock) -> OrderBlockOut:
    return OrderBlockOut(
        id=ob.id,
        symbolId=ob.symbol_id,
        tf=ob.tf,
        direction=ob.direction,
        high=ob.high,
        low=ob.low,
        t=ob.t,
        strength=ob.strength,
        retested=ob.retested,
        violated=ob.violated,
        structureEventId=ob.structure_event_id,
        detectedAt=ob.detected_at,
    )


def _fvg_to_dto(g: Fvg) -> FvgOut:
    return FvgOut(
        id=g.id,
        symbolId=g.symbol_id,
        tf=g.tf,
        direction=g.direction,
        top=g.top,
        bottom=g.bottom,
        t=g.t,
        mitigated=g.mitigated,
        mitigatedAt=g.mitigated_at,
        detectedAt=g.detected_at,
    )


# ─────────────────────────── routes ──────────────────────────────────


@router.get("/symbols", response_model=SymbolListOut)
async def list_symbols(
    user: CurrentUser,
    db: DbSession,
    active_only: bool = Query(True, alias="activeOnly"),
    asset_class: str | None = Query(None, alias="assetClass"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> SymbolListOut:
    stmt = select(Symbol)
    if active_only:
        stmt = stmt.where(Symbol.active.is_(True))
    if asset_class is not None:
        if asset_class not in _ALLOWED_ASSET_CLASSES:
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_asset_class",
                message=f"unknown asset_class: {asset_class}",
            )
        stmt = stmt.where(Symbol.asset_class == asset_class)
    rows = (
        await db.scalars(
            stmt.order_by(Symbol.ticker.asc()).limit(limit).offset(offset)
        )
    ).all()

    from sqlalchemy import func as _func

    count_stmt = select(_func.count()).select_from(Symbol)
    if active_only:
        count_stmt = count_stmt.where(Symbol.active.is_(True))
    if asset_class is not None:
        count_stmt = count_stmt.where(Symbol.asset_class == asset_class)
    total = int(await db.scalar(count_stmt) or 0)

    return SymbolListOut(
        symbols=[
            SymbolOut(
                id=r.id,
                ticker=r.ticker,
                exchange=r.exchange,
                assetClass=r.asset_class,
                displayName=r.display_name,
                tickSize=r.tick_size,
                lotSize=r.lot_size,
                quoteCurrency=r.quote_currency,
                sessionTz=r.session_tz,
                active=r.active,
                createdAt=r.created_at,
            )
            for r in rows
        ],
        total=total,
    )


@router.get("/symbols/{symbol_id}", response_model=SymbolOut)
async def get_symbol(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
) -> SymbolOut:
    sym = await _load_symbol_or_404(db, symbol_id)
    return SymbolOut(
        id=sym.id,
        ticker=sym.ticker,
        exchange=sym.exchange,
        assetClass=sym.asset_class,
        displayName=sym.display_name,
        tickSize=sym.tick_size,
        lotSize=sym.lot_size,
        quoteCurrency=sym.quote_currency,
        sessionTz=sym.session_tz,
        active=sym.active,
        createdAt=sym.created_at,
    )


@router.post(
    "/symbols", response_model=SymbolOut, status_code=status.HTTP_201_CREATED
)
async def create_symbol(
    body: SymbolCreateIn,
    user: AdminUser,
    db: DbSession,
) -> SymbolOut:
    # Uniqueness: ticker + exchange must be new.
    existing = await db.scalar(
        select(Symbol.id).where(
            and_(Symbol.ticker == body.ticker, Symbol.exchange == body.exchange)
        )
    )
    if existing is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="symbol_exists",
            message=f"{body.ticker}@{body.exchange} already registered",
        )
    sym = Symbol(
        id=_symbol_id(),
        ticker=body.ticker,
        exchange=body.exchange,
        asset_class=body.assetClass,
        display_name=body.displayName,
        tick_size=body.tickSize,
        lot_size=body.lotSize,
        quote_currency=body.quoteCurrency,
        session_tz=body.sessionTz,
        active=True,
    )
    db.add(sym)
    await db.flush()
    return SymbolOut(
        id=sym.id,
        ticker=sym.ticker,
        exchange=sym.exchange,
        assetClass=sym.asset_class,
        displayName=sym.display_name,
        tickSize=sym.tick_size,
        lotSize=sym.lot_size,
        quoteCurrency=sym.quote_currency,
        sessionTz=sym.session_tz,
        active=sym.active,
        createdAt=sym.created_at,
    )


@router.get(
    "/symbols/{symbol_id}/structure/events",
    response_model=StructureEventListOut,
)
async def list_structure_events(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
    tf: str | None = Query(None),
    kind: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> StructureEventListOut:
    await _load_symbol_or_404(db, symbol_id)
    _validate_tf_filter(tf)

    stmt = select(StructureEvent).where(StructureEvent.symbol_id == symbol_id)
    if tf is not None:
        stmt = stmt.where(StructureEvent.tf == tf)
    if kind is not None:
        stmt = stmt.where(StructureEvent.kind == kind)
    stmt = (
        stmt.order_by(desc(StructureEvent.confirmation_t))
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.scalars(stmt)).all()

    from sqlalchemy import func as _func

    count_stmt = (
        select(_func.count())
        .select_from(StructureEvent)
        .where(StructureEvent.symbol_id == symbol_id)
    )
    if tf is not None:
        count_stmt = count_stmt.where(StructureEvent.tf == tf)
    if kind is not None:
        count_stmt = count_stmt.where(StructureEvent.kind == kind)
    total = int(await db.scalar(count_stmt) or 0)

    return StructureEventListOut(
        events=[_structure_event_to_dto(r) for r in rows],
        total=total,
    )


@router.get(
    "/symbols/{symbol_id}/structure/zones",
    response_model=StructureZonesOut,
)
async def list_structure_zones(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
    tf: str | None = Query(None),
    include_inactive: bool = Query(False, alias="includeInactive"),
) -> StructureZonesOut:
    await _load_symbol_or_404(db, symbol_id)
    _validate_tf_filter(tf)

    ob_stmt = select(OrderBlock).where(OrderBlock.symbol_id == symbol_id)
    fvg_stmt = select(Fvg).where(Fvg.symbol_id == symbol_id)
    if tf is not None:
        ob_stmt = ob_stmt.where(OrderBlock.tf == tf)
        fvg_stmt = fvg_stmt.where(Fvg.tf == tf)
    if not include_inactive:
        ob_stmt = ob_stmt.where(OrderBlock.violated.is_(False))
        fvg_stmt = fvg_stmt.where(Fvg.mitigated.is_(False))

    ob_rows = (await db.scalars(ob_stmt.order_by(desc(OrderBlock.t)))).all()
    fvg_rows = (await db.scalars(fvg_stmt.order_by(desc(Fvg.t)))).all()

    return StructureZonesOut(
        orderBlocks=[_ob_to_dto(o) for o in ob_rows],
        fvgs=[_fvg_to_dto(g) for g in fvg_rows],
    )


@router.get(
    "/symbols/{symbol_id}/context",
    response_model=MarketContextOut,
)
async def get_market_context(
    symbol_id: str,
    user: CurrentUser,
    db: DbSession,
) -> MarketContextOut:
    await _load_symbol_or_404(db, symbol_id)
    ctx = await db.scalar(
        select(MarketContext)
        .where(MarketContext.symbol_id == symbol_id)
        .order_by(desc(MarketContext.generated_at))
        .limit(1)
    )
    if ctx is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="context_not_found",
            message=(
                "no MarketContext has been generated for this symbol yet"
            ),
        )
    return MarketContextOut(
        symbolId=ctx.symbol_id,
        htfBias=ctx.htf_bias,
        ltfBias=ctx.ltf_bias,
        conflict=ctx.conflict,
        recentEvents=list(ctx.recent_events or []),
        activeOrderBlocks=list(ctx.active_order_blocks or []),
        activeFvgs=list(ctx.active_fvgs or []),
        generatedAt=ctx.generated_at,
    )


@router.post(
    "/quotes",
    response_model=QuotePublishOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def publish_quote(
    body: QuotePublishIn,
    user: AdminUser,
    db: DbSession,
) -> QuotePublishOut:
    """Push a single Quote tick into the realtime fan-out hub.

    The symbol must exist in the registry — unknown ids return 404
    rather than silently dropping the message. Used by operator tooling
    (replay, synthetic feeds) and by the upstream ingest adapter when
    it can't open a long-lived hub connection.
    """
    await _load_symbol_or_404(db, body.symbolId)
    msg = QuoteMessage(
        symbol_id=body.symbolId,
        bid=body.bid,
        ask=body.ask,
        last=body.last,
        bid_size=body.bidSize,
        ask_size=body.askSize,
        t=body.t,
    )
    delivered = await get_quote_hub().publish(msg)
    return QuotePublishOut(delivered=delivered, symbolId=body.symbolId)
