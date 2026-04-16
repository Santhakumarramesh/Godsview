"""
GodsView v2 — Strategy Promotion Pipeline.

Manage strategy lifecycle through promotion stages:
  EXPERIMENTAL → PAPER_TRADING → ASSISTED_LIVE → AUTONOMOUS

Each stage has promotion and demotion criteria.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional, Any

from services.shared.logging import get_logger
from services.shared.types import BacktestMetrics

log = get_logger(__name__)


DB_PATH = Path("/tmp/godsview_pipeline.db")


class StrategyStage(str, Enum):
    """Strategy promotion stages."""
    EXPERIMENTAL = "EXPERIMENTAL"
    PAPER_TRADING = "PAPER_TRADING"
    ASSISTED_LIVE = "ASSISTED_LIVE"
    AUTONOMOUS = "AUTONOMOUS"


@dataclass
class PromotionCriteria:
    """Criteria to advance from one stage to the next."""
    min_trades: int
    min_profit_factor: float
    max_drawdown_pct: float
    min_sharpe: float
    description: str


# Promotion criteria for each stage transition
STAGE_CRITERIA: dict[StrategyStage, PromotionCriteria] = {
    StrategyStage.EXPERIMENTAL: PromotionCriteria(
        min_trades=100,
        min_profit_factor=1.3,
        max_drawdown_pct=0.15,
        min_sharpe=1.0,
        description="Min 100 trades, PF > 1.3, DD < 15%, Sharpe > 1.0",
    ),
    StrategyStage.PAPER_TRADING: PromotionCriteria(
        min_trades=50,
        min_profit_factor=1.2,
        max_drawdown_pct=0.20,
        min_sharpe=0.5,
        description="Min 50 paper trades, metrics within 20% of backtest",
    ),
    StrategyStage.ASSISTED_LIVE: PromotionCriteria(
        min_trades=30,
        min_profit_factor=1.1,
        max_drawdown_pct=0.25,
        min_sharpe=0.0,
        description="Min 30 live trades, 90% human approval rate",
    ),
}

# Demotion criteria (applied at any stage)
DEMOTION_CRITERIA = {
    "profit_factor_threshold": 1.0,  # Demote if PF falls below this
    "drawdown_multiplier": 2.0,  # Demote if DD exceeds 2x backtest DD
    "consecutive_losing_days": 3,  # Demote if 3 consecutive losing days
}


@dataclass
class StrategyRecord:
    """Persistent strategy promotion record."""
    strategy_id: str
    name: str
    stage: StrategyStage
    backtest_metrics: dict[str, Any]
    paper_metrics: Optional[dict[str, Any]] = None
    live_metrics: Optional[dict[str, Any]] = None
    human_approval_rate: float = 0.0  # For ASSISTED_LIVE
    consecutive_losses: int = 0
    promoted_at: Optional[datetime] = None
    demoted_at: Optional[datetime] = None
    notes: str = ""


class PromotionPipeline:
    """Manage strategy promotion and demotion."""

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """Initialize database schema."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute("""
            CREATE TABLE IF NOT EXISTS strategies (
                strategy_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                stage TEXT NOT NULL,
                backtest_metrics TEXT,
                paper_metrics TEXT,
                live_metrics TEXT,
                human_approval_rate REAL,
                consecutive_losses INTEGER DEFAULT 0,
                promoted_at TEXT,
                demoted_at TEXT,
                notes TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS promotions (
                promotion_id TEXT PRIMARY KEY,
                strategy_id TEXT NOT NULL,
                from_stage TEXT,
                to_stage TEXT,
                criteria_met BOOLEAN,
                promotion_date TEXT,
                reason TEXT,
                FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS demotions (
                demotion_id TEXT PRIMARY KEY,
                strategy_id TEXT NOT NULL,
                from_stage TEXT,
                to_stage TEXT,
                demotion_date TEXT,
                reason TEXT,
                FOREIGN KEY (strategy_id) REFERENCES strategies(strategy_id)
            )
        """)

        conn.commit()
        conn.close()
        log.info("promotion_pipeline_db_ready", path=str(self.db_path))

    def register_strategy(
        self,
        strategy_id: str,
        name: str,
        backtest_metrics: BacktestMetrics,
    ) -> None:
        """Register a new strategy at EXPERIMENTAL stage."""
        metrics_dict = (
            backtest_metrics.model_dump()
            if hasattr(backtest_metrics, "model_dump")
            else backtest_metrics.__dict__
        )

        now = datetime.now(timezone.utc).isoformat()

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute(
            """
            INSERT OR REPLACE INTO strategies
            (strategy_id, name, stage, backtest_metrics, promoted_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                strategy_id,
                name,
                StrategyStage.EXPERIMENTAL.value,
                json.dumps(metrics_dict),
                now,
                now,
                now,
            ),
        )

        conn.commit()
        conn.close()

        log.info(
            "strategy_registered",
            strategy_id=strategy_id,
            name=name,
            stage="EXPERIMENTAL",
        )

    def check_promotion_eligibility(
        self,
        strategy_id: str,
    ) -> dict[str, Any]:
        """Check if a strategy is eligible for promotion to next stage."""
        strategy = self._get_strategy(strategy_id)
        if not strategy:
            return {"eligible": False, "reason": "Strategy not found"}

        current_stage = StrategyStage(strategy["stage"])
        next_stage = self._next_stage(current_stage)

        if not next_stage:
            return {"eligible": False, "reason": "Already at AUTONOMOUS stage"}

        criteria = STAGE_CRITERIA.get(current_stage)
        if not criteria:
            return {"eligible": False, "reason": "No criteria defined for this stage"}

        # Use appropriate metrics based on stage
        if current_stage == StrategyStage.EXPERIMENTAL:
            metrics = strategy.get("backtest_metrics", {})
        elif current_stage == StrategyStage.PAPER_TRADING:
            metrics = strategy.get("paper_metrics", {})
        elif current_stage == StrategyStage.ASSISTED_LIVE:
            metrics = strategy.get("live_metrics", {})
        else:
            return {"eligible": False, "reason": "Unknown stage"}

        if not metrics:
            return {"eligible": False, "reason": f"No metrics available for {current_stage.value}"}

        # Check criteria
        checks = {
            "min_trades": (
                metrics.get("total_trades", 0) >= criteria.min_trades,
                f"Trades: {metrics.get('total_trades', 0)} >= {criteria.min_trades}",
            ),
            "profit_factor": (
                metrics.get("profit_factor", 0) >= criteria.min_profit_factor,
                f"PF: {metrics.get('profit_factor', 0):.2f} >= {criteria.min_profit_factor}",
            ),
            "max_drawdown": (
                metrics.get("max_drawdown_pct", 1.0) <= criteria.max_drawdown_pct,
                f"DD: {metrics.get('max_drawdown_pct', 0):.2%} <= {criteria.max_drawdown_pct:.1%}",
            ),
            "sharpe": (
                metrics.get("sharpe_ratio", 0) >= criteria.min_sharpe,
                f"Sharpe: {metrics.get('sharpe_ratio', 0):.2f} >= {criteria.min_sharpe}",
            ),
        }

        all_pass = all(check[0] for check in checks.values())

        return {
            "strategy_id": strategy_id,
            "current_stage": current_stage.value,
            "next_stage": next_stage.value if next_stage else None,
            "eligible": all_pass,
            "criteria": criteria.description,
            "checks": {k: v[1] for k, v in checks.items()},
            "passed_checks": sum(1 for check in checks.values() if check[0]),
            "total_checks": len(checks),
        }

    def promote_strategy(self, strategy_id: str) -> dict[str, Any]:
        """Attempt to promote a strategy. Returns promotion status."""
        eligibility = self.check_promotion_eligibility(strategy_id)

        if not eligibility.get("eligible"):
            return {
                "promoted": False,
                "reason": "Promotion criteria not met",
                "eligibility": eligibility,
            }

        strategy = self._get_strategy(strategy_id)
        current_stage = StrategyStage(strategy["stage"])
        next_stage = self._next_stage(current_stage)

        if not next_stage:
            return {"promoted": False, "reason": "Already at max stage"}

        # Update database
        now = datetime.now(timezone.utc).isoformat()

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute(
            "UPDATE strategies SET stage = ?, promoted_at = ?, updated_at = ? WHERE strategy_id = ?",
            (next_stage.value, now, now, strategy_id),
        )

        # Record promotion
        import uuid
        c.execute(
            """
            INSERT INTO promotions
            (promotion_id, strategy_id, from_stage, to_stage, criteria_met, promotion_date, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"promo_{str(uuid.uuid4())[:8]}",
                strategy_id,
                current_stage.value,
                next_stage.value,
                True,
                now,
                "Promotion criteria met",
            ),
        )

        conn.commit()
        conn.close()

        log.info(
            "strategy_promoted",
            strategy_id=strategy_id,
            from_stage=current_stage.value,
            to_stage=next_stage.value,
        )

        return {
            "promoted": True,
            "strategy_id": strategy_id,
            "from_stage": current_stage.value,
            "to_stage": next_stage.value,
        }

    def demote_strategy(self, strategy_id: str, reason: str) -> dict[str, Any]:
        """Demote a strategy one level."""
        strategy = self._get_strategy(strategy_id)
        if not strategy:
            return {"demoted": False, "reason": "Strategy not found"}

        current_stage = StrategyStage(strategy["stage"])

        if current_stage == StrategyStage.EXPERIMENTAL:
            return {"demoted": False, "reason": "Already at minimum stage"}

        # Find previous stage
        prev_stage = {
            StrategyStage.PAPER_TRADING: StrategyStage.EXPERIMENTAL,
            StrategyStage.ASSISTED_LIVE: StrategyStage.PAPER_TRADING,
            StrategyStage.AUTONOMOUS: StrategyStage.ASSISTED_LIVE,
        }.get(current_stage)

        if not prev_stage:
            return {"demoted": False, "reason": "Cannot determine previous stage"}

        now = datetime.now(timezone.utc).isoformat()

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute(
            "UPDATE strategies SET stage = ?, demoted_at = ?, updated_at = ? WHERE strategy_id = ?",
            (prev_stage.value, now, now, strategy_id),
        )

        import uuid
        c.execute(
            """
            INSERT INTO demotions
            (demotion_id, strategy_id, from_stage, to_stage, demotion_date, reason)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                f"demote_{str(uuid.uuid4())[:8]}",
                strategy_id,
                current_stage.value,
                prev_stage.value,
                now,
                reason,
            ),
        )

        conn.commit()
        conn.close()

        log.info(
            "strategy_demoted",
            strategy_id=strategy_id,
            from_stage=current_stage.value,
            to_stage=prev_stage.value,
            reason=reason,
        )

        return {
            "demoted": True,
            "strategy_id": strategy_id,
            "from_stage": current_stage.value,
            "to_stage": prev_stage.value,
            "reason": reason,
        }

    def get_pipeline_status(self) -> dict[str, Any]:
        """Get status of all strategies in the pipeline."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute("SELECT * FROM strategies")
        rows = c.fetchall()
        conn.close()

        by_stage = {stage.value: [] for stage in StrategyStage}

        for row in rows:
            strategy = {
                "strategy_id": row[0],
                "name": row[1],
                "stage": row[2],
                "promoted_at": row[8],
                "demoted_at": row[9],
            }
            by_stage[row[2]].append(strategy)

        return {
            "total_strategies": len(rows),
            "by_stage": by_stage,
            "stage_counts": {stage: len(strategies) for stage, strategies in by_stage.items()},
        }

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_strategy(self, strategy_id: str) -> Optional[dict]:
        """Fetch strategy record."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute("SELECT * FROM strategies WHERE strategy_id = ?", (strategy_id,))
        row = c.fetchone()
        conn.close()

        if not row:
            return None

        return {
            "strategy_id": row[0],
            "name": row[1],
            "stage": row[2],
            "backtest_metrics": json.loads(row[3]) if row[3] else {},
            "paper_metrics": json.loads(row[4]) if row[4] else {},
            "live_metrics": json.loads(row[5]) if row[5] else {},
            "human_approval_rate": row[6],
            "consecutive_losses": row[7],
            "promoted_at": row[8],
            "demoted_at": row[9],
            "notes": row[10],
        }

    def _next_stage(self, current: StrategyStage) -> Optional[StrategyStage]:
        """Get next stage in pipeline."""
        mapping = {
            StrategyStage.EXPERIMENTAL: StrategyStage.PAPER_TRADING,
            StrategyStage.PAPER_TRADING: StrategyStage.ASSISTED_LIVE,
            StrategyStage.ASSISTED_LIVE: StrategyStage.AUTONOMOUS,
            StrategyStage.AUTONOMOUS: None,
        }
        return mapping.get(current)
