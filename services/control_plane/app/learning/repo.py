"""Async SQLAlchemy repo for the learning + governance loop.

Every mutation is ``async`` and operates against the ``AsyncSession``
handed down from the route layer. The route layer is responsible for
``audit.log_event`` on admin mutations — the repo is the pure
database seam.

Shape contract
--------------

* ``append_learning_event`` writes one row to ``learning_events``;
  every other repo mutation *also* appends a matching event so the
  event log is the authoritative tail.
* ``recompute_calibration`` reads closed ``RecallTrade`` rows that
  match the scope, fits the chosen calibrator, and persists a new
  ``ConfidenceCalibration`` row. Returns the DTO *and* the actual
  sample size used — callers use the latter to decide whether to
  surface a "sample too small" warning.
* ``upsert_regime_snapshot`` enforces the ``(symbol, tf)`` uniqueness
  the UI relies on for "current regime" reads — it writes a fresh
  row rather than mutating the old one so the history endpoint stays
  honest.
* ``list_data_truth_checks`` + ``upsert_data_truth_check`` back the
  kill-switch aggregator. The overall ``DataTruthStatusOutDto`` is
  composed in memory from the per-kind latest row.

All list endpoints are paginated cursor-style on their chronological
column. Invariants:

  * ``cursor`` is **exclusive** — the row at the cursor ts is NOT
    returned; this avoids the off-by-one a ``<=`` cursor introduces
    under duplicate timestamps.
  * ``limit`` is an upper bound. The repo returns ``total = len(rows)``
    **after** the cursor + limit truncation — callers that need the
    global total must issue a separate ``COUNT(*)`` query.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.learning.calibration import (
    CALIBRATION_BIN_COUNT,
    CalibrationBin,
    CalibrationKindLiteral,
    CalibrationSamples,
    brier_score,
    ece_score,
    fit_bucket_calibrator,
    fit_platt_calibrator,
    platt_predict,
    predict_calibrated,
)
from app.learning.data_truth import (
    DataTruthCheckInput,
    DataTruthStatusLiteral,
    aggregate_data_truth,
    evaluate_kill_switch,
)
from app.learning.dna import (
    DNACellKey,
    build_dna_grid,
    select_best_cell,
    select_worst_cell,
)
from app.learning.dto import (
    CalibrationBinDto,
    CalibrationCurvesOut,
    CalibrationRecomputeRequestDto,
    CalibrationRecomputeResponseDto,
    ConfidenceCalibrationDto,
    DataTruthCheckCreateRequestDto,
    DataTruthCheckDto,
    DataTruthStatusOutDto,
    DNACellDto,
    LearningEventDto,
    LearningEventKindLiteral,
    LearningEventSubjectLiteral,
    LearningEventsListOut,
    RegimeCurrentOutDto,
    RegimeHistoryOutDto,
    RegimeSnapshotDto,
    SessionIntelOutDto,
    SessionSnapshotDto,
    StrategyDNADto,
    StrategyDNAListOutDto,
)
from app.learning.regime import REGIME_KINDS
from app.models import (
    ConfidenceCalibration,
    DataTruthCheck,
    LearningEvent,
    RecallTrade,
    RegimeSnapshot,
    SessionSnapshot,
    Strategy,
    StrategyDNACell,
)

__all__ = [
    "DNA_CELL_COUNT",
    "append_learning_event",
    "build_dna_for_strategy",
    "get_data_truth_status",
    "list_learning_events",
    "list_regime_history",
    "list_regime_snapshots",
    "list_session_snapshots",
    "list_strategy_dna",
    "load_calibration_curves",
    "recompute_calibration",
    "upsert_data_truth_check",
    "upsert_regime_snapshot",
    "_event_to_dto",
    "_calibration_to_dto",
    "_regime_to_dto",
    "_session_to_dto",
    "_data_truth_to_dto",
    "_dna_cell_to_dto",
    "_strategy_dna_to_dto",
]


UTC = timezone.utc
DNA_CELL_COUNT = 20  # 4 regimes × 5 sessions


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC)


# ──────────────────────────── learning events ──────────────────────────


async def append_learning_event(
    db: AsyncSession,
    *,
    kind: LearningEventKindLiteral,
    subject_id: str,
    subject_kind: LearningEventSubjectLiteral,
    strategy_id: str | None = None,
    symbol_id: str | None = None,
    setup_id: str | None = None,
    payload: dict[str, Any] | None = None,
    correlation_id: str | None = None,
    occurred_at: datetime | None = None,
) -> LearningEvent:
    """Append one event to ``learning_events``.

    ``correlation_id`` and ``subject_kind`` live inside the JSON
    ``payload`` column since the Phase 5 PR3 schema doesn't carry
    dedicated columns for them. The repo keeps the projection tidy
    so the wire DTO sees them as top-level fields.
    """

    pl = dict(payload or {})
    # Enrich the payload with wire-visible trailer fields.
    pl.setdefault("_meta", {}).update(
        {
            "subjectKind": subject_kind,
            "correlationId": correlation_id,
        }
    )
    row = LearningEvent(
        kind=kind,
        occurred_at=_ensure_utc(occurred_at) if occurred_at else _now_utc(),
        symbol_id=symbol_id,
        setup_id=setup_id,
        strategy_id=strategy_id,
        payload=pl,
    )
    # subject_id is the anchor — we store it in the payload as well so
    # the wire DTO can echo it back. The DB columns above are FK-safe;
    # subject_id isn't always a FK (e.g. calibration.scope).
    row.payload = {**pl, "_subjectId": subject_id}
    db.add(row)
    await db.flush()
    return row


def _event_to_dto(row: LearningEvent) -> LearningEventDto:
    meta = dict((row.payload or {}).get("_meta") or {})
    subject_kind = (
        meta.get("subjectKind") or "setup"
    )  # defensive default — older rows may be missing the trailer
    correlation_id = meta.get("correlationId")
    subject_id = (row.payload or {}).get("_subjectId") or row.setup_id or row.id

    # Strip the internal trailer before surfacing payload.
    clean_payload: dict[str, Any] = {
        k: v for k, v in (row.payload or {}).items() if not k.startswith("_")
    }
    return LearningEventDto(
        id=row.id,
        kind=row.kind,  # type: ignore[arg-type]
        subjectId=str(subject_id),
        subjectKind=subject_kind,  # type: ignore[arg-type]
        strategyId=row.strategy_id,
        payload=clean_payload,
        correlationId=correlation_id,
        occurredAt=_ensure_utc(row.occurred_at),
        ingestedAt=_ensure_utc(row.ingested_at),
    )


async def list_learning_events(
    db: AsyncSession,
    *,
    kind: LearningEventKindLiteral | None = None,
    subject_kind: LearningEventSubjectLiteral | None = None,
    strategy_id: str | None = None,
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
    cursor: datetime | None = None,
    limit: int = 100,
) -> LearningEventsListOut:
    """List learning events newest-first with exclusive cursor pagination."""

    stmt = select(LearningEvent).order_by(desc(LearningEvent.occurred_at), desc(LearningEvent.id))
    clauses = []
    if kind is not None:
        clauses.append(LearningEvent.kind == kind)
    if strategy_id is not None:
        clauses.append(LearningEvent.strategy_id == strategy_id)
    if from_ts is not None:
        clauses.append(LearningEvent.occurred_at >= _ensure_utc(from_ts))
    if to_ts is not None:
        clauses.append(LearningEvent.occurred_at <= _ensure_utc(to_ts))
    if cursor is not None:
        clauses.append(LearningEvent.occurred_at < _ensure_utc(cursor))
    if clauses:
        stmt = stmt.where(and_(*clauses))
    stmt = stmt.limit(limit)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    # subject_kind is a payload-trailer filter applied in memory.
    if subject_kind is not None:
        rows = [
            r for r in rows
            if ((r.payload or {}).get("_meta") or {}).get("subjectKind") == subject_kind
        ]

    events = [_event_to_dto(r) for r in rows]
    return LearningEventsListOut(events=events, total=len(events))


# ──────────────────────────── calibration ─────────────────────────────


def _scope_match_clause(
    strategy_id: str | None,
    setup_type: str | None,
    tf: str | None,
) -> Any:
    clauses: list[Any] = []
    # scope_kind column semantics — 'global' for everything-null, 'strategy'
    # for strategy_id scopes, 'setup_type' / 'tf' for the finer scopes.
    if strategy_id is None and setup_type is None and tf is None:
        clauses.append(ConfidenceCalibration.scope_kind == "global")
    elif strategy_id is not None:
        clauses.append(ConfidenceCalibration.scope_kind == "strategy")
        clauses.append(ConfidenceCalibration.scope_ref == strategy_id)
    elif setup_type is not None and tf is not None:
        clauses.append(ConfidenceCalibration.scope_kind == "setup_tf")
        clauses.append(ConfidenceCalibration.scope_ref == f"{setup_type}:{tf}")
    elif setup_type is not None:
        clauses.append(ConfidenceCalibration.scope_kind == "setup_type")
        clauses.append(ConfidenceCalibration.scope_ref == setup_type)
    elif tf is not None:
        clauses.append(ConfidenceCalibration.scope_kind == "tf")
        clauses.append(ConfidenceCalibration.scope_ref == tf)
    return and_(*clauses)


def _scope_tuple_from_ref(
    scope_kind: str, scope_ref: str | None
) -> tuple[str | None, str | None, str | None]:
    """Decompose (scope_kind, scope_ref) back into (strategy_id, setup_type, tf)."""

    if scope_kind == "global" or scope_ref is None:
        return None, None, None
    if scope_kind == "strategy":
        return scope_ref, None, None
    if scope_kind == "setup_type":
        return None, scope_ref, None
    if scope_kind == "tf":
        return None, None, scope_ref
    if scope_kind == "setup_tf":
        setup_type, tf = scope_ref.split(":", 1) if ":" in scope_ref else (scope_ref, None)
        return None, setup_type, tf
    return None, None, None


def _calibration_to_dto(row: ConfidenceCalibration) -> ConfidenceCalibrationDto:
    strategy_id, setup_type, tf = _scope_tuple_from_ref(row.scope_kind, row.scope_ref)
    bins = [
        CalibrationBinDto(
            rawLow=float(b.get("rawLow", b.get("raw_low", 0.0))),
            rawHigh=float(b.get("rawHigh", b.get("raw_high", 0.0))),
            calibrated=float(b.get("calibrated", 0.0)),
            count=int(b.get("count", 0)),
            wins=int(b.get("wins", 0)),
        )
        for b in (row.bins or [])
    ]
    return ConfidenceCalibrationDto(
        id=row.id,
        strategyId=strategy_id,
        setupType=setup_type,
        tf=tf,
        kind=row.kind,  # type: ignore[arg-type]
        bins=bins,
        plattA=row.platt_a,
        plattB=row.platt_b,
        ece=float(row.ece or 0.0),
        brier=float(row.brier or 0.0),
        sampleSize=int(row.sample_size or 0),
        generatedAt=_ensure_utc(row.computed_at),
    )


async def _latest_calibrations(
    db: AsyncSession,
) -> list[ConfidenceCalibration]:
    """Return the most recent calibration per (scope_kind, scope_ref)."""

    # Pull ordered newest-first and dedupe in memory — the scope space
    # is small (global + a few strategies) so this is fine.
    stmt = select(ConfidenceCalibration).order_by(
        desc(ConfidenceCalibration.computed_at), desc(ConfidenceCalibration.id)
    )
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    seen: set[tuple[str, str | None]] = set()
    latest: list[ConfidenceCalibration] = []
    for r in rows:
        key = (r.scope_kind, r.scope_ref)
        if key in seen:
            continue
        seen.add(key)
        latest.append(r)
    return latest


async def load_calibration_curves(db: AsyncSession) -> CalibrationCurvesOut:
    """Read the canonical (latest-per-scope) calibration curves."""

    rows = await _latest_calibrations(db)
    curves = [_calibration_to_dto(r) for r in rows]
    return CalibrationCurvesOut(curves=curves, generatedAt=_now_utc())


async def _gather_calibration_samples(
    db: AsyncSession,
    *,
    strategy_id: str | None,
    setup_type: str | None,
    tf: str | None,
) -> CalibrationSamples:
    """Pull closed RecallTrade rows that match the scope + have a raw score."""

    stmt = select(RecallTrade).where(
        RecallTrade.outcome.in_(("win", "loss"))
    )
    if strategy_id is not None:
        stmt = stmt.where(RecallTrade.strategy_id == strategy_id)
    if setup_type is not None:
        stmt = stmt.where(RecallTrade.setup_type == setup_type)
    if tf is not None:
        stmt = stmt.where(RecallTrade.tf == tf)
    stmt = stmt.order_by(desc(RecallTrade.captured_at)).limit(10_000)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    raw: list[float] = []
    outcomes: list[int] = []
    for row in rows:
        if row.confidence_at_detection is None:
            continue
        conf = float(row.confidence_at_detection)
        if not (0.0 <= conf <= 1.0):
            continue
        raw.append(conf)
        outcomes.append(1 if row.outcome == "win" else 0)
    return CalibrationSamples(raw_scores=raw, outcomes=outcomes)


async def recompute_calibration(
    db: AsyncSession,
    *,
    req: CalibrationRecomputeRequestDto,
) -> CalibrationRecomputeResponseDto:
    """Recompute a calibration curve for a scope + persist it.

    Rules:
      * If the sample is empty, the curve is still persisted — but it
        carries the zero-sample identity bin set. This is deliberate:
        the UI needs a row to render "calibration pending" for every
        scope the operator can pick.
      * Platt requires ``sample_size >= 50``; otherwise we silently
        fall back to the bucket calibrator. The response DTO echoes
        the actual kind stored.
    """

    samples = await _gather_calibration_samples(
        db,
        strategy_id=req.strategy_id,
        setup_type=req.setup_type,
        tf=req.tf,
    )
    sample_size = len(samples.raw_scores)

    effective_kind: CalibrationKindLiteral = req.kind
    platt_a: float | None = None
    platt_b: float | None = None
    bins: list[CalibrationBin]

    if req.kind == "platt" and sample_size >= 50:
        platt_a, platt_b = fit_platt_calibrator(samples)
        # Also compute backup bucket bins so the row is never empty.
        bins = fit_bucket_calibrator(samples)
        effective_kind = "platt"
    else:
        bins = fit_bucket_calibrator(samples)
        effective_kind = "bucket"

    ece = ece_score(samples)
    if effective_kind == "platt" and platt_a is not None and platt_b is not None:
        preds = [platt_predict(s, platt_a, platt_b) for s in samples.raw_scores]
    else:
        preds = [predict_calibrated(s, bins) for s in samples.raw_scores]
    brier = brier_score(preds, samples.outcomes)

    # Persist.
    if req.strategy_id is None and req.setup_type is None and req.tf is None:
        scope_kind, scope_ref = "global", None
    elif req.strategy_id is not None:
        scope_kind, scope_ref = "strategy", req.strategy_id
    elif req.setup_type is not None and req.tf is not None:
        scope_kind, scope_ref = "setup_tf", f"{req.setup_type}:{req.tf}"
    elif req.setup_type is not None:
        scope_kind, scope_ref = "setup_type", req.setup_type
    elif req.tf is not None:
        scope_kind, scope_ref = "tf", req.tf
    else:  # pragma: no cover — exhausted
        scope_kind, scope_ref = "global", None

    row = ConfidenceCalibration(
        scope_kind=scope_kind,
        scope_ref=scope_ref,
        kind=effective_kind,
        bins=[
            {
                "rawLow": b.raw_low,
                "rawHigh": b.raw_high,
                "calibrated": b.calibrated,
                "count": b.count,
                "wins": b.wins,
            }
            for b in bins
        ],
        platt_a=platt_a,
        platt_b=platt_b,
        ece=ece,
        brier=brier,
        sample_size=sample_size,
    )
    db.add(row)
    await db.flush()

    # Emit a learning event — calibration_updated.
    await append_learning_event(
        db,
        kind="calibration_updated",
        subject_id=row.id,
        subject_kind="calibration",
        strategy_id=req.strategy_id,
        payload={
            "scope": {
                "kind": scope_kind,
                "ref": scope_ref,
            },
            "calibrator": effective_kind,
            "sampleSize": sample_size,
            "ece": ece,
            "brier": brier,
        },
    )

    dto = _calibration_to_dto(row)
    return CalibrationRecomputeResponseDto(
        curve=dto,
        sampleSize=sample_size,
        stored=True,
    )


# ──────────────────────────── regime ───────────────────────────────────


def _regime_to_dto(row: RegimeSnapshot) -> RegimeSnapshotDto:
    details = row.details or {}
    trend_strength = float(details.get("trendStrength", 0.0))
    volatility = float(details.get("volatility", 0.0))
    bar_age_ms = int(details.get("barAgeMs", 0))
    notes = str(details.get("notes", ""))
    return RegimeSnapshotDto(
        id=row.id,
        symbolId=row.symbol_id,
        tf=row.tf,
        kind=row.regime,  # type: ignore[arg-type]
        confidence=float(row.confidence or 0.0),
        trendStrength=trend_strength,
        volatility=volatility,
        barAgeMs=bar_age_ms,
        observedAt=_ensure_utc(row.observed_at),
        notes=notes,
    )


async def upsert_regime_snapshot(
    db: AsyncSession,
    *,
    symbol_id: str,
    tf: str,
    kind: str,
    confidence: float,
    trend_strength: float,
    volatility: float,
    bar_age_ms: int = 0,
    atr: float | None = None,
    adx: float | None = None,
    news_pressure: float | None = None,
    notes: str = "",
    observed_at: datetime | None = None,
) -> RegimeSnapshot:
    """Insert a new RegimeSnapshot row (snapshots are append-only).

    Also emits a ``regime_flipped`` event when the new kind differs
    from the most recent snapshot for this (symbol, tf).
    """

    previous = await db.execute(
        select(RegimeSnapshot)
        .where(
            and_(
                RegimeSnapshot.symbol_id == symbol_id,
                RegimeSnapshot.tf == tf,
            )
        )
        .order_by(desc(RegimeSnapshot.observed_at))
        .limit(1)
    )
    prev_row = previous.scalar_one_or_none()
    prev_kind = prev_row.regime if prev_row is not None else None

    row = RegimeSnapshot(
        symbol_id=symbol_id,
        tf=tf,
        regime=kind,
        confidence=confidence,
        observed_at=_ensure_utc(observed_at) if observed_at else _now_utc(),
        atr=atr,
        adx=adx,
        news_pressure=news_pressure,
        details={
            "trendStrength": float(trend_strength),
            "volatility": float(volatility),
            "barAgeMs": int(bar_age_ms),
            "notes": notes,
        },
    )
    db.add(row)
    await db.flush()

    if prev_kind is not None and prev_kind != kind:
        await append_learning_event(
            db,
            kind="regime_flipped",
            subject_id=row.id,
            subject_kind="regime",
            symbol_id=symbol_id,
            payload={
                "tf": tf,
                "from": prev_kind,
                "to": kind,
                "confidence": confidence,
            },
        )
    return row


async def list_regime_snapshots(db: AsyncSession) -> RegimeCurrentOutDto:
    """Return the latest snapshot per (symbolId, tf)."""

    stmt = select(RegimeSnapshot).order_by(
        desc(RegimeSnapshot.observed_at), desc(RegimeSnapshot.id)
    )
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    seen: set[tuple[str, str]] = set()
    latest: list[RegimeSnapshot] = []
    for row in rows:
        key = (row.symbol_id, row.tf)
        if key in seen:
            continue
        seen.add(key)
        latest.append(row)
    snapshots = [_regime_to_dto(r) for r in latest]
    return RegimeCurrentOutDto(snapshots=snapshots, generatedAt=_now_utc())


async def list_regime_history(
    db: AsyncSession,
    *,
    symbol_id: str,
    tf: str,
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
    limit: int = 200,
) -> RegimeHistoryOutDto:
    stmt = select(RegimeSnapshot).where(
        and_(RegimeSnapshot.symbol_id == symbol_id, RegimeSnapshot.tf == tf)
    )
    if from_ts is not None:
        stmt = stmt.where(RegimeSnapshot.observed_at >= _ensure_utc(from_ts))
    if to_ts is not None:
        stmt = stmt.where(RegimeSnapshot.observed_at <= _ensure_utc(to_ts))
    stmt = stmt.order_by(desc(RegimeSnapshot.observed_at)).limit(limit)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    return RegimeHistoryOutDto(
        symbolId=symbol_id,
        tf=tf,
        snapshots=[_regime_to_dto(r) for r in rows],
    )


# ──────────────────────────── session snapshots ─────────────────────────


def _session_to_dto(row: SessionSnapshot) -> SessionSnapshotDto:
    volatility_raw = float(row.avg_range_r or 0.0)
    volatility = max(0.0, min(volatility_raw, 1.0))
    win_rate = float(row.win_rate) if row.setup_count else None
    return SessionSnapshotDto(
        id=row.id,
        symbolId=row.symbol_id or "",
        session=row.session,  # type: ignore[arg-type]
        volatility=volatility,
        winRate=win_rate,
        meanR=None,
        sampleSize=int(row.setup_count or 0),
        observedAt=_ensure_utc(row.computed_at),
    )


async def list_session_snapshots(
    db: AsyncSession,
    *,
    symbol_id: str | None = None,
    session: str | None = None,
    limit: int = 50,
) -> SessionIntelOutDto:
    stmt = select(SessionSnapshot)
    clauses = []
    if symbol_id is not None:
        clauses.append(SessionSnapshot.symbol_id == symbol_id)
    if session is not None:
        clauses.append(SessionSnapshot.session == session)
    if clauses:
        stmt = stmt.where(and_(*clauses))
    stmt = stmt.order_by(
        desc(SessionSnapshot.bucket_ts), desc(SessionSnapshot.id)
    ).limit(limit)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    return SessionIntelOutDto(
        snapshots=[_session_to_dto(r) for r in rows],
        generatedAt=_now_utc(),
    )


# ──────────────────────────── data truth ──────────────────────────────


def _data_truth_to_dto(
    row: DataTruthCheck, status: DataTruthStatusLiteral
) -> DataTruthCheckDto:
    return DataTruthCheckDto(
        id=row.id,
        kind=row.kind,  # type: ignore[arg-type]
        status=status,
        message=row.message or "",
        measurement=float(row.last_value or 0.0),
        amberThreshold=float(row.threshold or 0.0),
        redThreshold=float((row.threshold or 0.0) * 2.0),
        symbolId=None,  # DataTruthCheck has no symbol column.
        observedAt=_ensure_utc(row.last_observed_at),
    )


async def upsert_data_truth_check(
    db: AsyncSession,
    *,
    req: DataTruthCheckCreateRequestDto,
    observed_at: datetime | None = None,
) -> tuple[DataTruthCheck, DataTruthStatusLiteral]:
    """Upsert a DataTruthCheck row by ``kind`` (unique).

    Writes the dedicated ``threshold`` column to ``amber_threshold`` so
    legacy consumers keep reading. The DTO round-trip re-derives the
    red threshold as ``2 × amber`` to stay within the existing schema.
    """

    from app.learning.data_truth import classify_data_truth_status

    status = classify_data_truth_status(
        req.measurement, req.amber_threshold, req.red_threshold
    )

    existing = await db.execute(
        select(DataTruthCheck).where(DataTruthCheck.kind == req.kind).limit(1)
    )
    row = existing.scalar_one_or_none()
    now = _ensure_utc(observed_at) if observed_at else _now_utc()

    if row is None:
        row = DataTruthCheck(
            kind=req.kind,
            status=status,
            last_observed_at=now,
            last_value=req.measurement,
            threshold=req.amber_threshold,
            message=req.message or None,
        )
        db.add(row)
    else:
        row.status = status
        row.last_observed_at = now
        row.last_value = req.measurement
        row.threshold = req.amber_threshold
        row.message = req.message or None
    await db.flush()

    # data_truth_breach event only fires when the row goes red.
    if status == "red":
        await append_learning_event(
            db,
            kind="data_truth_breach",
            subject_id=row.id,
            subject_kind="data_truth",
            payload={
                "kind": req.kind,
                "measurement": req.measurement,
                "redThreshold": req.red_threshold,
            },
        )
    return row, status


async def get_data_truth_status(db: AsyncSession) -> DataTruthStatusOutDto:
    stmt = select(DataTruthCheck).order_by(
        DataTruthCheck.kind.asc(), desc(DataTruthCheck.last_observed_at)
    )
    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    # Dedupe by kind (one row per kind anyway, but the ordering guard
    # keeps the code correct even if the unique constraint is relaxed).
    seen: set[str] = set()
    unique: list[DataTruthCheck] = []
    for row in rows:
        if row.kind in seen:
            continue
        seen.add(row.kind)
        unique.append(row)

    checks_in: list[DataTruthCheckInput] = []
    for row in unique:
        amber = float(row.threshold or 0.0)
        red = amber * 2.0 if amber else 0.0
        checks_in.append(
            DataTruthCheckInput(
                kind=row.kind,
                measurement=float(row.last_value or 0.0),
                amber_threshold=amber,
                red_threshold=red,
            )
        )
    overall, verdicts = aggregate_data_truth(checks_in)
    tripped, reason = evaluate_kill_switch(verdicts)

    return DataTruthStatusOutDto(
        status=overall,
        checks=[_data_truth_to_dto(row, s) for row, (_, s) in zip(unique, verdicts)],
        killSwitchTripped=tripped,
        killSwitchReason=reason,
        generatedAt=_now_utc(),
    )


# ──────────────────────────── strategy DNA ─────────────────────────────


def _dna_cell_to_dto(cell: StrategyDNACell) -> DNACellDto:
    return DNACellDto(
        regime=cell.regime,  # type: ignore[arg-type]
        session=cell.session,  # type: ignore[arg-type]
        winRate=float(cell.win_rate) if cell.sample_size else None,
        meanR=float(cell.mean_r) if cell.sample_size else None,
        sampleSize=int(cell.sample_size or 0),
    )


def _strategy_dna_to_dto(
    strategy: Strategy, cells: Sequence[StrategyDNACell]
) -> StrategyDNADto:
    cell_dtos = [_dna_cell_to_dto(c) for c in cells]

    best = None
    worst = None
    best_key: tuple[float, int] = (-1e18, -1)
    worst_key: tuple[float, int] = (1e18, -1)
    total_trades = 0
    latest: datetime | None = None
    for c, dto in zip(cells, cell_dtos):
        if c.sample_size >= 3 and dto.mean_r is not None:
            k = (dto.mean_r, c.sample_size)
            if k > best_key:
                best_key = k
                best = dto
            k2 = (dto.mean_r, -c.sample_size)
            if k2 < worst_key:
                worst_key = k2
                worst = dto
        total_trades += int(c.sample_size or 0)
        if latest is None or c.computed_at > latest:
            latest = c.computed_at

    return StrategyDNADto(
        id=f"dnaset_{strategy.id}",
        strategyId=strategy.id,
        cells=cell_dtos,
        bestCell=best,
        worstCell=worst,
        tierAtGeneration=strategy.current_tier,  # type: ignore[arg-type]
        totalTrades=total_trades,
        generatedAt=_ensure_utc(latest) if latest else _now_utc(),
    )


async def list_strategy_dna(
    db: AsyncSession,
    *,
    strategy_id: str | None = None,
) -> StrategyDNAListOutDto:
    stmt = select(Strategy)
    if strategy_id is not None:
        stmt = stmt.where(Strategy.id == strategy_id)
    result = await db.execute(stmt)
    strategies = list(result.scalars().all())

    out: list[StrategyDNADto] = []
    for strat in strategies:
        cell_stmt = select(StrategyDNACell).where(
            StrategyDNACell.strategy_id == strat.id
        )
        cell_result = await db.execute(cell_stmt)
        cells = list(cell_result.scalars().all())
        if not cells:
            # Emit an empty 20-cell grid so the UI can render the skeleton.
            out.append(
                StrategyDNADto(
                    id=f"dnaset_{strat.id}",
                    strategyId=strat.id,
                    cells=[
                        DNACellDto(
                            regime=kind,
                            session=sess,  # type: ignore[arg-type]
                            winRate=None,
                            meanR=None,
                            sampleSize=0,
                        )
                        for kind in REGIME_KINDS
                        for sess in ("asia", "london", "ny_am", "ny_pm", "off_hours")
                    ],
                    bestCell=None,
                    worstCell=None,
                    tierAtGeneration=strat.current_tier,  # type: ignore[arg-type]
                    totalTrades=0,
                    generatedAt=_now_utc(),
                )
            )
            continue
        out.append(_strategy_dna_to_dto(strat, cells))
    return StrategyDNAListOutDto(dna=out, generatedAt=_now_utc())


async def build_dna_for_strategy(
    db: AsyncSession,
    *,
    strategy_id: str,
) -> StrategyDNADto:
    """Recompute the DNA grid for one strategy from RecallTrade rows.

    Writes the 20 cells (upserting on the uniq index) so the list
    endpoint can read them back without recomputing.
    """

    strategy = await db.get(Strategy, strategy_id)
    if strategy is None:
        raise LookupError(f"strategy {strategy_id!r} not found")

    stmt = select(RecallTrade).where(
        and_(
            RecallTrade.strategy_id == strategy_id,
            RecallTrade.outcome.in_(("win", "loss")),
        )
    )
    result = await db.execute(stmt)
    trades = list(result.scalars().all())

    trade_rows = [
        {
            "regime": t.regime,
            "session": t.session,
            "win": t.outcome == "win",
            "r": float(t.pnl_r or 0.0),
        }
        for t in trades
        if t.regime and t.session
    ]
    cells = build_dna_grid(trade_rows)

    # Upsert each cell.
    now = _now_utc()
    for cell in cells:
        existing = await db.execute(
            select(StrategyDNACell).where(
                and_(
                    StrategyDNACell.strategy_id == strategy_id,
                    StrategyDNACell.regime == cell.regime,
                    StrategyDNACell.session == cell.session,
                )
            )
        )
        row = existing.scalar_one_or_none()
        if row is None:
            row = StrategyDNACell(
                strategy_id=strategy_id,
                regime=cell.regime,
                session=cell.session,
                win_rate=cell.win_rate or 0.0,
                mean_r=cell.mean_r or 0.0,
                median_r=cell.mean_r or 0.0,
                drawdown=0.0,
                sample_size=cell.sample_size,
                computed_at=now,
            )
            db.add(row)
        else:
            row.win_rate = cell.win_rate or 0.0
            row.mean_r = cell.mean_r or 0.0
            row.median_r = cell.mean_r or 0.0
            row.sample_size = cell.sample_size
            row.computed_at = now
    await db.flush()

    cell_stmt = select(StrategyDNACell).where(
        StrategyDNACell.strategy_id == strategy_id
    )
    cell_result = await db.execute(cell_stmt)
    persisted = list(cell_result.scalars().all())
    return _strategy_dna_to_dto(strategy, persisted)
