#!/usr/bin/env python3
"""
GodsView — 50-Trade Paper Validation Tracker
=============================================
Persistent service that:
  1. Polls /c4-strategy every POLL_INTERVAL seconds
  2. Detects PAPER_TRADE decisions (C4 >= 80)
  3. Logs full trade details (symbol, TF, direction, C1-C4 breakdown)
  4. Monitors /positions and /trades for outcomes
  5. Computes running stats: win rate, PF, avg R, max DD
  6. Generates summary reports every 10 trades
  7. Final report after 50 trades

Output: docs/backtests/c4/live-validation/
  - trade_log.json          (all signals + outcomes)
  - summary_10.json         (after trade 10)
  - summary_20.json         (after trade 20)
  - ...
  - final_report_50.json    (comprehensive analysis)

Mode: PAPER ONLY — no real money
Author: GodsView Trading Systems
"""

import json
import os
import sys
import time
import logging
import signal as sig_module
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SIGNAL_ENGINE_URL = os.getenv("SIGNAL_ENGINE_URL", "http://localhost:8099")
POLL_INTERVAL = int(os.getenv("TRACKER_POLL_INTERVAL", "120"))  # seconds
TARGET_TRADES = int(os.getenv("TRACKER_TARGET_TRADES", "50"))
REPORT_EVERY = int(os.getenv("TRACKER_REPORT_EVERY", "10"))
C4_THRESHOLD = 80

# Output directory
OUTPUT_DIR = Path(os.getenv(
    "TRACKER_OUTPUT_DIR",
    os.path.join(os.path.dirname(__file__), "..", "docs", "backtests", "c4", "live-validation")
))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TRADE_LOG_FILE = OUTPUT_DIR / "trade_log.json"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(OUTPUT_DIR / "tracker.log"),
    ]
)
log = logging.getLogger("trade_tracker")

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class TrackerState:
    """Persistent state for the trade tracker."""

    def __init__(self):
        self.signals: list[dict] = []        # All C4>=80 signals detected
        self.trades: list[dict] = []         # Completed trades with outcomes
        self.open_signals: dict[str, dict] = {}  # key: symbol_direction -> signal
        self.known_position_ids: set[str] = set()
        self.known_closed_ids: set[str] = set()
        self.scan_count: int = 0
        self.start_time: str = datetime.now(timezone.utc).isoformat()
        self.running: bool = True

    def load(self):
        """Load existing state from trade log file."""
        if TRADE_LOG_FILE.exists():
            try:
                data = json.loads(TRADE_LOG_FILE.read_text())
                self.signals = data.get("signals", [])
                self.trades = data.get("trades", [])
                self.scan_count = data.get("scan_count", 0)
                self.start_time = data.get("start_time", self.start_time)
                # Rebuild known IDs
                for t in self.trades:
                    pid = t.get("position_id")
                    if pid:
                        self.known_closed_ids.add(pid)
                # Rebuild open signals
                for s in self.signals:
                    if s.get("status") == "OPEN":
                        key = f"{s['symbol']}_{s['direction']}"
                        self.open_signals[key] = s
                log.info(
                    "Loaded state: %d signals, %d trades, %d scans",
                    len(self.signals), len(self.trades), self.scan_count
                )
            except Exception as e:
                log.warning("Could not load existing state: %s", e)

    def save(self):
        """Persist state to trade log file."""
        data = {
            "start_time": self.start_time,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "scan_count": self.scan_count,
            "total_signals": len(self.signals),
            "total_trades": len(self.trades),
            "target_trades": TARGET_TRADES,
            "c4_threshold": C4_THRESHOLD,
            "signals": self.signals,
            "trades": self.trades,
        }
        TRADE_LOG_FILE.write_text(json.dumps(data, indent=2, default=str))


state = TrackerState()

# ---------------------------------------------------------------------------
# API Helpers
# ---------------------------------------------------------------------------

def api_get(path: str, timeout: float = 15.0) -> Optional[dict]:
    """GET from signal engine with error handling."""
    try:
        r = requests.get(f"{SIGNAL_ENGINE_URL}{path}", timeout=timeout)
        if r.status_code == 200:
            return r.json()
        log.warning("API %s returned %d", path, r.status_code)
    except requests.exceptions.ConnectionError:
        log.warning("Connection refused: %s", path)
    except Exception as e:
        log.warning("API error %s: %s", path, e)
    return None


