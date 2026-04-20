"""Gate-snapshot reader.

In production the three autonomous-promotion gates are backed by:

  * ``dnaAllClear``       ← rollup of ``strategy_dna_cells`` (win_rate,
                            drawdown thresholds vs. configured bands).
  * ``calibrationPass``   ← ``confidence_calibrations`` row for
                            ``scope_kind='strategy'`` with the smallest
                            Brier score.
  * ``sampleSizeMet``     ← Sum of ``sample_size`` across DNA cells for
                            the strategy.

The reader is intentionally read-only; the autonomy engine consumes
these snapshots and the UI renders them verbatim. When the back-fill
tables have no data yet the gate falls back to ``unknown`` so the
engine never mistakes a cold start for a passing gate.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.autonomy.dto import AutonomyGateSnapshotDto
from app.models import (
    ConfidenceCalibration,
    StrategyDNACell,
)

UTC = timezone.utc


# ──────────────────────────── constants ────────────────────────────────

# Live fills (summed across DNA cells) required for the sample-size gate
# to turn green. A strategy with fewer fills is auto-held at
# ``assisted_live`` no matter how clean its DNA is.
DEFAULT_SAMPLE_SIZE_FLOOR = 30

# Calibration score tolerance — any ``confidence_calibrations.brier``
# below this is ``passing``; up to 2× is ``watch``; beyond is ``failing``.
DEFAULT_CALIBRATION_TOLERANCE = 0.10

# DNA thresholds for the rollup band.
DNA_WIN_RATE_PASS = 0.55
DNA_WIN_RATE_WATCH = 0.50
DNA_DRAWDOWN_PASS = 0.15   # ≤ 15% intra-strategy
DNA_DRAWDOWN_WATCH = 0.25  # ≤ 25%


# ──────────────────────────── helpers ──────────────────────────────────


def _now() -> datetime:
    return datetime.now(UTC)


async def _dna_rollup(
    session: AsyncSession, strategy_id: str
) -> tuple[str, Optional[str], int]:
    """Return (status, dna_tier, total_sample_size).

    ``dna_tier`` is derived from aggregate win-rate / drawdown — A, B, C.
    Status is ``passing`` for A, ``watch`` for B, ``failing`` for C,
    ``unknown`` when there are no DNA cells yet.
    """
    stmt = select(
        func.avg(StrategyDNACell.win_rate),
        func.max(StrategyDNACell.drawdown),
        func.sum(StrategyDNACell.sample_size),
    ).where(StrategyDNACell.strategy_id == strategy_id)
    row = (await session.execute(stmt)).one()
    avg_wr, max_dd, total_ss = row
    if avg_wr is None:
        return "unknown", None, 0

    avg_wr = float(avg_wr)
    max_dd = float(max_dd or 0.0)
    total_ss = int(total_ss or 0)

    if avg_wr >= DNA_WIN_RATE_PASS and max_dd <= DNA_DRAWDOWN_PASS:
        return "passing", "A", total_ss
    if avg_wr >= DNA_WIN_RATE_WATCH and max_dd <= DNA_DRAWDOWN_WATCH:
        return "watch", "B", total_ss
    return "failing", "C", total_ss


async def _calibration_band(
    session: AsyncSession,
    strategy_id: str,
    tolerance: float,
) -> tuple[str, Optional[float]]:
    stmt = (
        select(ConfidenceCalibration)
        .where(
            ConfidenceCalibration.scope_kind == "strategy",
            ConfidenceCalibration.scope_ref == strategy_id,
        )
        .order_by(desc(ConfidenceCalibration.computed_at))
        .limit(1)
    )
    row = (await session.execute(stmt)).scalars().first()
    if row is None:
        return "unknown", None
    brier = float(row.brier or 0.0)
    if brier <= tolerance:
        return "passing", brier
    if brier <= 2 * tolerance:
        return "watch", brier
    return "failing", brier


# ──────────────────────────── public api ───────────────────────────────


async def compute_gate_snapshot(
    session: AsyncSession,
    *,
    strategy_id: str,
    sample_size_floor: int = DEFAULT_SAMPLE_SIZE_FLOOR,
    calibration_tolerance: float = DEFAULT_CALIBRATION_TOLERANCE,
) -> AutonomyGateSnapshotDto:
    """Assemble a fresh gate snapshot for ``strategy_id``."""
    dna_status, dna_tier, sample_size = await _dna_rollup(session, strategy_id)
    cal_status, brier = await _calibration_band(
        session, strategy_id, calibration_tolerance
    )

    if sample_size >= sample_size_floor:
        sample_status = "passing"
    elif sample_size >= max(1, sample_size_floor // 2):
        sample_status = "watch"
    else:
        sample_status = "failing" if sample_size > 0 else "unknown"

    return AutonomyGateSnapshotDto(
        dnaAllClear=dna_status,  # type: ignore[arg-type]
        calibrationPass=cal_status,  # type: ignore[arg-type]
        sampleSizeMet=sample_status,  # type: ignore[arg-type]
        lastSampleSize=sample_size,
        requiredSampleSize=sample_size_floor,
        calibrationDrift=brier,
        dnaTier=dna_tier,  # type: ignore[arg-type]
        observedAt=_now(),
    )


def default_gate_snapshot() -> AutonomyGateSnapshotDto:
    """Cold-start snapshot — all gates ``unknown``. Used when seeding
    a fresh autonomy record before any Phase 5 rollups exist."""
    return AutonomyGateSnapshotDto(
        dnaAllClear="unknown",
        calibrationPass="unknown",
        sampleSizeMet="unknown",
        lastSampleSize=0,
        requiredSampleSize=DEFAULT_SAMPLE_SIZE_FLOOR,
        calibrationDrift=None,
        dnaTier=None,
        observedAt=_now(),
    )


def all_gates_passing(snapshot: AutonomyGateSnapshotDto) -> bool:
    """True if every gate is in the ``passing`` state."""
    return (
        snapshot.dna_all_clear == "passing"
        and snapshot.calibration_pass == "passing"
        and snapshot.sample_size_met == "passing"
    )


__all__ = [
    "DEFAULT_SAMPLE_SIZE_FLOOR",
    "DEFAULT_CALIBRATION_TOLERANCE",
    "all_gates_passing",
    "compute_gate_snapshot",
    "default_gate_snapshot",
]
