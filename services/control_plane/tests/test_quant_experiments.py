"""Tests for /v1/quant — Phase 5 PR6 experiments + ranking + promotion.

Covers:

* Pure ranking math — classifier + composite score deterministic on
  replays.
* POST /quant/experiments — admin gate, unknown strategy 404, draft
  lifecycle, attach/detach, complete with winner validation.
* POST /quant/rankings/recompute — admin gate, deterministic tiering,
  mirror onto Strategy.current_tier.
* GET /quant/rankings + /rankings/history — read surfaces.
* POST /quant/strategies/{id}/promote — admin gate, FSM enforcement
  (adjacent forward hops, tier ceiling, retire-from-experimental).
* POST /quant/strategies/{id}/demote — admin gate, any-rung demote.
* Promotion history audit log — per-strategy immutable event stream.

Determinism contract
--------------------
Two calls to :func:`score_metrics` on the same metrics envelope must
return identical tier + composite_score + rationale. That pins down
the contract the nightly ranking cron depends on.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BacktestRun,
    PromotionEvent,
    Strategy,
    StrategyVersion,
)
from app.quant_lab import (
    BacktestMetricsDto,
    InvalidPromotionError,
    TierThresholds,
    classify_tier,
    compute_composite_score,
    compute_transition,
    score_metrics,
)

UTC = timezone.utc


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


# ─────────────────────────── pure math tests ────────────────────────────


def _metrics_envelope(**overrides: Any) -> BacktestMetricsDto:
    base = {
        "totalTrades": 80,
        "wins": 50,
        "losses": 28,
        "scratches": 2,
        "winRate": 0.625,
        "profitFactor": 2.1,
        "expectancyR": 0.35,
        "sharpe": 1.8,
        "sortino": 2.2,
        "maxDrawdownR": -2.2,
        "meanMAER": -0.4,
        "meanMFER": 0.8,
        "totalR": 28.0,
        "startedAt": datetime(2026, 1, 1, tzinfo=UTC),
        "endedAt": datetime(2026, 3, 1, tzinfo=UTC),
    }
    base.update(overrides)
    return BacktestMetricsDto.model_validate(base)


def test_classifier_returns_a_for_strong_metrics() -> None:
    metrics = _metrics_envelope(
        totalTrades=80, sharpe=2.1, profitFactor=2.4, winRate=0.62, expectancyR=0.55
    )
    score = compute_composite_score(metrics)
    tier = classify_tier(metrics, score)
    assert tier == "A"
    assert score > 0.75


def test_classifier_caps_b_tier_on_sample_size() -> None:
    # Good score but only 10 trades → must stay C-tier
    metrics = _metrics_envelope(
        totalTrades=10, sharpe=2.0, profitFactor=2.2, winRate=0.65, expectancyR=0.45
    )
    score = compute_composite_score(metrics)
    tier = classify_tier(metrics, score)
    assert tier == "C"


def test_classifier_loose_thresholds_allows_b() -> None:
    metrics = _metrics_envelope(
        totalTrades=15,
        sharpe=1.1,
        profitFactor=1.6,
        winRate=0.52,
        expectancyR=0.3,
        maxDrawdownR=-1.5,
    )
    loose = TierThresholds(
        a_score=0.9, a_min_trades=60, a_max_drawdown_r=-3.0,
        b_score=0.45, b_min_trades=10,
    )
    score = compute_composite_score(metrics)
    tier = classify_tier(metrics, score, thresholds=loose)
    assert tier == "B"


def test_score_metrics_is_deterministic() -> None:
    metrics = _metrics_envelope()
    a = score_metrics(metrics)
    b = score_metrics(metrics)
    assert a.tier == b.tier
    assert a.composite_score == b.composite_score
    assert a.rationale == b.rationale


def test_score_metrics_live_only_upgrades() -> None:
    lab = _metrics_envelope(sharpe=1.5, profitFactor=1.8, winRate=0.55, expectancyR=0.25)
    live_better = _metrics_envelope(
        totalTrades=90, sharpe=2.5, profitFactor=3.0, winRate=0.68, expectancyR=0.6
    )
    live_worse = _metrics_envelope(
        totalTrades=90, sharpe=0.5, profitFactor=1.1, winRate=0.45, expectancyR=0.05
    )
    upgraded = score_metrics(lab, live_metrics=live_better)
    held = score_metrics(lab, live_metrics=live_worse)
    assert upgraded.composite_score >= held.composite_score
    # live_worse should not drag below lab-only score
    lab_only = score_metrics(lab)
    assert held.composite_score == lab_only.composite_score


# ─────────────────────────── FSM tests ──────────────────────────────────


def test_fsm_rejects_non_adjacent_promotion() -> None:
    with pytest.raises(InvalidPromotionError) as exc:
        compute_transition("experimental", "assisted_live", "A")
    assert exc.value.code == "non_adjacent_promotion"


def test_fsm_allows_adjacent_promotion_on_a_tier() -> None:
    assert compute_transition("experimental", "paper", "A") == "paper"
    assert compute_transition("paper", "assisted_live", "A") == "assisted_live"
    assert compute_transition("assisted_live", "autonomous", "A") == "autonomous"


def test_fsm_caps_b_tier_at_paper() -> None:
    assert compute_transition("experimental", "paper", "B") == "paper"
    with pytest.raises(InvalidPromotionError) as exc:
        compute_transition("paper", "assisted_live", "B")
    assert exc.value.code == "tier_ceiling"


def test_fsm_allows_any_rung_demote() -> None:
    assert compute_transition("autonomous", "experimental", "A") == "experimental"
    assert compute_transition("autonomous", "paper", "A") == "paper"
    assert compute_transition("assisted_live", "experimental", "A") == "experimental"


def test_fsm_retire_requires_experimental() -> None:
    assert compute_transition("experimental", "retired", "C") == "retired"
    with pytest.raises(InvalidPromotionError) as exc:
        compute_transition("paper", "retired", "A")
    assert exc.value.code == "retire_requires_experimental"


def test_fsm_rejects_same_state() -> None:
    with pytest.raises(InvalidPromotionError) as exc:
        compute_transition("paper", "paper", "A")
    assert exc.value.code == "same_state"


# ─────────────────────────── HTTP fixtures ──────────────────────────────


def _sid() -> str:
    return f"sym_{uuid.uuid4().hex}"


def _strategy_payload(setup_type: str = "ob_retest") -> dict[str, Any]:
    return {
        "name": f"Exp Strategy {uuid.uuid4().hex[:6]}",
        "description": "experiment fixture",
        "setupType": setup_type,
        "initialVersion": {
            "entry": {
                "setupType": setup_type,
                "timeframes": ["1h"],
                "minConfidence": 0.5,
                "filters": {},
            },
            "exit": {
                "stopStyle": "atr",
                "takeProfitRR": 2.0,
                "trailAfterR": None,
            },
            "sizing": {"perTradeR": 0.005, "maxConcurrent": 5},
            "codeHash": f"hash_{uuid.uuid4().hex[:8]}",
            "notes": "exp fixture",
        },
    }


@pytest_asyncio.fixture()
async def seeded_strategy(
    db: AsyncSession, admin_user: dict[str, Any]
) -> dict[str, Any]:
    """Insert a strategy + active version directly through the ORM to
    keep the fixture independent of the /quant/strategies HTTP surface.
    """

    now = datetime.now(UTC)
    strategy_id = f"stg_{uuid.uuid4().hex}"
    version_id = f"stv_{uuid.uuid4().hex}"
    db.add(
        Strategy(
            id=strategy_id,
            name=f"seed-strategy-{uuid.uuid4().hex[:6]}",
            description="",
            setup_type="ob_retest",
            active_version_id=version_id,
            current_tier="C",
            current_state="experimental",
            created_at=now,
            updated_at=now,
            created_by_user_id=admin_user["id"],
        )
    )
    db.add(
        StrategyVersion(
            id=version_id,
            strategy_id=strategy_id,
            version=1,
            code_hash=f"hash_{uuid.uuid4().hex[:8]}",
            config={
                "entry": {
                    "setupType": "ob_retest",
                    "timeframes": ["1h"],
                    "minConfidence": 0.5,
                    "filters": {},
                },
                "exit": {"stopStyle": "atr", "takeProfitRR": 2.0, "trailAfterR": None},
                "sizing": {"perTradeR": 0.005, "maxConcurrent": 5},
            },
            notes="",
            created_at=now,
            created_by_user_id=admin_user["id"],
        )
    )
    await db.commit()
    return {"strategyId": strategy_id, "versionId": version_id}


async def _seed_backtest_run(
    db: AsyncSession,
    *,
    strategy_id: str,
    version_id: str,
    admin_id: str,
    metrics: dict[str, Any] | None = None,
    status_value: str = "completed",
) -> str:
    """Insert a ``BacktestRun`` row directly so tests can exercise the
    experiment + ranking surfaces without running the full engine.
    """

    run_id = f"bkt_{uuid.uuid4().hex}"
    now = datetime.now(UTC)
    metrics_payload = metrics if metrics is not None else {
        "totalTrades": 80,
        "wins": 50,
        "losses": 28,
        "scratches": 2,
        "winRate": 0.625,
        "profitFactor": 2.1,
        "expectancyR": 0.35,
        "sharpe": 1.8,
        "sortino": 2.2,
        "maxDrawdownR": -2.2,
        "meanMAER": -0.4,
        "meanMFER": 0.8,
        "totalR": 28.0,
        "startedAt": (now - timedelta(days=60)).isoformat(),
        "endedAt": now.isoformat(),
        "startingEquity": 100_000.0,
    }
    db.add(
        BacktestRun(
            id=run_id,
            strategy_id=strategy_id,
            version_id=version_id,
            status=status_value,
            requested_by_user_id=admin_id,
            symbol_ids=[f"sym_{uuid.uuid4().hex}"],
            tf="1h",
            from_ts=now - timedelta(days=60),
            to_ts=now,
            slippage_bps=2.0,
            spread_bps=0.0,
            latency_ms=100,
            commission_per_share=0.0,
            seed=0,
            requested_at=now - timedelta(hours=1),
            started_at=now - timedelta(hours=1),
            completed_at=now,
            metrics=metrics_payload,
        )
    )
    await db.commit()
    return run_id


# ─────────────────────────── experiment HTTP tests ──────────────────────


@pytest.mark.asyncio
async def test_create_experiment_requires_admin(client: AsyncClient) -> None:
    res = await client.post(
        "/quant/experiments",
        json={"name": "anon", "strategyId": "stg_anon", "hypothesis": ""},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_experiment_unknown_strategy(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    res = await client.post(
        "/quant/experiments",
        json={"name": "ghost", "strategyId": "stg_missing", "hypothesis": ""},
        headers=headers,
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "strategy_not_found"


@pytest.mark.asyncio
async def test_experiment_full_lifecycle(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_strategy: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}

    # Seed two backtest runs owned by the same strategy
    run_a = await _seed_backtest_run(
        db,
        strategy_id=seeded_strategy["strategyId"],
        version_id=seeded_strategy["versionId"],
        admin_id=admin_user["id"],
    )
    run_b = await _seed_backtest_run(
        db,
        strategy_id=seeded_strategy["strategyId"],
        version_id=seeded_strategy["versionId"],
        admin_id=admin_user["id"],
        metrics={
            "totalTrades": 50,
            "wins": 25,
            "losses": 24,
            "scratches": 1,
            "winRate": 0.5,
            "profitFactor": 1.3,
            "expectancyR": 0.1,
            "sharpe": 0.8,
            "sortino": 1.0,
            "maxDrawdownR": -3.5,
            "meanMAER": -0.5,
            "meanMFER": 0.6,
            "totalR": 5.0,
            "startedAt": datetime(2026, 1, 1, tzinfo=UTC).isoformat(),
            "endedAt": datetime(2026, 3, 1, tzinfo=UTC).isoformat(),
            "startingEquity": 100_000.0,
        },
    )

    # Create the experiment
    create = await client.post(
        "/quant/experiments",
        json={
            "name": "min confidence sweep",
            "strategyId": seeded_strategy["strategyId"],
            "hypothesis": "Higher minConfidence improves expectancy.",
        },
        headers=headers,
    )
    assert create.status_code == 201, create.text
    exp = create.json()
    assert exp["status"] == "draft"
    assert exp["backtestIds"] == []

    # Attach both runs → status flips to running
    for run_id in (run_a, run_b):
        res = await client.post(
            f"/quant/experiments/{exp['id']}/backtests/{run_id}",
            headers=headers,
        )
        assert res.status_code == 200, res.text
    reloaded = await client.get(
        f"/quant/experiments/{exp['id']}", headers=headers
    )
    body = reloaded.json()
    assert body["status"] == "running"
    assert sorted(body["backtestIds"]) == sorted([run_a, run_b])

    # Detach run_b
    detach = await client.delete(
        f"/quant/experiments/{exp['id']}/backtests/{run_b}", headers=headers
    )
    assert detach.status_code == 200
    assert run_b not in detach.json()["backtestIds"]

    # Complete with winner that IS attached
    complete = await client.post(
        f"/quant/experiments/{exp['id']}/complete",
        json={"winningBacktestId": run_a, "verdict": "A > B"},
        headers=headers,
    )
    assert complete.status_code == 200
    completed = complete.json()
    assert completed["status"] == "completed"
    assert completed["winningBacktestId"] == run_a
    assert completed["verdict"] == "A > B"

    # Double-complete is a 409
    again = await client.post(
        f"/quant/experiments/{exp['id']}/complete",
        json={"winningBacktestId": run_a, "verdict": "still A > B"},
        headers=headers,
    )
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_complete_requires_attached_winner(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_strategy: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    run_a = await _seed_backtest_run(
        db,
        strategy_id=seeded_strategy["strategyId"],
        version_id=seeded_strategy["versionId"],
        admin_id=admin_user["id"],
    )
    # Create experiment but never attach run_a
    create = await client.post(
        "/quant/experiments",
        json={
            "name": "floating winner",
            "strategyId": seeded_strategy["strategyId"],
        },
        headers=headers,
    )
    exp = create.json()
    res = await client.post(
        f"/quant/experiments/{exp['id']}/complete",
        json={"winningBacktestId": run_a, "verdict": "bogus"},
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "winning_backtest_not_attached"


# ─────────────────────────── ranking HTTP tests ─────────────────────────


@pytest.mark.asyncio
async def test_recompute_rankings_requires_admin(client: AsyncClient) -> None:
    res = await client.post("/quant/rankings/recompute")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_recompute_rankings_empty_cohort(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    res = await client.post("/quant/rankings/recompute", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["rankings"] == []


@pytest.mark.asyncio
async def test_recompute_rankings_tiers_and_mirrors(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_strategy: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}

    # Strong metrics so the strategy should tier up to A (≥60 trades,
    # score >= 0.75, drawdown >= -3.0).
    await _seed_backtest_run(
        db,
        strategy_id=seeded_strategy["strategyId"],
        version_id=seeded_strategy["versionId"],
        admin_id=admin_user["id"],
        metrics={
            "totalTrades": 120,
            "wins": 80,
            "losses": 38,
            "scratches": 2,
            "winRate": 0.67,
            "profitFactor": 2.6,
            "expectancyR": 0.55,
            "sharpe": 2.2,
            "sortino": 2.8,
            "maxDrawdownR": -1.8,
            "meanMAER": -0.3,
            "meanMFER": 0.9,
            "totalR": 66.0,
            "startedAt": datetime(2026, 1, 1, tzinfo=UTC).isoformat(),
            "endedAt": datetime(2026, 3, 1, tzinfo=UTC).isoformat(),
            "startingEquity": 100_000.0,
        },
    )

    res = await client.post("/quant/rankings/recompute", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["rankings"]) == 1
    entry = body["rankings"][0]
    assert entry["tier"] == "A"
    assert entry["rank"] == 1
    assert entry["strategyId"] == seeded_strategy["strategyId"]

    # Strategy.current_tier must be mirrored.
    strategy_res = await client.get(
        f"/quant/strategies/{seeded_strategy['strategyId']}", headers=headers
    )
    assert strategy_res.json()["tier"] == "A"

    # GET /quant/rankings returns the same snapshot we just wrote.
    latest = await client.get("/quant/rankings", headers=headers)
    assert latest.status_code == 200
    assert latest.json()["rankings"][0]["tier"] == "A"

    # History endpoint returns exactly one row for this strategy.
    history = await client.get(
        f"/quant/rankings/history?strategyId={seeded_strategy['strategyId']}",
        headers=headers,
    )
    assert history.status_code == 200
    rows = history.json()["rankings"]
    assert len(rows) == 1
    assert rows[0]["tier"] == "A"


# ─────────────────────────── promotion HTTP tests ───────────────────────


@pytest.mark.asyncio
async def test_promote_requires_admin(
    client: AsyncClient, seeded_strategy: dict[str, Any]
) -> None:
    res = await client.post(
        f"/quant/strategies/{seeded_strategy['strategyId']}/promote",
        json={"targetState": "paper", "reason": "noauth"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_promote_rejects_non_adjacent(
    client: AsyncClient, admin_user: dict[str, Any], seeded_strategy: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    res = await client.post(
        f"/quant/strategies/{seeded_strategy['strategyId']}/promote",
        json={"targetState": "autonomous", "reason": "jumping"},
        headers=headers,
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "non_adjacent_promotion"


@pytest.mark.asyncio
async def test_promote_paper_then_demote_all_the_way(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_strategy: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}

    # Upgrade tier to A directly so the FSM lets us climb all the way.
    strategy_id = seeded_strategy["strategyId"]
    strategy = await db.scalar(
        Strategy.__table__.select().where(Strategy.id == strategy_id)
    )
    # Use ORM update path to keep updated_at coherent.
    from sqlalchemy import update as sa_update
    await db.execute(
        sa_update(Strategy).where(Strategy.id == strategy_id).values(current_tier="A")
    )
    await db.commit()

    steps = [
        ("paper", "promote"),
        ("assisted_live", "promote"),
        ("autonomous", "promote"),
    ]
    for target, action in steps:
        res = await client.post(
            f"/quant/strategies/{strategy_id}/{action}",
            json={"targetState": target, "reason": f"auto-{target}"},
            headers=headers,
        )
        assert res.status_code == 200, res.text
        assert res.json()["promotionState"] == target

    # Demote straight back to experimental in one hop
    res = await client.post(
        f"/quant/strategies/{strategy_id}/demote",
        json={"targetState": "experimental", "reason": "reset"},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["promotionState"] == "experimental"

    # History returns 4 events, newest-first
    hist = await client.get(
        f"/quant/strategies/{strategy_id}/promotion", headers=headers
    )
    assert hist.status_code == 200
    events = hist.json()["events"]
    assert len(events) == 4
    assert events[0]["toState"] == "experimental"
    assert events[-1]["toState"] == "paper"


@pytest.mark.asyncio
async def test_promote_unknown_strategy(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    res = await client.post(
        "/quant/strategies/stg_never_existed/promote",
        json={"targetState": "paper", "reason": "ghost"},
        headers=headers,
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "strategy_not_found"


@pytest.mark.asyncio
async def test_promote_tier_ceiling_blocks_b_tier_from_assisted_live(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_strategy: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    strategy_id = seeded_strategy["strategyId"]

    from sqlalchemy import update as sa_update
    await db.execute(
        sa_update(Strategy)
        .where(Strategy.id == strategy_id)
        .values(current_tier="B", current_state="paper")
    )
    await db.commit()

    res = await client.post(
        f"/quant/strategies/{strategy_id}/promote",
        json={"targetState": "assisted_live", "reason": "over-eager"},
        headers=headers,
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "tier_ceiling"

    # No PromotionEvent should have been created for this illegal hop.
    count = (
        await db.scalars(
            PromotionEvent.__table__.select().where(
                PromotionEvent.strategy_id == strategy_id
            )
        )
    ).all()
    assert count == []
