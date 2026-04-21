"""Full domain schema — trading signals, setups, execution, flow, analytics, journal

Revision ID: 20260420_0002
Revises: 20260419_0001
Create Date: 2026-04-20 00:00:00+00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260420_0002"
down_revision: Union[str, None] = "20260419_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ============================================================================
    # SIGNAL DETECTION & TECHNICAL ANALYSIS
    # ============================================================================

    op.create_table(
        "signals",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),  # bullish, bearish, reversal, continuation, etc
        sa.Column("timeframe", sa.String(length=16), nullable=False),  # 1m, 5m, 15m, 1h, 4h, 1d, etc
        sa.Column("direction", sa.String(length=16), nullable=False),  # long, short
        sa.Column("confidence", sa.Float(), nullable=False),  # 0-100
        sa.Column("price_level", sa.Float(), nullable=False),
        sa.Column("source_agent", sa.String(length=120), nullable=False),  # which detector generated this
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_signals_symbol", "signals", ["symbol"])
    op.create_index("ix_signals_created_at", "signals", ["created_at"])
    op.create_index("ix_signals_type", "signals", ["type"])
    op.create_index("ix_signals_timeframe", "signals", ["timeframe"])

    op.create_table(
        "setups",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("setup_type", sa.String(length=64), nullable=False),  # confluence, scalp, swing, etc
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="new",
        ),  # new, validated, pending, approved, rejected
        sa.Column("confluence_score", sa.Float(), nullable=False),  # 0-100
        sa.Column("entry", sa.Float(), nullable=False),
        sa.Column("stop", sa.Float(), nullable=False),
        sa.Column("target", sa.Float(), nullable=False),
        sa.Column("rr_ratio", sa.Float(), nullable=True),  # risk:reward
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_setups_symbol", "setups", ["symbol"])
    op.create_index("ix_setups_created_at", "setups", ["created_at"])
    op.create_index("ix_setups_status", "setups", ["status"])

    op.create_table(
        "order_blocks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("timeframe", sa.String(length=16), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),  # bullish, bearish
        sa.Column("price_high", sa.Float(), nullable=False),
        sa.Column("price_low", sa.Float(), nullable=False),
        sa.Column("fresh", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("mitigated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("strength", sa.Integer(), nullable=False),  # 1-10 rating
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_order_blocks_symbol", "order_blocks", ["symbol"])
    op.create_index("ix_order_blocks_created_at", "order_blocks", ["created_at"])

    op.create_table(
        "structure_breaks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("timeframe", sa.String(length=16), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),  # BOS (Break of Structure), CHOCH (Change of Character)
        sa.Column("direction", sa.String(length=16), nullable=False),  # up, down
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("confirmed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_structure_breaks_symbol", "structure_breaks", ["symbol"])
    op.create_index("ix_structure_breaks_created_at", "structure_breaks", ["created_at"])

    op.create_table(
        "liquidity_sweeps",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),  # buy_side, sell_side
        sa.Column("swept_level", sa.Float(), nullable=False),
        sa.Column("recapture", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_liquidity_sweeps_symbol", "liquidity_sweeps", ["symbol"])
    op.create_index("ix_liquidity_sweeps_created_at", "liquidity_sweeps", ["created_at"])

    # ============================================================================
    # EXTERNAL INTEGRATIONS & DATA SOURCES
    # ============================================================================

    op.create_table(
        "webhook_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),  # tradingview, etc
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),  # long, short, close, etc
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("strategy_name", sa.String(length=120), nullable=True),
        sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_webhook_events_symbol", "webhook_events", ["symbol"])
    op.create_index("ix_webhook_events_received_at", "webhook_events", ["received_at"])
    op.create_index("ix_webhook_events_processed", "webhook_events", ["processed"])

    op.create_table(
        "pine_scripts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("version", sa.String(length=16), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column(
            "signals_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_pine_scripts_active", "pine_scripts", ["active"])

    op.create_table(
        "tv_strategy_syncs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=True),  # FK to strategies table
        sa.Column("tv_name", sa.String(length=120), nullable=False),  # TradingView strategy name
        sa.Column(
            "param_map_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("last_sync", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tv_strategy_syncs_strategy_id", "tv_strategy_syncs", ["strategy_id"])

    # ============================================================================
    # ORDER FLOW & MARKET MICROSTRUCTURE
    # ============================================================================

    op.create_table(
        "flow_snapshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("delta", sa.Float(), nullable=False),  # buy vol - sell vol
        sa.Column("cum_delta", sa.Float(), nullable=False),  # cumulative delta
        sa.Column("buy_vol", sa.Float(), nullable=False),
        sa.Column("sell_vol", sa.Float(), nullable=False),
        sa.Column("imbalance", sa.Float(), nullable=False),  # ratio
        sa.Column("absorption_score", sa.Float(), nullable=True),
        sa.Column(
            "pressure_bias",
            sa.String(length=16),
            nullable=False,
        ),  # bullish, bearish, neutral
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_flow_snapshots_symbol", "flow_snapshots", ["symbol"])
    op.create_index("ix_flow_snapshots_timestamp", "flow_snapshots", ["timestamp"])

    # ============================================================================
    # STRATEGY DEFINITION & OPTIMIZATION
    # ============================================================================

    op.create_table(
        "strategies",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "entry_rules_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "exit_rules_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "risk_rules_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="research",
        ),  # research, paper, assisted, semi_auto, autonomous
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_strategies_status", "strategies", ["status"])

    op.create_table(
        "backtests",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column(
            "symbols_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timeframe", sa.String(length=16), nullable=False),
        sa.Column("initial_capital", sa.Float(), nullable=False),
        sa.Column(
            "result_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="running",
        ),  # running, completed, failed
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_backtests_strategy_id"
        ),
    )
    op.create_index("ix_backtests_strategy_id", "backtests", ["strategy_id"])
    op.create_index("ix_backtests_status", "backtests", ["status"])

    op.create_table(
        "experiments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column(
            "parameters_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("best_result_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_experiments_strategy_id"
        ),
    )
    op.create_index("ix_experiments_strategy_id", "experiments", ["strategy_id"])
    op.create_index("ix_experiments_status", "experiments", ["status"])

    op.create_table(
        "promotions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=False),
        sa.Column("from_stage", sa.String(length=32), nullable=False),
        sa.Column("to_stage", sa.String(length=32), nullable=False),
        sa.Column(
            "gating_checks_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("approved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("approved_by", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["strategy_id"], ["strategies.id"], ondelete="CASCADE", name="fk_promotions_strategy_id"
        ),
    )
    op.create_index("ix_promotions_strategy_id", "promotions", ["strategy_id"])
    op.create_index("ix_promotions_approved", "promotions", ["approved"])

    # ============================================================================
    # EXECUTION & ORDERS
    # ============================================================================

    op.create_table(
        "orders",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("side", sa.String(length=16), nullable=False),  # buy, sell
        sa.Column("order_type", sa.String(length=32), nullable=False),  # market, limit, stop, etc
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("stop_price", sa.Float(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
        ),  # pending, open, filled, cancelled, rejected
        sa.Column(
            "execution_mode",
            sa.String(length=32),
            nullable=False,
        ),  # manual, paper, assisted, semi_auto, autonomous
        sa.Column("strategy_id", sa.String(length=64), nullable=True),
        sa.Column("filled_qty", sa.Float(), nullable=False, server_default="0"),
        sa.Column("avg_fill_price", sa.Float(), nullable=True),
        sa.Column("slippage", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_orders_symbol", "orders", ["symbol"])
    op.create_index("ix_orders_status", "orders", ["status"])
    op.create_index("ix_orders_created_at", "orders", ["created_at"])
    op.create_index("ix_orders_strategy_id", "orders", ["strategy_id"])

    op.create_table(
        "fills",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("order_id", sa.String(length=64), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("side", sa.String(length=16), nullable=False),
        sa.Column("fee", sa.Float(), nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], ondelete="CASCADE", name="fk_fills_order_id"
        ),
    )
    op.create_index("ix_fills_order_id", "fills", ["order_id"])
    op.create_index("ix_fills_timestamp", "fills", ["timestamp"])

    op.create_table(
        "positions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("side", sa.String(length=16), nullable=False),  # long, short
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("entry_price", sa.Float(), nullable=False),
        sa.Column("current_price", sa.Float(), nullable=False),
        sa.Column("unrealized_pnl", sa.Float(), nullable=False),
        sa.Column("realized_pnl", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stop_loss", sa.Float(), nullable=True),
        sa.Column("take_profit", sa.Float(), nullable=True),
        sa.Column("strategy_id", sa.String(length=64), nullable=True),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_positions_symbol", "positions", ["symbol"])
    op.create_index("ix_positions_strategy_id", "positions", ["strategy_id"])

    # ============================================================================
    # PORTFOLIO & RISK MANAGEMENT
    # ============================================================================

    op.create_table(
        "portfolio_snapshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("total_equity", sa.Float(), nullable=False),
        sa.Column("cash", sa.Float(), nullable=False),
        sa.Column("exposure", sa.Float(), nullable=False),  # % of equity at risk
        sa.Column("unrealized_pnl", sa.Float(), nullable=False),
        sa.Column("realized_pnl_today", sa.Float(), nullable=False),
        sa.Column("drawdown_pct", sa.Float(), nullable=False),
        sa.Column("position_count", sa.Integer(), nullable=False),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_portfolio_snapshots_timestamp", "portfolio_snapshots", ["timestamp"])

    op.create_table(
        "risk_policies",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "type",
            sa.String(length=64),
            nullable=False,
        ),  # max_position_size, max_daily_loss, max_correlation, etc
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column(
            "action",
            sa.String(length=32),
            nullable=False,
        ),  # warn, block, flatten
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_risk_policies_active", "risk_policies", ["active"])

    op.create_table(
        "pre_trade_checks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("order_id", sa.String(length=64), nullable=False),
        sa.Column(
            "checks_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("overall_pass", sa.Boolean(), nullable=False),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], ondelete="CASCADE", name="fk_pre_trade_checks_order_id"
        ),
    )
    op.create_index("ix_pre_trade_checks_order_id", "pre_trade_checks", ["order_id"])

    # ============================================================================
    # LEARNING & MEMORY
    # ============================================================================

    op.create_table(
        "recall_entries",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("setup_type", sa.String(length=64), nullable=False),
        sa.Column("timeframe", sa.String(length=16), nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=False),  # win, loss, breakeven
        sa.Column("pnl", sa.Float(), nullable=True),
        sa.Column(
            "confluence_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("screenshot_url", sa.String(length=512), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("embedding_vector", postgresql.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_recall_entries_symbol", "recall_entries", ["symbol"])
    op.create_index("ix_recall_entries_created_at", "recall_entries", ["created_at"])

    op.create_table(
        "journal_entries",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("trade_id", sa.String(length=64), nullable=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column(
            "mistakes_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "lessons_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("emotional_state", sa.String(length=32), nullable=True),
        sa.Column("rating", sa.Integer(), nullable=True),  # 1-5
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_journal_entries_symbol", "journal_entries", ["symbol"])
    op.create_index("ix_journal_entries_created_at", "journal_entries", ["created_at"])

    op.create_table(
        "cases",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=False),
        sa.Column(
            "entries_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "tags_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_cases_category", "cases", ["category"])

    op.create_table(
        "screenshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol", sa.String(length=12), nullable=False),
        sa.Column("url", sa.String(length=512), nullable=False),
        sa.Column(
            "tags_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("trade_id", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_screenshots_symbol", "screenshots", ["symbol"])
    op.create_index("ix_screenshots_created_at", "screenshots", ["created_at"])

    # ============================================================================
    # BRAIN HOLOGRAM & KNOWLEDGE GRAPH
    # ============================================================================

    op.create_table(
        "brain_nodes",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("type", sa.String(length=32), nullable=False),  # concept, pattern, symbol, etc
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("symbol", sa.String(length=12), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),  # active, deprecated, testing
        sa.Column(
            "metrics_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_brain_nodes_symbol", "brain_nodes", ["symbol"])
    op.create_index("ix_brain_nodes_type", "brain_nodes", ["type"])

    op.create_table(
        "brain_edges",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("source_id", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column(
            "edge_type",
            sa.String(length=32),
            nullable=False,
        ),  # reinforces, contradicts, correlates, etc
        sa.ForeignKeyConstraint(
            ["source_id"], ["brain_nodes.id"], ondelete="CASCADE", name="fk_brain_edges_source_id"
        ),
        sa.ForeignKeyConstraint(
            ["target_id"], ["brain_nodes.id"], ondelete="CASCADE", name="fk_brain_edges_target_id"
        ),
    )
    op.create_index("ix_brain_edges_source_id", "brain_edges", ["source_id"])
    op.create_index("ix_brain_edges_target_id", "brain_edges", ["target_id"])

    # ============================================================================
    # ALERTS & SYSTEM MONITORING
    # ============================================================================

    op.create_table(
        "alerts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "type",
            sa.String(length=32),
            nullable=False,
        ),  # market, infra, order, risk, data
        sa.Column(
            "severity",
            sa.String(length=16),
            nullable=False,
        ),  # critical, high, medium, low, info
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("acknowledged", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_alerts_type", "alerts", ["type"])
    op.create_index("ix_alerts_severity", "alerts", ["severity"])
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"])
    op.create_index("ix_alerts_acknowledged", "alerts", ["acknowledged"])


def downgrade() -> None:
    # Drop in reverse order of creation (respecting FK constraints)

    op.drop_index("ix_alerts_acknowledged", table_name="alerts")
    op.drop_index("ix_alerts_created_at", table_name="alerts")
    op.drop_index("ix_alerts_severity", table_name="alerts")
    op.drop_index("ix_alerts_type", table_name="alerts")
    op.drop_table("alerts")

    op.drop_index("ix_brain_edges_target_id", table_name="brain_edges")
    op.drop_index("ix_brain_edges_source_id", table_name="brain_edges")
    op.drop_table("brain_edges")

    op.drop_index("ix_brain_nodes_type", table_name="brain_nodes")
    op.drop_index("ix_brain_nodes_symbol", table_name="brain_nodes")
    op.drop_table("brain_nodes")

    op.drop_index("ix_screenshots_created_at", table_name="screenshots")
    op.drop_index("ix_screenshots_symbol", table_name="screenshots")
    op.drop_table("screenshots")

    op.drop_index("ix_cases_category", table_name="cases")
    op.drop_table("cases")

    op.drop_index("ix_journal_entries_created_at", table_name="journal_entries")
    op.drop_index("ix_journal_entries_symbol", table_name="journal_entries")
    op.drop_table("journal_entries")

    op.drop_index("ix_recall_entries_created_at", table_name="recall_entries")
    op.drop_index("ix_recall_entries_symbol", table_name="recall_entries")
    op.drop_table("recall_entries")

    op.drop_index("ix_pre_trade_checks_order_id", table_name="pre_trade_checks")
    op.drop_table("pre_trade_checks")

    op.drop_index("ix_risk_policies_active", table_name="risk_policies")
    op.drop_table("risk_policies")

    op.drop_index("ix_portfolio_snapshots_timestamp", table_name="portfolio_snapshots")
    op.drop_table("portfolio_snapshots")

    op.drop_index("ix_positions_strategy_id", table_name="positions")
    op.drop_index("ix_positions_symbol", table_name="positions")
    op.drop_table("positions")

    op.drop_index("ix_fills_timestamp", table_name="fills")
    op.drop_index("ix_fills_order_id", table_name="fills")
    op.drop_table("fills")

    op.drop_index("ix_orders_strategy_id", table_name="orders")
    op.drop_index("ix_orders_created_at", table_name="orders")
    op.drop_index("ix_orders_status", table_name="orders")
    op.drop_index("ix_orders_symbol", table_name="orders")
    op.drop_table("orders")

    op.drop_index("ix_promotions_approved", table_name="promotions")
    op.drop_index("ix_promotions_strategy_id", table_name="promotions")
    op.drop_table("promotions")

    op.drop_index("ix_experiments_status", table_name="experiments")
    op.drop_index("ix_experiments_strategy_id", table_name="experiments")
    op.drop_table("experiments")

    op.drop_index("ix_backtests_status", table_name="backtests")
    op.drop_index("ix_backtests_strategy_id", table_name="backtests")
    op.drop_table("backtests")

    op.drop_index("ix_strategies_status", table_name="strategies")
    op.drop_table("strategies")

    op.drop_index("ix_flow_snapshots_timestamp", table_name="flow_snapshots")
    op.drop_index("ix_flow_snapshots_symbol", table_name="flow_snapshots")
    op.drop_table("flow_snapshots")

    op.drop_index("ix_tv_strategy_syncs_strategy_id", table_name="tv_strategy_syncs")
    op.drop_table("tv_strategy_syncs")

    op.drop_index("ix_pine_scripts_active", table_name="pine_scripts")
    op.drop_table("pine_scripts")

    op.drop_index("ix_webhook_events_processed", table_name="webhook_events")
    op.drop_index("ix_webhook_events_received_at", table_name="webhook_events")
    op.drop_index("ix_webhook_events_symbol", table_name="webhook_events")
    op.drop_table("webhook_events")

    op.drop_index("ix_liquidity_sweeps_created_at", table_name="liquidity_sweeps")
    op.drop_index("ix_liquidity_sweeps_symbol", table_name="liquidity_sweeps")
    op.drop_table("liquidity_sweeps")

    op.drop_index("ix_structure_breaks_created_at", table_name="structure_breaks")
    op.drop_index("ix_structure_breaks_symbol", table_name="structure_breaks")
    op.drop_table("structure_breaks")

    op.drop_index("ix_order_blocks_created_at", table_name="order_blocks")
    op.drop_index("ix_order_blocks_symbol", table_name="order_blocks")
    op.drop_table("order_blocks")

    op.drop_index("ix_setups_status", table_name="setups")
    op.drop_index("ix_setups_created_at", table_name="setups")
    op.drop_index("ix_setups_symbol", table_name="setups")
    op.drop_table("setups")

    op.drop_index("ix_signals_timeframe", table_name="signals")
    op.drop_index("ix_signals_type", table_name="signals")
    op.drop_index("ix_signals_created_at", table_name="signals")
    op.drop_index("ix_signals_symbol", table_name="signals")
    op.drop_table("signals")
