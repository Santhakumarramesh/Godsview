"""Strategy ranking + promotion FSM — Phase 5 PR6.

The rank-and-promote engine is *pure* on purpose: given a snapshot of
``BacktestMetricsDto`` (lab metrics) and optional live metrics, it
returns a deterministic tier assignment, composite 0..1 score, and
human-readable rationale. That determinism is what the nightly
promotion cron audits against.

──────────────────────────────── Tiering ─────────────────────────────

``composite_score`` blends four dimensions, each capped to [0, 1]:

  * expectancy  — normalised on 0.5R (≥ 0.5R  → 1.0)
  * sharpe      — normalised on 2.0     (≥ 2.0    → 1.0)
  * profitFactor- normalised on 2.0     (≥ 2.0    → 1.0)
  * winRate     - normalised on 0.6     (≥ 0.6    → 1.0)

Equal weights (0.25 each) — deliberately simple + auditable. The bias
against over-fit strategies comes from the sample-size gate below.

After scoring, the classifier applies:

  * tier A ⇐ score ≥ 0.75 AND totalTrades ≥ 60 AND maxDrawdownR ≥ -3.0
  * tier B ⇐ score ≥ 0.55 AND totalTrades ≥ 30
  * otherwise tier C

These thresholds are conservative on purpose — the pipeline can be
eased per-cohort later by passing a custom :class:`TierThresholds`.

───────────────────────── Promotion FSM ───────────────────────────────

States:  experimental → paper → assisted_live → autonomous
              ↑                                      │
              └──────────────  retired  ◀────────────┘

Rules:
  * only adjacent forward hops are allowed (experimental→paper, …)
  * any state can demote back one notch or straight to ``experimental``
  * ``retired`` is a sink — reached only from ``experimental``; leaves
    the strategy frozen until operators re-draft it.
  * an A-tier strategy gates assisted_live + autonomous; B-tier is
    capped at ``paper``; C-tier must stay at ``experimental``.

``compute_transition(from_state, to_state, tier)`` returns the
validated target state or raises :class:`InvalidPromotionError`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from app.quant_lab.experiment_types import (
    ExperimentStatusLiteral,  # noqa: F401  (re-export for typing parity)
    StrategyRankingDto,
)
from app.quant_lab.types import (
    BacktestMetricsDto,
    PromotionStateLiteral,
    StrategyTierLiteral,
)

__all__ = [
    "InvalidPromotionError",
    "PROMOTION_STATES",
    "RankingOutcome",
    "TierThresholds",
    "classify_tier",
    "compute_composite_score",
    "compute_transition",
    "score_metrics",
    "rank_strategies",
]


# ───────────────────────── configuration ──────────────────────────────


@dataclass(frozen=True, slots=True)
class TierThresholds:
    """Tunable knobs for :func:`classify_tier`.

    Defaults are the conservative production values — tests can pass
    a loosened bundle to avoid seeding 60+ trades.
    """

    a_score: float = 0.75
    a_min_trades: int = 60
    a_max_drawdown_r: float = -3.0

    b_score: float = 0.55
    b_min_trades: int = 30


DEFAULT_THRESHOLDS = TierThresholds()


PROMOTION_STATES: tuple[PromotionStateLiteral, ...] = (
    "experimental",
    "paper",
    "assisted_live",
    "autonomous",
    "retired",
)

# Forward progression. Last element has no successor.
_FORWARD: dict[PromotionStateLiteral, PromotionStateLiteral | None] = {
    "experimental": "paper",
    "paper": "assisted_live",
    "assisted_live": "autonomous",
    "autonomous": None,
    "retired": None,
}

# Highest state allowed *at or below* the given tier.
_TIER_CEILING: dict[StrategyTierLiteral, PromotionStateLiteral] = {
    "A": "autonomous",
    "B": "paper",
    "C": "experimental",
}


class InvalidPromotionError(ValueError):
    """Raised when a requested FSM transition is not legal.

    Carries a machine-readable ``code`` so the route can surface a
    4xx without parsing the message.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ───────────────────────── scoring ────────────────────────────────────


