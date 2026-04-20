"""Venue-latency-breach detector.

Rule: a broker adapter's most recent :class:`BrokerHealthSnapshotRow`
shows ``latency_p95_ms`` above ``P95_THRESHOLD`` or ``latency_p99_ms``
above ``P99_THRESHOLD`` (whichever trips first). Thresholds are sourced
from ``system_config``:

  * ``governance.detectors.venue_latency.p95_ms`` — default 750
  * ``governance.detectors.venue_latency.p99_ms`` — default 1500
  * ``governance.detectors.venue_latency.window_seconds`` — default 300
    (the snapshot must be younger than this to count — a stale probe is
    treated as a probe failure, not a latency breach).

The emitted anomaly carries the probe percentiles and the adapter id so
the operator UI can deep-link to the broker health page.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.anomaly import emit_anomaly
from app.governance.detectors.thresholds import (
    get_float_threshold,
    get_int_threshold,
)
from app.models import BrokerAdapterRow, BrokerHealthSnapshotRow

UTC = timezone.utc

_CFG_P95 = "governance.detectors.venue_latency.p95_ms"
_CFG_P99 = "governance.detectors.venue_latency.p99_ms"
_CFG_WINDOW = "governance.detectors.venue_latency.window_seconds"


def _latest_snapshot_per_adapter(
    rows: list[BrokerHealthSnapshotRow],
) -> Dict[str, BrokerHealthSnapshotRow]:
    """Pick the newest snapshot per adapter from a batched query."""
    latest: Dict[str, BrokerHealthSnapshotRow] = {}
    for row in rows:
        existing = latest.get(row.adapter_id)
        if existing is None or row.observed_at > existing.observed_at:
            latest[row.adapter_id] = row
    return latest


async def detect_venue_latency_breach(
    session: AsyncSession,
) -> Dict[str, Any]:
    """Run the venue-latency detector and return a summary dict.

    Returns a summary compatible with :class:`DetectorReport`:

    ::

        {
            "emitted":          int,
            "suppressed":       int,
            "samples_examined": int,
            "notes":            Optional[str],
        }
    """
    p95_threshold = await get_float_threshold(session, _CFG_P95, 750.0)
    p99_threshold = await get_float_threshold(session, _CFG_P99, 1500.0)
    window_seconds = await get_int_threshold(session, _CFG_WINDOW, 300)

    now = datetime.now(UTC)
    cutoff = now - timedelta(seconds=window_seconds)

    # Pull probe-enabled adapters and their most recent snapshot in one
    # pass — a detector should never do N+1 queries on a hot path.
    stmt = select(BrokerAdapterRow).where(
        BrokerAdapterRow.probe_enabled.is_(True)
    )
    adapters = list((await session.execute(stmt)).scalars().all())
    if not adapters:
        return {
            "emitted": 0,
            "suppressed": 0,
            "samples_examined": 0,
            "notes": "no probe-enabled adapters",
        }

    adapter_ids = [a.id for a in adapters]
    snap_stmt = (
        select(BrokerHealthSnapshotRow)
        .where(
            BrokerHealthSnapshotRow.adapter_id.in_(adapter_ids),
            BrokerHealthSnapshotRow.observed_at >= cutoff,
        )
        .order_by(BrokerHealthSnapshotRow.observed_at.desc())
    )
    snapshots = list((await session.execute(snap_stmt)).scalars().all())
    latest = _latest_snapshot_per_adapter(snapshots)

    emitted = 0
    suppressed = 0

    for adapter in adapters:
        snap = latest.get(adapter.id)
        if snap is None:
            # No fresh snapshot → let the broker_outage detector decide.
            continue

        p95 = snap.latency_p95_ms
        p99 = snap.latency_p99_ms
        # Treat a missing percentile as healthy — the probe just hasn't
        # collected enough samples yet (first minute after reboot).
        p95_breach = p95 is not None and p95 > p95_threshold
        p99_breach = p99 is not None and p99 > p99_threshold
        if not (p95_breach or p99_breach):
            continue

        severity = "critical" if p99_breach else "warn"
        which = []
        if p95_breach:
            which.append(f"p95={p95:.1f}ms>{p95_threshold:.0f}ms")
        if p99_breach:
            which.append(f"p99={p99:.1f}ms>{p99_threshold:.0f}ms")
        message = (
            f"broker {adapter.display_name!r} latency breach: "
            + ", ".join(which)
        )

        evidence: Dict[str, Any] = {
            "adapterId": adapter.id,
            "adapterName": adapter.display_name,
            "brokerKind": adapter.kind,
            "latencyP50Ms": snap.latency_p50_ms,
            "latencyP95Ms": p95,
            "latencyP99Ms": p99,
            "errorRate": snap.error_rate,
            "sampleCount": snap.sample_count,
            "snapshotObservedAt": snap.observed_at.isoformat(),
            "thresholds": {
                "p95Ms": p95_threshold,
                "p99Ms": p99_threshold,
            },
        }

        alert = await emit_anomaly(
            session,
            source="venue_latency_breach",
            severity=severity,
            message=message,
            subject_key=adapter.id,
            evidence=evidence,
        )
        if alert.status == "suppressed":
            suppressed += 1
        else:
            emitted += 1

    return {
        "emitted": emitted,
        "suppressed": suppressed,
        "samples_examined": len(latest),
        "notes": None,
    }


__all__ = ["detect_venue_latency_breach"]
