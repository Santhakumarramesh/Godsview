"""
GodsView v2 — Outcome-to-Retraining Feedback Loop.

Closes the learning loop by:
  - Recording trade outcomes with full context
  - Accumulating completed trades in a training buffer
  - Triggering retraining when buffer reaches threshold
  - Updating feature importance, confidence calibration, signal thresholds
  - Tracking retraining history and metrics
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from services.shared.config import cfg
from services.shared.logging import get_logger

log = get_logger(__name__)

_DB_PATH = Path(cfg.data_dir) / "feedback_loop.db"

# Default buffer threshold for triggering retraining
_DEFAULT_RETRAIN_THRESHOLD = 50


class FeedbackLoop:
    """Manages trade outcomes and retraining triggers."""

    def __init__(self, retrain_threshold: int = _DEFAULT_RETRAIN_THRESHOLD) -> None:
        self._conn: Optional[sqlite3.Connection] = None
        self._ready = False
        self._retrain_threshold = retrain_threshold

    async def init(self) -> None:
        try:
            _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
            self._create_schema()
            self._ready = True
            log.info(
                "feedback_loop_ready",
                path=str(_DB_PATH),
                threshold=self._retrain_threshold,
            )
        except Exception as exc:
            log.error("feedback_loop_init_failed", err=str(exc))

    def _create_schema(self) -> None:
        if self._conn is None:
            return
        cursor = self._conn.cursor()

        # Completed trades with full context
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS completed_trades (
                id TEXT PRIMARY KEY,
                signal_id TEXT,
                symbol TEXT NOT NULL,
                entry_timestamp TEXT NOT NULL,
                exit_timestamp TEXT NOT NULL,
                setup_type TEXT,
                direction TEXT,
                entry_price REAL,
                exit_price REAL,
                stop_loss REAL,
                take_profit REAL,
                pnl_pct REAL,
                outcome TEXT,
                duration_seconds INT,
                mae REAL,
                mfe REAL,
                features TEXT,
                signal_confidence REAL,
                predicted_win_prob REAL,
                regime_at_entry TEXT,
                regime_at_exit TEXT,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Retraining buffer status
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS retraining_buffer (
                id TEXT PRIMARY KEY,
                symbol TEXT,
                timeframe TEXT,
                trade_count INT DEFAULT 0,
                total_pnl_pct REAL DEFAULT 0.0,
                win_count INT DEFAULT 0,
                loss_count INT DEFAULT 0,
                avg_win_pnl_pct REAL DEFAULT 0.0,
                avg_loss_pnl_pct REAL DEFAULT 0.0,
                ready_for_retrain BOOLEAN DEFAULT 0,
                last_updated TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Retraining history
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS retraining_history (
                id TEXT PRIMARY KEY,
                symbol TEXT,
                timeframe TEXT,
                trades_in_buffer INT,
                retrain_timestamp TEXT NOT NULL,
                pre_retrain_metrics TEXT,
                post_retrain_metrics TEXT,
                feature_importance TEXT,
                confidence_calibration TEXT,
                threshold_adjustments TEXT,
                status TEXT,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Feature importance tracking
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feature_importance_history (
                id TEXT PRIMARY KEY,
                symbol TEXT,
                timeframe TEXT,
                retrain_id TEXT,
                feature_name TEXT,
                importance_score REAL,
                correlation_with_outcome REAL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(retrain_id) REFERENCES retraining_history(id)
            )
        """)

        # Confidence calibration
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS confidence_calibration (
                id TEXT PRIMARY KEY,
                symbol TEXT,
                timeframe TEXT,
                confidence_bucket TEXT,
                expected_winrate REAL,
                actual_winrate REAL,
                trade_count INT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_completed_symbol_outcome
            ON completed_trades(symbol, outcome)
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_buffer_symbol_tf
            ON retraining_buffer(symbol, timeframe)
        """)

        self._conn.commit()

    async def record_trade_outcome(
        self,
        signal_id: str,
        symbol: str,
        entry_time: datetime,
        exit_time: datetime,
        setup_type: str,
        direction: str,
        entry_price: float,
        exit_price: float,
        stop_loss: float,
        take_profit: float,
        outcome: str,
        pnl_pct: float,
        features: dict[str, float] | None = None,
        signal_confidence: float = 0.0,
        predicted_win_prob: float = 0.0,
        regime_at_entry: str = "unknown",
        regime_at_exit: str = "unknown",
        mae: float = 0.0,
        mfe: float = 0.0,
        notes: str = "",
    ) -> dict[str, Any]:
        """Record a completed trade with full context."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        trade_id = str(uuid.uuid4())

        try:
            duration_seconds = int((exit_time - entry_time).total_seconds())

            cursor = self._conn.cursor()
            cursor.execute("""
                INSERT INTO completed_trades (
                    id, signal_id, symbol, entry_timestamp, exit_timestamp,
                    setup_type, direction, entry_price, exit_price,
                    stop_loss, take_profit, pnl_pct, outcome,
                    duration_seconds, mae, mfe, features,
                    signal_confidence, predicted_win_prob,
                    regime_at_entry, regime_at_exit, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                trade_id,
                signal_id,
                symbol,
                entry_time.isoformat(),
                exit_time.isoformat(),
                setup_type,
                direction,
                float(entry_price),
                float(exit_price),
                float(stop_loss),
                float(take_profit),
                float(pnl_pct),
                outcome,
                duration_seconds,
                float(mae),
                float(mfe),
                json.dumps(features or {}),
                float(signal_confidence),
                float(predicted_win_prob),
                regime_at_entry,
                regime_at_exit,
                notes,
            ))

            # Update retraining buffer
            buffer_key = f"{symbol}"
            cursor.execute("""
                SELECT id FROM retraining_buffer WHERE symbol = ?
            """, (symbol,))
            buf = cursor.fetchone()

            if buf:
                # Update existing buffer
                cursor.execute("""
                    UPDATE retraining_buffer
                    SET trade_count = trade_count + 1,
                        total_pnl_pct = total_pnl_pct + ?,
                        win_count = win_count + ?,
                        loss_count = loss_count + ?,
                        last_updated = CURRENT_TIMESTAMP
                    WHERE symbol = ?
                """, (
                    float(pnl_pct),
                    1 if outcome == "win" else 0,
                    1 if outcome == "loss" else 0,
                    symbol,
                ))
            else:
                # Create new buffer
                cursor.execute("""
                    INSERT INTO retraining_buffer (
                        id, symbol, trade_count, total_pnl_pct,
                        win_count, loss_count
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    str(uuid.uuid4()),
                    symbol,
                    1,
                    float(pnl_pct),
                    1 if outcome == "win" else 0,
                    1 if outcome == "loss" else 0,
                ))

            self._conn.commit()

            log.info(
                "trade_outcome_recorded",
                id=trade_id,
                symbol=symbol,
                outcome=outcome,
                pnl_pct=pnl_pct,
            )

            return {
                "id": trade_id,
                "status": "recorded",
                "symbol": symbol,
                "outcome": outcome,
            }

        except Exception as exc:
            log.error("trade_outcome_record_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}

    async def get_feedback_stats(
        self,
        symbol: str | None = None,
    ) -> dict[str, Any]:
        """Get retraining buffer status."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        try:
            cursor = self._conn.cursor()

            if symbol:
                cursor.execute("""
                    SELECT trade_count, total_pnl_pct, win_count, loss_count
                    FROM retraining_buffer
                    WHERE symbol = ?
                """, (symbol,))
            else:
                cursor.execute("""
                    SELECT SUM(trade_count), SUM(total_pnl_pct),
                           SUM(win_count), SUM(loss_count)
                    FROM retraining_buffer
                """)

            row = cursor.fetchone()
            if not row:
                return {
                    "symbol": symbol or "all",
                    "trade_count": 0,
                    "total_pnl_pct": 0.0,
                    "win_count": 0,
                    "loss_count": 0,
                    "win_rate": 0.0,
                    "ready_for_retrain": False,
                }

            trade_count, total_pnl, wins, losses = row
            trade_count = trade_count or 0
            total_pnl = total_pnl or 0.0
            wins = wins or 0
            losses = losses or 0

            win_rate = (wins / trade_count) if trade_count > 0 else 0.0
            ready = trade_count >= self._retrain_threshold

            return {
                "symbol": symbol or "all",
                "trade_count": trade_count,
                "total_pnl_pct": round(total_pnl, 2),
                "win_count": wins,
                "loss_count": losses,
                "win_rate": round(win_rate, 3),
                "retrain_threshold": self._retrain_threshold,
                "ready_for_retrain": ready,
                "progress_pct": round((trade_count / self._retrain_threshold) * 100, 1) \
                    if trade_count < self._retrain_threshold else 100.0,
            }

        except Exception as exc:
            log.error("feedback_stats_fetch_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}

    async def record_retraining(
        self,
        symbol: str,
        trades_in_buffer: int,
        pre_metrics: dict[str, Any],
        post_metrics: dict[str, Any],
        feature_importance: dict[str, float] | None = None,
        confidence_calibration: dict[str, Any] | None = None,
        threshold_adjustments: dict[str, float] | None = None,
        status: str = "success",
        notes: str = "",
    ) -> dict[str, Any]:
        """Record a retraining event."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        retrain_id = str(uuid.uuid4())

        try:
            cursor = self._conn.cursor()
            cursor.execute("""
                INSERT INTO retraining_history (
                    id, symbol, trades_in_buffer, retrain_timestamp,
                    pre_retrain_metrics, post_retrain_metrics,
                    feature_importance, confidence_calibration,
                    threshold_adjustments, status, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                retrain_id,
                symbol,
                trades_in_buffer,
                datetime.now(timezone.utc).isoformat(),
                json.dumps(pre_metrics),
                json.dumps(post_metrics),
                json.dumps(feature_importance or {}),
                json.dumps(confidence_calibration or {}),
                json.dumps(threshold_adjustments or {}),
                status,
                notes,
            ))

            # Store feature importance history
            if feature_importance:
                for feat_name, importance in feature_importance.items():
                    cursor.execute("""
                        INSERT INTO feature_importance_history (
                            id, symbol, retrain_id, feature_name,
                            importance_score
                        ) VALUES (?, ?, ?, ?, ?)
                    """, (
                        str(uuid.uuid4()),
                        symbol,
                        retrain_id,
                        feat_name,
                        float(importance),
                    ))

            # Reset buffer for this symbol
            cursor.execute("""
                DELETE FROM retraining_buffer WHERE symbol = ?
            """, (symbol,))

            self._conn.commit()

            log.info(
                "retraining_recorded",
                id=retrain_id,
                symbol=symbol,
                trades=trades_in_buffer,
                status=status,
            )

            return {
                "id": retrain_id,
                "status": "recorded",
                "symbol": symbol,
                "trades_in_buffer": trades_in_buffer,
            }

        except Exception as exc:
            log.error("retraining_record_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}

    async def get_retraining_history(
        self,
        symbol: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Retrieve retraining history."""
        if not self._ready or self._conn is None:
            return []

        try:
            query = "SELECT id, symbol, trades_in_buffer, retrain_timestamp, status FROM retraining_history"
            params = []

            if symbol:
                query += " WHERE symbol = ?"
                params.append(symbol)

            query += " ORDER BY retrain_timestamp DESC LIMIT ?"
            params.append(limit)

            cursor = self._conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()

            return [
                {
                    "id": row[0],
                    "symbol": row[1],
                    "trades_in_buffer": row[2],
                    "timestamp": row[3],
                    "status": row[4],
                }
                for row in rows
            ]

        except Exception as exc:
            log.error("retraining_history_fetch_failed", err=str(exc))
            return []

    async def calculate_confidence_calibration(
        self,
        symbol: str,
    ) -> dict[str, Any]:
        """Analyze confidence calibration: was predicted confidence accurate?"""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        try:
            cursor = self._conn.cursor()

            # Bucket trades by confidence
            cursor.execute("""
                SELECT
                    CASE
                        WHEN signal_confidence < 0.5 THEN '0.0-0.5'
                        WHEN signal_confidence < 0.6 THEN '0.5-0.6'
                        WHEN signal_confidence < 0.7 THEN '0.6-0.7'
                        WHEN signal_confidence < 0.8 THEN '0.7-0.8'
                        ELSE '0.8-1.0'
                    END as bucket,
                    COUNT(*) as total,
                    SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) as wins
                FROM completed_trades
                WHERE symbol = ?
                GROUP BY bucket
                ORDER BY bucket
            """, (symbol,))

            calibration = {}
            for bucket, total, wins in cursor.fetchall():
                actual_winrate = (wins / total) if total > 0 else 0.0
                calibration[bucket] = {
                    "actual_winrate": round(actual_winrate, 3),
                    "trade_count": total,
                }

            log.info("confidence_calibration_calculated", symbol=symbol)

            return {
                "symbol": symbol,
                "calibration": calibration,
                "status": "calculated",
            }

        except Exception as exc:
            log.error("confidence_calibration_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}

    async def calculate_feature_importance(
        self,
        symbol: str,
    ) -> dict[str, Any]:
        """Analyze which features best predicted wins."""
        if not self._ready or self._conn is None:
            return {"status": "not_ready"}

        try:
            cursor = self._conn.cursor()

            # Get trades and parse features
            cursor.execute("""
                SELECT features, outcome
                FROM completed_trades
                WHERE symbol = ? AND features IS NOT NULL
                ORDER BY entry_timestamp DESC
                LIMIT 100
            """, (symbol,))

            trades = cursor.fetchall()
            if not trades:
                return {"symbol": symbol, "importance": {}, "status": "insufficient_data"}

            # Parse features and compute correlation
            all_features = {}
            outcomes = []

            for feat_json, outcome in trades:
                try:
                    features = json.loads(feat_json)
                    for feat_name, feat_val in features.items():
                        if feat_name not in all_features:
                            all_features[feat_name] = []
                        all_features[feat_name].append(feat_val)
                    outcomes.append(1 if outcome == "win" else 0)
                except (json.JSONDecodeError, TypeError):
                    pass

            # Simple correlation calculation
            importance = {}
            if outcomes:
                import numpy as np
                outcomes_arr = np.array(outcomes)
                for feat_name, values in all_features.items():
                    if len(values) == len(outcomes):
                        values_arr = np.array(values)
                        corr = np.corrcoef(values_arr, outcomes_arr)[0, 1]
                        if not np.isnan(corr):
                            importance[feat_name] = abs(corr)

            # Sort by importance
            sorted_importance = dict(sorted(
                importance.items(),
                key=lambda x: x[1],
                reverse=True,
            )[:10])

            log.info("feature_importance_calculated", symbol=symbol)

            return {
                "symbol": symbol,
                "importance": {k: round(v, 4) for k, v in sorted_importance.items()},
                "status": "calculated",
            }

        except Exception as exc:
            log.error("feature_importance_calculation_failed", err=str(exc))
            return {"status": "error", "error": str(exc)}


# ── Factory ───────────────────────────────────────────────────────────────────

async def make_feedback_loop(
    retrain_threshold: int = _DEFAULT_RETRAIN_THRESHOLD,
) -> FeedbackLoop:
    """Initialize and return feedback loop."""
    loop = FeedbackLoop(retrain_threshold=retrain_threshold)
    await loop.init()
    return loop
