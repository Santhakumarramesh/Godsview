"""
GodsView v2 — Backtest metrics computation.

All metrics follow industry-standard definitions:
  Win Rate, Profit Factor, Sharpe Ratio, Sortino Ratio,
  Calmar Ratio, Max Drawdown, Expectancy, Recovery Factor,
  MAE (Maximum Adverse Excursion), MFE (Maximum Favorable Excursion).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

from services.shared.types import BacktestMetrics, Trade, TradeOutcome, Bar


@dataclass
class TradeExcursion:
    """Track MAE/MFE for a single trade."""
    trade_id: str
    entry_price: float
    direction: str  # LONG or SHORT
    mae: float = 0.0  # Maximum adverse excursion (worst unrealised loss)
    mfe: float = 0.0  # Maximum favorable excursion (best unrealised profit)


def compute_mae_mfe(
    trades: Sequence[Trade],
    bars: Sequence[Bar],
) -> dict[str, dict]:
    """
    Compute MAE/MFE for each closed trade.

    Args:
        trades: List of closed trades
        bars: Full list of bars (to reconstruct price history)

    Returns:
        Dict mapping trade_id to {mae, mfe, efficiency, exit_efficiency, mae_pct, mfe_pct}
    """
    excursions = {}

    # Build bar map for fast lookup
    bar_map = {}
    for bar in bars:
        bar_map[bar.timestamp] = bar

    for trade in trades:
        if not trade.entry_time or not trade.exit_time:
            continue

        entry_idx = None
        exit_idx = None
        for i, bar in enumerate(bars):
            if bar.timestamp == trade.entry_time:
                entry_idx = i
            if bar.timestamp == trade.exit_time:
                exit_idx = i

        if entry_idx is None or exit_idx is None:
            continue

        mae = 0.0
        mfe = 0.0

        # Scan bars from entry to exit
        for i in range(entry_idx, exit_idx + 1):
            bar = bars[i]

            if trade.direction.value == "LONG":
                # Adverse = low below entry, Favorable = high above entry
                adverse = max(0, trade.entry_price - bar.low)
                favorable = max(0, bar.high - trade.entry_price)
            else:  # SHORT
                # Adverse = high above entry, Favorable = low below entry
                adverse = max(0, bar.high - trade.entry_price)
                favorable = max(0, trade.entry_price - bar.low)

            mae = max(mae, adverse)
            mfe = max(mfe, favorable)

        # Efficiency metrics
        efficiency = (mfe / mae) if mae > 0 else 0.0  # MFE/MAE ratio
        actual_profit = trade.pnl / trade.size if trade.size > 0 else 0.0
        exit_efficiency = (actual_profit / mfe) if mfe > 0 else 0.0  # Profit captured

        # Percentage excursions
        mae_pct = (mae / trade.entry_price) if trade.entry_price > 0 else 0.0
        mfe_pct = (mfe / trade.entry_price) if trade.entry_price > 0 else 0.0

        excursions[trade.id] = {
            "mae": round(mae, 6),
            "mfe": round(mfe, 6),
            "mae_pct": round(mae_pct, 6),
            "mfe_pct": round(mfe_pct, 6),
            "efficiency": round(efficiency, 4),  # MFE/MAE
            "exit_efficiency": round(exit_efficiency, 4),  # Actual / MFE
        }

    return excursions


def compute_metrics(
    trades: Sequence[Trade],
    equity_curve: list[dict],
    initial_equity: float,
    bars_per_year:  float = 252.0,
    bars: Sequence[Bar] | None = None,
) -> BacktestMetrics:
    """
    Compute comprehensive backtest metrics from a list of closed trades
    and the equity curve.

    Args:
        trades: List of closed trades
        equity_curve: Equity curve points
        initial_equity: Starting capital
        bars_per_year: Bars per annum (for annualization)
        bars: Full bar list (for MAE/MFE computation)
    """
    if not trades:
        return BacktestMetrics()

    closed = [t for t in trades if t.outcome != TradeOutcome.OPEN]
    n = len(closed)
    if n == 0:
        return BacktestMetrics()

    pnls      = [t.pnl     for t in closed]
    pnl_pcts  = [t.pnl_pct for t in closed]

    wins  = [p for p in pnls if p > 0]
    loss  = [p for p in pnls if p < 0]
    n_win = len(wins)
    n_los = len(loss)

    win_rate     = n_win / n if n else 0.0
    total_pnl    = sum(pnls)
    gross_profit = sum(wins)
    gross_loss   = abs(sum(loss)) or 1e-8
    profit_factor = gross_profit / gross_loss

    avg_win_pct  = sum(p for p in pnl_pcts if p > 0) / n_win if n_win else 0.0
    avg_loss_pct = sum(abs(p) for p in pnl_pcts if p < 0) / n_los if n_los else 0.0
    expectancy   = (win_rate * avg_win_pct) - ((1 - win_rate) * avg_loss_pct)

    avg_rr = (
        (avg_win_pct / avg_loss_pct) if avg_loss_pct else 0.0
    )

    # ── Max drawdown ─────────────────────────────────────────────────────────
    max_dd, max_dd_pct = _max_drawdown(equity_curve)

    # ── Sharpe / Sortino ─────────────────────────────────────────────────────
    sharpe  = _sharpe(pnl_pcts, bars_per_year)
    sortino = _sortino(pnl_pcts, bars_per_year)

    # ── Calmar = CAGR / max_drawdown ─────────────────────────────────────────
    final_equity = equity_curve[-1]["equity"] if equity_curve else initial_equity
    total_return = (final_equity - initial_equity) / initial_equity
    n_years = n / bars_per_year
    cagr = (1 + total_return) ** (1 / n_years) - 1 if n_years > 0 else 0.0
    calmar = cagr / max_dd_pct if max_dd_pct > 0 else 0.0

    recovery = total_pnl / max_dd if max_dd else 0.0
    total_pnl_pct = total_pnl / initial_equity if initial_equity else 0.0

    # ── Signal rate ──────────────────────────────────────────────────────────
    total_bars  = equity_curve[-1].get("total_bars", 0) if equity_curve else 0
    signal_rate = n / total_bars if total_bars else 0.0

    # ── MAE / MFE ────────────────────────────────────────────────────────────
    mae_dict = {}
    if bars:
        mae_dict = compute_mae_mfe(closed, bars)

    maes = [v["mae"] for v in mae_dict.values()] if mae_dict else []
    mfes = [v["mfe"] for v in mae_dict.values()] if mae_dict else []
    efficiencies = [v["efficiency"] for v in mae_dict.values()] if mae_dict else []
    exit_effs = [v["exit_efficiency"] for v in mae_dict.values()] if mae_dict else []

    avg_mae = sum(maes) / len(maes) if maes else 0.0
    max_mae = max(maes) if maes else 0.0
    avg_mfe = sum(mfes) / len(mfes) if mfes else 0.0
    max_mfe = max(mfes) if mfes else 0.0
    avg_efficiency = sum(efficiencies) / len(efficiencies) if efficiencies else 0.0
    avg_exit_eff = sum(exit_effs) / len(exit_effs) if exit_effs else 0.0

    metrics_dict = {
        "total_trades": n,
        "winning_trades": n_win,
        "losing_trades": n_los,
        "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 3),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl_pct, 4),
        "max_drawdown": round(max_dd, 2),
        "max_drawdown_pct": round(max_dd_pct, 4),
        "sharpe_ratio": round(sharpe, 3),
        "sortino_ratio": round(sortino, 3),
        "calmar_ratio": round(calmar, 3),
        "avg_rr": round(avg_rr, 2),
        "avg_win_pct": round(avg_win_pct, 4),
        "avg_loss_pct": round(avg_loss_pct, 4),
        "expectancy": round(expectancy, 4),
        "recovery_factor": round(recovery, 2),
        "total_bars": total_bars,
        "signal_rate": round(signal_rate, 4),
        "avg_mae": round(avg_mae, 6),
        "max_mae": round(max_mae, 6),
        "avg_mfe": round(avg_mfe, 6),
        "max_mfe": round(max_mfe, 6),
        "avg_efficiency": round(avg_efficiency, 4),
        "avg_exit_efficiency": round(avg_exit_eff, 4),
    }

    return BacktestMetrics(**metrics_dict)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _max_drawdown(equity_curve: list[dict]) -> tuple[float, float]:
    """Return (max_dd_dollar, max_dd_pct) from the equity curve."""
    if not equity_curve:
        return 0.0, 0.0

    peak    = equity_curve[0]["equity"]
    max_dd  = 0.0
    max_pct = 0.0

    for point in equity_curve:
        eq = point["equity"]
        if eq > peak:
            peak = eq
        dd     = peak - eq
        dd_pct = dd / peak if peak else 0.0
        if dd > max_dd:
            max_dd  = dd
            max_pct = dd_pct

    return max_dd, max_pct


def _sharpe(returns: list[float], bars_per_year: float, risk_free: float = 0.0) -> float:
    """Annualised Sharpe ratio."""
    n = len(returns)
    if n < 2:
        return 0.0
    mu  = sum(returns) / n
    var = sum((r - mu) ** 2 for r in returns) / (n - 1)
    std = math.sqrt(var)
    if std == 0:
        return 0.0
    return (mu - risk_free / bars_per_year) / std * math.sqrt(bars_per_year)


def _sortino(returns: list[float], bars_per_year: float, risk_free: float = 0.0) -> float:
    """Annualised Sortino ratio (downside deviation)."""
    n = len(returns)
    if n < 2:
        return 0.0
    mu         = sum(returns) / n
    downside_r = [r for r in returns if r < 0]
    if not downside_r:
        return float("inf")
    dd_var = sum(r ** 2 for r in downside_r) / len(downside_r)
    dd_std = math.sqrt(dd_var)
    if dd_std == 0:
        return 0.0
    return (mu - risk_free / bars_per_year) / dd_std * math.sqrt(bars_per_year)