def _clip(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    if value != value:  # NaN guard
        return lo
    return max(lo, min(hi, value))


def _normalise(value: float, target: float) -> float:
    """Linear 0..1 normalisation — saturates at ``target``.

    Negative values clip to 0 so a losing strategy can't borrow credit
    from the composite score.
    """

    if target <= 0.0:
        return 0.0
    return _clip(value / target)


def compute_composite_score(metrics: BacktestMetricsDto) -> float:
    """Blend the 4 core metrics into a 0..1 composite."""

    expectancy_part = _normalise(metrics.expectancyR, 0.5)
    sharpe_part = _normalise(metrics.sharpe, 2.0)
    pf_part = _normalise(metrics.profitFactor, 2.0)
    wr_part = _normalise(metrics.winRate, 0.6)

    # Equal weights — keeps the scoring easy to reason about in audit.
    score = (expectancy_part + sharpe_part + pf_part + wr_part) / 4.0
    return _clip(score)


def classify_tier(
    metrics: BacktestMetricsDto,
    score: float,
    *,
    thresholds: TierThresholds = DEFAULT_THRESHOLDS,
) -> StrategyTierLiteral:
    """Return the A/B/C tier for the given metrics + composite score."""

    if (
        score >= thresholds.a_score
        and metrics.totalTrades >= thresholds.a_min_trades
        and metrics.maxDrawdownR >= thresholds.a_max_drawdown_r
    ):
        return "A"
    if (
        score >= thresholds.b_score
        and metrics.totalTrades >= thresholds.b_min_trades
    ):
        return "B"
    return "C"


def _rationale(
    tier: StrategyTierLiteral,
    score: float,
    metrics: BacktestMetricsDto,
    *,
    has_live: bool,
) -> str:
    suffix = " (live metrics applied)" if has_live else ""
    return (
        f"tier {tier} @ score {score:.3f}: "
        f"expectancyR={metrics.expectancyR:.3f}, "
        f"sharpe={metrics.sharpe:.2f}, "
        f"PF={metrics.profitFactor:.2f}, "
        f"WR={metrics.winRate:.2%}, "
        f"trades={metrics.totalTrades}, "
        f"maxDD={metrics.maxDrawdownR:.2f}R"
        f"{suffix}"
    )


@dataclass(frozen=True, slots=True)
class RankingOutcome:
    """Deterministic output of :func:`score_metrics`.

    ``best`` is the metrics envelope that drove the ranking (either the
    supplied lab metrics, or the live metrics if present and they beat
    the lab score). ``live`` echoes any live metrics back for audit.
    """

    tier: StrategyTierLiteral
    composite_score: float
    best: BacktestMetricsDto
    live: BacktestMetricsDto | None
    rationale: str


def score_metrics(
    lab_metrics: BacktestMetricsDto,
    *,
    live_metrics: BacktestMetricsDto | None = None,
    thresholds: TierThresholds = DEFAULT_THRESHOLDS,
) -> RankingOutcome:
    """Combine lab + live metrics into a RankingOutcome.

    When live metrics are present, the higher composite score wins —
    live only ever *upgrades* a tier, never downgrades it. A separate
    calibration job demotes strategies whose live metrics drift.
    """

    lab_score = compute_composite_score(lab_metrics)
    best_metrics = lab_metrics
    best_score = lab_score

    if live_metrics is not None:
        live_score = compute_composite_score(live_metrics)
        if live_score > best_score:
            best_metrics = live_metrics
            best_score = live_score

    tier = classify_tier(best_metrics, best_score, thresholds=thresholds)
    rationale = _rationale(
        tier, best_score, best_metrics, has_live=live_metrics is not None
    )
    return RankingOutcome(
        tier=tier,
        composite_score=best_score,
        best=best_metrics,
        live=live_metrics,
        rationale=rationale,
    )


def rank_strategies(
    outcomes: Iterable[tuple[str, RankingOutcome]],
) -> list[tuple[str, RankingOutcome, int]]:
    """Attach a 1-based rank to each (strategy_id, outcome) pair.

    Tie-break is deterministic by strategy_id so the output is stable
    across reruns.
    """

    items = list(outcomes)
    items.sort(
        key=lambda it: (-it[1].composite_score, it[0])
    )
    return [(sid, outcome, idx + 1) for idx, (sid, outcome) in enumerate(items)]


# ───────────────────────── FSM ────────────────────────────────────────


def _tier_allows(target: PromotionStateLiteral, tier: StrategyTierLiteral) -> bool:
    if target == "retired" or target == "experimental":
        return True  # demotion is always allowed regardless of tier
    ceiling = _TIER_CEILING[tier]
    # autonomous > assisted_live > paper > experimental
    order = {"experimental": 0, "paper": 1, "assisted_live": 2, "autonomous": 3}
    return order[target] <= order[ceiling]


def compute_transition(
    from_state: PromotionStateLiteral,
    to_state: PromotionStateLiteral,
    tier: StrategyTierLiteral,
) -> PromotionStateLiteral:
    """Validate a promotion/demotion request — returns the target state
    on success, raises :class:`InvalidPromotionError` otherwise.
    """

    if from_state not in PROMOTION_STATES:
        raise InvalidPromotionError(
            "invalid_from_state",
            f"unknown current state {from_state!r}",
        )
    if to_state not in PROMOTION_STATES:
        raise InvalidPromotionError(
            "invalid_to_state",
            f"unknown target state {to_state!r}",
        )
    if to_state == from_state:
        raise InvalidPromotionError(
            "same_state",
            f"strategy is already in {from_state!r}",
        )

    # Demotion path — always legal to snap back one rung or go to
    # ``experimental``.
    order = {
        "experimental": 0,
        "paper": 1,
        "assisted_live": 2,
        "autonomous": 3,
        "retired": -1,
    }

    if to_state == "retired":
        # Only experimental strategies can retire cleanly — anything
        # live has to demote step-by-step first.
        if from_state != "experimental":
            raise InvalidPromotionError(
                "retire_requires_experimental",
                "strategies must be demoted to 'experimental' before retirement",
            )
        return "retired"

    if order.get(to_state, -99) < order.get(from_state, -99):
        # demotion — any rung down at once is allowed
        return to_state

    # Forward hop — must be adjacent AND allowed by tier.
    expected_next = _FORWARD.get(from_state)
    if expected_next != to_state:
        raise InvalidPromotionError(
            "non_adjacent_promotion",
            f"cannot promote {from_state!r} directly to {to_state!r}",
        )
    if not _tier_allows(to_state, tier):
        raise InvalidPromotionError(
            "tier_ceiling",
            f"tier {tier!r} does not permit {to_state!r}",
        )
    return to_state


# ───────────────────────── ranking DTO builder ────────────────────────


def outcome_to_ranking_dto(
    *,
    ranking_id: str,
    strategy_id: str,
    outcome: RankingOutcome,
    rank: int,
    ranked_at,
) -> StrategyRankingDto:
    """Turn a :class:`RankingOutcome` into the wire DTO. Separated from
    the pure scorer so tests can assert on the pure path without dragging
    in timestamps.
    """

    return StrategyRankingDto(
        id=ranking_id,
        strategyId=strategy_id,
        tier=outcome.tier,
        compositeScore=outcome.composite_score,
        bestMetrics=outcome.best,
        liveMetrics=outcome.live,
        rank=rank,
        rationale=outcome.rationale,
        rankedAt=ranked_at,
    )