# ---------------------------------------------------------------------------
# Core Logic
# ---------------------------------------------------------------------------

def scan_c4_signals():
    """Poll /c4-strategy and detect PAPER_TRADE decisions."""
    data = api_get("/c4-strategy", timeout=30.0)
    if not data:
        return []

    new_signals = []
    now = datetime.now(timezone.utc).isoformat()

    for symbol, sym_data in data.items():
        if "error" in sym_data or "directions" not in sym_data:
            continue

        timeframe = sym_data.get("timeframe", "unknown")
        current_price = sym_data.get("price", 0)

        for direction, d_data in sym_data["directions"].items():
            decision = d_data.get("decision", "")
            total_score = d_data.get("total_score", 0)

            if decision != "PAPER_TRADE" or total_score < C4_THRESHOLD:
                continue

            # Dedup: don't log same signal twice within 30 minutes
            key = f"{symbol}_{direction.upper()}"
            if key in state.open_signals:
                existing = state.open_signals[key]
                existing_time = datetime.fromisoformat(existing["detected_at"])
                if (datetime.now(timezone.utc) - existing_time) < timedelta(minutes=30):
                    continue

            signal = {
                "signal_id": f"SIG-{len(state.signals)+1:04d}",
                "detected_at": now,
                "symbol": symbol,
                "timeframe": timeframe,
                "direction": direction.upper(),
                "current_price": current_price,
                "c4_total": total_score,
                "c1_context": d_data.get("c1_context", {}),
                "c2_confirmation": d_data.get("c2_confirmation", {}),
                "c3_commitment": d_data.get("c3_commitment", {}),
                "c4_control": d_data.get("c4_control", {}),
                "entry_price": d_data.get("entry_price", 0),
                "stop_loss": d_data.get("stop_loss", 0),
                "take_profit": d_data.get("take_profit", 0),
                "risk_reward": d_data.get("risk_reward", 0),
                "confirmations": d_data.get("confirmations", []),
                "warnings": d_data.get("warnings", []),
                "status": "OPEN",
                "position_id": None,
                "outcome": None,
            }

            state.signals.append(signal)
            state.open_signals[key] = signal
            new_signals.append(signal)

            log.info(
                "NEW SIGNAL: %s %s %s C4=%s entry=%.2f SL=%.2f TP=%.2f RR=%.2f",
                signal["signal_id"], symbol, direction.upper(),
                total_score, signal["entry_price"],
                signal["stop_loss"], signal["take_profit"],
                signal["risk_reward"]
            )

    return new_signals


def check_positions():
    """Check /positions for open positions and match to signals."""
    positions = api_get("/positions")
    if not positions:
        return

    for pos in positions:
        pid = pos.get("position_id", "")
        if pid in state.known_position_ids:
            continue

        # Try to match to an open signal
        symbol = pos.get("symbol", "")
        direction = pos.get("direction", "")
        key = f"{symbol}_{direction}"

        if key in state.open_signals:
            signal = state.open_signals[key]
            signal["position_id"] = pid
            signal["actual_entry_price"] = pos.get("entry_price", 0)
            signal["actual_entry_time"] = pos.get("entry_time", "")
            state.known_position_ids.add(pid)
            log.info("Matched position %s to signal %s", pid, signal["signal_id"])


