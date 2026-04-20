"""DB loaders that project rebalancer inputs into :mod:`app.rebalancer.planner`.

The planner is pure — it consumes dataclasses and returns dataclasses.
These helpers are the DB-facing bridge: they read
``allocation_plans``, open ``positions``, the latest
``account_equity_snapshots`` row and ``market_symbols`` metadata, map
each open position onto a strategy via the same
``LiveTrade → Setup.type → Strategy.setup_type`` chain
:mod:`app.portfolio.allocation` uses, and fold the result into the
``synthesize_plan()`` argument shape.

Keeping the loader side-effect free on the DB (no writes, read-only
select) means the cron + the operator ``POST /rebalance/plans`` path
can share one implementation and the tests can seed a database and
diff against the dataclass output.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountEquitySnapshot,
    AllocationPlanRow,
    LiveTrade,
    Position,
    Setup,
    Strategy,
    Symbol,
)
from app.rebalancer.planner import _StrategyLeg

# Correlation-class mapping — mirrors the execution route so the
# intent row's ``correlation_class`` matches what the live gate uses
# downstream.
_ASSET_TO_CORRELATION: Dict[str, str] = {
    "equity": "us_equity",
    "futures": "futures",
    "forex": "forex_major",
    "crypto": "crypto",
    "option": "us_equity",
}


def _correlation_for_symbol(sym: Symbol | None) -> str:
    if sym is None:
        return "unknown"
    return _ASSET_TO_CORRELATION.get(sym.asset_class, sym.asset_class)


@dataclass
class RebalancerInputs:
    """Everything the planner needs for one account, pre-loaded."""

    account_id: str
    total_equity: float
    targets_by_strategy: Dict[str, float]
    legs: List[_StrategyLeg]
    symbols_by_id: Dict[str, Symbol]


async def _latest_equity(
    session: AsyncSession, account_id: str
) -> float:
    stmt = (
        select(AccountEquitySnapshot.total_equity)
        .where(AccountEquitySnapshot.account_id == account_id)
        .order_by(desc(AccountEquitySnapshot.observed_at))
        .limit(1)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    return float(row) if row is not None else 0.0


async def _targets_by_strategy(
    session: AsyncSession, account_id: str
) -> Dict[str, float]:
    stmt = select(
        AllocationPlanRow.strategy_id, AllocationPlanRow.target_percent
    ).where(AllocationPlanRow.account_id == account_id)
    rows = (await session.execute(stmt)).all()
    return {sid: float(pct) for sid, pct in rows}


async def _open_positions(
    session: AsyncSession, account_id: str
) -> List[Position]:
    stmt = select(Position).where(
        and_(Position.account_id == account_id, Position.status == "open")
    )
    return list((await session.scalars(stmt)).all())


async def _symbols_by_id(
    session: AsyncSession, symbol_ids: Sequence[str]
) -> Dict[str, Symbol]:
    if not symbol_ids:
        return {}
    stmt = select(Symbol).where(Symbol.id.in_(list(set(symbol_ids))))
    return {row.id: row for row in (await session.scalars(stmt)).all()}


async def _strategy_id_for_position(
    session: AsyncSession, positions: Sequence[Position]
) -> Dict[str, str]:
    """Resolve ``position.id → strategy_id`` via LiveTrade → Setup → Strategy.

    Positions that carry a ``setup_id`` route directly through the
    setup's type. The same "oldest strategy wins" tie-break as
    :func:`app.portfolio.allocation._open_live_r_by_strategy` keeps the
    mapping deterministic.
    """

    if not positions:
        return {}

    # Position → setup via either position.setup_id or a live_trade row.
    setup_ids_direct = [p.setup_id for p in positions if p.setup_id]
    live_trade_ids = [
        p.live_trade_id for p in positions if p.live_trade_id is not None
    ]

    live_setup_by_trade: Dict[str, str] = {}
    if live_trade_ids:
        lt_rows = (
            await session.execute(
                select(LiveTrade.id, LiveTrade.setup_id).where(
                    LiveTrade.id.in_(list(set(live_trade_ids)))
                )
            )
        ).all()
        for tid, sid in lt_rows:
            if sid is not None:
                live_setup_by_trade[tid] = sid

    setup_ids = list(
        {sid for sid in setup_ids_direct}
        | {sid for sid in live_setup_by_trade.values()}
    )
    if not setup_ids:
        return {}

    setup_type_by_id: Dict[str, str] = dict(
        (
            await session.execute(
                select(Setup.id, Setup.type).where(Setup.id.in_(setup_ids))
            )
        ).all()
    )

    types_in_play = sorted({t for t in setup_type_by_id.values() if t})
    strat_rows = (
        await session.execute(
            select(Strategy.id, Strategy.setup_type, Strategy.created_at)
            .where(Strategy.setup_type.in_(types_in_play))
            .order_by(Strategy.created_at)
        )
    ).all()
    type_to_strategy: Dict[str, str] = {}
    for sid, stype, _ in strat_rows:
        type_to_strategy.setdefault(stype, sid)

    out: Dict[str, str] = {}
    for pos in positions:
        sid = pos.setup_id
        if sid is None and pos.live_trade_id is not None:
            sid = live_setup_by_trade.get(pos.live_trade_id)
        if sid is None:
            continue
        stype = setup_type_by_id.get(sid)
        if not stype:
            continue
        strat_id = type_to_strategy.get(stype)
        if strat_id is None:
            continue
        out[pos.id] = strat_id
    return out


async def load_rebalancer_inputs(
    session: AsyncSession, *, account_id: str
) -> RebalancerInputs:
    """Read the planner's inputs for ``account_id`` from the DB.

    The returned dataclass is passed verbatim to :func:`synthesize_plan`
    (and is small enough that both the cron and the operator path hold
    it in-process without streaming).
    """

    total_equity = await _latest_equity(session, account_id)
    targets = await _targets_by_strategy(session, account_id)
    positions = await _open_positions(session, account_id)
    symbols = await _symbols_by_id(session, [p.symbol_id for p in positions])
    pos_to_strategy = await _strategy_id_for_position(session, positions)

    legs: List[_StrategyLeg] = []
    for pos in positions:
        sid = pos_to_strategy.get(pos.id)
        if sid is None:
            # Unattributed positions are surfaced against a
            # synthetic "unattributed" bucket so the planner can at
            # least flag them; operators can reconcile downstream.
            sid = "unattributed"
        sym = symbols.get(pos.symbol_id)
        correlation = _correlation_for_symbol(sym)
        # Signed notional: long positions carry + qty * mark_price,
        # short positions carry a negative value so the planner can
        # close + flip exposure in one pass.
        sign = -1.0 if pos.direction == "short" else 1.0
        notional = sign * float(pos.qty) * float(pos.mark_price)
        legs.append(
            _StrategyLeg(
                strategy_id=sid,
                symbol_id=pos.symbol_id,
                correlation_class=correlation,
                current_notional=notional,
            )
        )

    return RebalancerInputs(
        account_id=account_id,
        total_equity=total_equity,
        targets_by_strategy=targets,
        legs=legs,
        symbols_by_id=symbols,
    )


__all__ = [
    "RebalancerInputs",
    "load_rebalancer_inputs",
]
