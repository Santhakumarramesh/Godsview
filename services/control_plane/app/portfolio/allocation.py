"""Strategy allocation planner.

The allocation layer reconciles three sources of truth:

1. ``allocation_plans``  — operator intent (``target_percent``)
2. ``live_trades``       — current open risk (in R-multiples)
3. ``strategies``        — tier + promotion_state + DNA anchor

The read path projects them into a
:class:`AllocationPlanDto`. The write path persists a new row in
``allocation_plans`` (or updates the existing row for the
``(account_id, strategy_id)`` pair) and emits an audit event; the
route layer owns the audit surface.

Design notes
------------

* ``actual_percent`` is recomputed every call from open live-trade risk
  divided by current equity. We never cache it.
* Missing strategies fall through ``default_strategy_target`` in
  ``system_config.portfolio``. That key defaults to ``0.1`` so a brand
  new strategy can't accidentally consume the full budget.
* The plan is ``in_policy`` when ``total_target_percent`` is in ``[0,1]``
  and every strategy's target is in ``[0, 0.35]``. Anything outside
  those bounds produces a warning but is still allowed so operators
  can park experimental values.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountEquitySnapshot,
    AllocationPlanRow,
    LiveTrade,
    RiskBudget,
    Strategy,
    StrategyDNACell,
    SystemConfig,
)
from app.portfolio.dto import (
    AllocationPlanDto,
    AllocationUpdateRequestDto,
    PortfolioExposureWarningDto,
    StrategyAllocationDto,
)

_DEFAULT_STRATEGY_TARGET = 0.10
_MAX_STRATEGY_TARGET = 0.35
_EPS = 1e-6


# ─────────────────────── config helpers ─────────────────────────────────


async def _default_strategy_target(session: AsyncSession) -> float:
    stmt = select(SystemConfig).where(
        SystemConfig.key == "portfolio.default_strategy_target"
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None or not isinstance(row.value, (int, float)):
        return _DEFAULT_STRATEGY_TARGET
    v = float(row.value)
    if v < 0.0 or v > _MAX_STRATEGY_TARGET:
        return _DEFAULT_STRATEGY_TARGET
    return v


async def _latest_equity(
    session: AsyncSession, account_id: str
) -> Tuple[float, Optional[AccountEquitySnapshot]]:
    stmt = (
        select(AccountEquitySnapshot)
        .where(AccountEquitySnapshot.account_id == account_id)
        .order_by(desc(AccountEquitySnapshot.observed_at))
        .limit(1)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        return 0.0, None
    return row.total_equity, row


async def _risk_per_trade(session: AsyncSession, account_id: str) -> float:
    stmt = select(RiskBudget.max_risk_per_trade_r).where(
        RiskBudget.account_id == account_id
    )
    v = (await session.execute(stmt)).scalar_one_or_none()
    if v is None or v <= 0:
        return 0.005  # matches the RiskBudget default
    return float(v)


async def _open_live_r_by_strategy(
    session: AsyncSession, *, account_id: str
) -> Dict[str, float]:
    """Sum of open-risk dollars by strategy.

    Resolution path: LiveTrade → Setup.type → Strategy.setup_type. When
    more than one :class:`Strategy` shares a setup_type, the oldest
    strategy (by ``created_at``) wins so the mapping is deterministic.
    """
    from app.models import Setup  # local import keeps import graph shallow

    terminal = {"won", "lost", "scratched", "cancelled", "rejected"}
    stmt = (
        select(
            LiveTrade.setup_id,
            LiveTrade.status,
            LiveTrade.qty,
            LiveTrade.entry_ref,
            LiveTrade.stop_loss,
        ).where(LiveTrade.account_id == account_id)
    )
    rows = (await session.execute(stmt)).all()
    active: List[Tuple[str, float, float, float]] = [
        (r[0], float(r[2]), float(r[3]), float(r[4]))
        for r in rows
        if r[1] not in terminal
    ]
    if not active:
        return {}

    # setup → setup_type
    setup_ids = [r[0] for r in active]
    setup_rows = (
        await session.execute(
            select(Setup.id, Setup.type).where(Setup.id.in_(setup_ids))
        )
    ).all()
    setup_to_type: Dict[str, str] = {sid: t for sid, t in setup_rows}

    # setup_type → strategy_id (oldest wins)
    types_in_play = sorted({t for t in setup_to_type.values() if t})
    strat_rows = (
        await session.execute(
            select(Strategy.id, Strategy.setup_type, Strategy.created_at)
            .where(Strategy.setup_type.in_(types_in_play))
            .order_by(Strategy.created_at)
        )
    ).all()
    type_to_strategy: Dict[str, str] = {}
    for sid, stype, _ in strat_rows:
        # first seen wins because we ordered by created_at
        type_to_strategy.setdefault(stype, sid)

    out: Dict[str, float] = {}
    for setup_id, qty, entry_ref, stop_loss in active:
        stype = setup_to_type.get(setup_id)
        if not stype:
            continue
        strat_id = type_to_strategy.get(stype)
        if not strat_id:
            continue
        risk_dollars = abs((entry_ref - stop_loss) * qty)
        out[strat_id] = out.get(strat_id, 0.0) + risk_dollars
    return out


async def _dna_tier(
    session: AsyncSession, strategy_ids: Sequence[str]
) -> Dict[str, str]:
    """Return the highest-tier DNA cell per strategy.

    Tiers are ranked A > B > C; a strategy with no DNA cells yet returns
    nothing and the wire shape uses ``None``.
    """
    if not strategy_ids:
        return {}
    stmt = select(StrategyDNACell).where(
        StrategyDNACell.strategy_id.in_(list(strategy_ids))
    )
    rows = (await session.execute(stmt)).scalars().all()
    ranked = {"A": 3, "B": 2, "C": 1}
    best: Dict[str, str] = {}
    for cell in rows:
        # Map mean_r to coarse tier A/B/C for the allocation view
        if cell.mean_r >= 0.5 and cell.sample_size >= 20:
            t = "A"
        elif cell.mean_r >= 0.2 and cell.sample_size >= 10:
            t = "B"
        else:
            t = "C"
        prev = best.get(cell.strategy_id)
        if prev is None or ranked[t] > ranked[prev]:
            best[cell.strategy_id] = t
    return best


# ─────────────────────── read path ──────────────────────────────────────


async def build_allocation_plan(
    session: AsyncSession, *, account_id: str, observed_at: Optional[datetime] = None
) -> AllocationPlanDto:
    """Project the allocation plan for a single account.

    Includes every strategy the operator has explicitly set a target
    for, plus every strategy currently holding risk on the account.
    Strategies with no target and no open risk are not included — the
    operator can add them via :func:`set_allocation`.
    """
    ts = observed_at or datetime.now(tz=timezone.utc)

    total_equity, _ = await _latest_equity(session, account_id)
    r_per_trade = await _risk_per_trade(session, account_id)
    r_unit = r_per_trade * total_equity if total_equity > 0 else 0.0

    default_target = await _default_strategy_target(session)

    # load allocation rows
    plan_stmt = select(AllocationPlanRow).where(
        AllocationPlanRow.account_id == account_id
    )
    plan_rows = (await session.execute(plan_stmt)).scalars().all()
    plan_by_strategy: Dict[str, AllocationPlanRow] = {
        r.strategy_id: r for r in plan_rows
    }

    # load open risk
    open_r_dollars = await _open_live_r_by_strategy(
        session, account_id=account_id
    )

    strategy_ids = set(plan_by_strategy.keys()) | set(open_r_dollars.keys())
    if not strategy_ids:
        return AllocationPlanDto(
            accountId=account_id,
            observedAt=ts,
            strategies=[],
            totalTargetPercent=0.0,
            totalActualPercent=0.0,
            inPolicy=True,
            warnings=[],
        )

    # pull strategies
    strat_stmt = select(Strategy).where(Strategy.id.in_(strategy_ids))
    strategies = (await session.execute(strat_stmt)).scalars().all()
    by_id: Dict[str, Strategy] = {s.id: s for s in strategies}
    dna_map = await _dna_tier(session, list(by_id.keys()))

    rows_out: List[StrategyAllocationDto] = []
    total_target = 0.0
    total_actual = 0.0
    warnings: List[PortfolioExposureWarningDto] = []

    for sid in sorted(strategy_ids):
        strat = by_id.get(sid)
        plan = plan_by_strategy.get(sid)
        target = (
            plan.target_percent if plan is not None else default_target
        )
        # actual = (open risk dollars / r_unit) * r_per_trade-equivalent,
        # but since we want a *percent of equity* we express it as
        # notional risk at-risk / equity. r_dollars already == risk in $.
        r_dollars = open_r_dollars.get(sid, 0.0)
        actual = (r_dollars / total_equity) if total_equity > 0 else 0.0
        delta_r = 0.0
        if r_unit > 0:
            delta_r = ((target - actual) * total_equity) / r_unit

        source = (
            plan.source if plan is not None else "inherited_default"
        )
        reviewed_at = (
            plan.reviewed_at if plan is not None else ts
        )
        tier = strat.current_tier if strat is not None else "C"
        promo = strat.current_state if strat is not None else "experimental"

        rows_out.append(
            StrategyAllocationDto(
                strategyId=sid,
                targetPercent=max(0.0, min(1.0, target)),
                actualPercent=actual,
                deltaR=delta_r,
                source=source,  # type: ignore[arg-type]
                reviewedAt=reviewed_at,
                tier=tier,  # type: ignore[arg-type]
                promotionState=promo,  # type: ignore[arg-type]
                dnaTier=dna_map.get(sid),  # type: ignore[arg-type]
            )
        )
        total_target += target
        total_actual += actual

        if target > _MAX_STRATEGY_TARGET + _EPS:
            warnings.append(
                PortfolioExposureWarningDto(
                    code="single_symbol_concentration",
                    severity="warn",
                    message=(
                        f"Strategy {sid} target {target:.0%} exceeds "
                        f"per-strategy soft cap {_MAX_STRATEGY_TARGET:.0%}."
                    ),
                    subjectKey=sid,
                )
            )

    if total_target > 1.0 + _EPS:
        warnings.append(
            PortfolioExposureWarningDto(
                code="gross_exposure_breach",
                severity="critical",
                message=(
                    f"Sum of strategy targets is {total_target:.0%}, "
                    f"above the 100% account budget."
                ),
                subjectKey=None,
            )
        )

    in_policy = not any(w.severity == "critical" for w in warnings)

    return AllocationPlanDto(
        accountId=account_id,
        observedAt=ts,
        strategies=rows_out,
        totalTargetPercent=total_target,
        totalActualPercent=total_actual,
        inPolicy=in_policy,
        warnings=warnings,
    )


# ─────────────────────── write path ─────────────────────────────────────


async def set_allocation(
    session: AsyncSession,
    *,
    account_id: str,
    req: AllocationUpdateRequestDto,
    actor_user_id: str,
) -> AllocationPlanRow:
    """Upsert an allocation target for ``(account_id, strategy_id)``.

    The unique constraint ``uq_allocation_plans_account_strategy`` makes
    the write deterministic: if a row already exists we update it,
    otherwise we insert one. Every write carries the actor for audit.
    """
    stmt = select(AllocationPlanRow).where(
        and_(
            AllocationPlanRow.account_id == account_id,
            AllocationPlanRow.strategy_id == req.strategy_id,
        )
    )
    existing = (await session.execute(stmt)).scalar_one_or_none()
    now = datetime.now(tz=timezone.utc)
    if existing is None:
        row = AllocationPlanRow(
            account_id=account_id,
            strategy_id=req.strategy_id,
            target_percent=req.target_percent,
            source="operator",
            reason=req.reason,
            reviewed_at=now,
            updated_at=now,
            updated_by_user_id=actor_user_id,
        )
        session.add(row)
        await session.flush()
        return row
    existing.target_percent = req.target_percent
    existing.source = "operator"
    existing.reason = req.reason
    existing.reviewed_at = now
    existing.updated_at = now
    existing.updated_by_user_id = actor_user_id
    await session.flush()
    return existing


async def rebalance_plan(
    session: AsyncSession, *, account_id: str, actor_user_id: str
) -> AllocationPlanDto:
    """Snap every strategy target on the account to the configured default.

    This is the "reset to policy" button. It's idempotent — re-running
    produces the same result — and preserves the per-row audit trail
    because each upsert carries the actor id.
    """
    default_target = await _default_strategy_target(session)
    stmt = select(AllocationPlanRow).where(
        AllocationPlanRow.account_id == account_id
    )
    now = datetime.now(tz=timezone.utc)
    for row in (await session.execute(stmt)).scalars().all():
        row.target_percent = default_target
        row.source = "automated"
        row.reason = "rebalance_to_default"
        row.reviewed_at = now
        row.updated_at = now
        row.updated_by_user_id = actor_user_id
    await session.flush()
    return await build_allocation_plan(session, account_id=account_id)


__all__ = [
    "build_allocation_plan",
    "rebalance_plan",
    "set_allocation",
]
