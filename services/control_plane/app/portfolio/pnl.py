"""Daily PnL timeseries + aggregate summary.

Projects every trading day inside ``[start_date, end_date]`` into a
:class:`PortfolioPnlPointDto`. One point per trading day. Points are
assembled from three Phase 4 sources:

* ``account_equity_snapshots`` — first/last snapshot per day frames
  the day's equity window (``start_equity``, ``end_equity``,
  ``realized`` etc).
* ``live_trades``               — trade_count, winning/losing/scratch
  counts, commission.
* ``risk_budgets``              — ``r_unit`` = ``max_risk_per_trade_r``
  × ``start_equity``, used to convert dollar PnL to R-multiples.

A running drawdown is computed on the fly: peak equity is the max of
every day's ``end_equity`` seen so far, and ``drawdown_r`` is
``(peak - end) / r_unit``. This mirrors the live gate's drawdown
definition so nothing is double-counted.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountEquitySnapshot,
    LiveTrade,
    RiskBudget,
)
from app.portfolio.dto import (
    PortfolioPnlPointDto,
    PortfolioPnlReportDto,
    PortfolioPnlSummaryDto,
)


@dataclass(frozen=True)
class _DayFrame:
    """Pre-aggregated per-day scratch record."""

    observed_date: date
    start_equity: float
    end_equity: float
    realized: float
    unrealized: float
    fees: float
    trade_count: int
    winning: int
    losing: int
    scratching: int


# ─────────────────────── helpers ────────────────────────────────────────


def _to_utc_date(v: datetime) -> date:
    if v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc).date()
    return v.astimezone(timezone.utc).date()


def _day_bounds(d: date) -> Tuple[datetime, datetime]:
    start = datetime.combine(d, time.min, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start, end


async def _snapshots_in_range(
    session: AsyncSession,
    *,
    account_id: str,
    start_utc: datetime,
    end_utc: datetime,
) -> Sequence[AccountEquitySnapshot]:
    stmt = (
        select(AccountEquitySnapshot)
        .where(
            and_(
                AccountEquitySnapshot.account_id == account_id,
                AccountEquitySnapshot.observed_at >= start_utc,
                AccountEquitySnapshot.observed_at < end_utc,
            )
        )
        .order_by(AccountEquitySnapshot.observed_at)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _trades_in_range(
    session: AsyncSession,
    *,
    account_id: str,
    start_utc: datetime,
    end_utc: datetime,
) -> Sequence[LiveTrade]:
    stmt = (
        select(LiveTrade)
        .where(
            and_(
                LiveTrade.account_id == account_id,
                LiveTrade.closed_at.is_not(None),
                LiveTrade.closed_at >= start_utc,
                LiveTrade.closed_at < end_utc,
            )
        )
        .order_by(LiveTrade.closed_at)
    )
    return list((await session.execute(stmt)).scalars().all())


async def _risk_per_trade(session: AsyncSession, account_id: str) -> float:
    stmt = select(RiskBudget.max_risk_per_trade_r).where(
        RiskBudget.account_id == account_id
    )
    v = (await session.execute(stmt)).scalar_one_or_none()
    if v is None or v <= 0:
        return 0.005
    return float(v)


def _classify_trade(trade: LiveTrade) -> str:
    """Return "win" / "loss" / "scratch" for a terminal trade."""
    if trade.pnl_r is None:
        return "scratch"
    if trade.pnl_r > 0.01:
        return "win"
    if trade.pnl_r < -0.01:
        return "loss"
    return "scratch"


def _build_day_frames(
    trading_days: Sequence[date],
    snapshots: Sequence[AccountEquitySnapshot],
    trades: Sequence[LiveTrade],
) -> List[_DayFrame]:
    """Fold snapshots + trades into one row per calendar day.

    Empty days (no snapshot, no trade) are still included so the UI can
    render a flat-line chart; their start/end equity inherit from the
    previous day.
    """
    snap_by_day: Dict[date, List[AccountEquitySnapshot]] = defaultdict(list)
    for s in snapshots:
        snap_by_day[_to_utc_date(s.observed_at)].append(s)

    trade_by_day: Dict[date, List[LiveTrade]] = defaultdict(list)
    for t in trades:
        if t.closed_at is None:
            continue
        trade_by_day[_to_utc_date(t.closed_at)].append(t)

    frames: List[_DayFrame] = []
    carry_equity: Optional[float] = None

    for d in trading_days:
        day_snaps = snap_by_day.get(d, [])
        if day_snaps:
            first = day_snaps[0]
            last = day_snaps[-1]
            start_equity = (
                carry_equity
                if carry_equity is not None
                else first.start_of_day_equity
            )
            end_equity = last.total_equity
            realized = sum(s.realized_pnl for s in day_snaps)
            unrealized = last.unrealized_pnl
        else:
            start_equity = carry_equity if carry_equity is not None else 0.0
            end_equity = start_equity
            realized = 0.0
            unrealized = 0.0

        day_trades = trade_by_day.get(d, [])
        fees = sum(t.commission for t in day_trades)
        trade_count = len(day_trades)
        winning = 0
        losing = 0
        scratching = 0
        for t in day_trades:
            bucket = _classify_trade(t)
            if bucket == "win":
                winning += 1
            elif bucket == "loss":
                losing += 1
            else:
                scratching += 1

        frames.append(
            _DayFrame(
                observed_date=d,
                start_equity=start_equity,
                end_equity=end_equity,
                realized=realized,
                unrealized=unrealized,
                fees=fees,
                trade_count=trade_count,
                winning=winning,
                losing=losing,
                scratching=scratching,
            )
        )
        carry_equity = end_equity
    return frames


# ─────────────────────── public API ─────────────────────────────────────


async def build_pnl_report(
    session: AsyncSession,
    *,
    account_id: str,
    start_date: date,
    end_date: date,
) -> PortfolioPnlReportDto:
    """Build a full PnL report for ``[start_date, end_date]`` inclusive."""
    if end_date < start_date:
        start_date, end_date = end_date, start_date

    days: List[date] = []
    d = start_date
    while d <= end_date:
        days.append(d)
        d += timedelta(days=1)

    start_utc, _ = _day_bounds(start_date)
    _, end_utc = _day_bounds(end_date)

    snapshots = await _snapshots_in_range(
        session,
        account_id=account_id,
        start_utc=start_utc,
        end_utc=end_utc,
    )
    trades = await _trades_in_range(
        session,
        account_id=account_id,
        start_utc=start_utc,
        end_utc=end_utc,
    )
    r_per_trade = await _risk_per_trade(session, account_id)
    frames = _build_day_frames(days, snapshots, trades)

    points: List[PortfolioPnlPointDto] = []
    peak_equity = 0.0
    cumulative_r = 0.0
    best_day_r = 0.0
    worst_day_r = 0.0

    total_win = 0
    total_loss = 0
    total_scratch = 0
    total_trades = 0

    for frame in frames:
        net_pnl = frame.realized + frame.unrealized - frame.fees
        r_unit = r_per_trade * frame.start_equity if frame.start_equity > 0 else 0.0
        r_today = (net_pnl / r_unit) if r_unit > 0 else 0.0
        peak_equity = max(peak_equity, frame.end_equity)
        drawdown_r = 0.0
        if r_unit > 0:
            drawdown_r = max(0.0, (peak_equity - frame.end_equity) / r_unit)
        cumulative_r += r_today
        best_day_r = max(best_day_r, r_today)
        worst_day_r = min(worst_day_r, r_today)

        total_win += frame.winning
        total_loss += frame.losing
        total_scratch += frame.scratching
        total_trades += frame.trade_count

        points.append(
            PortfolioPnlPointDto(
                observedDate=frame.observed_date.isoformat(),
                startEquity=frame.start_equity,
                endEquity=frame.end_equity,
                realized=frame.realized,
                unrealized=frame.unrealized,
                fees=frame.fees,
                netPnl=net_pnl,
                rToday=r_today,
                cumulativeR=cumulative_r,
                drawdownR=drawdown_r,
                peakEquity=peak_equity,
                tradeCount=frame.trade_count,
            )
        )

    starting_equity = points[0].start_equity if points else 0.0
    ending_equity = points[-1].end_equity if points else 0.0
    gross_pnl = sum(p.realized + p.unrealized for p in points)
    net_pnl = sum(p.net_pnl for p in points)
    max_drawdown_r = max((p.drawdown_r for p in points), default=0.0)

    decided = total_win + total_loss
    win_rate = (total_win / decided) if decided > 0 else 0.0
    total_r = cumulative_r

    summary = PortfolioPnlSummaryDto(
        accountId=account_id,
        startDate=start_date.isoformat(),
        endDate=end_date.isoformat(),
        startingEquity=starting_equity,
        endingEquity=ending_equity,
        grossPnl=gross_pnl,
        netPnl=net_pnl,
        totalR=total_r,
        maxDrawdownR=max_drawdown_r,
        winRate=win_rate,
        tradeCount=total_trades,
        winningTrades=total_win,
        losingTrades=total_loss,
        scratchTrades=total_scratch,
        bestDayR=best_day_r,
        worstDayR=worst_day_r,
    )

    return PortfolioPnlReportDto(summary=summary, points=points)


__all__ = ["build_pnl_report"]
