"""Anomaly detector library — Phase 7 PR5.

Each detector is a pure async function that:

  * Reads recent rollup / snapshot rows from the DB.
  * Applies a deterministic rule with a threshold sourced from
    ``system_config`` (falls back to a hard-coded default).
  * Calls :func:`app.governance.anomaly.emit_anomaly` when the rule
    trips — suppression is enforced inside ``emit_anomaly`` so a firing
    detector does not double-write while an operator is still acking.

The detectors live under this package so each rule has one file owning
its thresholds, fixture shape, and test surface. The :mod:`runner`
module fans out across the full detector set in a single pass and is
what the cron + the ``/v1/governance/detectors/run`` admin endpoint
call into.

Design notes:
  * Detectors **never** raise — they trap per-detector errors and
    return ``DetectorReport.error`` so one bad feed can't silence the
    rest of the pass.
  * Detectors are idempotent — re-firing the same rule within the
    suppression window is a no-op (handled by ``emit_anomaly``).
  * Thresholds are read at the top of every pass, not cached at import
    time, so operators can tune the system without a bounce.
"""

from __future__ import annotations

from app.governance.detectors.broker_outage import detect_broker_outage
from app.governance.detectors.calibration_brier import (
    detect_calibration_brier_regression,
)
from app.governance.detectors.runner import (
    DetectorReport,
    run_all_detectors,
)
from app.governance.detectors.venue_latency import detect_venue_latency_breach

__all__ = [
    "DetectorReport",
    "detect_broker_outage",
    "detect_calibration_brier_regression",
    "detect_venue_latency_breach",
    "run_all_detectors",
]
