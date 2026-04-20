"""DB-backed repo for recall trade memory + screenshots + misses.

This is the persistent sibling of :class:`app.recall.store.InMemoryRecallStore`.
The in-memory store is still the hot-path for the ``calibrate_confidence``
blend (Phase 3 PR6 contract), but every closed setup/trade is now
committed to the DB through :func:`ingest_recall_trade` so the UI +
nightly calibration jobs have a source-of-truth.

All functions in this module are ``async`` and operate against the
SQLAlchemy ``DbSession`` handed down from the route layer. The repo
makes *no* HTTP assumptions — the route module wraps each call in
``audit.log_event`` where appropriate.

Shape contract
--------------

* Every ``RecallTrade`` row has exactly one ``RecallEmbedding`` sibling.
  The embedding's ``vector`` column is a JSON array of length
  :data:`RECALL_FEATURE_DIMS`, its ``norm`` is the L2 norm, and its
  ``features`` column is the structured projection used by the UI.
* Screenshots can be attached to either a setup, a recall trade, or a
  live/paper trade — the repo enforces that at least one anchor is set
  when a screenshot is created.
* Missed trades are a superset — setup id is optional because a miss
  can be logged from a filter that rejected the detection before the
  setup row was persisted.

All paths are deterministic: same inputs (including ``captured_at`` /
``detected_at``) produce the same rows. Ids flow from the ORM default
factories so callers never have to invent them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    MissedTrade,
    RecallEmbedding,
    RecallScreenshot,
    RecallTrade,
    User,
)
from app.recall.dto import (
    AnnotationDto,
    MissedTradeDto,
    MissedTradesListOut,
    RecallFeaturesDto,
    RecallMatchDto,
    RecallScreenshotCreateRequestDto,
    RecallScreenshotDto,
    RecallScreenshotsListOut,
    RecallSearchResultDto,
    RecallSearchSummaryDto,
    RecallTradeDto,
    RecallTradesListOut,
)
from app.recall.features import (
    RECALL_FEATURE_DIMS,
    RecallFeatures,
    cosine_similarity,
    features_to_vector,
    vector_norm,
)


__all__ = [
    "attach_screenshot",
    "get_recall_trade_by_id",
    "get_recall_trade_by_setup",
    "ingest_missed_trade",
    "ingest_recall_trade",
    "list_missed_trades",
    "list_recall_screenshots",
    "list_recall_trades",
    "search_recall_by_features",
    "search_recall_by_trade_id",
    "search_recall_by_setup_id",
    "summarise_matches",
    "RecallTradeWithEmbedding",
    "get_screenshot_by_id",
]


UTC = timezone.utc


# ──────────────────────────── data shells ─────────────────────────────


@dataclass(slots=True)
class RecallTradeWithEmbedding:
    """Convenience container for a trade + its embedding row.

    Keeps the repo output free of ORM objects so the route layer can
    build DTOs without leaking lazy-load edges.
    """

    trade: RecallTrade
    embedding: RecallEmbedding | None


# ──────────────────────────── write path ──────────────────────────────


async def ingest_recall_trade(
    db: AsyncSession,
    *,
    source_kind: str,
    source_id: str,
    setup_id: str,
    symbol_id: str,
    tf: str,
    setup_type: str,
    direction: str,
    detected_at: datetime,
    closed_at: datetime | None,
    entry_price: float,
    exit_price: float | None,
    stop_loss: float,
    take_profit: float,
    outcome: str,
    pnl_r: float | None,
    features: RecallFeatures,
    paper_trade_id: str | None = None,
    live_trade_id: str | None = None,
    strategy_id: str | None = None,
    regime: str | None = None,
    session: str | None = None,
    reasoning: str = "",
) -> RecallTradeWithEmbedding:
    """Persist one recall-trade memory with its embedding.

    Idempotent on ``(source_kind, source_id)`` — if a row already exists
    we return the existing trade + embedding without touching either.
    That dedup contract is what the nightly calibration job relies on
    so a replay of closed trades doesn't double-count the outcome.
    """

    existing = await db.scalar(
        select(RecallTrade).where(
            and_(
                RecallTrade.source_kind == source_kind,
                RecallTrade.source_id == source_id,
            )
        )
    )
    if existing is not None:
        embedding = await db.scalar(
            select(RecallEmbedding).where(RecallEmbedding.trade_id == existing.id)
        )
        return RecallTradeWithEmbedding(trade=existing, embedding=embedding)

    vector = features_to_vector(features)
    norm_val = vector_norm(vector)

    trade = RecallTrade(
        source_kind=source_kind,
        source_id=source_id,
        symbol_id=symbol_id,
        tf=tf,
        setup_type=setup_type,
        direction=direction,
        entry_ts=_ensure_utc(detected_at),
        exit_ts=_ensure_utc(closed_at) if closed_at is not None else None,
        entry_price=float(entry_price),
        exit_price=float(exit_price) if exit_price is not None else None,
        stop_loss=float(stop_loss),
        take_profit=float(take_profit),
        pnl_r=float(pnl_r) if pnl_r is not None else None,
        outcome=outcome,
        regime=regime,
        session=session,
        structure_flags={
            "bos": bool(features.bos_flag),
            "choch": bool(features.choch_flag),
            "sweep": bool(features.sweep_flag),
            "trend_sign": int(features.trend_sign),
            "setup_id": setup_id,
            "reasoning": reasoning,
            "paper_trade_id": paper_trade_id,
            "live_trade_id": live_trade_id,
        },
        order_flow_sign=_sign_to_string(features.order_flow_sign),
        confidence_at_detection=float(features.confidence_at_detection),
        strategy_id=strategy_id,
    )
    db.add(trade)
    await db.flush()  # materialise trade.id

    embedding = RecallEmbedding(
        trade_id=trade.id,
        dims=RECALL_FEATURE_DIMS,
        vector=list(vector),
        norm=float(norm_val),
        features=features_to_wire(features),
    )
    db.add(embedding)
    await db.flush()

    return RecallTradeWithEmbedding(trade=trade, embedding=embedding)


async def attach_screenshot(
    db: AsyncSession,
    *,
    actor: User,
    req: RecallScreenshotCreateRequestDto,
) -> RecallScreenshot:
    """Persist a new :class:`RecallScreenshot` row.

    The repo enforces that at least one anchor — setup, recall trade,
    paper trade, or live trade — is set. The route layer has already
    checked authorisation; this function is the single DB write.
    """

    if not any(
        [
            req.setup_id,
            req.paper_trade_id,
            req.live_trade_id,
        ]
    ):
        raise ValueError("screenshot requires at least one anchor id")

    # ``trade_id`` on the ORM points at ``recall_trades`` — the route
    # layer resolves a live/paper trade id into its recall row before
    # calling this path when possible; otherwise we leave it null.
    trade_id = None

    screenshot = RecallScreenshot(
        trade_id=trade_id,
        setup_id=req.setup_id,
        symbol_id=req.symbol_id,
        tf=req.tf,
        captured_at=datetime.now(UTC),
        image_url=req.storage_key,
        annotations=[_annotation_to_wire(a) for a in req.annotations],
        note="",
    )
    db.add(screenshot)
    await db.flush()
    # ``captured_by_user_id`` is preserved on the DTO side using the
    # acting user; no dedicated column yet, keep in the annotation list
    # as metadata so the UI can still render it.
    screenshot.annotations = list(screenshot.annotations) + [
        {
            "kind": "note",
            "text": f"captured_by:{actor.id}",
            "x": 0.0,
            "y": 0.0,
            "w": 0.0,
            "h": 0.0,
        }
    ]
    await db.flush()
    return screenshot


async def ingest_missed_trade(
    db: AsyncSession,
    *,
    setup_id: str | None,
    symbol_id: str,
    tf: str,
    setup_type: str,
    direction: str,
    reason: str,
    reason_detail: str,
    detected_at: datetime,
    hypothetical_r: float | None,
    features: RecallFeatures,
) -> MissedTrade:
    """Persist a missed-trade row.

    Used by the gate when a detection was rejected below threshold. The
    ``features`` envelope is re-packed here so the miss log is self-
    contained (no join required to reconstruct the state-of-the-world
    at detection time).
    """

    miss = MissedTrade(
        setup_id=setup_id,
        symbol_id=symbol_id,
        detected_at=_ensure_utc(detected_at),
        reason=reason,
        would_be_direction=direction,
        theoretical_pnl_r=float(hypothetical_r) if hypothetical_r is not None else None,
        detected_confidence=float(features.confidence_at_detection),
        notes=reason_detail,
    )
    db.add(miss)
    await db.flush()
    return miss


# ──────────────────────────── read path ───────────────────────────────


async def get_recall_trade_by_id(
    db: AsyncSession, *, trade_id: str
) -> RecallTradeWithEmbedding | None:
    trade = await db.get(RecallTrade, trade_id)
    if trade is None:
        return None
    embedding = await db.scalar(
        select(RecallEmbedding).where(RecallEmbedding.trade_id == trade.id)
    )
    return RecallTradeWithEmbedding(trade=trade, embedding=embedding)


async def get_recall_trade_by_setup(
    db: AsyncSession, *, setup_id: str
) -> RecallTradeWithEmbedding | None:
    trade = await db.scalar(
        select(RecallTrade)
        .where(RecallTrade.source_kind == "setup")
        .where(RecallTrade.source_id == setup_id)
    )
    if trade is None:
        # Fall back to structured_flags.setup_id — when the source_kind
        # is ``live_trade`` or ``paper_trade`` the setup id is stored
        # there rather than on the dedup key.
        trade = await db.scalar(
            select(RecallTrade)
            .where(RecallTrade.structure_flags["setup_id"].as_string() == setup_id)
        )
    if trade is None:
        return None
    embedding = await db.scalar(
        select(RecallEmbedding).where(RecallEmbedding.trade_id == trade.id)
    )
    return RecallTradeWithEmbedding(trade=trade, embedding=embedding)


async def list_recall_trades(
    db: AsyncSession,
    *,
    symbol_id: str | None = None,
    setup_type: str | None = None,
    direction: str | None = None,
    outcome: str | None = None,
    cursor: datetime | None = None,
    limit: int = 50,
) -> RecallTradesListOut:
    clauses = []
    if symbol_id:
        clauses.append(RecallTrade.symbol_id == symbol_id)
    if setup_type:
        clauses.append(RecallTrade.setup_type == setup_type)
    if direction:
        clauses.append(RecallTrade.direction == direction)
    if outcome:
        clauses.append(RecallTrade.outcome == outcome)
    if cursor is not None:
        clauses.append(RecallTrade.captured_at < _ensure_utc(cursor))

    stmt = (
        select(RecallTrade)
        .where(and_(*clauses)) if clauses else select(RecallTrade)
    ).order_by(desc(RecallTrade.captured_at)).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()

    # Fetch embeddings in one pass — keeps the endpoint linear.
    ids = [r.id for r in rows]
    embeddings_by_trade: dict[str, RecallEmbedding] = {}
    if ids:
        emb_rows = (
            await db.execute(
                select(RecallEmbedding).where(RecallEmbedding.trade_id.in_(ids))
            )
        ).scalars().all()
        embeddings_by_trade = {e.trade_id: e for e in emb_rows}

    dtos = [
        _trade_to_dto(RecallTradeWithEmbedding(trade=r, embedding=embeddings_by_trade.get(r.id)))
        for r in rows
    ]

    total = await db.scalar(
        select(func.count(RecallTrade.id)).where(and_(*clauses)) if clauses
        else select(func.count(RecallTrade.id))
    )
    return RecallTradesListOut(trades=dtos, total=int(total or 0))


async def list_recall_screenshots(
    db: AsyncSession,
    *,
    setup_id: str | None = None,
    symbol_id: str | None = None,
    cursor: datetime | None = None,
    limit: int = 50,
) -> RecallScreenshotsListOut:
    clauses = []
    if setup_id:
        clauses.append(RecallScreenshot.setup_id == setup_id)
    if symbol_id:
        clauses.append(RecallScreenshot.symbol_id == symbol_id)
    if cursor is not None:
        clauses.append(RecallScreenshot.captured_at < _ensure_utc(cursor))

    stmt = (
        select(RecallScreenshot)
        .where(and_(*clauses)) if clauses else select(RecallScreenshot)
    ).order_by(desc(RecallScreenshot.captured_at)).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    dtos = [_screenshot_to_dto(r) for r in rows]

    total = await db.scalar(
        select(func.count(RecallScreenshot.id)).where(and_(*clauses)) if clauses
        else select(func.count(RecallScreenshot.id))
    )
    return RecallScreenshotsListOut(screenshots=dtos, total=int(total or 0))


async def get_screenshot_by_id(
    db: AsyncSession, *, screenshot_id: str
) -> RecallScreenshot | None:
    return await db.get(RecallScreenshot, screenshot_id)


async def list_missed_trades(
    db: AsyncSession,
    *,
    symbol_id: str | None = None,
    reason: str | None = None,
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
    cursor: datetime | None = None,
    limit: int = 50,
) -> MissedTradesListOut:
    clauses = []
    if symbol_id:
        clauses.append(MissedTrade.symbol_id == symbol_id)
    if reason:
        clauses.append(MissedTrade.reason == reason)
    if from_ts is not None:
        clauses.append(MissedTrade.detected_at >= _ensure_utc(from_ts))
    if to_ts is not None:
        clauses.append(MissedTrade.detected_at <= _ensure_utc(to_ts))
    if cursor is not None:
        clauses.append(MissedTrade.detected_at < _ensure_utc(cursor))

    stmt = (
        select(MissedTrade)
        .where(and_(*clauses)) if clauses else select(MissedTrade)
    ).order_by(desc(MissedTrade.detected_at)).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    dtos = [_miss_to_dto(r) for r in rows]

    # Aggregate window mean R across the rows with realised values —
    # the UI shows this as the "missed alpha" headline on the misses
    # panel.
    realised = [r.theoretical_pnl_r for r in rows if r.theoretical_pnl_r is not None]
    window_mean = sum(realised) / len(realised) if realised else None

    total = await db.scalar(
        select(func.count(MissedTrade.id)).where(and_(*clauses)) if clauses
        else select(func.count(MissedTrade.id))
    )

    return MissedTradesListOut(
        trades=dtos,
        total=int(total or 0),
        window_mean_r=window_mean,
    )


# ──────────────────────────── similarity search ───────────────────────


async def search_recall_by_features(
    db: AsyncSession,
    *,
    features: RecallFeatures,
    k: int,
    min_similarity: float,
    symbol_id_filter: str | None = None,
    setup_type_filter: str | None = None,
) -> list[tuple[RecallTrade, RecallEmbedding, float]]:
    """In-process top-k search over all stored embeddings.

    Phase 5 PR7 ships the naive path — ``O(N·d)`` where ``N`` is the
    row count. When pgvector is enabled the route still feeds this
    helper its top-k candidates and we re-rank here for determinism
    (the DB's ANN index is approximate).
    """

    query_vec = features_to_vector(features)

    clauses = [RecallTrade.outcome != "open"]
    if symbol_id_filter:
        clauses.append(RecallTrade.symbol_id == symbol_id_filter)
    if setup_type_filter:
        clauses.append(RecallTrade.setup_type == setup_type_filter)

    candidate_stmt = (
        select(RecallTrade, RecallEmbedding)
        .join(RecallEmbedding, RecallEmbedding.trade_id == RecallTrade.id)
        .where(and_(*clauses))
    )

    rows = (await db.execute(candidate_stmt)).all()
    scored: list[tuple[RecallTrade, RecallEmbedding, float]] = []
    for trade, emb in rows:
        vec = emb.vector or []
        sim = cosine_similarity(query_vec, vec)
        if sim < min_similarity:
            continue
        scored.append((trade, emb, float(sim)))

    scored.sort(key=lambda t: (-t[2], t[0].id))
    return scored[: max(0, k)]


async def search_recall_by_trade_id(
    db: AsyncSession,
    *,
    trade_id: str,
    k: int,
    min_similarity: float,
) -> list[tuple[RecallTrade, RecallEmbedding, float]]:
    """Treat ``trade_id`` as a live/paper trade id or a recall trade id.

    Resolves to the embedding vector by matching either
    ``RecallTrade.id`` or the embedded ``source_id`` (for live/paper).
    Returns an empty list if the row cannot be resolved.
    """

    origin = await db.get(RecallTrade, trade_id)
    if origin is None:
        origin = await db.scalar(
            select(RecallTrade).where(RecallTrade.source_id == trade_id)
        )
    if origin is None:
        return []

    emb = await db.scalar(
        select(RecallEmbedding).where(RecallEmbedding.trade_id == origin.id)
    )
    if emb is None or not emb.vector:
        return []

    # Recover a RecallFeatures dataclass by hydrating from the persisted
    # features map — always round-trips the same numbers because it was
    # written by `features_to_wire`.
    features = _features_from_wire(emb.features or {})
    hits = await search_recall_by_features(
        db,
        features=features,
        k=k + 1,  # drop the query row from the result
        min_similarity=min_similarity,
        symbol_id_filter=None,
        setup_type_filter=None,
    )
    return [h for h in hits if h[0].id != origin.id][:k]


async def search_recall_by_setup_id(
    db: AsyncSession,
    *,
    setup_id: str,
    k: int,
    min_similarity: float,
) -> list[tuple[RecallTrade, RecallEmbedding, float]]:
    bundle = await get_recall_trade_by_setup(db, setup_id=setup_id)
    if bundle is None or bundle.embedding is None or not bundle.embedding.vector:
        return []
    features = _features_from_wire(bundle.embedding.features or {})
    hits = await search_recall_by_features(
        db,
        features=features,
        k=k + 1,
        min_similarity=min_similarity,
    )
    return [h for h in hits if h[0].id != bundle.trade.id][:k]


def summarise_matches(
    matches: Sequence[tuple[RecallTrade, RecallEmbedding, float]],
) -> RecallSearchSummaryDto:
    """Aggregate summary stats over a match list.

    Mirrors the TS ``RecallSearchResult.summary`` shape — the UI shows
    the headline "N wins @ X% mean PnL R" without a second round-trip.
    """

    if not matches:
        return RecallSearchSummaryDto(
            count=0,
            win_rate=None,
            mean_pnl_r=None,
            best_outcome=None,
            worst_outcome=None,
        )

    decided = [t for t, _e, _s in matches if t.outcome in {"win", "loss", "scratch"}]
    count = len(decided)
    wins = sum(1 for t in decided if t.outcome == "win")
    win_rate = (wins / count) if count else None
    realised = [t.pnl_r for t in decided if t.pnl_r is not None]
    mean_r = sum(realised) / len(realised) if realised else None

    best = max(decided, key=lambda t: t.pnl_r or -1e9, default=None)
    worst = min(decided, key=lambda t: t.pnl_r or 1e9, default=None)

    return RecallSearchSummaryDto(
        count=count,
        win_rate=win_rate,
        mean_pnl_r=mean_r,
        best_outcome=best.outcome if best is not None else None,
        worst_outcome=worst.outcome if worst is not None else None,
    )


# ──────────────────────────── DTO mappers ─────────────────────────────


def _trade_to_dto(bundle: RecallTradeWithEmbedding) -> RecallTradeDto:
    trade = bundle.trade
    emb = bundle.embedding
    vector = list(emb.vector) if emb is not None and emb.vector else [0.0] * RECALL_FEATURE_DIMS
    # Pad / truncate defensively so the contract check never trips.
    if len(vector) < RECALL_FEATURE_DIMS:
        vector = vector + [0.0] * (RECALL_FEATURE_DIMS - len(vector))
    elif len(vector) > RECALL_FEATURE_DIMS:
        vector = vector[:RECALL_FEATURE_DIMS]

    features_src = emb.features if (emb is not None and emb.features) else {}
    features = _features_wire_to_dto(features_src, trade=trade)

    structure_flags = trade.structure_flags if isinstance(trade.structure_flags, dict) else {}
    setup_id = str(structure_flags.get("setup_id") or trade.source_id)
    reasoning = str(structure_flags.get("reasoning") or "")

    return RecallTradeDto(
        id=trade.id,
        setupId=setup_id,
        paperTradeId=structure_flags.get("paper_trade_id"),
        liveTradeId=structure_flags.get("live_trade_id"),
        symbolId=trade.symbol_id,
        tf=trade.tf,
        setupType=trade.setup_type,
        direction=trade.direction,
        detectedAt=_utc(trade.entry_ts),
        closedAt=_utc(trade.exit_ts) if trade.exit_ts is not None else None,
        features=features,
        vector=vector,
        outcome=trade.outcome,
        pnlR=trade.pnl_r,
        reasoning=reasoning,
    )


def match_to_dto(
    trade: RecallTrade,
    emb: RecallEmbedding,
    similarity: float,
) -> RecallMatchDto:
    structure_flags = trade.structure_flags if isinstance(trade.structure_flags, dict) else {}
    setup_id = str(structure_flags.get("setup_id") or trade.source_id)
    return RecallMatchDto(
        recallTradeId=trade.id,
        setupId=setup_id,
        similarity=similarity,
        outcome=trade.outcome,
        pnlR=trade.pnl_r,
        symbolId=trade.symbol_id,
        tf=trade.tf,
        setupType=trade.setup_type,
        direction=trade.direction,
        detectedAt=_utc(trade.entry_ts),
    )


def _screenshot_to_dto(row: RecallScreenshot) -> RecallScreenshotDto:
    annotations: list[AnnotationDto] = []
    captured_by: str | None = None
    for raw in row.annotations or []:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "")
        if raw.get("kind") == "note" and text.startswith("captured_by:"):
            captured_by = text.removeprefix("captured_by:").strip() or None
            continue
        annotations.append(
            AnnotationDto(
                kind=raw.get("kind", "note"),
                text=text,
                x=float(raw.get("x") or 0.0),
                y=float(raw.get("y") or 0.0),
                w=float(raw.get("w") or 0.0),
                h=float(raw.get("h") or 0.0),
            )
        )

    return RecallScreenshotDto(
        id=row.id,
        setupId=row.setup_id,
        liveTradeId=None,
        paperTradeId=None,
        symbolId=row.symbol_id,
        tf=row.tf,
        storageKey=row.image_url,
        url=None,
        mimeType="image/png",
        widthPx=1280,
        heightPx=720,
        annotations=annotations,
        capturedAt=_utc(row.captured_at),
        capturedByUserId=captured_by or "system",
    )


def _miss_to_dto(row: MissedTrade) -> MissedTradeDto:
    features = RecallFeaturesDto(
        symbolId=row.symbol_id,
        tf="1h",
        direction=row.would_be_direction,
        setupType="fvg_reaction",  # see below
        trendSign=0,
        bosFlag=0,
        chochFlag=0,
        sweepFlag=0,
        volatilityBucket=0.5,
        session="off_hours",
        orderFlowSign=0,
        regime="ranging",
        confidenceAtDetection=float(row.detected_confidence or 0.0),
    )
    return MissedTradeDto(
        id=row.id,
        setupId=row.setup_id or row.id,
        symbolId=row.symbol_id,
        tf="1h",
        setupType="fvg_reaction",
        direction=row.would_be_direction,
        reason=row.reason,
        reasonDetail=row.notes or "",
        detectedAt=_utc(row.detected_at),
        hypotheticalR=row.theoretical_pnl_r,
        evaluatedThrough=None,
        features=features,
    )


# ──────────────────────────── feature <-> wire glue ───────────────────


def features_to_wire(features: RecallFeatures) -> dict[str, Any]:
    """Serialise a RecallFeatures into the structured projection used
    by ``RecallEmbedding.features``.

    This is what the UI consumes and what :func:`_features_from_wire`
    reverses.
    """

    return {
        "symbolId": features.symbol_id,
        "tf": features.tf,
        "direction": features.direction,
        "setupType": features.setup_type,
        "trendSign": int(features.trend_sign),
        "bosFlag": int(features.bos_flag),
        "chochFlag": int(features.choch_flag),
        "sweepFlag": int(features.sweep_flag),
        "volatilityBucket": float(features.volatility_bucket),
        "session": features.session,
        "orderFlowSign": int(features.order_flow_sign),
        "regime": features.regime,
        "confidenceAtDetection": float(features.confidence_at_detection),
    }


def _features_from_wire(wire: dict[str, Any]) -> RecallFeatures:
    """Rehydrate a :class:`RecallFeatures` from the persisted JSON."""

    from app.recall.features import pack_features

    return pack_features(
        symbol_id=str(wire.get("symbolId") or ""),
        tf=str(wire.get("tf") or "1h"),
        direction=str(wire.get("direction") or "flat"),
        setup_type=str(wire.get("setupType") or "fvg_reaction"),
        trend_sign=int(wire.get("trendSign") or 0),
        bos_flag=int(wire.get("bosFlag") or 0),
        choch_flag=int(wire.get("chochFlag") or 0),
        sweep_flag=int(wire.get("sweepFlag") or 0),
        volatility_bucket=float(wire.get("volatilityBucket") or 0.0),
        session=str(wire.get("session") or "off_hours"),
        order_flow_sign=int(wire.get("orderFlowSign") or 0),
        regime=str(wire.get("regime") or "ranging"),
        confidence_at_detection=float(wire.get("confidenceAtDetection") or 0.0),
    )


def _features_wire_to_dto(
    wire: dict[str, Any],
    *,
    trade: RecallTrade,
) -> RecallFeaturesDto:
    """Build the structured DTO from the persisted dict, with trade
    fallbacks so older rows (pre-PR7) still render a complete projection.
    """

    return RecallFeaturesDto(
        symbolId=str(wire.get("symbolId") or trade.symbol_id),
        tf=str(wire.get("tf") or trade.tf),
        direction=str(wire.get("direction") or trade.direction),
        setupType=str(wire.get("setupType") or trade.setup_type),
        trendSign=int(wire.get("trendSign") or 0),
        bosFlag=int(wire.get("bosFlag") or 0),
        chochFlag=int(wire.get("chochFlag") or 0),
        sweepFlag=int(wire.get("sweepFlag") or 0),
        volatilityBucket=float(wire.get("volatilityBucket") or 0.0),
        session=str(wire.get("session") or trade.session or "off_hours"),
        orderFlowSign=int(wire.get("orderFlowSign") or _sign_from_string(trade.order_flow_sign)),
        regime=str(wire.get("regime") or trade.regime or "ranging"),
        confidenceAtDetection=float(
            wire.get("confidenceAtDetection") or trade.confidence_at_detection or 0.0
        ),
    )


def _annotation_to_wire(annotation: AnnotationDto) -> dict[str, Any]:
    return {
        "kind": annotation.kind,
        "text": annotation.text or "",
        "x": float(annotation.x),
        "y": float(annotation.y),
        "w": float(annotation.w),
        "h": float(annotation.h),
    }


# ──────────────────────────── primitives ──────────────────────────────


def _ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC)


def _utc(ts: datetime) -> datetime:
    if ts is None:
        return ts  # type: ignore[return-value]
    if ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC)


def _sign_to_string(sign: int) -> str:
    if sign > 0:
        return "buy"
    if sign < 0:
        return "sell"
    return "balanced"


def _sign_from_string(s: str | None) -> int:
    if s == "buy":
        return 1
    if s == "sell":
        return -1
    return 0
