"""Integration tests for Phase 7 PR5 — anomaly-detector expansion.

Covers the three new detectors:

  * ``venue_latency_breach``          — BrokerHealthSnapshot p95/p99 trip
  * ``broker_outage``                 — consecutive-unhealthy streak
  * ``calibration_brier_regression``  — newest brier ≥ 20% above baseline

Plus the admin-gated ``POST /v1/governance/detectors/run`` fan-out
endpoint that each cron pass replays.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.detectors import (
    detect_broker_outage,
    detect_calibration_brier_regression,
    detect_venue_latency_breach,
    run_all_detectors,
)
from app.models import (
    AnomalyAlertRow,
    BrokerAdapterRow,
    BrokerHealthSnapshotRow,
    ConfidenceCalibration,
)

UTC = timezone.utc


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


@pytest_asyncio.fixture()
async def admin_token(
    client: AsyncClient, admin_user: dict[str, Any]
) -> str:
    return await _login(client, admin_user["email"], admin_user["password"])


# ──────────────────────────── helpers ──────────────────────────────────


def _mk_adapter(
    name: str = "primary", kind: str = "alpaca_paper"
) -> BrokerAdapterRow:
    return BrokerAdapterRow(
        id=f"bkr_{uuid.uuid4().hex[:10]}",
        kind=kind,
        role="primary",
        display_name=name,
        host="paper-api.alpaca.markets",
        api_key_masked=None,
        api_secret_ref="",
        status="healthy",
        live_enabled=False,
        probe_enabled=True,
    )


def _mk_snapshot(
    adapter_id: str,
    *,
    status: str = "healthy",
    p95: float | None = 100.0,
    p99: float | None = 200.0,
    error_rate: float = 0.0,
    observed_at: datetime | None = None,
) -> BrokerHealthSnapshotRow:
    return BrokerHealthSnapshotRow(
        adapter_id=adapter_id,
        status=status,
        last_probe_at=observed_at or datetime.now(UTC),
        sample_count=20,
        latency_p50_ms=50.0,
        latency_p95_ms=p95,
        latency_p99_ms=p99,
        error_rate=error_rate,
        observed_at=observed_at or datetime.now(UTC),
    )


def _mk_calibration(
    *,
    scope_kind: str = "strategy",
    scope_ref: str = "strat_demo",
    brier: float,
    sample_size: int = 250,
    computed_at: datetime | None = None,
) -> ConfidenceCalibration:
    return ConfidenceCalibration(
        scope_kind=scope_kind,
        scope_ref=scope_ref,
        kind="bucket",
        bins=[],
        platt_a=None,
        platt_b=None,
        ece=0.05,
        brier=brier,
        sample_size=sample_size,
        computed_at=computed_at or datetime.now(UTC),
    )


# ──────────────────────────── venue_latency ────────────────────────────


@pytest.mark.asyncio
async def test_venue_latency_emits_on_p99_breach(db: AsyncSession) -> None:
    adapter = _mk_adapter(name="alpaca-paper-p99")
    db.add(adapter)
    await db.flush()
    db.add(_mk_snapshot(adapter.id, p95=400.0, p99=1900.0))
    await db.commit()

    summary = await detect_venue_latency_breach(db)
    await db.commit()

    assert summary["emitted"] == 1, summary
    rows = (
        await db.execute(
            select(AnomalyAlertRow).where(
                AnomalyAlertRow.source == "venue_latency_breach"
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].severity == "critical"
    assert rows[0].subject_key == adapter.id


@pytest.mark.asyncio
async def test_venue_latency_no_emit_when_under_threshold(
    db: AsyncSession,
) -> None:
    adapter = _mk_adapter(name="alpaca-paper-ok")
    db.add(adapter)
    await db.flush()
    db.add(_mk_snapshot(adapter.id, p95=100.0, p99=200.0))
    await db.commit()

    summary = await detect_venue_latency_breach(db)
    await db.commit()

    assert summary["emitted"] == 0
    rows = (
        await db.execute(
            select(AnomalyAlertRow).where(
                AnomalyAlertRow.source == "venue_latency_breach"
            )
        )
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_venue_latency_skips_probe_disabled(db: AsyncSession) -> None:
    adapter = _mk_adapter(name="disabled")
    adapter.probe_enabled = False
    db.add(adapter)
    await db.flush()
    db.add(_mk_snapshot(adapter.id, p95=900.0, p99=1900.0))
    await db.commit()

    summary = await detect_venue_latency_breach(db)
    await db.commit()

    assert summary["emitted"] == 0


# ──────────────────────────── broker_outage ────────────────────────────


@pytest.mark.asyncio
async def test_broker_outage_consecutive_unhealthy_emits(
    db: AsyncSession,
) -> None:
    adapter = _mk_adapter(name="flappy")
    db.add(adapter)
    await db.flush()

    now = datetime.now(UTC)
    for offset, status in [(0, "error"), (30, "error"), (60, "error")]:
        db.add(
            _mk_snapshot(
                adapter.id,
                status=status,
                observed_at=now - timedelta(seconds=offset),
            )
        )
    await db.commit()

    summary = await detect_broker_outage(db)
    await db.commit()

    assert summary["emitted"] == 1, summary
    rows = (
        await db.execute(
            select(AnomalyAlertRow).where(
                AnomalyAlertRow.source == "broker_outage"
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].severity == "critical"


@pytest.mark.asyncio
async def test_broker_outage_error_spike_emits(db: AsyncSession) -> None:
    adapter = _mk_adapter(name="spike")
    db.add(adapter)
    await db.flush()
    db.add(
        _mk_snapshot(adapter.id, status="degraded", error_rate=0.4)
    )
    await db.commit()

    summary = await detect_broker_outage(db)
    await db.commit()

    assert summary["emitted"] == 1


@pytest.mark.asyncio
async def test_broker_outage_healthy_streak_no_emit(
    db: AsyncSession,
) -> None:
    adapter = _mk_adapter(name="healthy")
    db.add(adapter)
    await db.flush()
    now = datetime.now(UTC)
    for offset in (0, 30, 60):
        db.add(
            _mk_snapshot(
                adapter.id, observed_at=now - timedelta(seconds=offset)
            )
        )
    await db.commit()

    summary = await detect_broker_outage(db)
    await db.commit()

    assert summary["emitted"] == 0


# ──────────────────────────── calibration_brier ────────────────────────


@pytest.mark.asyncio
async def test_calibration_brier_regression_emits(db: AsyncSession) -> None:
    now = datetime.now(UTC)
    # Baseline of 5 healthy rows at ~0.10 brier
    for i in range(5):
        db.add(
            _mk_calibration(
                brier=0.10,
                computed_at=now - timedelta(days=i + 1),
            )
        )
    # Newest row jumps to 0.15 = 50% worse than baseline median 0.10
    db.add(_mk_calibration(brier=0.15, computed_at=now))
    await db.commit()

    summary = await detect_calibration_brier_regression(db)
    await db.commit()

    assert summary["emitted"] == 1, summary
    rows = (
        await db.execute(
            select(AnomalyAlertRow).where(
                AnomalyAlertRow.source == "calibration_brier_regression"
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].severity in {"error", "critical"}


@pytest.mark.asyncio
async def test_calibration_brier_stable_no_emit(db: AsyncSession) -> None:
    now = datetime.now(UTC)
    for i in range(6):
        db.add(
            _mk_calibration(
                brier=0.10,
                computed_at=now - timedelta(days=i),
            )
        )
    await db.commit()

    summary = await detect_calibration_brier_regression(db)
    await db.commit()

    assert summary["emitted"] == 0


@pytest.mark.asyncio
async def test_calibration_brier_small_sample_skipped(
    db: AsyncSession,
) -> None:
    now = datetime.now(UTC)
    for i in range(5):
        db.add(
            _mk_calibration(
                brier=0.10,
                sample_size=500,
                computed_at=now - timedelta(days=i + 1),
            )
        )
    # Newest row regresses but has tiny sample size — skip.
    db.add(
        _mk_calibration(
            brier=0.30,
            sample_size=10,
            computed_at=now,
        )
    )
    await db.commit()

    summary = await detect_calibration_brier_regression(db)
    await db.commit()

    assert summary["emitted"] == 0


# ──────────────────────────── runner fan-out ───────────────────────────


@pytest.mark.asyncio
async def test_run_all_detectors_returns_every_source(
    db: AsyncSession,
) -> None:
    result = await run_all_detectors(db)
    sources = {d.source for d in result.detectors}
    assert sources == {
        "venue_latency_breach",
        "broker_outage",
        "calibration_brier_regression",
    }
    assert result.total_emitted == 0
    assert result.total_suppressed == 0


# ──────────────────────────── admin route ──────────────────────────────


@pytest.mark.asyncio
async def test_detectors_run_route_requires_admin(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.post(
        "/governance/detectors/run",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["totalEmitted"] == 0
    assert body["totalSuppressed"] == 0
    assert len(body["detectors"]) == 3
