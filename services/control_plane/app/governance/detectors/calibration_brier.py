"""Calibration brier-regression detector.

Rule: for each ``(scope_kind, scope_ref)`` calibration series, compare
the most recent :class:`ConfidenceCalibration` row's ``brier`` score
against the median of the prior ``BASELINE_WINDOW`` rows. If the newest
row's brier exceeds ``baseline_median * (1 + REGRESSION_PCT)``, fire a
``calibration_brier_regression`` anomaly.

Thresholds (sourced from ``system_config`` with defaults):

  * ``governance.detectors.calibration_brier.regression_pct`` — 0.20
    (i.e. 20% worse than recent baseline)
  * ``governance.detectors.calibration_brier.baseline_window`` — 5
    (compare against the median of the previous 5 rows)
  * ``governance.detectors.calibration_brier.min_sample_size`` — 100
    (skip series whose newest row has fewer than this many observations;
    small samples produce noisy brier scores)

A rising brier score means the score-to-outcome mapping has drifted —
either the underlying model changed, the market regime shifted, or the
labelling pipeline broke. The operator response is usually a manual
``calibration_recompute`` approval, which the anomaly links to via
``evidence``.
"""

from __future__ import annotations

from statistics import median
from typing import Any, Dict, List, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.anomaly import emit_anomaly
from app.governance.detectors.thresholds import (
    get_float_threshold,
    get_int_threshold,
)
from app.models import ConfidenceCalibration

_CFG_REGRESSION_PCT = (
    "governance.detectors.calibration_brier.regression_pct"
)
_CFG_BASELINE = "governance.detectors.calibration_brier.baseline_window"
_CFG_MIN_SAMPLE = "governance.detectors.calibration_brier.min_sample_size"


def _bucket_by_scope(
    rows: List[ConfidenceCalibration],
) -> Dict[Tuple[str, str], List[ConfidenceCalibration]]:
    """Group rows by (scope_kind, scope_ref) preserving newest-first order."""
    out: Dict[Tuple[str, str], List[ConfidenceCalibration]] = {}
    for row in rows:
        key = (row.scope_kind, row.scope_ref or "")
        out.setdefault(key, []).append(row)
    return out


async def detect_calibration_brier_regression(
    session: AsyncSession,
) -> Dict[str, Any]:
    """Run the calibration-brier-regression detector."""
    regression_pct = await get_float_threshold(
        session, _CFG_REGRESSION_PCT, 0.20
    )
    baseline_window = await get_int_threshold(session, _CFG_BASELINE, 5)
    min_sample_size = await get_int_threshold(session, _CFG_MIN_SAMPLE, 100)

    # Pull enough rows to cover ``baseline_window + 1`` per scope; in
    # practice 64 rows total is a generous ceiling for the scope count
    # GodsView ever has active.
    stmt = (
        select(ConfidenceCalibration)
        .order_by(ConfidenceCalibration.computed_at.desc())
        .limit(max(64, (baseline_window + 1) * 16))
    )
    rows = list((await session.execute(stmt)).scalars().all())
    if not rows:
        return {
            "emitted": 0,
            "suppressed": 0,
            "samples_examined": 0,
            "notes": "no calibration rows",
        }

    buckets = _bucket_by_scope(rows)

    emitted = 0
    suppressed = 0
    examined = 0

    for (scope_kind, scope_ref), bucket in buckets.items():
        examined += len(bucket)
        if len(bucket) < baseline_window + 1:
            # Not enough history to decide.
            continue

        newest = bucket[0]
        baseline_rows = bucket[1 : baseline_window + 1]

        if newest.sample_size < min_sample_size:
            continue

        baseline_brier = median(r.brier for r in baseline_rows)
        if baseline_brier <= 0.0:
            # Edge: baseline zero or negative → skip, can't compute a
            # meaningful ratio.
            continue

        regression_ratio = (newest.brier - baseline_brier) / baseline_brier
        if regression_ratio < regression_pct:
            continue

        subject_key = (
            f"{scope_kind}:{scope_ref}" if scope_ref else scope_kind
        )
        severity = "critical" if regression_ratio >= regression_pct * 2 else "error"
        message = (
            f"calibration brier regression on {subject_key!r}: "
            f"brier={newest.brier:.4f} vs baseline={baseline_brier:.4f} "
            f"(+{regression_ratio * 100:.1f}%)"
        )

        evidence: Dict[str, Any] = {
            "scopeKind": scope_kind,
            "scopeRef": scope_ref or None,
            "newestCalibrationId": newest.id,
            "newestBrier": newest.brier,
            "newestEce": newest.ece,
            "newestSampleSize": newest.sample_size,
            "newestComputedAt": newest.computed_at.isoformat(),
            "baselineBrierMedian": baseline_brier,
            "baselineWindow": baseline_window,
            "regressionRatio": regression_ratio,
            "thresholds": {
                "regressionPct": regression_pct,
                "baselineWindow": baseline_window,
                "minSampleSize": min_sample_size,
            },
        }

        alert = await emit_anomaly(
            session,
            source="calibration_brier_regression",
            severity=severity,
            message=message,
            subject_key=subject_key,
            evidence=evidence,
        )
        if alert.status == "suppressed":
            suppressed += 1
        else:
            emitted += 1

    return {
        "emitted": emitted,
        "suppressed": suppressed,
        "samples_examined": examined,
        "notes": None,
    }


__all__ = ["detect_calibration_brier_regression"]
