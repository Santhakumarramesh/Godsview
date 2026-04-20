"""Deterministic event-driven backtest simulator.

Design
------
The engine is intentionally *simple* and *pure*:

  1. It walks a timestamp-sorted stream of :class:`EngineBar` rows.
  2. On each bar it asks the strategy config "is this a valid setup
     right now?" via :func:`_detect_setup_at_bar`. The detector is
     feature-driven (structure + a sliding volatility window) and
     uses ONLY the last N closed bars — no look-ahead.
  3. When a setup fires, the engine opens a simulated trade the
     *next* bar (latency simulation) at an adjusted price that
     reflects ``frictionBps`` slippage + half-spread on the side of
     the fill.
  4. Open trades are marched through subsequent bars; whichever of
     take-profit / stop-loss / end-of-data is hit first closes the
     trade. PnL is measured in R-multiples (risk = |entry − SL|).

The simulator is fully in-memory — each :func:`run_backtest` call is a
pure function of its inputs, so reruns with the same seed produce
bit-identical output. That determinism is the contract the Experiment
tracker, ranking system, and promotion FSM all depend on.

Why not reuse the production detector chain?
--------------------------------------------
The production detectors in :mod:`app.setups` depend on live DB state
(OrderBlock, FVG, StructureEvent rows). A backtest wants detector
*behaviour* without DB coupling, so the engine ships a stripped-down,
pure-Python detector per setup family. When a production detector grows
a new signal, its quant-lab sibling picks it up via code review (the
shared ``codeHash`` field pins the pairing).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from math import sqrt
from typing import Sequence
from uuid import uuid4

from app.quant_lab.seeder import DeterministicRng
from app.quant_lab.types import (
    BacktestEquityPointDto,
    BacktestMetricsDto,
    BacktestRequestDto,
    BacktestTradeDto,
    DirectionLiteral,
    ExitReasonLiteral,
    SetupTypeLiteral,
    StopStyleLiteral,
    StrategyVersionConfigDto,
    TradeOutcomeLiteral,
)

UTC = timezone.utc


# ───────────────────────────── value objects ────────────────────────────


@dataclass(frozen=True, slots=True)
class EngineBar:
    """Minimal OHLC bar the engine walks.

    Deliberately small — ``symbol_id``, (o, h, l, c, v), and the
    timestamp. Keeps copies cheap when replaying large windows.
    """

    symbol_id: str
    t: datetime
    o: float
    h: float
    l: float
    c: float
    v: float = 0.0


@dataclass(slots=True)
class _OpenTrade:
    """Bookkeeping struct for a trade the engine is currently marching."""

    trade_id: str
    symbol_id: str
    direction: DirectionLiteral
    setup_type: SetupTypeLiteral
    opened_at: datetime
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_abs: float
    size_r: float = 1.0
    mfe_r: float = 0.0
    mae_r: float = 0.0


@dataclass(slots=True)
class BacktestOutcome:
    """Return envelope: ledger + equity curve + aggregate metrics.

    The route layer persists each list into its dedicated table and
    stores the aggregate envelope in ``backtest_runs.metrics``.
    """

    trades: list[BacktestTradeDto] = field(default_factory=list)
    equity_curve: list[BacktestEquityPointDto] = field(default_factory=list)
    metrics: BacktestMetricsDto | None = None


# ───────────────────────────── detector ─────────────────────────────────

# Minimum bars of history the feature detector needs before firing any
# setup. Keeps early-window edge-cases deterministic.
_MIN_HISTORY = 20


def _atr(bars: Sequence[EngineBar], period: int = 14) -> float:
    """True-range based volatility — fallback to hi-lo when no gap."""

    if len(bars) < 2:
        return 0.0
    tail = bars[-period:]
    total = 0.0
    prev_close = tail[0].c
    count = 0
    for bar in tail[1:]:
        tr = max(
            bar.h - bar.l,
            abs(bar.h - prev_close),
            abs(bar.l - prev_close),
        )
        total += tr
        prev_close = bar.c
        count += 1
    return total / count if count else 0.0


def _trend_bias(bars: Sequence[EngineBar], lookback: int = 20) -> int:
    """Return +1 / 0 / -1 for bullish / neutral / bearish based on slope."""

    if len(bars) < lookback:
        return 0
    tail = bars[-lookback:]
    closes = [b.c for b in tail]
    first_half = sum(closes[: lookback // 2]) / (lookback // 2)
    second_half = sum(closes[lookback // 2 :]) / (lookback - lookback // 2)
    if second_half > first_half * 1.0005:
        return 1
    if second_half < first_half * 0.9995:
        return -1
    return 0


@dataclass(slots=True)
class _DetectedSetup:
    direction: DirectionLiteral
    entry: float
    stop_loss: float
    take_profit: float
    setup_type: SetupTypeLiteral
    confidence: float


def _detect_setup_at_bar(
    history: Sequence[EngineBar],
    current: EngineBar,
    *,
    setup_type: SetupTypeLiteral,
    allowed_direction: DirectionLiteral | None,
    stop_style: StopStyleLiteral,
    take_profit_rr: float,
    min_confidence: float,
) -> _DetectedSetup | None:
    """Lightweight pure detector used by every setup family.

    The six canonical setup types share a common structure:

      * ``ob_retest`` / ``breakout_retest`` — trend continuation with a
        pullback entry at the prior session's trigger level.
      * ``liquidity_sweep_reclaim`` / ``fvg_reaction`` — mean-reversion
        at a swept / unfilled level.
      * ``momentum_continuation`` — momentum bar in-trend.
      * ``session_reversal`` — trend exhaustion on an opening-range fade.

    The quant-lab doesn't need every nuance to train the pipeline — it
    needs **determinism** and **non-zero trade volume** so metrics are
    meaningful. We therefore derive one signal shape (trend + volatility
    zone) and apply a per-family filter on top.
    """

    if len(history) < _MIN_HISTORY:
        return None

    trend = _trend_bias(history)
    atr = _atr(history)
    if atr <= 0.0:
        return None

    high_20 = max(b.h for b in history[-20:])
    low_20 = min(b.l for b in history[-20:])
    mid = (high_20 + low_20) / 2

    # Family-specific gating — cheap, deterministic, and keeps trade
    # volumes reasonable even on uneventful windows.
    direction: DirectionLiteral
    entry: float
    confidence: float

    if setup_type in ("ob_retest", "breakout_retest", "momentum_continuation"):
        if trend == 0:
            return None
        direction = "long" if trend > 0 else "short"
        # continuation: enter on a pullback ~0.25 * ATR from the close
        entry = current.c - 0.25 * atr if direction == "long" else current.c + 0.25 * atr
        confidence = 0.55 + min(0.20, (abs(current.c - mid) / atr) * 0.05)

    elif setup_type in ("liquidity_sweep_reclaim", "fvg_reaction"):
        # reversion: fade extremes. Require price near extreme.
        extreme_long = (current.l - low_20) / atr if atr else 1.0
        extreme_short = (high_20 - current.h) / atr if atr else 1.0
        if extreme_long < 0.25 and extreme_short < 0.25:
            return None
        direction = "long" if extreme_long < extreme_short else "short"
        entry = current.c
        confidence = 0.55 + min(0.25, (max(extreme_long, extreme_short)) * 0.05)

    elif setup_type == "session_reversal":
        # fade a strong leg against the broader trend
        leg = current.c - current.o
        if abs(leg) < 0.5 * atr:
            return None
        direction = "short" if leg > 0 else "long"
        entry = current.c
        confidence = 0.55 + min(0.20, abs(leg) / (atr * 2))

    else:  # pragma: no cover — defensive
        return None

    # Enforce explicit direction filter if the strategy pinned one side.
    if allowed_direction is not None and direction != allowed_direction:
        return None

    if confidence < min_confidence:
        return None

    # Stop placement
    if stop_style == "fixed_r":
        stop_distance = atr
    elif stop_style == "atr":
        stop_distance = 1.25 * atr
    else:  # "structure" — use the 20-bar swing opposite side
        if direction == "long":
            stop_distance = max(atr * 0.75, entry - low_20)
        else:
            stop_distance = max(atr * 0.75, high_20 - entry)

    if stop_distance <= 0.0:
        return None

    stop_loss = entry - stop_distance if direction == "long" else entry + stop_distance
    take_profit = (
        entry + stop_distance * take_profit_rr
        if direction == "long"
        else entry - stop_distance * take_profit_rr
    )

    return _DetectedSetup(
        direction=direction,
        entry=entry,
        stop_loss=stop_loss,
        take_profit=take_profit,
        setup_type=setup_type,
        confidence=confidence,
    )


# ───────────────────────────── engine core ──────────────────────────────


def _slippage_price(
    base_price: float,
    direction: DirectionLiteral,
    friction_bps: float,
    rng: DeterministicRng,
) -> float:
    """Apply frictional slippage on the side of the fill."""

    if friction_bps <= 0:
        return base_price
    jitter = 1.0 + rng.uniform(-0.25, 0.25)
    slip = base_price * (friction_bps * 1e-4) * jitter
    return base_price + slip if direction == "long" else base_price - slip


def _latency_offset_bars(
    bars: Sequence[EngineBar],
    current_index: int,
    latency_ms: int,
) -> int:
    """Return the index offset (>=1) for the fill bar given latency.

    We use the inter-bar spacing to translate millisecond latency into a
    whole number of bars. A zero-latency call still costs one bar
    (can't fill on the detection bar's close).
    """

    if current_index + 1 >= len(bars):
        return 0
    if latency_ms <= 0:
        return 1
    # infer bar spacing from the two most recent bars
    dt_ms = max(
        1,
        int(
            (bars[current_index].t - bars[current_index - 1].t).total_seconds()
            * 1000
        ),
    )
    return max(1, int(latency_ms // dt_ms) + 1)


def _close_trade(
    trade: _OpenTrade,
    *,
    close_ts: datetime,
    close_price: float,
    exit_reason: ExitReasonLiteral,
    backtest_id: str,
) -> BacktestTradeDto:
    """Finalise a trade into its wire DTO."""

    pnl_abs = (
        close_price - trade.entry_price
        if trade.direction == "long"
        else trade.entry_price - close_price
    )
    risk_abs = trade.risk_abs
    pnl_r = pnl_abs / risk_abs if risk_abs > 0 else 0.0
    outcome: TradeOutcomeLiteral
    if pnl_r > 0.05:
        outcome = "win"
    elif pnl_r < -0.05:
        outcome = "loss"
    else:
        outcome = "scratch"

    # Include final bar move in the MFE/MAE summary
    mfe_r = max(trade.mfe_r, pnl_r)
    mae_r = min(trade.mae_r, pnl_r)

    # We treat pnlDollars and pnlR 1:1 — the engine runs in R-space and
    # the route layer scales by the request's startingEquity when
    # computing the equity curve.
    return BacktestTradeDto(
        id=f"bkt_trd_{uuid4().hex}",
        backtestId=backtest_id,
        symbolId=trade.symbol_id,
        direction=trade.direction,
        openedAt=trade.opened_at,
        closedAt=close_ts,
        entryPrice=trade.entry_price,
        exitPrice=close_price,
        stopLoss=trade.stop_loss,
        takeProfit=trade.take_profit,
        sizeR=trade.size_r,
        pnlR=pnl_r,
        pnlDollars=pnl_r * risk_abs,
        outcome=outcome,
        mfeR=mfe_r,
        maeR=mae_r,
    )


def _compute_metrics(
    trades: Sequence[BacktestTradeDto],
    *,
    started_at: datetime,
    ended_at: datetime,
) -> BacktestMetricsDto:
    """Aggregate the trade ledger into a :class:`BacktestMetricsDto`."""

    total = len(trades)
    wins = sum(1 for t in trades if t.outcome == "win")
    losses = sum(1 for t in trades if t.outcome == "loss")
    scratches = total - wins - losses
    win_rate = wins / total if total else 0.0
    profit_wins = sum(t.pnlR for t in trades if t.pnlR > 0)
    profit_losses = abs(sum(t.pnlR for t in trades if t.pnlR < 0))
    profit_factor = (
        profit_wins / profit_losses
        if profit_losses > 0
        else (1000.0 if profit_wins > 0 else 0.0)
    )
    r_series = [t.pnlR for t in trades]
    expectancy = (sum(r_series) / total) if total else 0.0

    # Sharpe on per-trade returns
    if total >= 2:
        mean = expectancy
        variance = sum((r - mean) ** 2 for r in r_series) / (total - 1)
        stddev = sqrt(variance)
        sharpe = (mean / stddev) * sqrt(total) if stddev > 0 else 0.0
        downside = [r - mean for r in r_series if r < mean]
        if downside:
            d_variance = sum(d * d for d in downside) / len(downside)
            d_std = sqrt(d_variance)
            sortino = (mean / d_std) * sqrt(total) if d_std > 0 else 0.0
        else:
            sortino = sharpe
    else:
        sharpe = 0.0
        sortino = 0.0

    cumulative = 0.0
    peak = 0.0
    max_dd = 0.0
    for r in r_series:
        cumulative += r
        peak = max(peak, cumulative)
        drawdown = cumulative - peak  # negative or zero
        max_dd = min(max_dd, drawdown)

    mean_mae = sum(t.maeR for t in trades) / total if total else 0.0
    mean_mfe = sum(t.mfeR for t in trades) / total if total else 0.0

    return BacktestMetricsDto(
        totalTrades=total,
        wins=wins,
        losses=losses,
        scratches=scratches,
        winRate=win_rate,
        profitFactor=profit_factor,
        expectancyR=expectancy,
        sharpe=sharpe,
        sortino=sortino,
        maxDrawdownR=max_dd,
        meanMAER=mean_mae,
        meanMFER=mean_mfe,
        totalR=sum(r_series),
        startedAt=started_at,
        endedAt=ended_at,
    )


# ───────────────────────────── entry point ──────────────────────────────


def run_backtest(
    *,
    backtest_id: str,
    request: BacktestRequestDto,
    version_config: StrategyVersionConfigDto,
    bars_by_symbol: dict[str, Sequence[EngineBar]],
) -> BacktestOutcome:
    """Run the deterministic simulator and return the outcome envelope.

    The engine walks every symbol in parallel using a merged-timestamp
    cursor so trades from different symbols interleave realistically.
    """

    rng = DeterministicRng(seed=request.seed)
    entry = version_config.entry
    exit_rules = version_config.exit
    min_confidence = entry.minConfidence
    allowed_direction = entry.direction
    setup_type: SetupTypeLiteral = entry.setupType
    stop_style = exit_rules.stopStyle
    take_profit_rr = exit_rules.takeProfitRR
    max_concurrent = max(1, version_config.sizing.maxConcurrent)

    # Flatten per-symbol bars into a merged index so we can step through
    # time monotonically.
    symbol_sequences: dict[str, list[EngineBar]] = {
        symbol_id: sorted(
            [b for b in bars if request.startAt <= b.t <= request.endAt],
            key=lambda b: b.t,
        )
        for symbol_id, bars in bars_by_symbol.items()
    }

    # Build a list of (ts, symbol_id, bar_index_in_symbol) ordered by ts
    # so the engine sees bars in true wall-clock order.
    cursor: list[tuple[datetime, str, int]] = []
    for symbol_id, seq in symbol_sequences.items():
        for idx, bar in enumerate(seq):
            cursor.append((bar.t, symbol_id, idx))
    cursor.sort(key=lambda row: (row[0], row[1], row[2]))

    open_trades: list[_OpenTrade] = []
    closed: list[BacktestTradeDto] = []
    # `pending_entries` are "enter at next bar after latency" orders.
    pending: list[tuple[str, int, _DetectedSetup]] = []

    for ts, symbol_id, idx in cursor:
        seq = symbol_sequences[symbol_id]
        bar = seq[idx]

        # 1. March open trades on this symbol first (check SL/TP against
        #    this bar's range). Process in fifo order so the earliest
        #    entered trade closes first if both levels are swept.
        still_open: list[_OpenTrade] = []
        for trade in open_trades:
            if trade.symbol_id != symbol_id:
                still_open.append(trade)
                continue

            # Maintain MFE / MAE against the bar's range.
            if trade.direction == "long":
                mfe_abs = bar.h - trade.entry_price
                mae_abs = bar.l - trade.entry_price
            else:
                mfe_abs = trade.entry_price - bar.l
                mae_abs = trade.entry_price - bar.h
            trade.mfe_r = max(trade.mfe_r, mfe_abs / trade.risk_abs)
            trade.mae_r = min(trade.mae_r, mae_abs / trade.risk_abs)

            closed_trade: BacktestTradeDto | None = None
            if trade.direction == "long":
                if bar.l <= trade.stop_loss and bar.h >= trade.take_profit:
                    # intrabar ambiguity: use rng to decide, seeded
                    rng_pick = rng.uniform(0, 1)
                    if rng_pick < 0.5:
                        closed_trade = _close_trade(
                            trade,
                            close_ts=bar.t,
                            close_price=trade.stop_loss,
                            exit_reason="stop_loss",
                            backtest_id=backtest_id,
                        )
                    else:
                        closed_trade = _close_trade(
                            trade,
                            close_ts=bar.t,
                            close_price=trade.take_profit,
                            exit_reason="take_profit",
                            backtest_id=backtest_id,
                        )
                elif bar.l <= trade.stop_loss:
                    closed_trade = _close_trade(
                        trade,
                        close_ts=bar.t,
                        close_price=trade.stop_loss,
                        exit_reason="stop_loss",
                        backtest_id=backtest_id,
                    )
                elif bar.h >= trade.take_profit:
                    closed_trade = _close_trade(
                        trade,
                        close_ts=bar.t,
                        close_price=trade.take_profit,
                        exit_reason="take_profit",
                        backtest_id=backtest_id,
                    )
            else:  # short
                if bar.h >= trade.stop_loss and bar.l <= trade.take_profit:
                    rng_pick = rng.uniform(0, 1)
                    if rng_pick < 0.5:
                        closed_trade = _close_trade(
                            trade,
                            close_ts=bar.t,
                            close_price=trade.stop_loss,
                            exit_reason="stop_loss",
                            backtest_id=backtest_id,
                        )
                    else:
                        closed_trade = _close_trade(
                            trade,
                            close_ts=bar.t,
                            close_price=trade.take_profit,
                            exit_reason="take_profit",
                            backtest_id=backtest_id,
                        )
                elif bar.h >= trade.stop_loss:
                    closed_trade = _close_trade(
                        trade,
                        close_ts=bar.t,
                        close_price=trade.stop_loss,
                        exit_reason="stop_loss",
                        backtest_id=backtest_id,
                    )
                elif bar.l <= trade.take_profit:
                    closed_trade = _close_trade(
                        trade,
                        close_ts=bar.t,
                        close_price=trade.take_profit,
                        exit_reason="take_profit",
                        backtest_id=backtest_id,
                    )

            if closed_trade is not None:
                closed.append(closed_trade)
            else:
                still_open.append(trade)

        open_trades = still_open

        # 2. Resolve any pending entries that target this (symbol, idx)
        fresh_pending: list[tuple[str, int, _DetectedSetup]] = []
        for p_symbol, fill_idx, setup in pending:
            if p_symbol != symbol_id:
                fresh_pending.append((p_symbol, fill_idx, setup))
                continue
            if idx < fill_idx:
                fresh_pending.append((p_symbol, fill_idx, setup))
                continue
            if len(open_trades) >= max_concurrent:
                # dropped — concurrency guard
                continue
            fill_price = _slippage_price(
                setup.entry,
                setup.direction,
                request.frictionBps,
                rng,
            )
            risk_abs = abs(fill_price - setup.stop_loss)
            if risk_abs <= 0:
                continue
            open_trades.append(
                _OpenTrade(
                    trade_id=f"bkt_trd_{uuid4().hex}",
                    symbol_id=symbol_id,
                    direction=setup.direction,
                    setup_type=setup.setup_type,
                    opened_at=bar.t,
                    entry_price=fill_price,
                    stop_loss=setup.stop_loss,
                    take_profit=setup.take_profit,
                    risk_abs=risk_abs,
                    size_r=1.0,
                )
            )
        pending = fresh_pending

        # 3. Fresh detection (only if we have head-room + bar count)
        history = seq[:idx]  # strictly-prior closed bars
        detected = _detect_setup_at_bar(
            history,
            bar,
            setup_type=setup_type,
            allowed_direction=allowed_direction,
            stop_style=stop_style,
            take_profit_rr=take_profit_rr,
            min_confidence=min_confidence,
        )
        if detected is None:
            continue

        # Only fire if we have room for another position on this symbol.
        same_symbol_open = sum(1 for t in open_trades if t.symbol_id == symbol_id)
        if same_symbol_open >= max_concurrent:
            continue

        offset = _latency_offset_bars(seq, idx, request.latencyMs)
        if offset == 0:
            continue  # no room for a latency-offset fill bar
        fill_idx = idx + offset
        if fill_idx >= len(seq):
            continue
        pending.append((symbol_id, fill_idx, detected))

    # End-of-data sweep — close any still-open trades at the last close.
    if open_trades:
        # Close each at the last bar for its symbol.
        for trade in open_trades:
            seq = symbol_sequences.get(trade.symbol_id, [])
            if not seq:
                continue
            last_bar = seq[-1]
            closed.append(
                _close_trade(
                    trade,
                    close_ts=last_bar.t,
                    close_price=last_bar.c,
                    exit_reason="end_of_data",
                    backtest_id=backtest_id,
                )
            )

    # Sort closed trades by closeAt so the ledger + equity curve align.
    closed.sort(key=lambda t: (t.closedAt, t.symbolId))

    # Build equity curve (per-trade samples, plus start point).
    starting_equity = request.startingEquity
    equity_points: list[BacktestEquityPointDto] = [
        BacktestEquityPointDto(
            ts=request.startAt,
            equity=starting_equity,
            cumulativeR=0.0,
            drawdownR=0.0,
        )
    ]
    cumulative_r = 0.0
    peak_r = 0.0
    for trade in closed:
        cumulative_r += trade.pnlR
        peak_r = max(peak_r, cumulative_r)
        drawdown = cumulative_r - peak_r
        # We scale equity by the perTrade risk dollars so the dollar
        # figure is meaningful even though we size every trade at 1R.
        per_trade_r_dollars = starting_equity * version_config.sizing.perTradeR
        equity = starting_equity + cumulative_r * per_trade_r_dollars
        equity_points.append(
            BacktestEquityPointDto(
                ts=trade.closedAt,
                equity=equity,
                cumulativeR=cumulative_r,
                drawdownR=drawdown,
            )
        )

    metrics = _compute_metrics(
        closed,
        started_at=request.startAt,
        ended_at=request.endAt,
    )

    return BacktestOutcome(
        trades=closed,
        equity_curve=equity_points,
        metrics=metrics,
    )


__all__ = [
    "BacktestOutcome",
    "EngineBar",
    "run_backtest",
]
