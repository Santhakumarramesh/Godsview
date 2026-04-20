"""Live execution gate — deterministic fusion of paper gate + risk engine.

The live gate extends the Phase 3 paper gate's setup-level checks
(kill switch, setup status, expires, confidence, size multiplier,
capacity caps) with Phase 4's live-only rules (live enabled, broker
reachable, risk budget + equity freshness, per-trade risk, daily
drawdown, gross + correlated exposure, open-positions, buying power).

Design rules — identical contract to :mod:`app.execution.gate`:

* No I/O. The caller pre-loads every field into :class:`LiveGateInput`.
* Deterministic. Same input → same verdict. Unit tests pin the exact
  reason for every rejection path without mocking a database.
* First-failure wins. Rule ordering below matches the priority the
  frontend + audit log + metrics expect.
* Closed enum. :data:`LiveGateReason` is the union of every paper + live
  rejection code. It MUST stay in lockstep with ``GateRejectionReason``
  in ``packages/types/src/execution.ts``.

Rule order
----------

 1. ``kill_switch_active``          — absolute override.
 2. ``live_disabled``               — operator has turned live off for
                                      this mode.
 3. ``broker_unavailable``          — adapter not registered / circuit
                                      tripped.
 4. ``setup_not_detected``          — wrong setup status.
 5. ``duplicate_active_trade``      — an open live trade already exists
                                      for this setup.
 6. ``setup_expired``               — ``expires_at`` is in the past.
 7. ``size_multiplier_out_of_range``— size multiplier ≤ 0 or > cap.
 8. ``confidence_below_threshold``  — calibrated confidence < floor.
 9. ``per_symbol_cap_exceeded``     — too many active trades in symbol.
10. ``global_cap_exceeded``         — too many active live trades total.
11. ``risk_budget_missing``         — no risk budget row on file.
12. ``stale_equity_snapshot``       — equity older than allowed.
13. ``daily_drawdown_breached``     — projected realised + pending loss
                                      exceeds daily cap.
14. ``max_open_positions_breached`` — open-position ceiling.
15. ``gross_exposure_breached``     — gross notional ceiling.
16. ``correlation_cap_breached``    — per correlation-class cap.
17. ``risk_per_trade_breached``     — per-trade R exceeds cap.
18. ``insufficient_buying_power``   — planned notional > BP.

The three "no pending trade" checks (drawdown, positions) still run
because a stale equity or missing budget MUST gate the operator even
before sizing — the UI uses the live gate as the pre-flight check.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from app.execution.gate import (
    DEFAULT_MAX_GLOBAL,
    DEFAULT_MAX_PER_SYMBOL,
    DEFAULT_MAX_SIZE_MULTIPLIER,
    DEFAULT_MIN_CONFIDENCE,
)
from app.risk import (
    EquitySnapshot,
    PendingTrade,
    RiskBudget,
    RiskInput,
    RiskVerdict,
    evaluate_risk,
    size_for_trade,
)

#: Upper bound on equity snapshot age — mirrors
#: :data:`app.risk.evaluator.MAX_EQUITY_STALENESS_S`. Held as a default
#: here so route-layer callers can override it if operator config tightens
#: the freshness requirement.
DEFAULT_MAX_EQUITY_AGE_S: int = 60

LiveGateReason = Literal[
    # Paper-gate reasons (kept in lockstep with ``GateReason`` in gate.py).
    "approved",
    "kill_switch_active",
    "live_disallowed",
    "setup_not_detected",
    "setup_expired",
    "size_multiplier_out_of_range",
    "confidence_below_threshold",
    "per_symbol_cap_exceeded",
    "global_cap_exceeded",
    "duplicate_active_trade",
    # Phase 4 additive reasons.
    "live_disabled",
    "broker_unavailable",
    "risk_budget_missing",
    "daily_drawdown_breached",
    "max_open_positions_breached",
    "correlation_cap_breached",
    "gross_exposure_breached",
    "insufficient_buying_power",
    "risk_per_trade_breached",
    "stale_equity_snapshot",
]


@dataclass(frozen=True, slots=True)
class LiveGateInput:
    """Snapshot of the world the live gate needs to decide.

    Mirrors ``LiveGateInputSchema`` in ``packages/types/src/execution.ts``.
    Every field is a primitive / plain dataclass so the route layer can
    build this from DB rows + a single broker pull without pulling the
    SQLAlchemy session into the gate.
    """

    # --- mode + sizing ---
    mode: Literal["paper", "live"]
    size_multiplier: float

    # --- setup snapshot ---
    setup_status: str
    setup_confidence: float
    setup_expires_at: datetime | None
    setup_has_active_live_trade: bool

    # --- runtime flags + counters ---
    kill_switch_active: bool
    active_trades_for_symbol: int
    active_trades_global: int
    live_enabled: bool
    broker_available: bool

    # --- risk context ---
    equity: EquitySnapshot | None
    risk: RiskBudget | None
    planned_trade_risk_dollars: float
    planned_trade_notional: float
    current_gross_exposure: float
    correlated_gross_exposure: float
    open_positions_count: int
    equity_age_seconds: float | None

    # --- correlation class for the pending trade ---
    correlation_class: str

    # --- "now" (injectable for deterministic tests) ---
    now: datetime

    # --- knobs (overridable for tests / operator config) ---
    max_per_symbol: int = DEFAULT_MAX_PER_SYMBOL
    max_global: int = DEFAULT_MAX_GLOBAL
    min_confidence: float = DEFAULT_MIN_CONFIDENCE
    max_size_multiplier: float = DEFAULT_MAX_SIZE_MULTIPLIER
    max_equity_age_s: float = float(DEFAULT_MAX_EQUITY_AGE_S)


@dataclass(frozen=True, slots=True)
class LiveGateDecision:
    """Structured verdict — mirrors ``GateDecisionSchema`` in @gv/types."""

    approved: bool
    reason: LiveGateReason
    detail: str = ""
    #: When approved, the per-trade R value computed by the risk
    #: evaluator. Useful for the preview envelope so operators see the
    #: sized risk before clicking "approve live".
    r_risk: float | None = None

    @classmethod
    def approve(
        cls, *, detail: str = "", r_risk: float | None = None
    ) -> "LiveGateDecision":
        return cls(approved=True, reason="approved", detail=detail, r_risk=r_risk)

    @classmethod
    def reject(cls, reason: LiveGateReason, detail: str = "") -> "LiveGateDecision":
        return cls(approved=False, reason=reason, detail=detail)


# ── evaluator ──────────────────────────────────────────────────────


def evaluate_live_gate(gi: LiveGateInput) -> LiveGateDecision:
    """Apply the deterministic live-gate floor.

    First failure wins — see module docstring for rule order.
    """

    # 1. absolute overrides
    if gi.kill_switch_active:
        return LiveGateDecision.reject(
            "kill_switch_active",
            detail="execution.kill_switch flag is on",
        )

    # 2. live toggle — operator has paused live trading for this account.
    if gi.mode == "live" and not gi.live_enabled:
        return LiveGateDecision.reject(
            "live_disabled",
            detail="live execution is disabled for this account",
        )

    # 3. broker reachability — adapter must be registered + healthy.
    if gi.mode == "live" and not gi.broker_available:
        return LiveGateDecision.reject(
            "broker_unavailable",
            detail="broker adapter is not available for this account",
        )

    # 4. setup-state preconditions
    if gi.setup_status != "detected":
        return LiveGateDecision.reject(
            "setup_not_detected",
            detail=f"setup in state '{gi.setup_status}'",
        )
    if gi.setup_has_active_live_trade:
        return LiveGateDecision.reject(
            "duplicate_active_trade",
            detail="an open live trade already exists for this setup",
        )
    if gi.setup_expires_at is not None:
        expires = _ensure_aware(gi.setup_expires_at)
        now = _ensure_aware(gi.now)
        if expires <= now:
            return LiveGateDecision.reject(
                "setup_expired",
                detail=f"setup expired at {expires.isoformat()}",
            )

    # 5. sizing + confidence
    if gi.size_multiplier <= 0.0 or gi.size_multiplier > gi.max_size_multiplier:
        return LiveGateDecision.reject(
            "size_multiplier_out_of_range",
            detail=(
                f"sizeMultiplier={gi.size_multiplier} outside "
                f"(0, {gi.max_size_multiplier}]"
            ),
        )
    if gi.setup_confidence < gi.min_confidence:
        return LiveGateDecision.reject(
            "confidence_below_threshold",
            detail=(
                f"confidence={gi.setup_confidence:.3f} < "
                f"threshold={gi.min_confidence:.3f}"
            ),
        )

    # 6. capacity caps
    if gi.active_trades_for_symbol >= gi.max_per_symbol:
        return LiveGateDecision.reject(
            "per_symbol_cap_exceeded",
            detail=(
                f"open live trades for symbol = "
                f"{gi.active_trades_for_symbol} / {gi.max_per_symbol}"
            ),
        )
    if gi.active_trades_global >= gi.max_global:
        return LiveGateDecision.reject(
            "global_cap_exceeded",
            detail=(
                f"open live trades globally = "
                f"{gi.active_trades_global} / {gi.max_global}"
            ),
        )

    # 7. budget + equity presence
    if gi.risk is None:
        return LiveGateDecision.reject(
            "risk_budget_missing",
            detail="no risk budget configured for this account",
        )
    if gi.equity is None:
        return LiveGateDecision.reject(
            "stale_equity_snapshot",
            detail="no equity snapshot available",
        )

    # 8. equity freshness — a stale snapshot cannot size a live trade.
    if gi.equity_age_seconds is not None and gi.equity_age_seconds > gi.max_equity_age_s:
        return LiveGateDecision.reject(
            "stale_equity_snapshot",
            detail=(
                f"equity snapshot is {gi.equity_age_seconds:.0f}s old "
                f"(> {gi.max_equity_age_s:.0f}s limit)"
            ),
        )

    # 9. delegate the dollar-math checks to the risk evaluator. We
    #    translate the planned trade into the evaluator's PendingTrade
    #    shape so the rule set stays DRY — one source of truth for
    #    risk math.
    #
    #    The evaluator expects qty + stop to derive dollar_risk. We
    #    already have dollar_risk + notional on the input envelope, so
    #    we pick an entry_price / stop_loss pair that reproduces the
    #    caller's numbers exactly. This keeps :func:`evaluate_risk`
    #    uncoupled from the gate surface — the evaluator has its own
    #    dedicated unit tests.
    dollar_risk = max(gi.planned_trade_risk_dollars, 0.0)
    notional = max(gi.planned_trade_notional, 0.0)
    # Derive a 1-unit pending trade that produces the same dollar_risk +
    # notional. ``qty=1`` so dollar_risk = stop_distance * 1 → stop_loss
    # = entry_price - dollar_risk. entry_price = notional.
    entry_price = notional if notional > 0 else max(dollar_risk + 1e-9, 1.0)
    stop_loss = max(entry_price - dollar_risk, 0.0)
    direction: Literal["long", "short"] = "long"
    pending = PendingTrade(
        symbol="(pending)",
        correlation_class=gi.correlation_class,
        direction=direction,
        qty=1.0,
        entry_price=entry_price,
        stop_loss=stop_loss,
    )
    # The evaluator takes the full set of open positions to compute
    # gross + correlated exposure, but the caller has already summed
    # those for us. We pre-project both sums onto a single synthetic
    # position carrying the correlated exposure, plus a second one for
    # the uncorrelated residual.
    equity = gi.equity
    risk = gi.risk
    correlated = max(gi.correlated_gross_exposure, 0.0)
    uncorrelated = max(gi.current_gross_exposure - correlated, 0.0)

    from app.risk import OpenPositionSummary

    positions: list[OpenPositionSummary] = []
    if correlated > 0:
        positions.append(
            OpenPositionSummary(
                symbol="(aggregated correlated)",
                correlation_class=gi.correlation_class,
                notional=correlated,
            )
        )
    if uncorrelated > 0:
        positions.append(
            OpenPositionSummary(
                symbol="(aggregated other)",
                correlation_class=f"_other_{gi.correlation_class}",
                notional=uncorrelated,
            )
        )

    # Open-position count comes in as an aggregate scalar; pad the
    # positions tuple so len() matches. The synthetic rows above
    # already contribute up to 2 entries — add empty placeholders for
    # the remainder so the evaluator's ``len(positions) >= cap`` check
    # trips at exactly the same number the operator sees.
    padding_needed = max(gi.open_positions_count - len(positions), 0)
    for i in range(padding_needed):
        positions.append(
            OpenPositionSummary(
                symbol=f"(padding_{i})",
                correlation_class=f"_pad_{i}",
                notional=0.0,
            )
        )

    ri = RiskInput(
        budget=risk,
        equity=equity,
        positions=tuple(positions),
        pending=pending,
        now=gi.now,
    )
    verdict: RiskVerdict = evaluate_risk(ri)
    if not verdict.approved:
        # Map risk reasons directly — they are a strict subset of
        # LiveGateReason so the cast is safe.
        return LiveGateDecision.reject(
            verdict.reason,  # type: ignore[arg-type]
            detail=verdict.detail,
        )

    return LiveGateDecision.approve(
        detail=(
            f"passed live gate (conf={gi.setup_confidence:.3f}, "
            f"size={gi.size_multiplier:g}, r_risk={verdict.r_risk or 0.0:.4f})"
        ),
        r_risk=verdict.r_risk,
    )


# ── sizing preview helper ──────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class LiveSizingPreview:
    """What :func:`preview_live_sizing` returns.

    A side-effect-free projection the preview route surfaces so the
    operator sees what the risk engine will size + which caps the
    trade will consume.
    """

    qty: float
    notional: float
    dollar_risk: float
    r_risk: float
    projected_gross: float
    projected_correlated: float
    drawdown_r: float


def preview_live_sizing(
    *,
    budget: RiskBudget,
    equity: EquitySnapshot,
    entry_price: float,
    stop_loss: float,
    size_multiplier: float,
    current_gross_exposure: float,
    correlated_gross_exposure: float,
    lot_size: float = 1.0,
) -> LiveSizingPreview:
    """Size a live trade + project the exposures it will consume.

    Uses :func:`app.risk.size_for_trade` for the share count, then
    computes the resulting dollar-risk, notional, R-risk, and projected
    gross + correlated exposure ratios. Zero I/O, zero side effects —
    safe to call from the preview route and from unit tests.
    """

    qty = size_for_trade(
        equity=equity.total_equity,
        risk_per_trade_r=budget.max_risk_per_trade_r * size_multiplier,
        entry_price=entry_price,
        stop_loss=stop_loss,
        lot_size=lot_size,
    )
    stop_distance = abs(entry_price - stop_loss)
    dollar_risk = qty * stop_distance
    notional = qty * entry_price
    equity_total = max(equity.total_equity, 1e-9)
    r_risk = dollar_risk / equity_total
    projected_gross = (current_gross_exposure + notional) / equity_total
    projected_correlated = (correlated_gross_exposure + notional) / equity_total
    sod = max(equity.start_of_day_equity, 1e-9)
    drawdown_r = max(
        0.0, -(equity.realized_pnl + equity.unrealized_pnl)
    ) / sod
    return LiveSizingPreview(
        qty=qty,
        notional=notional,
        dollar_risk=dollar_risk,
        r_risk=r_risk,
        projected_gross=projected_gross,
        projected_correlated=projected_correlated,
        drawdown_r=drawdown_r,
    )


def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


__all__ = [
    "DEFAULT_MAX_EQUITY_AGE_S",
    "LiveGateDecision",
    "LiveGateInput",
    "LiveGateReason",
    "LiveSizingPreview",
    "evaluate_live_gate",
    "preview_live_sizing",
]