def check_closed_trades():
    """Check /trades for closed positions and record outcomes."""
    trades_data = api_get("/trades")
    if not trades_data:
        return

    for trade in trades_data:
        pid = trade.get("position_id", "")
        if pid in state.known_closed_ids:
            continue

        # Match to signal
        matched_signal = None
        for s in state.signals:
            if s.get("position_id") == pid:
                matched_signal = s
                break

        if not matched_signal:
            # Could be a trade from before tracker started - still record
            symbol = trade.get("symbol", "")
            direction = trade.get("direction", "")
            key = f"{symbol}_{direction}"
            if key in state.open_signals:
                matched_signal = state.open_signals.pop(key, None)

        pnl = trade.get("pnl", 0)
        r_multiple = trade.get("r_multiple", 0)
        close_reason = trade.get("close_reason", "unknown")

        trade_record = {
            "trade_number": len(state.trades) + 1,
            "position_id": pid,
            "signal_id": matched_signal["signal_id"] if matched_signal else "UNMATCHED",
            "symbol": trade.get("symbol", ""),
            "timeframe": trade.get("timeframe", ""),
            "direction": trade.get("direction", ""),
            "entry_price": trade.get("entry_price", 0),
            "entry_time": trade.get("entry_time", ""),
            "close_price": trade.get("close_price", 0),
            "close_time": trade.get("close_time", ""),
            "stop_loss": trade.get("stop_loss", 0),
            "take_profit": trade.get("take_profit", 0),
            "pnl": pnl,
            "pnl_pct": trade.get("pnl_pct", 0),
            "r_multiple": r_multiple,
            "candles_held": trade.get("candles_held", 0),
            "close_reason": close_reason,
            "result": "WIN" if pnl > 0 else "LOSS" if pnl < 0 else "BREAKEVEN",
            "c4_total": matched_signal["c4_total"] if matched_signal else None,
            "c1_context": matched_signal["c1_context"] if matched_signal else None,
            "c2_confirmation": matched_signal["c2_confirmation"] if matched_signal else None,
            "c3_commitment": matched_signal["c3_commitment"] if matched_signal else None,
            "c4_control": matched_signal["c4_control"] if matched_signal else None,
        }

        state.trades.append(trade_record)
        state.known_closed_ids.add(pid)

        # Update signal status
        if matched_signal:
            matched_signal["status"] = "CLOSED"
            matched_signal["outcome"] = trade_record["result"]
            key = f"{trade_record['symbol']}_{trade_record['direction']}"
            state.open_signals.pop(key, None)

        log.info(
            "TRADE #%d CLOSED: %s %s %s PnL=%.2f R=%.2f reason=%s",
            trade_record["trade_number"], trade_record["symbol"],
            trade_record["direction"], trade_record["result"],
            pnl, r_multiple, close_reason
        )

        # Generate report at milestones
        n = len(state.trades)
        if n > 0 and n % REPORT_EVERY == 0:
            generate_summary_report(n)

        if n >= TARGET_TRADES:
            generate_final_report()


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

