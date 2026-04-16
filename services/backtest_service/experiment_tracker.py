"""
GodsView v2 — Experiment Tracker.

Track and compare strategy experiments:
  • Store experiment configs and results in SQLite
  • Compare experiments side-by-side
  • Parameter sensitivity analysis
  • Statistical significance testing
  • Rank experiments by performance
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any, Sequence
import uuid

from services.shared.logging import get_logger
from services.shared.types import BacktestMetrics

log = get_logger(__name__)


DB_PATH = Path("/tmp/godsview_experiments.db")


@dataclass
class Experiment:
    """Strategy experiment record."""
    experiment_id: str
    name: str
    version: str
    parameters: dict[str, Any]
    created_at: datetime
    status: str  # RUNNING | COMPLETED | FAILED
    result_metrics: Optional[BacktestMetrics] = None
    notes: str = ""
    parent_experiment_id: Optional[str] = None  # For experiment lineage


@dataclass
class ExperimentComparison:
    """Side-by-side comparison of two experiments."""
    experiment_a_id: str
    experiment_b_id: str
    experiment_a_name: str
    experiment_b_name: str
    metrics_diff: dict[str, dict[str, float]]  # {metric: {a, b, delta}}
    better_metrics: list[str]  # Metrics where B is better
    statistical_significance: Optional[float] = None  # p-value


class ExperimentDB:
    """SQLite-backed experiment store."""

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """Initialize database schema."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute("""
            CREATE TABLE IF NOT EXISTS experiments (
                experiment_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                parameters TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL,
                notes TEXT,
                parent_experiment_id TEXT,
                FOREIGN KEY (parent_experiment_id) REFERENCES experiments(experiment_id)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS results (
                result_id TEXT PRIMARY KEY,
                experiment_id TEXT NOT NULL,
                metrics TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                FOREIGN KEY (experiment_id) REFERENCES experiments(experiment_id)
            )
        """)

        conn.commit()
        conn.close()
        log.info("experiment_db_ready", path=str(self.db_path))

    def create_experiment(
        self,
        name: str,
        params: dict[str, Any],
        version: str = "1.0",
        parent_id: Optional[str] = None,
    ) -> str:
        """Create a new experiment. Returns experiment_id."""
        experiment_id = f"exp_{str(uuid.uuid4())[:8]}"
        now = datetime.now(timezone.utc).isoformat()

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute(
            """
            INSERT INTO experiments
            (experiment_id, name, version, parameters, created_at, updated_at, status, parent_experiment_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                experiment_id,
                name,
                version,
                json.dumps(params),
                now,
                now,
                "RUNNING",
                parent_id,
            ),
        )

        conn.commit()
        conn.close()

        log.info(
            "experiment_created",
            experiment_id=experiment_id,
            name=name,
            version=version,
        )

        return experiment_id

    def record_result(
        self,
        experiment_id: str,
        metrics: BacktestMetrics,
    ) -> str:
        """Record experiment result. Returns result_id."""
        result_id = f"result_{str(uuid.uuid4())[:8]}"
        now = datetime.now(timezone.utc).isoformat()

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        # Convert BacktestMetrics to dict
        metrics_dict = metrics.model_dump() if hasattr(metrics, "model_dump") else asdict(metrics)

        c.execute(
            """
            INSERT INTO results (result_id, experiment_id, metrics, recorded_at)
            VALUES (?, ?, ?, ?)
            """,
            (result_id, experiment_id, json.dumps(metrics_dict), now),
        )

        # Update experiment status
        c.execute(
            """
            UPDATE experiments SET status = 'COMPLETED', updated_at = ?
            WHERE experiment_id = ?
            """,
            (now, experiment_id),
        )

        conn.commit()
        conn.close()

        log.info("experiment_result_recorded", experiment_id=experiment_id, result_id=result_id)

        return result_id

    def get_experiment(self, experiment_id: str) -> Optional[dict]:
        """Retrieve experiment and latest result."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute(
            "SELECT * FROM experiments WHERE experiment_id = ?",
            (experiment_id,),
        )
        exp_row = c.fetchone()

        if not exp_row:
            conn.close()
            return None

        # Get latest result
        c.execute(
            """
            SELECT metrics FROM results WHERE experiment_id = ?
            ORDER BY recorded_at DESC LIMIT 1
            """,
            (experiment_id,),
        )
        result_row = c.fetchone()
        conn.close()

        return {
            "experiment_id": exp_row[0],
            "name": exp_row[1],
            "version": exp_row[2],
            "parameters": json.loads(exp_row[3]),
            "created_at": exp_row[4],
            "updated_at": exp_row[5],
            "status": exp_row[6],
            "notes": exp_row[7],
            "parent_experiment_id": exp_row[8],
            "metrics": json.loads(result_row[0]) if result_row else None,
        }

    def list_experiments(self, limit: int = 50) -> list[dict]:
        """List all experiments, most recent first."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute(
            """
            SELECT experiment_id, name, version, created_at, status
            FROM experiments
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        )

        rows = c.fetchall()
        conn.close()

        return [
            {
                "experiment_id": row[0],
                "name": row[1],
                "version": row[2],
                "created_at": row[3],
                "status": row[4],
            }
            for row in rows
        ]

    def compare_experiments(
        self,
        experiment_a_id: str,
        experiment_b_id: str,
    ) -> Optional[ExperimentComparison]:
        """Compare two experiments side-by-side."""
        exp_a = self.get_experiment(experiment_a_id)
        exp_b = self.get_experiment(experiment_b_id)

        if not exp_a or not exp_b or not exp_a.get("metrics") or not exp_b.get("metrics"):
            return None

        metrics_a = exp_a["metrics"]
        metrics_b = exp_b["metrics"]

        # Key metrics to compare
        key_metrics = [
            "total_pnl",
            "win_rate",
            "profit_factor",
            "sharpe_ratio",
            "max_drawdown_pct",
            "avg_mae",
            "avg_mfe",
            "avg_efficiency",
        ]

        metrics_diff = {}
        better_metrics = []

        for metric in key_metrics:
            if metric in metrics_a and metric in metrics_b:
                a_val = metrics_a[metric]
                b_val = metrics_b[metric]
                delta = b_val - a_val

                metrics_diff[metric] = {
                    "a": a_val,
                    "b": b_val,
                    "delta": delta,
                }

                # Determine which direction is "better" for each metric
                if metric in ["max_drawdown_pct"]:
                    if delta < 0:
                        better_metrics.append(metric)
                else:
                    if delta > 0:
                        better_metrics.append(metric)

        return ExperimentComparison(
            experiment_a_id=experiment_a_id,
            experiment_b_id=experiment_b_id,
            experiment_a_name=exp_a["name"],
            experiment_b_name=exp_b["name"],
            metrics_diff=metrics_diff,
            better_metrics=better_metrics,
        )

    def rank_experiments(self, top_k: int = 10, metric: str = "sharpe_ratio") -> list[dict]:
        """Rank experiments by a specific metric."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute(
            """
            SELECT e.experiment_id, e.name, e.version, r.metrics
            FROM experiments e
            LEFT JOIN results r ON e.experiment_id = r.experiment_id
            WHERE e.status = 'COMPLETED'
            ORDER BY e.created_at DESC
            LIMIT ?
            """,
            (top_k * 2,),  # Get extra to sort by metric
        )

        rows = c.fetchall()
        conn.close()

        ranked = []
        for row in rows:
            if row[3]:
                metrics = json.loads(row[3])
                if metric in metrics:
                    ranked.append({
                        "experiment_id": row[0],
                        "name": row[1],
                        "version": row[2],
                        metric: metrics[metric],
                    })

        # Sort by metric (descending for most, ascending for drawdown)
        reverse = metric not in ["max_drawdown_pct", "max_drawdown"]
        ranked.sort(key=lambda x: x.get(metric, 0), reverse=reverse)

        return ranked[:top_k]

    def parameter_sensitivity(
        self,
        param_name: str,
        metric: str = "sharpe_ratio",
    ) -> list[dict]:
        """Analyze sensitivity of a parameter to a metric."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute(
            """
            SELECT e.parameters, r.metrics
            FROM experiments e
            LEFT JOIN results r ON e.experiment_id = r.experiment_id
            WHERE e.status = 'COMPLETED'
            ORDER BY e.created_at DESC
            """
        )

        rows = c.fetchall()
        conn.close()

        sensitivity = {}

        for row in rows:
            if row[0] and row[1]:
                params = json.loads(row[0])
                metrics = json.loads(row[1])

                if param_name in params and metric in metrics:
                    param_val = str(params[param_name])
                    metric_val = metrics[metric]

                    if param_val not in sensitivity:
                        sensitivity[param_val] = []
                    sensitivity[param_val].append(metric_val)

        # Compute averages and trends
        sensitivity_results = []
        for param_val in sorted(sensitivity.keys()):
            values = sensitivity[param_val]
            avg = sum(values) / len(values)
            sensitivity_results.append({
                param_name: param_val,
                f"avg_{metric}": round(avg, 4),
                "count": len(values),
            })

        return sensitivity_results
