"""
GodsView v2 — Missed Trade Detector.

Detects and analyzes opportunities that GodsView should have taken but didn't:
  - Signal detected but rejected by risk/ML gates
  - Price moved significantly but no signal detected
  - Computes phantom outcomes: what WOULD have happened if trade was taken
  - Tracks systematic miss patterns (e.g., consistently missing momentum setups)
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

from services.shared.config import cfg
from services.shared.logging import get_logger
from services.shared.types import Bar, Signal, Direction

log = get_logger(__name__)

_DB_PATH = Path(cfg.data_dir) / "missed_trades.db"


class MissedTradeDetector:
    """Tracks and analyzes missed trading opportunities."""

    def __init__(self) -> None:
        self._conn: Optional[sqlite3.Connection] = None
        self._ready = False

    async def init(self) -> None:
        try:
            _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
            self._create_schema()
            self._ready = True
            log.info("missed_trade_detector_ready", path=str(_DB_PATH))
        except Exception as exc:
            log.error("missed_trade_detector_init_failed", err=str(exc))

    def _create_schema(self) -> None:
        if self._conn is None:
            return
        cursor = self._conn.cursor()

        # Missed signals: detected but rejected
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS missed_signals (
                id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                setup_type TEXT,
                timeframe TEXT DEFAULT '15min',
                reason TEXT,
                signal_confidence REAL,
                entry_price REAL,
                stop_loss REAL,
                take_profit REAL,
                tags TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Phantom trades: what WOULD have happened
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS phantom_trades (
                id TEXT PRIMARY KEY,
                signal_id TEXT,
                symbol TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                setup_type TEXT,
                direction TEXT,
                entry_price REAL,
                stop_loss REAL,
                take_profit REAL,
                exit_price REAL,
                exit_reason TEXT,
                bars_held INT,
                phantom_pnl_pct REAL,
                phantom_outcome TEXT,
                mae REAL,
                mfe REAL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(signal_id) REFERENCES missed_signals(id)
            )
        """)

        # Opportunity cost analysis
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS opportunity_analysis (
                id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                missed_count INT,
                total_phantom_pnl REAL,
                avg_phantom_pnl_pct REAL,
                win_rate_phantom REAL,
                opportunity_cost_pct REAL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_missed_symbol_date
            ON missed_signals(symbol, timestamp)
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_phantom_outcome
            ON phantom_trades(symbol, phantom_outcome)
        """)

        self._conn.commit()

    async def record_missed_signal(
        self,
        signal: Signal,
        rejection_reason: str,
        rejection_score: float = 0.0,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        """Record a signal that was detected but rejected."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        missed_id = str(uuid.uuid4())

        try:
            cursor = self._conn.cursor()
            cursor.execute("""
                INSERT INTO missed_signals (
                    id, symbol, timestamp, setup_type, timeframe,
                    reason, signal_confidence, entry_price,
                    stop_loss, take_profit, tags
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                missed_id,
                signal.symbol,
                signal.timestamp.isoformat(),
                signal.signal_type.value,
                signal.timeframe,
                rejection_reason,
                float(signal.confidence),
                float(signal.entry),
                float(signal.stop),
                float(signal.target),
                json.dumps(tags or []),
            ))
            self._conn.commit()

            log.info(
                "missed_signal_recorded",
                id=missed_id,
                symbol=signal.symbol,
                reason=rejection_reason,
            )

            return {
                "id": missed_id,
                "status": "recorded",
                "symbol": signal.symbol,
                "reason": rejection_reason,
            }

        except Exception as exc:
            log.error("missed_signal_record_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}

    async def compute_phantom_outcome(
        self,
        signal: Signal,
        future_bars: list[Bar],
    ) -> dict[str, Any]:
        """Simulate what would have happened if the trade was taken."""
        if not future_bars or not signal:
            return {"status": "insufficient_data"}

        phantom_id = str(uuid.uuid4())

        try:
            entry = signal.entry
            sl = signal.stop
            tp = signal.target
            direction = signal.direction

            # Find if SL or TP is hit first
            exit_price = None
            exit_reason = None
            bars_held = 0
            mae = 0.0  # Maximum Adverse Excursion
            mfe = 0.0  # Maximum Favorable Excursion

            for i, bar in enumerate(future_bars):
                bars_held = i + 1

                if direction == "long":
                    mae = min(mae, bar.low - entry)
                    mfe = max(mfe, bar.high - entry)

                    if bar.low <= sl:
                        exit_price = sl
                        exit_reason = "stop_loss"
                        break
                    elif bar.high >= tp:
                        exit_price = tp
                        exit_reason = "take_profit"
                        break

                else:  # short
                    mae = min(mae, entry - bar.high)
                    mfe = max(mfe, entry - bar.low)

                    if bar.high >= sl:
                        exit_price = sl
                        exit_reason = "stop_loss"
                        break
                    elif bar.low <= tp:
                        exit_price = tp
                        exit_reason = "take_profit"
                        break

            # If no exit, use last close
            if exit_price is None:
                exit_price = future_bars[-1].close
                exit_reason = "time_stop"

            # Calculate phantom P&L
            if direction == "long":
                phantom_pnl = exit_price - entry
            else:
                phantom_pnl = entry - exit_price

            phantom_pnl_pct = (phantom_pnl / entry) * 100 if entry != 0 else 0.0
            phantom_outcome = "win" if phantom_pnl > 0 else "loss" if phantom_pnl < 0 else "breakeven"

            # Store in database
            if self._conn:
                cursor = self._conn.cursor()
                cursor.execute("""
                    INSERT INTO phantom_trades (
                        id, signal_id, symbol, timestamp, setup_type, direction,
                        entry_price, stop_loss, take_profit, exit_price,
                        exit_reason, bars_held, phantom_pnl_pct, phantom_outcome,
                        mae, mfe
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    phantom_id,
                    "",  # No signal_id for standalone phantom
                    signal.symbol,
                    signal.timestamp.isoformat(),
                    signal.signal_type.value,
                    signal.direction.value,
                    float(entry),
                    float(sl),
                    float(tp),
                    float(exit_price),
                    exit_reason,
                    bars_held,
                    float(phantom_pnl_pct),
                    phantom_outcome,
                    float(mae),
                    float(mfe),
                ))
                self._conn.commit()

            log.info(
                "phantom_trade_computed",
                id=phantom_id,
                symbol=signal.symbol,
                outcome=phantom_outcome,
                pnl_pct=phantom_pnl_pct,
            )

            return {
                "id": phantom_id,
                "status": "computed",
                "symbol": signal.symbol,
                "entry": entry,
                "exit": exit_price,
                "exit_reason": exit_reason,
                "phantom_pnl_pct": round(phantom_pnl_pct, 2),
                "phantom_outcome": phantom_outcome,
                "mae": round(mae, 2),
                "mfe": round(mfe, 2),
                "bars_held": bars_held,
            }

        except Exception as exc:
            log.error("phantom_outcome_computation_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}

    async def get_missed_opportunities(
        self,
        symbol: str | None = None,
        days_back: int = 30,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """List missed trading opportunities."""
        if not self._ready or self._conn is None:
            return []

        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()

            query = """
                SELECT id, symbol, timestamp, setup_type, reason,
                       signal_confidence, entry_price, stop_loss, take_profit
                FROM missed_signals
                WHERE timestamp >= ?
            """
            params = [cutoff]

            if symbol:
                query += " AND symbol = ?"
                params.append(symbol)

            query += " ORDER BY timestamp DESC LIMIT ?"
            params.append(limit)

            cursor = self._conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()

            return [
                {
                    "id": row[0],
                    "symbol": row[1],
                    "timestamp": row[2],
                    "setup_type": row[3],
                    "reason": row[4],
                    "confidence": row[5],
                    "entry": row[6],
                    "stop_loss": row[7],
                    "take_profit": row[8],
                }
                for row in rows
            ]

        except Exception as exc:
            log.error("missed_opportunities_fetch_failed", err=str(exc))
            return []

    async def compute_opportunity_cost(
        self,
        symbol: str | None = None,
        days_back: int = 30,
    ) -> dict[str, Any]:
        """Calculate opportunity cost: total $ left on table."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()

            query = """
                SELECT COUNT(*), SUM(phantom_pnl_pct)
                FROM phantom_trades
                WHERE timestamp >= ?
            """
            params = [cutoff]

            if symbol:
                query += " AND symbol = ?"
                params.append(symbol)

            cursor = self._conn.cursor()
            cursor.execute(query, params)
            count, total_pnl = cursor.fetchone()

            count = count or 0
            total_pnl = total_pnl or 0.0
            avg_pnl = (total_pnl / count) if count > 0 else 0.0

            # Win rate on phantom trades
            cursor.execute("""
                SELECT COUNT(*)
                FROM phantom_trades
                WHERE phantom_outcome = 'win'
                AND timestamp >= ?
            """, params if not symbol else [cutoff, symbol])
            if symbol:
                cursor.execute("""
                    SELECT COUNT(*)
                    FROM phantom_trades
                    WHERE phantom_outcome = 'win'
                    AND timestamp >= ? AND symbol = ?
                """, (cutoff, symbol))
            wins = cursor.fetchone()[0] or 0

            win_rate = (wins / count) if count > 0 else 0.0

            log.info(
                "opportunity_cost_computed",
                symbol=symbol,
                missed_count=count,
                total_pnl_pct=total_pnl,
                avg_pnl_pct=avg_pnl,
            )

            return {
                "period_days": days_back,
                "symbol": symbol or "all",
                "missed_opportunities": count,
                "total_phantom_pnl_pct": round(total_pnl, 2),
                "avg_phantom_pnl_pct": round(avg_pnl, 2),
                "win_rate_on_missed": round(win_rate, 3),
                "opportunity_cost_pct": round(total_pnl, 2),
            }

        except Exception as exc:
            log.error("opportunity_cost_computation_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}

    async def identify_systematic_misses(
        self,
        days_back: int = 60,
    ) -> dict[str, Any]:
        """Identify patterns in what's being missed."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()

            # Miss reasons
            cursor = self._conn.cursor()
            cursor.execute("""
                SELECT reason, COUNT(*) as count
                FROM missed_signals
                WHERE timestamp >= ?
                GROUP BY reason
                ORDER BY count DESC
                LIMIT 10
            """, (cutoff,))
            reasons = {row[0]: row[1] for row in cursor.fetchall()}

            # Setup types being missed
            cursor.execute("""
                SELECT setup_type, COUNT(*) as count
                FROM missed_signals
                WHERE timestamp >= ?
                GROUP BY setup_type
                ORDER BY count DESC
            """, (cutoff,))
            setups = {row[0]: row[1] for row in cursor.fetchall()}

            # Performance on missed setups (via phantom trades)
            cursor.execute("""
                SELECT setup_type, phantom_outcome, COUNT(*) as count
                FROM phantom_trades
                WHERE timestamp >= ?
                GROUP BY setup_type, phantom_outcome
            """, (cutoff,))

            setup_stats = {}
            for row in cursor.fetchall():
                setup, outcome, count = row
                if setup not in setup_stats:
                    setup_stats[setup] = {"win": 0, "loss": 0, "breakeven": 0}
                setup_stats[setup][outcome] = count

            # Calculate win rates
            setup_winrates = {}
            for setup, stats in setup_stats.items():
                total = sum(stats.values())
                winrate = stats["win"] / total if total > 0 else 0.0
                setup_winrates[setup] = round(winrate, 3)

            log.info(
                "systematic_misses_identified",
                top_miss_reason=list(reasons.keys())[0] if reasons else None,
                top_missed_setup=list(setups.keys())[0] if setups else None,
            )

            return {
                "period_days": days_back,
                "miss_reasons": reasons,
                "missed_setup_types": setups,
                "setup_phantom_winrates": setup_winrates,
                "key_insight": _generate_miss_insight(reasons, setups, setup_winrates),
            }

        except Exception as exc:
            log.error("systematic_misses_analysis_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}


def _generate_miss_insight(
    reasons: dict[str, int],
    setups: dict[str, int],
    winrates: dict[str, float],
) -> str:
    """Generate a human-readable insight about systematic misses."""
    if not reasons:
        return "No systematic misses detected."

    top_reason = max(reasons.items(), key=lambda x: x[1])
    top_setup = max(setups.items(), key=lambda x: x[1])

    insight = f"Most common miss: {top_reason[0]} ({top_reason[1]} times). "
    insight += f"Most missed setup: {top_setup[0]} ({top_setup[1]} times). "

    if top_setup[0] in winrates:
        wr = winrates[top_setup[0]]
        if wr > 0.6:
            insight += f"But {top_setup[0]} has high win rate ({wr*100:.0f}%) when taken!"
        elif wr < 0.4:
            insight += f"This setup has low win rate ({wr*100:.0f}%), missing it may be correct."

    return insight


# ── Factory ───────────────────────────────────────────────────────────────────

async def make_missed_trade_detector() -> MissedTradeDetector:
    """Initialize and return detector."""
    detector = MissedTradeDetector()
    await detector.init()
    return detector