def compute_stats(trades: list[dict]) -> dict:
    """Compute performance statistics from a list of trades."""
    if not trades:
        return {"error": "no trades"}

    n = len(trades)
    wins = [t for t in trades if t["result"] == "WIN"]
    losses = [t for t in trades if t["result"] == "LOSS"]
    breakevens = [t for t in trades if t["result"] == "BREAKEVEN"]

    win_rate = len(wins) / n * 100 if n > 0 else 0

    # Profit factor
    gross_profit = sum(t["pnl"] for t in wins) if wins else 0
    gross_loss = abs(sum(t["pnl"] for t in losses)) if losses else 0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf") if gross_profit > 0 else 0

    # R multiples
    r_values = [t["r_multiple"] for t in trades if t["r_multiple"] is not None]
    avg_r = sum(r_values) / len(r_values) if r_values else 0
    avg_win_r = sum(t["r_multiple"] for t in wins) / len(wins) if wins else 0
    avg_loss_r = sum(t["r_multiple"] for t in losses) / len(losses) if losses else 0

    # PnL
    total_pnl = sum(t["pnl"] for t in trades)
    avg_pnl = total_pnl / n

    # Max drawdown (cumulative PnL)
    cumulative = []
    running = 0
    peak = 0
    max_dd = 0
    for t in trades:
        running += t["pnl"]
        cumulative.append(running)
        if running > peak:
            peak = running
        dd = peak - running
        if dd > max_dd:
            max_dd = dd

    # Duration
    durations = [t.get("candles_held", 0) for t in trades]
    avg_duration = sum(durations) / len(durations) if durations else 0

    # Best / worst by R
    best_trades = sorted(trades, key=lambda t: t.get("r_multiple", 0), reverse=True)[:5]
    worst_trades = sorted(trades, key=lambda t: t.get("r_multiple", 0))[:5]

    # By symbol
    symbol_stats = {}
    for t in trades:
        sym = t["symbol"]
        if sym not in symbol_stats:
            symbol_stats[sym] = {"trades": 0, "wins": 0, "pnl": 0, "r_sum": 0}
        symbol_stats[sym]["trades"] += 1
        if t["result"] == "WIN":
            symbol_stats[sym]["wins"] += 1
        symbol_stats[sym]["pnl"] += t["pnl"]
        symbol_stats[sym]["r_sum"] += t.get("r_multiple", 0)

    for sym, s in symbol_stats.items():
        s["win_rate"] = round(s["wins"] / s["trades"] * 100, 1) if s["trades"] > 0 else 0
        s["avg_r"] = round(s["r_sum"] / s["trades"], 2) if s["trades"] > 0 else 0
        s["pnl"] = round(s["pnl"], 2)

    # C4 score distribution
    c4_scores = [t["c4_total"] for t in trades if t.get("c4_total") is not None]
    avg_c4 = sum(c4_scores) / len(c4_scores) if c4_scores else 0
    c4_win_scores = [t["c4_total"] for t in wins if t.get("c4_total") is not None]
    c4_loss_scores = [t["c4_total"] for t in losses if t.get("c4_total") is not None]
    avg_c4_win = sum(c4_win_scores) / len(c4_win_scores) if c4_win_scores else 0
    avg_c4_loss = sum(c4_loss_scores) / len(c4_loss_scores) if c4_loss_scores else 0

    # Pillar analysis
    pillar_stats = {"c1": [], "c2": [], "c3": [], "c4_ctrl": []}
    for t in wins:
        if t.get("c1_context"):
            pillar_stats["c1"].append(t["c1_context"].get("total", 0))
        if t.get("c2_confirmation"):
            pillar_stats["c2"].append(t["c2_confirmation"].get("total", 0))
        if t.get("c3_commitment"):
            pillar_stats["c3"].append(t["c3_commitment"].get("total", 0))
        if t.get("c4_control"):
            pillar_stats["c4_ctrl"].append(t["c4_control"].get("total", 0))

    avg_pillar_wins = {
        k: round(sum(v)/len(v), 1) if v else 0
        for k, v in pillar_stats.items()
    }

    return {
        "total_trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "breakevens": len(breakevens),
        "win_rate_pct": round(win_rate, 1),
        "profit_factor": round(profit_factor, 2),
        "total_pnl": round(total_pnl, 2),
        "avg_pnl": round(avg_pnl, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "avg_r_multiple": round(avg_r, 2),
        "avg_win_r": round(avg_win_r, 2),
        "avg_loss_r": round(avg_loss_r, 2),
        "max_drawdown": round(max_dd, 2),
        "avg_candles_held": round(avg_duration, 1),
        "avg_c4_score": round(avg_c4, 1),
        "avg_c4_winners": round(avg_c4_win, 1),
        "avg_c4_losers": round(avg_c4_loss, 1),
        "avg_pillar_scores_winners": avg_pillar_wins,
        "cumulative_pnl": [round(c, 2) for c in cumulative],
        "by_symbol": symbol_stats,
        "best_trades": [
            {"trade_number": t["trade_number"], "symbol": t["symbol"],
             "direction": t["direction"], "r_multiple": t["r_multiple"],
             "c4_total": t.get("c4_total")}
            for t in best_trades
        ],
        "worst_trades": [
            {"trade_number": t["trade_number"], "symbol": t["symbol"],
             "direction": t["direction"], "r_multiple": t["r_multiple"],
             "c4_total": t.get("c4_total")}
            for t in worst_trades
        ],
    }


def generate_summary_report(trade_count: int):
    """Generate a milestone summary report."""
    stats = compute_stats(state.trades[:trade_count])
    report = {
        "report_type": "milestone_summary",
        "trade_count": trade_count,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tracker_start": state.start_time,
        "total_scans": state.scan_count,
        "total_signals_detected": len(state.signals),
        "stats": stats,
    }

    filename = OUTPUT_DIR / f"summary_{trade_count}.json"
    filename.write_text(json.dumps(report, indent=2, default=str))
    log.info("=" * 60)
    log.info("MILESTONE REPORT: %d trades", trade_count)
    log.info("Win Rate: %.1f%%  |  PF: %.2f  |  Avg R: %.2f",
             stats["win_rate_pct"], stats["profit_factor"], stats["avg_r_multiple"])
    log.info("Total PnL: $%.2f  |  Max DD: $%.2f", stats["total_pnl"], stats["max_drawdown"])
    log.info("Report saved: %s", filename)
    log.info("=" * 60)


def generate_final_report():
    """Generate the comprehensive final 50-trade report."""
    stats = compute_stats(state.trades)

    # Recommendations based on stats
    recommendations = []
    if stats["win_rate_pct"] >= 55 and stats["profit_factor"] >= 1.5:
        recommendations.append("POSITIVE: Strategy shows edge. Consider graduating to assisted live.")
    elif stats["win_rate_pct"] >= 50 and stats["profit_factor"] >= 1.2:
        recommendations.append("CAUTIOUS: Marginal edge. Run another 50 trades before live.")
    else:
        recommendations.append("NEGATIVE: No clear edge. Review strategy parameters.")

    if stats["avg_r_multiple"] >= 1.0:
        recommendations.append("R-POSITIVE: Average R >= 1.0 — risk management is working.")
    else:
        recommendations.append("R-CONCERN: Average R < 1.0 — review stop/target placement.")

    if stats["max_drawdown"] > stats["total_pnl"] * 0.5:
        recommendations.append("DD-WARNING: Max drawdown exceeds 50% of total PnL. Tighten risk.")

    # C4 pillar analysis
    if stats.get("avg_c4_winners", 0) > stats.get("avg_c4_losers", 0) + 5:
        recommendations.append("C4-INSIGHT: Winners have significantly higher C4 scores — scoring model is discriminating.")
    else:
        recommendations.append("C4-INSIGHT: Winners and losers have similar C4 scores — scoring may need recalibration.")

    report = {
        "report_type": "final_50_trade_validation",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tracker_start": state.start_time,
        "total_scans": state.scan_count,
        "total_signals_detected": len(state.signals),
        "target_trades": TARGET_TRADES,
        "actual_trades": len(state.trades),
        "stats": stats,
        "recommendations": recommendations,
        "verdict": "PASS" if stats["win_rate_pct"] >= 55 and stats["profit_factor"] >= 1.5 else
                   "MARGINAL" if stats["win_rate_pct"] >= 50 and stats["profit_factor"] >= 1.0 else
                   "FAIL",
        "next_steps": {
            "PASS": "Graduate to assisted live trading with 50% position size",
            "MARGINAL": "Run another 50-trade validation or tune C4 sub-scores",
            "FAIL": "Do not go live. Analyze pillar breakdowns and recalibrate.",
        },
    }

    filename = OUTPUT_DIR / f"final_report_{len(state.trades)}.json"
    filename.write_text(json.dumps(report, indent=2, default=str))

    log.info("=" * 70)
    log.info("FINAL VALIDATION REPORT — %d TRADES", len(state.trades))
    log.info("=" * 70)
    log.info("Win Rate:      %.1f%%", stats["win_rate_pct"])
    log.info("Profit Factor: %.2f", stats["profit_factor"])
    log.info("Average R:     %.2f", stats["avg_r_multiple"])
    log.info("Total PnL:     $%.2f", stats["total_pnl"])
    log.info("Max Drawdown:  $%.2f", stats["max_drawdown"])
    log.info("Verdict:       %s", report["verdict"])
    for rec in recommendations:
        log.info("  → %s", rec)
    log.info("Report saved:  %s", filename)
    log.info("=" * 70)


# ---------------------------------------------------------------------------
# Also track signals that DON'T become trades (for signal quality analysis)
# ---------------------------------------------------------------------------

def scan_signal_outcomes():
    """
    For open signals older than 2 hours with no position match,
    check if price hit TP or SL to measure signal quality even
    without execution.
    """
    now = datetime.now(timezone.utc)
    for s in state.signals:
        if s["status"] != "OPEN":
            continue
        if s.get("position_id"):
            continue

        detected_at = datetime.fromisoformat(s["detected_at"])
        age_hours = (now - detected_at).total_seconds() / 3600

        if age_hours < 4:
            continue  # Give signals time

        # Check current price
        symbol = s["symbol"]
        data = api_get(f"/c4-strategy?symbol={symbol}", timeout=15.0)
        if not data or symbol not in data:
            continue

        current_price = data[symbol].get("price", 0)
        if current_price <= 0:
            continue

        entry = s["entry_price"]
        sl = s["stop_loss"]
        tp = s["take_profit"]
        direction = s["direction"]

        # Check if price would have hit TP or SL
        if direction == "LONG":
            if current_price >= tp:
                s["status"] = "SIGNAL_TP_HIT"
                s["outcome"] = "WOULD_WIN"
            elif current_price <= sl:
                s["status"] = "SIGNAL_SL_HIT"
                s["outcome"] = "WOULD_LOSE"
            elif age_hours > 24:
                s["status"] = "EXPIRED"
                s["outcome"] = "NO_FILL"
        else:  # SHORT
            if current_price <= tp:
                s["status"] = "SIGNAL_TP_HIT"
                s["outcome"] = "WOULD_WIN"
            elif current_price >= sl:
                s["status"] = "SIGNAL_SL_HIT"
                s["outcome"] = "WOULD_LOSE"
            elif age_hours > 24:
                s["status"] = "EXPIRED"
                s["outcome"] = "NO_FILL"

        if s["status"] != "OPEN":
            s["resolved_at"] = now.isoformat()
            s["resolved_price"] = current_price
            key = f"{symbol}_{direction}"
            state.open_signals.pop(key, None)
            log.info(
                "Signal %s resolved: %s (price=%.2f entry=%.2f)",
                s["signal_id"], s["status"], current_price, entry
            )


# ---------------------------------------------------------------------------
# Main Loop
# ---------------------------------------------------------------------------

def graceful_shutdown(signum, frame):
    """Handle SIGTERM/SIGINT gracefully."""
    log.info("Shutdown signal received (sig=%d). Saving state...", signum)
    state.running = False
    state.save()
    log.info("State saved. Exiting.")
    sys.exit(0)


def main():
    log.info("=" * 60)
    log.info("GodsView Paper Trade Tracker — Starting")
    log.info("Target: %d trades  |  Poll: %ds  |  Report every: %d trades",
             TARGET_TRADES, POLL_INTERVAL, REPORT_EVERY)
    log.info("Output: %s", OUTPUT_DIR)
    log.info("Signal Engine: %s", SIGNAL_ENGINE_URL)
    log.info("=" * 60)

    # Register shutdown handlers
    sig_module.signal(sig_module.SIGTERM, graceful_shutdown)
    sig_module.signal(sig_module.SIGINT, graceful_shutdown)

    # Load existing state
    state.load()

    if len(state.trades) >= TARGET_TRADES:
        log.info("Already have %d trades (target: %d). Generating final report.",
                 len(state.trades), TARGET_TRADES)
        generate_final_report()
        return

    # Verify signal engine is reachable
    health = api_get("/health")
    if health:
        log.info("Signal engine healthy: %s", health.get("status", "unknown"))
    else:
        log.warning("Signal engine not reachable. Will retry on next poll.")

    # Main loop
    while state.running:
        try:
            state.scan_count += 1

            # 1. Scan for new C4 signals
            new_signals = scan_c4_signals()
            if new_signals:
                log.info("Detected %d new PAPER_TRADE signals", len(new_signals))

            # 2. Check for position matches
            check_positions()

            # 3. Check for closed trades
            check_closed_trades()

            # 4. Check signal outcomes (for unexecuted signals)
            scan_signal_outcomes()

            # 5. Save state
            state.save()

            # Status log every 10 scans
            if state.scan_count % 10 == 0:
                log.info(
                    "Status: scans=%d signals=%d trades=%d/%d open_signals=%d",
                    state.scan_count, len(state.signals),
                    len(state.trades), TARGET_TRADES,
                    len(state.open_signals)
                )

            # Check if we've hit target
            if len(state.trades) >= TARGET_TRADES:
                log.info("TARGET REACHED: %d trades collected!", len(state.trades))
                generate_final_report()
                log.info("Continuing to monitor... (Ctrl+C to stop)")

        except Exception as e:
            log.error("Main loop error: %s", e, exc_info=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
