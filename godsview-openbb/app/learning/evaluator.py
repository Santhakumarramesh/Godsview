from __future__ import annotations

from typing import Any


def evaluate_replay_metrics(report: dict[str, Any]) -> dict[str, Any]:
    records = list(report.get("records", []) or [])
    if not records:
        return {
            "trades": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "expectancy_r": 0.0,
            "max_drawdown_pct": 0.0,
            "total_pnl_pct": 0.0,
        }

    wins = 0
    losses = 0
    gross_win = 0.0
    gross_loss = 0.0
    total_r = 0.0
    total_pnl = 0.0

    equity = 100.0
    peak = equity
    max_dd = 0.0

    for row in records:
        outcome = str(row.get("outcome", "open")).lower()
        rr = float(row.get("rr", 0.0))
        pnl_pct = float(row.get("pnl_pct", 0.0))
        total_pnl += pnl_pct

        if outcome == "win":
            wins += 1
            gross_win += max(pnl_pct, 0.0)
            total_r += rr
        elif outcome == "loss":
            losses += 1
            gross_loss += abs(min(pnl_pct, 0.0))
            total_r -= 1.0

        equity = equity * (1.0 + pnl_pct / 100.0)
        peak = max(peak, equity)
        dd = ((peak - equity) / max(peak, 1e-9)) * 100.0
        max_dd = max(max_dd, dd)

    closed = wins + losses
    win_rate = wins / closed if closed > 0 else 0.0
    pf = gross_win / gross_loss if gross_loss > 0 else (999.0 if gross_win > 0 else 0.0)
    expectancy_r = total_r / closed if closed > 0 else 0.0

    return {
        "trades": int(len(records)),
        "closed_trades": int(closed),
        "wins": int(wins),
        "losses": int(losses),
        "win_rate": round(float(win_rate), 6),
        "profit_factor": round(float(pf), 6),
        "expectancy_r": round(float(expectancy_r), 6),
        "max_drawdown_pct": round(float(max_dd), 6),
        "total_pnl_pct": round(float(total_pnl), 6),
    }
