"""phase5 quant-lab + recall + learning tables.

Revision ID: 20260419_0010
Revises: 20260419_0009
Create Date: 2026-04-19 14:00:00+00:00

Adds the twenty-one persistence tables for Phase 5:

  Quant Lab
    * ``strategies``                — named trading strategy
    * ``strategy_versions``         — immutable config versions
    * ``backtest_runs``             — single backtest execution
    * ``backtest_trades``           — per-trade ledger per run
    * ``backtest_equity_points``    — equity curve samples per run
    * ``replay_runs``               — candle-by-candle replay cursor
    * ``replay_frames``             — persisted decision envelope per replay
    * ``experiments``               — hypothesis-grouped backtests
    * ``experiment_backtests``      — M2M join experiment ⟷ backtest
    * ``strategy_rankings``         — daily tier snapshot
    * ``promotion_events``          — audit row for every FSM transition

  Recall
    * ``recall_trades``             — canonical trade memory
    * ``recall_embeddings``         — 64-dim feature vectors
    * ``recall_screenshots``        — chart screenshots + annotations
    * ``missed_trades``             — systematic-miss log

  Learning + Governance
    * ``learning_events``           — append-only event-bus tail
    * ``confidence_calibrations``   — per-scope calibration curves
    * ``regime_snapshots``          — per (symbol, tf) regime detections
    * ``session_snapshots``         — per-session rollups
    * ``data_truth_checks``         — feed/broker health + kill-switch state
    * ``strategy_dna_cells``        — regime × session performance grid

Every table is strictly additive — no Phase 0-4 table is modified — so a
v2.4.0 production database can run ``alembic upgrade head`` in-place
without downtime.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0010"
down_revision: Union[str, None] = "20260419_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ──────────────────────────── Quant Lab ────────────────────────────

    op.create_table(
        "strategies",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("setup_type", sa.String(length=48), nullable=False),
        sa.Column("active_version_id", sa.String(length=64), nullable=True),
        sa.Column("current_tier", sa.String(length=2), nullable=False, server_default=sa.text("'C'")),
        sa.Column(
            "current_state",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'experimental'"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_strategies_state_tier", "strategies", ["current_state", "current_tier"])
    op.create_index("ix_strategies_setup_type", "strategies", ["setup_type"])

    op.create_table(
        "strategy_versions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by_user_id", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_strategy_versions_strategy",
        ),
        sa.UniqueConstraint("strategy_id", "version", name="uq_strategy_versions_n"),
    )
    op.create_index("ix_strategy_versions_strategy", "strategy_versions", ["strategy_id"])

    op.create_table(
        "backtest_runs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column("version_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("requested_by_user_id", sa.String(length=64), nullable=True),
        sa.Column("symbol_ids", sa.JSON(), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("from_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("to_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("slippage_bps", sa.Float(), nullable=False, server_default=sa.text("1")),
        sa.Column("spread_bps", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("commission_per_share", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("seed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(length=1000), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_backtest_runs_strategy",
        ),
        sa.ForeignKeyConstraint(
            ["version_id"], ["strategy_versions.id"], ondelete="CASCADE", name="fk_backtest_runs_version",
        ),
    )
    op.create_index("ix_backtest_runs_strategy_status", "backtest_runs", ["strategy_id", "status"])
    op.create_index("ix_backtest_runs_requested_at", "backtest_runs", ["requested_at"])

    op.create_table(
        "backtest_trades",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("trade_index", sa.Integer(), nullable=False),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("entry_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("exit_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entry_price", sa.Float(), nullable=False),
        sa.Column("exit_price", sa.Float(), nullable=False),
        sa.Column("stop_loss", sa.Float(), nullable=False),
        sa.Column("take_profit", sa.Float(), nullable=False),
        sa.Column("qty", sa.Float(), nullable=False, server_default=sa.text("1")),
        sa.Column("pnl_r", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("pnl_dollars", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("mae_r", sa.Float(), nullable=True),
        sa.Column("mfe_r", sa.Float(), nullable=True),
        sa.Column("setup_type", sa.String(length=48), nullable=False),
        sa.Column("exit_reason", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"], ["backtest_runs.id"], ondelete="CASCADE", name="fk_backtest_trades_run",
        ),
        sa.UniqueConstraint("run_id", "trade_index", name="uq_backtest_trade_index"),
    )
    op.create_index("ix_backtest_trades_run", "backtest_trades", ["run_id"])

    op.create_table(
        "backtest_equity_points",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("equity", sa.Float(), nullable=False),
        sa.Column("drawdown", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.ForeignKeyConstraint(
            ["run_id"], ["backtest_runs.id"], ondelete="CASCADE", name="fk_backtest_equity_run",
        ),
    )
    op.create_index("ix_backtest_equity_run_ts", "backtest_equity_points", ["run_id", "ts"])

    op.create_table(
        "replay_runs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=True),
        sa.Column("version_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("symbol_ids", sa.JSON(), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("from_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("to_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cursor_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("step_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_by_user_id", sa.String(length=64), nullable=True),
        sa.Column("error", sa.String(length=1000), nullable=True),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="SET NULL", name="fk_replay_runs_strategy",
        ),
        sa.ForeignKeyConstraint(
            ["version_id"], ["strategy_versions.id"], ondelete="SET NULL", name="fk_replay_runs_version",
        ),
    )
    op.create_index("ix_replay_runs_status", "replay_runs", ["status"])
    op.create_index("ix_replay_runs_strategy", "replay_runs", ["strategy_id"])

    op.create_table(
        "replay_frames",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("replay_id", sa.String(length=64), nullable=False),
        sa.Column("frame_index", sa.Integer(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decision", sa.JSON(), nullable=False),
        sa.Column("bars_applied", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["replay_id"], ["replay_runs.id"], ondelete="CASCADE", name="fk_replay_frames_replay",
        ),
        sa.UniqueConstraint("replay_id", "frame_index", name="uq_replay_frame_index"),
    )
    op.create_index("ix_replay_frames_replay", "replay_frames", ["replay_id"])

    op.create_table(
        "experiments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("hypothesis", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("winning_backtest_id", sa.String(length=64), nullable=True),
        sa.Column("verdict", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_experiments_strategy",
        ),
        sa.ForeignKeyConstraint(
            ["winning_backtest_id"], ["backtest_runs.id"], ondelete="SET NULL", name="fk_experiments_winner",
        ),
    )
    op.create_index("ix_experiments_strategy_status", "experiments", ["strategy_id", "status"])

    op.create_table(
        "experiment_backtests",
        sa.Column("experiment_id", sa.String(length=64), nullable=False),
        sa.Column("backtest_run_id", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False, server_default=sa.text("'candidate'")),
        sa.Column("attached_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("experiment_id", "backtest_run_id", name="pk_experiment_backtests"),
        sa.ForeignKeyConstraint(
            ["experiment_id"], ["experiments.id"], ondelete="CASCADE", name="fk_exp_bt_experiment",
        ),
        sa.ForeignKeyConstraint(
            ["backtest_run_id"], ["backtest_runs.id"], ondelete="CASCADE", name="fk_exp_bt_run",
        ),
    )

    op.create_table(
        "strategy_rankings",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column("tier", sa.String(length=2), nullable=False, server_default=sa.text("'C'")),
        sa.Column("score", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("sharpe", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("profit_factor", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("win_rate", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("drawdown", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("expectancy", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_strategy_rankings_strategy",
        ),
    )
    op.create_index("ix_strategy_rankings_ts", "strategy_rankings", ["computed_at"])
    op.create_index("ix_strategy_rankings_strategy_ts", "strategy_rankings", ["strategy_id", "computed_at"])

    op.create_table(
        "promotion_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column("from_state", sa.String(length=32), nullable=False),
        sa.Column("to_state", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("actor_user_id", sa.String(length=64), nullable=True),
        sa.Column("auto", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ranking_id", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_promotion_events_strategy",
        ),
        sa.ForeignKeyConstraint(
            ["ranking_id"], ["strategy_rankings.id"], ondelete="SET NULL", name="fk_promotion_events_ranking",
        ),
    )
    op.create_index(
        "ix_promotion_events_strategy_ts",
        "promotion_events",
        ["strategy_id", "occurred_at"],
    )

    # ──────────────────────────── Recall ───────────────────────────────

    op.create_table(
        "recall_trades",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("source_kind", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.String(length=64), nullable=False),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("setup_type", sa.String(length=48), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("entry_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("exit_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entry_price", sa.Float(), nullable=False),
        sa.Column("exit_price", sa.Float(), nullable=True),
        sa.Column("stop_loss", sa.Float(), nullable=False),
        sa.Column("take_profit", sa.Float(), nullable=False),
        sa.Column("pnl_r", sa.Float(), nullable=True),
        sa.Column("outcome", sa.String(length=16), nullable=False, server_default=sa.text("'scratch'")),
        sa.Column("regime", sa.String(length=16), nullable=True),
        sa.Column("session", sa.String(length=16), nullable=True),
        sa.Column("structure_flags", sa.JSON(), nullable=False),
        sa.Column("order_flow_sign", sa.String(length=8), nullable=True),
        sa.Column("confidence_at_detection", sa.Float(), nullable=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_recall_trades_symbol",
        ),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="SET NULL", name="fk_recall_trades_strategy",
        ),
        sa.UniqueConstraint("source_kind", "source_id", name="uq_recall_trades_source"),
    )
    op.create_index("ix_recall_trades_symbol_ts", "recall_trades", ["symbol_id", "captured_at"])
    op.create_index("ix_recall_trades_setup_type", "recall_trades", ["setup_type"])
    op.create_index("ix_recall_trades_outcome", "recall_trades", ["outcome"])
    op.create_index("ix_recall_trades_strategy", "recall_trades", ["strategy_id"])

    op.create_table(
        "recall_embeddings",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("trade_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("dims", sa.Integer(), nullable=False, server_default=sa.text("64")),
        sa.Column("vector", sa.JSON(), nullable=False),
        sa.Column("norm", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("features", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["trade_id"], ["recall_trades.id"], ondelete="CASCADE", name="fk_recall_embeddings_trade",
        ),
    )

    op.create_table(
        "recall_screenshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("trade_id", sa.String(length=64), nullable=True),
        sa.Column("setup_id", sa.String(length=64), nullable=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("image_url", sa.String(length=1024), nullable=False),
        sa.Column("annotations", sa.JSON(), nullable=False),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.ForeignKeyConstraint(
            ["trade_id"], ["recall_trades.id"], ondelete="CASCADE", name="fk_recall_screenshots_trade",
        ),
        sa.ForeignKeyConstraint(
            ["setup_id"], ["setups.id"], ondelete="SET NULL", name="fk_recall_screenshots_setup",
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_recall_screenshots_symbol",
        ),
    )
    op.create_index("ix_recall_screenshots_symbol_ts", "recall_screenshots", ["symbol_id", "captured_at"])
    op.create_index("ix_recall_screenshots_setup", "recall_screenshots", ["setup_id"])

    op.create_table(
        "missed_trades",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("setup_id", sa.String(length=64), nullable=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("would_be_direction", sa.String(length=8), nullable=False),
        sa.Column("theoretical_pnl_r", sa.Float(), nullable=True),
        sa.Column("detected_confidence", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.ForeignKeyConstraint(
            ["setup_id"], ["setups.id"], ondelete="SET NULL", name="fk_missed_trades_setup",
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_missed_trades_symbol",
        ),
    )
    op.create_index("ix_missed_trades_symbol_ts", "missed_trades", ["symbol_id", "detected_at"])
    op.create_index("ix_missed_trades_reason", "missed_trades", ["reason"])

    # ──────────────────────────── Learning + Governance ────────────────

    op.create_table(
        "learning_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("kind", sa.String(length=48), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("symbol_id", sa.String(length=64), nullable=True),
        sa.Column("setup_id", sa.String(length=64), nullable=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="SET NULL", name="fk_learning_events_symbol",
        ),
        sa.ForeignKeyConstraint(
            ["setup_id"], ["setups.id"], ondelete="SET NULL", name="fk_learning_events_setup",
        ),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="SET NULL", name="fk_learning_events_strategy",
        ),
    )
    op.create_index("ix_learning_events_kind_ts", "learning_events", ["kind", "occurred_at"])
    op.create_index(
        "ix_learning_events_strategy_ts", "learning_events", ["strategy_id", "occurred_at"],
    )
    op.create_index(
        "ix_learning_events_symbol_ts", "learning_events", ["symbol_id", "occurred_at"],
    )

    op.create_table(
        "confidence_calibrations",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("scope_kind", sa.String(length=16), nullable=False),
        sa.Column("scope_ref", sa.String(length=64), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default=sa.text("'bucket'")),
        sa.Column("bins", sa.JSON(), nullable=False),
        sa.Column("platt_a", sa.Float(), nullable=True),
        sa.Column("platt_b", sa.Float(), nullable=True),
        sa.Column("ece", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("brier", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_confidence_calibrations_scope_ts",
        "confidence_calibrations",
        ["scope_kind", "scope_ref", "computed_at"],
    )

    op.create_table(
        "regime_snapshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("regime", sa.String(length=16), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("atr", sa.Float(), nullable=True),
        sa.Column("adx", sa.Float(), nullable=True),
        sa.Column("news_pressure", sa.Float(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_regime_snapshots_symbol",
        ),
    )
    op.create_index(
        "ix_regime_snapshots_symbol_tf_ts",
        "regime_snapshots",
        ["symbol_id", "tf", "observed_at"],
    )

    op.create_table(
        "session_snapshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=True),
        sa.Column("session", sa.String(length=16), nullable=False),
        sa.Column("bucket_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("avg_range_r", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_volume", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("setup_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("win_rate", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_session_snapshots_symbol",
        ),
    )
    op.create_index("ix_session_snapshots_session_ts", "session_snapshots", ["session", "bucket_ts"])
    op.create_index(
        "ix_session_snapshots_symbol_session", "session_snapshots", ["symbol_id", "session"],
    )

    op.create_table(
        "data_truth_checks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False, server_default=sa.text("'green'")),
        sa.Column("last_observed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_value", sa.Float(), nullable=True),
        sa.Column("threshold", sa.Float(), nullable=True),
        sa.Column("message", sa.String(length=1000), nullable=True),
        sa.Column("kill_switch_tripped", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("kill_switch_reason", sa.String(length=500), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("kind", name="uq_data_truth_checks_kind"),
    )
    op.create_index("ix_data_truth_checks_status", "data_truth_checks", ["status"])

    op.create_table(
        "strategy_dna_cells",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column("regime", sa.String(length=16), nullable=False),
        sa.Column("session", sa.String(length=16), nullable=False),
        sa.Column("win_rate", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("mean_r", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("median_r", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("drawdown", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_strategy_dna_cells_strategy",
        ),
        sa.UniqueConstraint(
            "strategy_id", "regime", "session", name="uq_strategy_dna_cells",
        ),
    )
    op.create_index("ix_strategy_dna_strategy", "strategy_dna_cells", ["strategy_id"])


def downgrade() -> None:
    # Drop in reverse FK order.
    op.drop_index("ix_strategy_dna_strategy", table_name="strategy_dna_cells")
    op.drop_table("strategy_dna_cells")

    op.drop_index("ix_data_truth_checks_status", table_name="data_truth_checks")
    op.drop_table("data_truth_checks")

    op.drop_index("ix_session_snapshots_symbol_session", table_name="session_snapshots")
    op.drop_index("ix_session_snapshots_session_ts", table_name="session_snapshots")
    op.drop_table("session_snapshots")

    op.drop_index("ix_regime_snapshots_symbol_tf_ts", table_name="regime_snapshots")
    op.drop_table("regime_snapshots")

    op.drop_index("ix_confidence_calibrations_scope_ts", table_name="confidence_calibrations")
    op.drop_table("confidence_calibrations")

    op.drop_index("ix_learning_events_symbol_ts", table_name="learning_events")
    op.drop_index("ix_learning_events_strategy_ts", table_name="learning_events")
    op.drop_index("ix_learning_events_kind_ts", table_name="learning_events")
    op.drop_table("learning_events")

    op.drop_index("ix_missed_trades_reason", table_name="missed_trades")
    op.drop_index("ix_missed_trades_symbol_ts", table_name="missed_trades")
    op.drop_table("missed_trades")

    op.drop_index("ix_recall_screenshots_setup", table_name="recall_screenshots")
    op.drop_index("ix_recall_screenshots_symbol_ts", table_name="recall_screenshots")
    op.drop_table("recall_screenshots")

    op.drop_table("recall_embeddings")

    op.drop_index("ix_recall_trades_strategy", table_name="recall_trades")
    op.drop_index("ix_recall_trades_outcome", table_name="recall_trades")
    op.drop_index("ix_recall_trades_setup_type", table_name="recall_trades")
    op.drop_index("ix_recall_trades_symbol_ts", table_name="recall_trades")
    op.drop_table("recall_trades")

    op.drop_index("ix_promotion_events_strategy_ts", table_name="promotion_events")
    op.drop_table("promotion_events")

    op.drop_index("ix_strategy_rankings_strategy_ts", table_name="strategy_rankings")
    op.drop_index("ix_strategy_rankings_ts", table_name="strategy_rankings")
    op.drop_table("strategy_rankings")

    op.drop_table("experiment_backtests")

    op.drop_index("ix_experiments_strategy_status", table_name="experiments")
    op.drop_table("experiments")

    op.drop_index("ix_replay_frames_replay", table_name="replay_frames")
    op.drop_table("replay_frames")

    op.drop_index("ix_replay_runs_strategy", table_name="replay_runs")
    op.drop_index("ix_replay_runs_status", table_name="replay_runs")
    op.drop_table("replay_runs")

    op.drop_index("ix_backtest_equity_run_ts", table_name="backtest_equity_points")
    op.drop_table("backtest_equity_points")

    op.drop_index("ix_backtest_trades_run", table_name="backtest_trades")
    op.drop_table("backtest_trades")

    op.drop_index("ix_backtest_runs_requested_at", table_name="backtest_runs")
    op.drop_index("ix_backtest_runs_strategy_status", table_name="backtest_runs")
    op.drop_table("backtest_runs")

    op.drop_index("ix_strategy_versions_strategy", table_name="strategy_versions")
    op.drop_table("strategy_versions")

    op.drop_index("ix_strategies_setup_type", table_name="strategies")
    op.drop_index("ix_strategies_state_tier", table_name="strategies")
    op.drop_table("strategies")
