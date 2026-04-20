"""Per-account portfolio exposure aggregator.

This module is *read-biased*: it joins Phase 4 state (``positions`` +
``account_equity_snapshots`` + ``live_trades`` + ``risk_budgets``) into
a :class:`PortfolioExposureReportDto` without writing anything.

Every field on the returned DTO is a projection — there is no
``portfolio_exposures`` table. Operators get a fresh snapshot every
poll, so the only staleness is whatever the broker adapter sync
introduces.

Warning rules
-------------

Five warning codes can be emitted (matching
``packages/types/src/portfolio.ts::PortfolioExposureWarningSchema``):

* ``gross_exposure_breach``        — sum(|notional|) / equity > cap
* ``correlated_exposure_breach``   — max(|class notional|) / equity > cap
* ``single_symbol_concentration``  — any symbol > 0.4 * equity
* ``drawdown_cap_approaching``     — current drawdown > 0.8 * cap
* ``cross_account_duplication``    — same symbol+direction on >1 account

The last rule requires a cross-account sweep and is only computed when
the caller passes ``all_account_positions``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountEquitySnapshot,
    BrokerAccount,
    LiveTrade,
    Position,
    RiskBudget,
    Symbol,
)
from app.portfolio.correlation import classify, load_correlation_map
from app.portfolio.dto import (
    PortfolioClassExposureDto,
    PortfolioExposureReportDto,
    PortfolioExposureWarningDto,
    PortfolioSymbolExposureDto,
)

_SINGLE_SYMBOL_CAP = 0.4
_DRAWDOWN_WARN_RATIO = 0.8


# ─────────────────────── helpers ────────────────────────────────────────


def _percent(n: float, d: float) -> float:
    """Safe division — return 0.0 when ``d`` is zero to avoid ZeroDivisionError."""
    if d == 0.0:
        return 0.0
    return n / d


async def _latest_equity_snapshot(
    session: AsyncSession, account_id: str
) -> Optional[AccountEquitySnapshot]:
    stmt = (
        select(AccountEquitySnapshot)
        .where(AccountEquitySnapshot.account_id == account_id)
        .order_by(desc(AccountEquitySnapshot.observed_at))
        .limit(1)
    )
    res = await session.execute(stmt)
    return res.scalar_one_or_none()


async def _open_positions(
    session: AsyncSession, account_id: str
) -> Sequence[Position]:
    stmt = (
        select(Position)
        .where(Position.account_id == account_id, Position.status == "open")
        .order_by(Position.opened_at)
    )
    res = await session.execute(stmt)
    return res.scalars().all()


async def _symbol_ticker_map(
    session: AsyncSession, symbol_ids: Iterable[str]
) -> Dict[str, str]:
    ids = [sid for sid in symbol_ids if sid]
    if not ids:
        return {}
    stmt = select(Symbol.id, Symbol.ticker).where(Symbol.id.in_(ids))
    res = await session.execute(stmt)
    return {row[0]: row[1] for row in res.all()}


async def _live_trade_links(
    session: AsyncSession, account_id: str
) -> Tuple[Dict[str, List[str]], Dict[str, List[str]]]:
    """Return two maps keyed by ``symbol_id``:

    * ``setup_ids``     — list of setup ids with open/pending live trades
    * ``live_trade_ids`` — list of live trade ids still active

    "Active" means a status other than terminal (won/lost/scratched/
    cancelled/rejected).
    """
    terminal = {"won", "lost", "scratched", "cancelled", "rejected"}
    stmt = select(LiveTrade).where(LiveTrade.account_id == account_id)
    res = await session.execute(stmt)
    setup_map: Dict[str, List[str]] = {}
    trade_map: Dict[str, List[str]] = {}
    for row in res.scalars().all():
        if row.status in terminal:
            continue
        setup_map.setdefault(row.symbol_id, []).append(row.setup_id)
        trade_map.setdefault(row.symbol_id, []).append(row.id)
    return setup_map, trade_map


async def _risk_budget(
    session: AsyncSession, account_id: str
) -> Optional[RiskBudget]:
    stmt = select(RiskBudget).where(RiskBudget.account_id == account_id)
    res = await session.execute(stmt)
    return res.scalar_one_or_none()


# ─────────────────────── report builder ─────────────────────────────────


async def build_exposure_report(
    session: AsyncSession,
    *,
    account_id: str,
    observed_at: Optional[datetime] = None,
    cross_account_positions: Optional[Sequence[Position]] = None,
) -> PortfolioExposureReportDto:
    """Project current account state into a :class:`PortfolioExposureReportDto`.

    Parameters
    ----------
    session
        Open async SQLAlchemy session.
    account_id
        ``broker_accounts.id`` of the account to project.
    observed_at
        Override for the report timestamp. Defaults to ``now()`` so the
        operator can see exactly when the snapshot was taken.
    cross_account_positions
        Optional pre-loaded positions across *other* accounts. When
        present, the ``cross_account_duplication`` warning becomes
        active.
    """
    ts = observed_at or datetime.now(tz=timezone.utc)

    equity_snap = await _latest_equity_snapshot(session, account_id)
    total_equity = equity_snap.total_equity if equity_snap else 0.0

    positions = await _open_positions(session, account_id)
    symbol_ids = {p.symbol_id for p in positions}
    ticker_map = await _symbol_ticker_map(session, symbol_ids)
    setup_map, trade_map = await _live_trade_links(session, account_id)
    corr_map = await load_correlation_map(session)
    budget = await _risk_budget(session, account_id)

    # per-symbol rows
    by_symbol: List[PortfolioSymbolExposureDto] = []
    gross_notional = 0.0
    net_notional = 0.0
    class_agg: Dict[str, Dict[str, float]] = {}
    per_class_symbol_count: Dict[str, int] = {}

    for pos in positions:
        ticker = ticker_map.get(pos.symbol_id, pos.symbol_id)
        cls = classify(ticker, corr_map)
        signed_qty = pos.qty if pos.direction == "long" else -pos.qty
        notional = abs(pos.mark_price * pos.qty)
        signed_notional = pos.mark_price * signed_qty
        unrealized_r = None
        if budget is not None and budget.max_risk_per_trade_r > 0 and total_equity > 0:
            r_unit = budget.max_risk_per_trade_r * total_equity
            if r_unit > 0:
                unrealized_r = pos.unrealized_pnl / r_unit

        by_symbol.append(
            PortfolioSymbolExposureDto(
                symbolId=pos.symbol_id,
                correlationClass=cls,
                direction=pos.direction,
                qty=pos.qty,
                notional=notional,
                unrealizedPnl=pos.unrealized_pnl,
                unrealizedR=unrealized_r,
                percentOfEquity=_percent(notional, total_equity),
                setupIds=setup_map.get(pos.symbol_id, []),
                liveTradeIds=trade_map.get(pos.symbol_id, []),
            )
        )

        gross_notional += notional
        net_notional += signed_notional

        bucket = class_agg.setdefault(cls, {"gross": 0.0, "net": 0.0})
        bucket["gross"] += notional
        bucket["net"] += signed_notional
        per_class_symbol_count[cls] = per_class_symbol_count.get(cls, 0) + 1

    # per-class rows
    by_class: List[PortfolioClassExposureDto] = []
    for cls, agg in sorted(class_agg.items()):
        by_class.append(
            PortfolioClassExposureDto(
                correlationClass=cls,
                symbolCount=per_class_symbol_count.get(cls, 0),
                netNotional=agg["net"],
                grossNotional=agg["gross"],
                netPercentOfEquity=_percent(agg["net"], total_equity),
                grossPercentOfEquity=_percent(agg["gross"], total_equity),
            )
        )

    # warnings
    warnings: List[PortfolioExposureWarningDto] = []

    if budget is not None and total_equity > 0:
        gross_ratio = gross_notional / total_equity
        if gross_ratio > budget.max_gross_exposure:
            warnings.append(
                PortfolioExposureWarningDto(
                    code="gross_exposure_breach",
                    severity="critical",
                    message=(
                        f"Gross exposure {gross_ratio:.2f}× equity "
                        f"exceeds cap {budget.max_gross_exposure:.2f}×."
                    ),
                    subjectKey=None,
                )
            )

        # correlated class cap — any single class breach
        worst_cls: Optional[Tuple[str, float]] = None
        for cls, agg in class_agg.items():
            ratio = agg["gross"] / total_equity
            if worst_cls is None or ratio > worst_cls[1]:
                worst_cls = (cls, ratio)
        if worst_cls is not None and worst_cls[1] > budget.max_correlated_exposure:
            warnings.append(
                PortfolioExposureWarningDto(
                    code="correlated_exposure_breach",
                    severity="warn",
                    message=(
                        f"Class '{worst_cls[0]}' holds {worst_cls[1]:.2f}× "
                        f"equity, cap is {budget.max_correlated_exposure:.2f}×."
                    ),
                    subjectKey=worst_cls[0],
                )
            )

        # drawdown cap approaching — use intraday (start_of_day_equity)
        if equity_snap is not None and budget.max_daily_drawdown_r > 0:
            sod = equity_snap.start_of_day_equity or 0.0
            if sod > 0:
                draw = max(0.0, (sod - equity_snap.total_equity) / sod)
                threshold = _DRAWDOWN_WARN_RATIO * budget.max_daily_drawdown_r
                if draw >= threshold:
                    warnings.append(
                        PortfolioExposureWarningDto(
                            code="drawdown_cap_approaching",
                            severity="warn" if draw < budget.max_daily_drawdown_r else "critical",
                            message=(
                                f"Intraday drawdown {draw:.2%} "
                                f"is {draw / budget.max_daily_drawdown_r:.0%} "
                                f"of the daily cap {budget.max_daily_drawdown_r:.2%}."
                            ),
                            subjectKey=None,
                        )
                    )

    # single-symbol concentration — fires regardless of budget
    for row in by_symbol:
        if row.percent_of_equity > _SINGLE_SYMBOL_CAP:
            warnings.append(
                PortfolioExposureWarningDto(
                    code="single_symbol_concentration",
                    severity="warn",
                    message=(
                        f"{row.symbol_id} is {row.percent_of_equity:.0%} of equity, "
                        f"above the {_SINGLE_SYMBOL_CAP:.0%} single-symbol soft cap."
                    ),
                    subjectKey=row.symbol_id,
                )
            )

    # cross-account duplication — only when caller hands us sibling positions
    if cross_account_positions is not None and positions:
        our_keys = {
            (p.symbol_id, p.direction) for p in positions if p.status == "open"
        }
        seen: Dict[Tuple[str, str], int] = {}
        for p in cross_account_positions:
            if p.account_id == account_id or p.status != "open":
                continue
            key = (p.symbol_id, p.direction)
            if key in our_keys:
                seen[key] = seen.get(key, 0) + 1
        for (sid, direction), count in seen.items():
            warnings.append(
                PortfolioExposureWarningDto(
                    code="cross_account_duplication",
                    severity="info",
                    message=(
                        f"{sid} ({direction}) is also open on "
                        f"{count} sibling account(s)."
                    ),
                    subjectKey=sid,
                )
            )

    return PortfolioExposureReportDto(
        accountId=account_id,
        observedAt=ts,
        totalEquity=total_equity,
        grossNotional=gross_notional,
        netNotional=net_notional,
        grossPercentOfEquity=_percent(gross_notional, total_equity),
        netPercentOfEquity=_percent(net_notional, total_equity),
        bySymbol=by_symbol,
        byCorrelationClass=by_class,
        warnings=warnings,
    )


async def load_all_open_positions(session: AsyncSession) -> List[Position]:
    """Helper for cross-account duplication checks.

    Returns every open position across *every* broker account — callers
    can then pass this into :func:`build_exposure_report` via
    ``cross_account_positions=`` to turn on the duplication warning.
    """
    stmt = select(Position).where(Position.status == "open")
    res = await session.execute(stmt)
    return list(res.scalars().all())


async def list_broker_accounts(session: AsyncSession) -> List[BrokerAccount]:
    """Return every enabled broker account, newest first."""
    stmt = (
        select(BrokerAccount)
        .where(BrokerAccount.enabled.is_(True))
        .order_by(desc(BrokerAccount.created_at))
    )
    res = await session.execute(stmt)
    return list(res.scalars().all())


__all__ = [
    "build_exposure_report",
    "list_broker_accounts",
    "load_all_open_positions",
]
