"""Broker-outage detector.

Rule: for each probe-enabled broker adapter, fetch the last
``CONSECUTIVE_SAMPLES`` snapshots. If **all** of them report
``status != 'healthy'`` — or the most recent snapshot is older than
``STALE_SECONDS`` — raise a ``broker_outage`` anomaly.

Thresholds (sourced from ``system_config`` with defaults in code):

  * ``governance.detectors.broker_outage.consecutive_samples`` — 3
  * ``governance.detectors.broker_outage.error_rate`` — 0.25
  * ``governance.detectors.broker_outage.stale_seconds`` — 180

Complementary to :mod:`venue_latency` — that one fires on slow-but-up,
this one fires on down-or-erroring. Both detectors share the same
suppression key (``adapter_id``) through different ``source`` values so
a flapping broker only produces one row per source per window.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.anomaly import emit_anomaly
from app.governance.detectors.thresholds import (
    get_float_threshold,
    get_int_threshold,
)
from app.models import BrokerAdapterRow, BrokerHealthSnapshotRow

UTC = timezone.utc

_CFG_CONSEC = "governance.detectors.broker_outage.consecutive_samples"
_CFG_ERROR_RATE = "governance.detectors.broker_outage.error_rate"
_CFG_STALE = "governance.detectors.broker_outage.stale_seconds"


def _bucket_by_adapter(
    rows: List[BrokerHealthSnapshotRow],
) -> Dict[str, List[BrokerHealthSnapshotRow]]:
    out: Dict[str, List[BrokerHealthSnapshotRow]] = {}
    for row in rows:
        out.setdefault(row.adapter_id, []).append(row)
    # newest → oldest already, thanks to the query's ORDER BY
    return out


async def detect_broker_outage(
    session: AsyncSession,
) -> Dict[str, Any]:
    """Run the broker-outage detector and return a summary dict."""
    consec_n = await get_int_threshold(session, _CFG_CONSEC, 3)
    err_rate_limit = await get_float_threshold(
        session, _CFG_ERROR_RATE, 0.25
    )
    stale_seconds = await get_int_threshold(session, _CFG_STALE, 180)

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
        .where(BrokerHealthSnapshotRow.adapter_id.in_(adapter_ids))
        .order_by(BrokerHealthSnapshotRow.observed_at.desc())
    )
    snapshots = list((await session.execute(snap_stmt)).scalars().all())
    buckets = _bucket_by_adapter(snapshots)

    now = datetime.now(UTC)
    stale_cutoff = now - timedelta(seconds=stale_seconds)

    emitted = 0
    suppressed = 0
    examined = 0

    for adapter in adapters:
        rows = buckets.get(adapter.id, [])
        examined += len(rows)

        latest = rows[0] if rows else None
        stale = latest is None or latest.observed_at < stale_cutoff

        recent = rows[:consec_n]
        unhealthy_streak = (
            len(recent) >= consec_n
            and all(r.status != "healthy" for r in recent)
        )
        # Single-row error-rate trip: if the newest snapshot reports
        # more than ``err_rate_limit`` errors in its window, that's
        # outage enough — don't wait for two more samples.
        error_spike = (
            latest is not None
            and latest.error_rate >= err_rate_limit
        )

        if not (stale or unhealthy_streak or error_spike):
            continue

        if stale:
            severity = "critical"
            reason = "probe stale or never ran"
        elif error_spike:
            severity = "critical"
            reason = f"error_rate={latest.error_rate:.2f}≥{err_rate_limit:.2f}"
        else:
            severity = "critical"
            reason = f"{consec_n} consecutive non-healthy snapshots"

        message = f"broker {adapter.display_name!r} outage: {reason}"

        evidence: Dict[str, Any] = {
            "adapterId": adapter.id,
            "adapterName": adapter.display_name,
            "brokerKind": adapter.kind,
            "latestStatus": latest.status if latest else None,
            "latestObservedAt": (
                latest.observed_at.isoformat() if latest else None
            ),
            "errorRate": latest.error_rate if latest else None,
            "streakLen": len(recent),
            "thresholds": {
                "consecutiveSamples": consec_n,
                "errorRate": err_rate_limit,
                "staleSeconds": stale_seconds,
            },
            "stale": stale,
        }

        alert = await emit_anomaly(
            session,
            source="broker_outage",
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
        "samples_examined": examined,
        "notes": None,
    }


__all__ = ["detect_broker_outage"]
