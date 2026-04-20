"""Detector pass runner.

One call fans out across every registered detector, captures a
per-detector report, and returns a single rollup DTO. The runner is
called from:

  * ``POST /v1/governance/detectors/run`` (admin trigger)
  * a scheduled cron (next wiring — same entry point, no duplication)

Every detector is awaited inside its own ``try/except`` so a failure in
one does not kill the others — detectors are load-bearing for
production safety and must run to completion even when one feed is
misbehaving.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List

from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.detectors.broker_outage import detect_broker_outage
from app.governance.detectors.calibration_brier import (
    detect_calibration_brier_regression,
)
from app.governance.detectors.venue_latency import detect_venue_latency_breach
from app.governance.dto import (
    AnomalySource,
    DetectorRunResultDto,
    DetectorRunSummaryDto,
)

UTC = timezone.utc

logger = logging.getLogger(__name__)


# ──────────────────────────── detector report ──────────────────────────


@dataclass(frozen=True)
class DetectorReport:
    """In-memory detector pass summary — mirrors DetectorRunSummaryDto."""

    source: str
    emitted: int
    suppressed: int
    samples_examined: int
    notes: str | None


DetectorFunc = Callable[[AsyncSession], Awaitable[Dict[str, Any]]]

# Ordering is cosmetic — the runner awaits them in sequence to keep the
# DB driver happy (a single async session cannot interleave queries).
_REGISTRY: List[tuple[AnomalySource, DetectorFunc]] = [
    ("venue_latency_breach", detect_venue_latency_breach),
    ("broker_outage", detect_broker_outage),
    ("calibration_brier_regression", detect_calibration_brier_regression),
]


def _summary_to_dto(
    source: AnomalySource, summary: Dict[str, Any]
) -> DetectorRunSummaryDto:
    return DetectorRunSummaryDto(
        source=source,
        emitted=int(summary.get("emitted", 0)),
        suppressed=int(summary.get("suppressed", 0)),
        samplesExamined=int(summary.get("samples_examined", 0)),
        notes=summary.get("notes"),
    )


def _error_summary(
    source: AnomalySource, exc: BaseException
) -> DetectorRunSummaryDto:
    return DetectorRunSummaryDto(
        source=source,
        emitted=0,
        suppressed=0,
        samplesExamined=0,
        notes=f"detector error: {type(exc).__name__}: {exc}",
    )


async def run_all_detectors(
    session: AsyncSession,
) -> DetectorRunResultDto:
    """Run every registered detector and return a rollup DTO.

    Each detector is wrapped in ``try/except`` — any exception is
    captured as an error summary but does not propagate. This keeps a
    single bad feed from blocking the rest of the pass.
    """
    reports: List[DetectorRunSummaryDto] = []
    total_emitted = 0
    total_suppressed = 0

    for source, func in _REGISTRY:
        try:
            summary = await func(session)
            dto = _summary_to_dto(source, summary)
        except Exception as exc:  # pragma: no cover — defensive
            logger.exception("detector %s failed", source)
            dto = _error_summary(source, exc)

        reports.append(dto)
        total_emitted += dto.emitted
        total_suppressed += dto.suppressed

    return DetectorRunResultDto(
        ranAt=datetime.now(UTC),
        totalEmitted=total_emitted,
        totalSuppressed=total_suppressed,
        detectors=reports,
    )


__all__ = ["DetectorReport", "run_all_detectors"]
