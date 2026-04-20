"""Rebalance plan synthesis — pure logic + persistence mappers.

The planner reads:

  * ``AllocationPlanRow`` targets for (account, strategy)
  * ``Position`` rows (open) for (account, strategy via setup, symbol)
  * latest equity snapshot for the account
  * mark price per symbol

and decides which (strategy, symbol) legs have drifted from their
target by more than the configured band. It emits one ``PlanIntent``
per leg, a rollup ``PlanDraft`` with aggregate metrics, and a list of
``PlanWarning`` envelopes the governance surface renders.

The planner is deliberately pure — it consumes already-loaded data +
knobs and returns data classes. The route + cron wire it to SQLAlchemy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from app.models import (
    RebalanceIntentRow,
    RebalancePlanRow,
)


# ─────────────────────────── data classes ───────────────────────────


PlanSide = Literal["long", "short", "flat"]
PlanWarningCode = Literal[
    "target_sum_out_of_band",
    "correlated_exposure_breach",
    "single_symbol_concentration",
    "liquidity_warning",
    "venue_latency_degraded",
    "broker_quorum_insufficient",
    "kill_switch_active",
]
PlanWarningSeverity = Literal["info", "warn", "critical"]


@dataclass
class PlanWarning:
    """One policy-breach warning attached to a plan draft."""

    code: PlanWarningCode
    severity: PlanWarningSeverity
    message: str
    subject_key: str | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "subjectKey": self.subject_key,
        }


@dataclass
class PlanIntent:
    """One (strategy, symbol) leg the plan will adjust."""

    strategy_id: str
    symbol_id: str
    correlation_class: str
    side: PlanSide
    current_notional: float
    target_notional: float
    delta_notional: float
    current_percent: float
    target_percent: float
    delta_percent: float


@dataclass
class PlanDraft:
    """Full rebalance plan draft — the synthesis output."""

    account_id: str
    trigger: str
    initiated_by_user_id: str | None
    reason: str | None
    intents: list[PlanIntent] = field(default_factory=list)
    warnings: list[PlanWarning] = field(default_factory=list)

    @property
    def intent_count(self) -> int:
        return len(self.intents)

    @property
    def gross_delta_notional(self) -> float:
        return sum(abs(i.delta_notional) for i in self.intents)

    @property
    def net_delta_notional(self) -> float:
        return sum(i.delta_notional for i in self.intents)


# ─────────────────────────── synthesis inputs ───────────────────────


@dataclass
class _StrategyLeg:
    """One (strategy, symbol) observation the planner consumes."""

    strategy_id: str
    symbol_id: str
    correlation_class: str
    current_notional: float


# ─────────────────────────── synthesis helpers ──────────────────────


# Per-symbol drift threshold as a fraction of equity — legs whose
# absolute delta/equity is below this are skipped so the rebalancer
# doesn't rage-loop on dust exposure. The knob is deliberately static
# here; system_config can override by setting
# ``portfolio.rebalance.drift_band_percent`` and the route-layer glue
# passes it in as ``drift_band``.
_DEFAULT_DRIFT_BAND: float = 0.005  # 0.5% of equity
# Minimum absolute dollar delta — a 0.1% drift on a $1M account is $1000
# and worth rebalancing; a 5% drift on a $200 account is $10 and not.
_DEFAULT_MIN_DOLLAR_DELTA: float = 50.0
# Target-sum soft cap; above this the planner emits a critical warning
# and still proposes, but the UI flags the plan in red.
_TARGET_SUM_SOFT_CAP: float = 1.0 + 0.02
# Per-symbol concentration soft cap — if any leg targets above this the
# planner emits a warning.
_SINGLE_SYMBOL_CONCENTRATION: float = 0.20


def _side_for_delta(delta: float) -> PlanSide:
    if delta > 0:
        return "long"
    if delta < 0:
        return "short"
    return "flat"


def synthesize_plan(
    *,
    account_id: str,
    trigger: str,
    initiated_by_user_id: str | None,
    reason: str | None,
    total_equity: float,
    # allocation targets keyed by strategy id, value in (0, 1] fraction
    targets_by_strategy: dict[str, float],
    # current per-(strategy, symbol) exposure legs
    legs: list[_StrategyLeg],
    # per-symbol optional target override — when None the planner spreads
    # the strategy target evenly across the symbols the strategy currently
    # holds exposure in (or declines to rebalance when the strategy has no
    # current exposure on a symbol and no override is present)
    symbol_target_override: dict[tuple[str, str], float] | None = None,
    drift_band: float | None = None,
    min_dollar_delta: float | None = None,
) -> PlanDraft:
    """Compute a ``PlanDraft`` from allocation targets + current exposure.

    Parameters
    ----------
    account_id:
        The broker account the plan targets.
    trigger:
        One of ``scheduled|manual|drift|anomaly|allocation_change``.
    initiated_by_user_id:
        The operator id for manual plans; ``None`` for cron passes.
    reason:
        Operator reason captured on manual triggers.
    total_equity:
        Latest equity snapshot for the account. Used to translate
        percent-of-equity targets into dollar notional.
    targets_by_strategy:
        Operator-set (or default-inherited) target percent per strategy.
        Missing strategies fall through to ``0.0`` target (close-to-zero).
    legs:
        Current per-(strategy, symbol) exposure observations derived
        from open positions + live trade attribution.
    symbol_target_override:
        Optional (strategy, symbol) → target percent override. When set,
        the planner uses the override instead of evenly splitting the
        strategy target across the strategy's symbols.
    drift_band:
        Legs whose absolute ``delta_percent`` is below this band are
        skipped. Defaults to :data:`_DEFAULT_DRIFT_BAND` (0.5% of equity).
    min_dollar_delta:
        Legs whose absolute ``delta_notional`` is below this are skipped
        regardless of percent drift. Defaults to
        :data:`_DEFAULT_MIN_DOLLAR_DELTA`.
    """

    band = drift_band if drift_band is not None else _DEFAULT_DRIFT_BAND
    min_delta = (
        min_dollar_delta
        if min_dollar_delta is not None
        else _DEFAULT_MIN_DOLLAR_DELTA
    )

    intents: list[PlanIntent] = []
    warnings: list[PlanWarning] = []
    legs_by_strategy: dict[str, list[_StrategyLeg]] = {}
    for leg in legs:
        legs_by_strategy.setdefault(leg.strategy_id, []).append(leg)

    # fold over every strategy that either has a target OR has exposure
    strategy_ids = set(targets_by_strategy.keys()) | set(
        legs_by_strategy.keys()
    )

    # policy checks — sum of targets
    target_sum = sum(targets_by_strategy.values())
    if target_sum > _TARGET_SUM_SOFT_CAP:
        warnings.append(
            PlanWarning(
                code="target_sum_out_of_band",
                severity="critical",
                message=(
                    f"Sum of strategy targets is {target_sum:.0%}, "
                    "above the 100% account budget."
                ),
                subject_key=None,
            )
        )

    for sid in sorted(strategy_ids):
        strat_target = targets_by_strategy.get(sid, 0.0)
        strat_legs = legs_by_strategy.get(sid, [])

        if strat_target > _SINGLE_SYMBOL_CONCENTRATION:
            warnings.append(
                PlanWarning(
                    code="single_symbol_concentration",
                    severity="warn",
                    message=(
                        f"Strategy {sid} target {strat_target:.0%} exceeds "
                        f"soft per-strategy cap "
                        f"{_SINGLE_SYMBOL_CONCENTRATION:.0%}."
                    ),
                    subject_key=sid,
                )
            )

        # No legs and no target -> nothing to do.
        if not strat_legs and strat_target <= 0:
            continue

        # Decide symbol-level targets:
        #   * If overrides cover every (sid, symbol), use them.
        #   * Else evenly split strat_target across the strategy's
        #     currently-held symbols. When the strategy has no open
        #     exposure we can't invent new symbols, so we treat this as a
        #     close-to-zero target for every leg (which will show up as
        #     the first case anyway via strat_legs=[]).
        sym_targets: dict[str, float] = {}
        if symbol_target_override is not None:
            for (lsid, lsym), v in symbol_target_override.items():
                if lsid == sid:
                    sym_targets[lsym] = v
        if not sym_targets:
            held = [leg.symbol_id for leg in strat_legs]
            n = len(held)
            if n > 0:
                per = strat_target / n
                for sym in held:
                    sym_targets[sym] = per

        # Union of current legs + target legs.
        symbol_ids = set(sym_targets.keys()) | {
            leg.symbol_id for leg in strat_legs
        }
        current_by_symbol = {leg.symbol_id: leg for leg in strat_legs}

        for sym in sorted(symbol_ids):
            cur = current_by_symbol.get(sym)
            target_percent = sym_targets.get(sym, 0.0)
            target_notional = target_percent * total_equity
            current_notional = cur.current_notional if cur else 0.0
            delta_notional = target_notional - current_notional
            current_percent = (
                (current_notional / total_equity) if total_equity > 0 else 0.0
            )
            delta_percent = target_percent - current_percent

            # Drift filter — skip dust legs.
            if abs(delta_percent) < band and abs(delta_notional) < min_delta:
                continue

            correlation_class = (
                cur.correlation_class if cur else "uncorrelated"
            )

            intents.append(
                PlanIntent(
                    strategy_id=sid,
                    symbol_id=sym,
                    correlation_class=correlation_class,
                    side=_side_for_delta(delta_notional),
                    current_notional=current_notional,
                    target_notional=target_notional,
                    delta_notional=delta_notional,
                    current_percent=current_percent,
                    target_percent=target_percent,
                    delta_percent=delta_percent,
                )
            )

    return PlanDraft(
        account_id=account_id,
        trigger=trigger,
        initiated_by_user_id=initiated_by_user_id,
        reason=reason,
        intents=intents,
        warnings=warnings,
    )


def warnings_for_plan(draft: PlanDraft) -> list[dict[str, object]]:
    """Wire-shape warning list (what the JSON column stores)."""
    return [w.as_dict() for w in draft.warnings]


# ─────────────────────────── persistence mappers ────────────────────


def plan_to_row(draft: PlanDraft, *, proposed_at: datetime | None = None) -> RebalancePlanRow:
    """Map a draft to an unsaved :class:`RebalancePlanRow`."""
    ts = proposed_at or datetime.now(timezone.utc)
    return RebalancePlanRow(
        account_id=draft.account_id,
        status="proposed",
        trigger=draft.trigger,
        initiated_by_user_id=draft.initiated_by_user_id,
        approval_id=None,
        intent_count=draft.intent_count,
        gross_delta_notional=draft.gross_delta_notional,
        net_delta_notional=draft.net_delta_notional,
        estimated_r=None,
        warnings=warnings_for_plan(draft),
        reason=draft.reason,
        proposed_at=ts,
        approved_at=None,
        executed_at=None,
        completed_at=None,
        updated_at=ts,
    )


def draft_to_intent_rows(
    draft: PlanDraft, *, plan_id: str
) -> list[RebalanceIntentRow]:
    """Map each intent to an unsaved :class:`RebalanceIntentRow`."""
    return [
        RebalanceIntentRow(
            plan_id=plan_id,
            strategy_id=i.strategy_id,
            symbol_id=i.symbol_id,
            correlation_class=i.correlation_class,
            side=i.side,
            current_notional=i.current_notional,
            target_notional=i.target_notional,
            delta_notional=i.delta_notional,
            current_percent=i.current_percent,
            target_percent=i.target_percent,
            delta_percent=i.delta_percent,
            status="queued",
            execution_intent_id=None,
            adapter_id=None,
            filled_notional=0.0,
            reason=None,
        )
        for i in draft.intents
    ]
