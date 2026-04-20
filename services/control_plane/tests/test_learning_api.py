"""Tests for /v1/learning — Phase 5 PR8 learning + governance HTTP surface.

Coverage map
------------

* **Pure calibration** — bucket determinism + ECE monotonicity, Platt
  convergence under perfectly-separable samples, Brier + ECE bounds.
* **Pure regime** — trending wins when trend + ADX high, ranging wins
  when everything is calm, news_driven beats volatile when
  news_pressure dominates, zero-everything falls back to ranging@0.25.
* **Pure data truth** — classifier green / amber / red, worst-of
  aggregation, kill-switch trip on red + strict-mode amber cluster.
* **Pure DNA grid** — emits the full 20-cell grid, empty cells carry
  None values, best / worst cell selection requires sample_size ≥ 3.
* **HTTP auth** — every endpoint rejects missing token with 401.
* **HTTP admin gate** — POST /calibration/recompute, POST
  /data-truth/checks and POST /dna/{id}/rebuild reject non-admin
  with 403.
* **HTTP validation** — 400 codes for invalid_event_kind,
  invalid_subject_kind, invalid_data_truth_kind, invalid_threshold_pair,
  invalid_session, regime_query_missing.
* **HTTP 404** — /dna/{unknown}/rebuild returns strategy_not_found.
* **End-to-end** — POST /calibration/recompute → GET /calibration
  round-trip, POST /data-truth/checks red trip surfaces kill-switch,
  POST /dna/{id}/rebuild on empty strategy emits 20-cell skeleton.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.learning.calibration import (
    CALIBRATION_BIN_COUNT,
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
    aggregate_data_truth,
    classify_data_truth_status,
    evaluate_kill_switch,
)
from app.learning.dna import (
    SESSIONS,
    build_dna_grid,
    select_best_cell,
    select_worst_cell,
)
from app.learning.regime import (
    REGIME_KINDS,
    RegimeFeatures,
    classify_regime,
    regime_confidence,
)
from app.models import (
    MarketSymbol,
    RecallTrade,
    Strategy,
    User,
)
from app.security import hash_password


UTC = timezone.utc


# ──────────────────────────── helpers ──────────────────────────────────


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


async def _ensure_symbol(db: AsyncSession, symbol_id: str) -> None:
    existing = await db.get(MarketSymbol, symbol_id)
    if existing is not None:
        return
    db.add(
        MarketSymbol(
            id=symbol_id,
            broker_symbol=symbol_id,
            display_symbol=symbol_id,
            exchange="TEST",
            asset_class="crypto",
            status="active",
            price_decimals=2,
            tick_size=0.01,
            lot_size=1.0,
        )
    )
    await db.flush()


async def _seed_strategy(
    db: AsyncSession, *, name: str, setup_type: str = "liquidity_sweep_reclaim"
) -> Strategy:
    strat = Strategy(
        name=name,
        description="test",
        setup_type=setup_type,
        current_tier="C",
        current_state="experimental",
    )
    db.add(strat)
    await db.flush()
    return strat


async def _seed_viewer_user(db: AsyncSession) -> dict[str, Any]:
    password = "viewer-pass-123"
    user = User(
        id=f"usr_{uuid.uuid4().hex}",
        email="viewer@godsview.io",
        display_name="Viewer",
        password_hash=hash_password(password),
        roles=["viewer"],
        mfa_enabled=False,
        disabled=False,
    )
    db.add(user)
    await db.commit()
    return {"email": user.email, "password": password, "id": user.id}


async def _seed_calibration_samples(
    db: AsyncSession,
    *,
    strategy_id: str | None = None,
    n_wins: int = 30,
    n_losses: int = 30,
    hi_conf: float = 0.85,
    lo_conf: float = 0.15,
) -> None:
    """Seed closed RecallTrade rows the calibration recompute can consume.

    High-confidence trades win, low-confidence trades lose — this is the
    textbook "well-calibrated" pattern so the bucket fit lands on a
    monotonic curve without the test needing to fake randomness.
    """

    await _ensure_symbol(db, "BTCUSD")
    now = datetime.now(UTC)
    for i in range(n_wins):
        db.add(
            RecallTrade(
                source_kind="setup",
                source_id=f"wn_{i}_{uuid.uuid4().hex[:6]}",
                symbol_id="BTCUSD",
                tf="1h",
                setup_type="liquidity_sweep_reclaim",
                direction="long",
                entry_ts=now - timedelta(hours=i + 2),
                exit_ts=now - timedelta(hours=i + 1),
                entry_price=40000.0,
                exit_price=40500.0,
                stop_loss=39800.0,
                take_profit=40500.0,
                pnl_r=1.5,
                outcome="win",
                regime="trending",
                session="ny_am",
                confidence_at_detection=hi_conf,
                strategy_id=strategy_id,
            )
        )
    for i in range(n_losses):
        db.add(
            RecallTrade(
                source_kind="setup",
                source_id=f"ls_{i}_{uuid.uuid4().hex[:6]}",
                symbol_id="BTCUSD",
                tf="1h",
                setup_type="liquidity_sweep_reclaim",
                direction="long",
                entry_ts=now - timedelta(hours=i + 2),
                exit_ts=now - timedelta(hours=i + 1),
                entry_price=40000.0,
                exit_price=39800.0,
                stop_loss=39800.0,
                take_profit=40500.0,
                pnl_r=-1.0,
                outcome="loss",
                regime="trending",
                session="ny_am",
                confidence_at_detection=lo_conf,
                strategy_id=strategy_id,
            )
        )
    await db.flush()


# ═══════════════════════ pure calibration tests ═══════════════════════


def test_bucket_calibrator_is_deterministic() -> None:
    """Same samples → bit-identical bin list."""

    samples = CalibrationSamples(
        raw_scores=[0.1, 0.2, 0.3, 0.7, 0.8, 0.9],
        outcomes=[0, 0, 0, 1, 1, 1],
    )
    a = fit_bucket_calibrator(samples)
    b = fit_bucket_calibrator(samples)
    assert len(a) == CALIBRATION_BIN_COUNT
    assert a == b


def test_bucket_calibrator_empty_bins_fallback_to_midpoint() -> None:
    """A bin with zero samples gets the bin midpoint as its calibrated value."""

    samples = CalibrationSamples(raw_scores=[0.05], outcomes=[0])
    bins = fit_bucket_calibrator(samples, bin_count=10)
    # Only bin 0 has a sample — bins 1..9 should carry their midpoint.
    for i, b in enumerate(bins):
        if b.count == 0:
            assert b.calibrated == pytest.approx((b.raw_low + b.raw_high) / 2)


def test_bucket_calibrator_reflects_empirical_win_rate() -> None:
    samples = CalibrationSamples(
        raw_scores=[0.75, 0.76, 0.77, 0.78],  # all land in bin 7 [0.7, 0.8)
        outcomes=[1, 1, 0, 1],
    )
    bins = fit_bucket_calibrator(samples)
    target_bin = bins[7]
    assert target_bin.count == 4
    assert target_bin.wins == 3
    assert target_bin.calibrated == pytest.approx(0.75)


def test_predict_calibrated_respects_bin_edges() -> None:
    samples = CalibrationSamples(
        raw_scores=[0.15, 0.85], outcomes=[0, 1]
    )
    bins = fit_bucket_calibrator(samples)
    # 0.0 → bin 0 empty → midpoint = 0.05
    assert predict_calibrated(0.0, bins) == pytest.approx(0.05)
    # 1.0 → last bin (closed on the right).
    v = predict_calibrated(1.0, bins)
    assert 0.0 <= v <= 1.0


def test_ece_and_brier_bounds() -> None:
    """Both metrics must sit in [0, 1]."""

    samples = CalibrationSamples(
        raw_scores=[0.1, 0.5, 0.9] * 10,
        outcomes=[0, 1, 1] * 10,
    )
    e = ece_score(samples)
    preds = [predict_calibrated(s, fit_bucket_calibrator(samples)) for s in samples.raw_scores]
    b = brier_score(preds, samples.outcomes)
    assert 0.0 <= e <= 1.0
    assert 0.0 <= b <= 1.0


def test_ece_empty_is_zero() -> None:
    samples = CalibrationSamples(raw_scores=[], outcomes=[])
    assert ece_score(samples) == 0.0


def test_brier_mismatched_lengths_raises() -> None:
    with pytest.raises(ValueError):
        brier_score([0.1, 0.2], [1])


def test_platt_calibrator_converges_on_separable_samples() -> None:
    """Perfectly-separable samples → a monotonic sigmoid."""

    raw = [0.05] * 10 + [0.95] * 10
    outcomes = [0] * 10 + [1] * 10
    a, b = fit_platt_calibrator(CalibrationSamples(raw_scores=raw, outcomes=outcomes))
    low = platt_predict(0.05, a, b)
    high = platt_predict(0.95, a, b)
    assert 0.0 <= low <= 1.0
    assert 0.0 <= high <= 1.0
    # Monotonicity — high-confidence samples must predict higher.
    assert high > low


def test_platt_calibrator_rejects_empty() -> None:
    with pytest.raises(ValueError):
        fit_platt_calibrator(CalibrationSamples(raw_scores=[], outcomes=[]))


def test_calibration_samples_validates_inputs() -> None:
    with pytest.raises(ValueError):
        CalibrationSamples(raw_scores=[0.1, 0.2], outcomes=[1])
    with pytest.raises(ValueError):
        CalibrationSamples(raw_scores=[1.5], outcomes=[1])
    with pytest.raises(ValueError):
        CalibrationSamples(raw_scores=[0.5], outcomes=[2])


# ═══════════════════════ pure regime tests ═══════════════════════════


def test_regime_trending_wins_on_strong_trend() -> None:
    f = RegimeFeatures(
        trend_strength=0.9,
        adx=45.0,
        atr_percentile=0.5,
        volatility_percentile=0.55,
        news_pressure=0.1,
    )
    kind, conf = classify_regime(f)
    assert kind == "trending"
    assert 0.0 <= conf <= 1.0


def test_regime_ranging_wins_on_calm_market() -> None:
    f = RegimeFeatures(
        trend_strength=0.05,
        adx=10.0,
        atr_percentile=0.1,
        volatility_percentile=0.1,
        news_pressure=0.05,
    )
    kind, _ = classify_regime(f)
    assert kind == "ranging"


def test_regime_news_driven_wins_when_news_dominates() -> None:
    f = RegimeFeatures(
        trend_strength=0.1,
        adx=20.0,
        atr_percentile=0.9,
        volatility_percentile=0.6,
        news_pressure=0.95,
    )
    kind, _ = classify_regime(f)
    assert kind == "news_driven"


def test_regime_fallback_to_ranging_on_zero_everything() -> None:
    f = RegimeFeatures(
        trend_strength=0.0,
        adx=0.0,
        atr_percentile=0.0,
        volatility_percentile=0.0,
        news_pressure=0.0,
    )
    kind, conf = classify_regime(f)
    # Trend-flat + low-adx + vol-low all emit positive ranging score,
    # so the classifier correctly picks ranging. Confidence must stay
    # in the valid band either way.
    assert kind == "ranging"
    assert 0.0 <= conf <= 1.0


def test_regime_features_validate_ranges() -> None:
    with pytest.raises(ValueError):
        RegimeFeatures(
            trend_strength=2.0,
            adx=20.0,
            atr_percentile=0.5,
            volatility_percentile=0.5,
            news_pressure=0.1,
        )
    with pytest.raises(ValueError):
        RegimeFeatures(
            trend_strength=0.5,
            adx=200.0,
            atr_percentile=0.5,
            volatility_percentile=0.5,
            news_pressure=0.1,
        )
    with pytest.raises(ValueError):
        RegimeFeatures(
            trend_strength=0.5,
            adx=20.0,
            atr_percentile=1.5,
            volatility_percentile=0.5,
            news_pressure=0.1,
        )


def test_regime_confidence_margin_scales_output() -> None:
    scores = {
        "trending": 0.9,
        "ranging": 0.1,
        "volatile": 0.0,
        "news_driven": 0.0,
    }
    high_margin = regime_confidence(scores, "trending")  # big lead
    low_margin = regime_confidence(
        {"trending": 0.5, "ranging": 0.48, "volatile": 0.0, "news_driven": 0.0},
        "trending",
    )
    assert high_margin > low_margin
    assert 0.0 <= high_margin <= 1.0
    assert 0.0 <= low_margin <= 1.0


def test_regime_confidence_unknown_winner_raises() -> None:
    with pytest.raises(ValueError):
        regime_confidence({"trending": 0.5}, "ranging")  # type: ignore[arg-type]


# ═══════════════════════ pure data-truth tests ═══════════════════════


def test_classify_data_truth_status_thresholds() -> None:
    assert classify_data_truth_status(50.0, 100.0, 200.0) == "green"
    assert classify_data_truth_status(100.0, 100.0, 200.0) == "amber"
    assert classify_data_truth_status(150.0, 100.0, 200.0) == "amber"
    assert classify_data_truth_status(200.0, 100.0, 200.0) == "red"
    assert classify_data_truth_status(250.0, 100.0, 200.0) == "red"


def test_classify_data_truth_degrades_when_amber_gt_red() -> None:
    """Swapped thresholds must not produce nonsense — collapse to red threshold."""

    assert classify_data_truth_status(150.0, 200.0, 100.0) in ("red", "amber")


def test_aggregate_worst_of() -> None:
    checks = [
        DataTruthCheckInput(
            kind="bar_latency",
            measurement=50.0,
            amber_threshold=100.0,
            red_threshold=200.0,
        ),
        DataTruthCheckInput(
            kind="bar_gap",
            measurement=150.0,
            amber_threshold=100.0,
            red_threshold=200.0,
        ),
    ]
    overall, verdicts = aggregate_data_truth(checks)
    assert overall == "amber"
    statuses = [s for _, s in verdicts]
    assert statuses == ["green", "amber"]


def test_aggregate_empty_is_green() -> None:
    overall, verdicts = aggregate_data_truth([])
    assert overall == "green"
    assert verdicts == []


def test_kill_switch_trips_on_red() -> None:
    checks = [
        DataTruthCheckInput(
            kind="broker_heartbeat",
            measurement=10_000.0,
            amber_threshold=1_000.0,
            red_threshold=5_000.0,
        ),
    ]
    _, verdicts = aggregate_data_truth(checks)
    tripped, reason = evaluate_kill_switch(verdicts)
    assert tripped is True
    assert reason is not None
    assert "broker_heartbeat" in reason


def test_kill_switch_strict_amber_cluster() -> None:
    checks = [
        DataTruthCheckInput(
            kind="bar_latency",
            measurement=120.0,
            amber_threshold=100.0,
            red_threshold=500.0,
        ),
        DataTruthCheckInput(
            kind="book_staleness",
            measurement=130.0,
            amber_threshold=100.0,
            red_threshold=500.0,
        ),
    ]
    _, verdicts = aggregate_data_truth(checks)
    tripped, reason = evaluate_kill_switch(verdicts, strict=True)
    assert tripped is True
    assert reason is not None
    # Non-strict same cluster → no trip.
    tripped2, reason2 = evaluate_kill_switch(verdicts, strict=False)
    assert tripped2 is False
    assert reason2 is None


# ═══════════════════════ pure DNA grid tests ═════════════════════════


def test_dna_grid_emits_full_20_cells() -> None:
    trades: list[dict[str, Any]] = []
    cells = build_dna_grid(trades)
    assert len(cells) == len(REGIME_KINDS) * len(SESSIONS) == 20
    for c in cells:
        assert c.sample_size == 0
        assert c.win_rate is None
        assert c.mean_r is None


def test_dna_grid_aggregates_trades_per_cell() -> None:
    trades = [
        {"regime": "trending", "session": "ny_am", "win": True, "r": 2.0},
        {"regime": "trending", "session": "ny_am", "win": True, "r": 1.0},
        {"regime": "trending", "session": "ny_am", "win": False, "r": -1.0},
    ]
    cells = build_dna_grid(trades)
    target = next(
        c for c in cells if c.regime == "trending" and c.session == "ny_am"
    )
    assert target.sample_size == 3
    assert target.win_rate == pytest.approx(2 / 3, abs=1e-4)
    assert target.mean_r == pytest.approx(2.0 / 3, abs=1e-4)


def test_dna_grid_skips_invalid_labels() -> None:
    trades = [
        {"regime": "nonsense", "session": "ny_am", "win": True, "r": 1.0},
        {"regime": "trending", "session": "not_a_session", "win": True, "r": 1.0},
    ]
    cells = build_dna_grid(trades)
    for c in cells:
        assert c.sample_size == 0


def test_select_best_and_worst_require_samples() -> None:
    # Grid with one rich cell + one thin cell — only the rich one qualifies.
    trades = [
        {"regime": "trending", "session": "ny_am", "win": True, "r": 2.0},
        {"regime": "trending", "session": "ny_am", "win": True, "r": 1.5},
        {"regime": "trending", "session": "ny_am", "win": False, "r": -0.5},
        {"regime": "ranging", "session": "asia", "win": False, "r": -1.0},
    ]
    cells = build_dna_grid(trades)
    best = select_best_cell(cells)
    worst = select_worst_cell(cells)
    assert best is not None
    assert best.regime == "trending" and best.session == "ny_am"
    # The ranging/asia cell has only 1 sample → doesn't qualify.
    assert worst == best


def test_select_best_none_when_all_thin() -> None:
    trades = [
        {"regime": "trending", "session": "ny_am", "win": True, "r": 1.0},
    ]
    cells = build_dna_grid(trades)
    assert select_best_cell(cells) is None
    assert select_worst_cell(cells) is None


# ═══════════════════════ HTTP auth gates ═════════════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method, path",
    [
        ("GET", "/learning/events"),
        ("GET", "/learning/calibration"),
        ("GET", "/learning/regime"),
        ("GET", "/learning/regime/history?symbolId=BTCUSD&tf=1h"),
        ("GET", "/learning/sessions"),
        ("GET", "/learning/data-truth"),
        ("GET", "/learning/dna"),
    ],
)
async def test_get_endpoints_require_auth(
    client: AsyncClient, method: str, path: str
) -> None:
    res = await client.request(method, path)
    assert res.status_code == 401, res.text


@pytest.mark.asyncio
async def test_post_endpoints_require_auth(client: AsyncClient) -> None:
    res = await client.post("/learning/calibration/recompute", json={})
    assert res.status_code == 401, res.text
    res = await client.post(
        "/learning/data-truth/checks",
        json={
            "kind": "bar_latency",
            "measurement": 50.0,
            "amberThreshold": 100.0,
            "redThreshold": 200.0,
        },
    )
    assert res.status_code == 401, res.text
    res = await client.post("/learning/dna/strat_unknown/rebuild")
    assert res.status_code == 401, res.text


@pytest.mark.asyncio
async def test_post_endpoints_require_admin(
    client: AsyncClient, db: AsyncSession
) -> None:
    viewer = await _seed_viewer_user(db)
    token = await _login(client, viewer["email"], viewer["password"])
    hdrs = {"Authorization": f"Bearer {token}"}

    r1 = await client.post(
        "/learning/calibration/recompute", json={"kind": "bucket"}, headers=hdrs
    )
    assert r1.status_code == 403, r1.text

    r2 = await client.post(
        "/learning/data-truth/checks",
        json={
            "kind": "bar_latency",
            "measurement": 50.0,
            "amberThreshold": 100.0,
            "redThreshold": 200.0,
        },
        headers=hdrs,
    )
    assert r2.status_code == 403, r2.text

    r3 = await client.post(
        "/learning/dna/strat_unknown/rebuild", headers=hdrs
    )
    assert r3.status_code == 403, r3.text


# ═══════════════════════ HTTP validation ════════════════════════════


@pytest.mark.asyncio
async def test_list_events_rejects_invalid_kind(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/learning/events?kind=bogus",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_event_kind"


@pytest.mark.asyncio
async def test_list_events_rejects_invalid_subject_kind(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/learning/events?subjectKind=bogus",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_subject_kind"


@pytest.mark.asyncio
async def test_sessions_rejects_invalid_session(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/learning/sessions?session=pacific",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_session"


@pytest.mark.asyncio
async def test_regime_history_requires_both_symbol_and_tf(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/learning/regime/history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "regime_query_missing"


@pytest.mark.asyncio
async def test_data_truth_rejects_invalid_kind(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/learning/data-truth/checks",
        json={
            "kind": "bogus_kind",
            "measurement": 50.0,
            "amberThreshold": 100.0,
            "redThreshold": 200.0,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_data_truth_kind"


@pytest.mark.asyncio
async def test_data_truth_rejects_inverted_thresholds(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/learning/data-truth/checks",
        json={
            "kind": "bar_latency",
            "measurement": 50.0,
            "amberThreshold": 500.0,
            "redThreshold": 200.0,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_threshold_pair"


@pytest.mark.asyncio
async def test_rebuild_dna_unknown_strategy_returns_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/learning/dna/strat_does_not_exist/rebuild",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "strategy_not_found"


# ═══════════════════════ HTTP happy paths ═══════════════════════════


@pytest.mark.asyncio
async def test_calibration_recompute_then_read_round_trip(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _seed_calibration_samples(db)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    hdrs = {"Authorization": f"Bearer {token}"}

    # Recompute global bucket curve.
    r = await client.post(
        "/learning/calibration/recompute",
        json={"kind": "bucket"},
        headers=hdrs,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["sampleSize"] == 60
    assert body["stored"] is True
    assert body["curve"]["kind"] == "bucket"
    assert len(body["curve"]["bins"]) == CALIBRATION_BIN_COUNT

    # Read the curves back.
    r2 = await client.get("/learning/calibration", headers=hdrs)
    assert r2.status_code == 200, r2.text
    curves = r2.json()["curves"]
    assert len(curves) == 1
    assert curves[0]["sampleSize"] == 60


@pytest.mark.asyncio
async def test_calibration_recompute_falls_back_when_platt_undersampled(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _seed_calibration_samples(db, n_wins=5, n_losses=5)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/learning/calibration/recompute",
        json={"kind": "platt"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 201
    body = res.json()
    # < 50 samples → repo forces bucket fallback.
    assert body["curve"]["kind"] == "bucket"


@pytest.mark.asyncio
async def test_data_truth_write_then_read_reports_kill_switch(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    hdrs = {"Authorization": f"Bearer {token}"}

    # Red check — trips the kill-switch.
    r = await client.post(
        "/learning/data-truth/checks",
        json={
            "kind": "broker_heartbeat",
            "measurement": 20_000.0,
            "amberThreshold": 1_000.0,
            "redThreshold": 5_000.0,
            "message": "lost broker link",
        },
        headers=hdrs,
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "red"

    r2 = await client.get("/learning/data-truth", headers=hdrs)
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["status"] == "red"
    assert body["killSwitchTripped"] is True
    assert body["killSwitchReason"]
    assert len(body["checks"]) == 1


@pytest.mark.asyncio
async def test_regime_current_and_history_are_empty_by_default(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    hdrs = {"Authorization": f"Bearer {token}"}

    r = await client.get("/learning/regime", headers=hdrs)
    assert r.status_code == 200, r.text
    assert r.json()["snapshots"] == []

    r2 = await client.get(
        "/learning/regime/history?symbolId=BTCUSD&tf=1h",
        headers=hdrs,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["snapshots"] == []


@pytest.mark.asyncio
async def test_sessions_empty_by_default(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/learning/sessions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["snapshots"] == []


@pytest.mark.asyncio
async def test_list_events_newest_first_empty(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/learning/events",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json() == {"events": [], "total": 0}


@pytest.mark.asyncio
async def test_recompute_emits_calibration_updated_event(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _seed_calibration_samples(db)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    hdrs = {"Authorization": f"Bearer {token}"}
    r = await client.post(
        "/learning/calibration/recompute",
        json={"kind": "bucket"},
        headers=hdrs,
    )
    assert r.status_code == 201

    r2 = await client.get("/learning/events?kind=calibration_updated", headers=hdrs)
    assert r2.status_code == 200
    body = r2.json()
    assert body["total"] >= 1
    evt = body["events"][0]
    assert evt["kind"] == "calibration_updated"
    assert evt["subjectKind"] == "calibration"


@pytest.mark.asyncio
async def test_rebuild_dna_on_empty_strategy_returns_skeleton(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    strat = await _seed_strategy(db, name="empty-dna-strat")
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    hdrs = {"Authorization": f"Bearer {token}"}
    res = await client.post(
        f"/learning/dna/{strat.id}/rebuild",
        headers=hdrs,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["strategyId"] == strat.id
    assert len(body["cells"]) == 20
    assert body["totalTrades"] == 0
    assert body["bestCell"] is None
    assert body["worstCell"] is None


@pytest.mark.asyncio
async def test_list_dna_emits_skeleton_for_every_strategy(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _seed_strategy(db, name="skel-a", setup_type="breakout_retest")
    await _seed_strategy(db, name="skel-b", setup_type="ob_retest")
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/learning/dna", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["dna"]) == 2
    for entry in body["dna"]:
        assert len(entry["cells"]) == 20
        assert entry["totalTrades"] == 0
