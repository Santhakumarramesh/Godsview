"""phase4 execution + broker + risk tables.

Revision ID: 20260419_0009
Revises: 20260419_0008
Create Date: 2026-04-19 12:45:00+00:00

Adds the seven persistence tables for the Phase 4 live-execution path:

  * ``broker_accounts``           — one per operator-configured broker
  * ``risk_budgets``              — per-account caps consumed by the live gate
  * ``account_equity_snapshots``  — MTM equity snapshots from the broker
  * ``positions``                 — canonical live-position rows
  * ``broker_orders``             — idempotent order envelopes
  * ``broker_fills``              — one row per execution report
  * ``live_trades``               — live sibling of ``paper_trades``

Every table is additive — no Phase 3 table is modified — so a v2.3.0
production database can run ``alembic upgrade head`` in-place.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0009"
down_revision: Union[str, None] = "20260419_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "broker_accounts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False, server_default=sa.text("'paper'")),
        sa.Column("api_key_ref", sa.String(length=120), nullable=False),
        sa.Column("api_secret_ref", sa.String(length=120), nullable=False),
        sa.Column("base_url", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("provider", "display_name", name="uq_broker_accounts_name"),
    )

    op.create_table(
        "risk_budgets",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("account_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("max_risk_per_trade_r", sa.Float(), nullable=False, server_default=sa.text("0.005")),
        sa.Column("max_daily_drawdown_r", sa.Float(), nullable=False, server_default=sa.text("0.03")),
        sa.Column("max_open_positions", sa.Integer(), nullable=False, server_default=sa.text("5")),
        sa.Column("max_correlated_exposure", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column("max_gross_exposure", sa.Float(), nullable=False, server_default=sa.text("2.0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["account_id"], ["broker_accounts.id"], ondelete="CASCADE", name="fk_risk_budgets_account",
        ),
    )

    op.create_table(
        "account_equity_snapshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("account_id", sa.String(length=64), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("total_equity", sa.Float(), nullable=False),
        sa.Column("start_of_day_equity", sa.Float(), nullable=False),
        sa.Column("realized_pnl", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("unrealized_pnl", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("margin_used", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("buying_power", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"], ["broker_accounts.id"], ondelete="CASCADE", name="fk_equity_snap_account",
        ),
    )
    op.create_index(
        "ix_equity_snap_account_ts", "account_equity_snapshots", ["account_id", "observed_at"],
    )

    op.create_table(
        "positions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("account_id", sa.String(length=64), nullable=False),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("qty", sa.Float(), nullable=False),
        sa.Column("avg_entry_price", sa.Float(), nullable=False),
        sa.Column("mark_price", sa.Float(), nullable=False),
        sa.Column("unrealized_pnl", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.String(length=8), nullable=False, server_default=sa.text("'open'")),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("setup_id", sa.String(length=64), nullable=True),
        sa.Column("live_trade_id", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["account_id"], ["broker_accounts.id"], ondelete="CASCADE", name="fk_positions_account",
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_positions_symbol",
        ),
        sa.ForeignKeyConstraint(
            ["setup_id"], ["setups.id"], ondelete="SET NULL", name="fk_positions_setup",
        ),
    )
    op.create_index("ix_positions_account_status", "positions", ["account_id", "status"])
    op.create_index(
        "ix_positions_account_symbol_status",
        "positions",
        ["account_id", "symbol_id", "status"],
    )

    op.create_table(
        "broker_orders",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("client_order_id", sa.String(length=128), nullable=False, unique=True),
        sa.Column("account_id", sa.String(length=64), nullable=False),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("qty", sa.Float(), nullable=False),
        sa.Column("order_type", sa.String(length=16), nullable=False),
        sa.Column("time_in_force", sa.String(length=8), nullable=False),
        sa.Column("limit_price", sa.Float(), nullable=True),
        sa.Column("stop_price", sa.Float(), nullable=True),
        sa.Column("take_profit_price", sa.Float(), nullable=True),
        sa.Column("stop_loss_price", sa.Float(), nullable=True),
        sa.Column("setup_id", sa.String(length=64), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("broker_order_id", sa.String(length=128), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["account_id"], ["broker_accounts.id"], ondelete="CASCADE", name="fk_broker_orders_account",
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_broker_orders_symbol",
        ),
        sa.ForeignKeyConstraint(
            ["setup_id"], ["setups.id"], ondelete="SET NULL", name="fk_broker_orders_setup",
        ),
    )

    op.create_table(
        "broker_fills",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("client_order_id", sa.String(length=128), nullable=False),
        sa.Column("broker_order_id", sa.String(length=128), nullable=False),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("filled_qty", sa.Float(), nullable=False),
        sa.Column("avg_fill_price", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("commission", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("slippage", sa.Float(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_broker_fills_symbol",
        ),
    )
    op.create_index("ix_broker_fills_client_order", "broker_fills", ["client_order_id"])
    op.create_index("ix_broker_fills_symbol_ts", "broker_fills", ["symbol_id", "observed_at"])

    op.create_table(
        "live_trades",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("setup_id", sa.String(length=64), nullable=False),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("account_id", sa.String(length=64), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("entry_ref", sa.Float(), nullable=False),
        sa.Column("stop_loss", sa.Float(), nullable=False),
        sa.Column("take_profit", sa.Float(), nullable=False),
        sa.Column("size_multiplier", sa.Float(), nullable=False, server_default=sa.text("1")),
        sa.Column("qty", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'pending_submit'")),
        sa.Column("client_order_id", sa.String(length=128), nullable=False, unique=True),
        sa.Column("broker_order_id", sa.String(length=128), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("approved_by_user_id", sa.String(length=64), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("filled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("avg_fill_price", sa.Float(), nullable=True),
        sa.Column("filled_qty", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("commission", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("realized_pnl_dollars", sa.Float(), nullable=True),
        sa.Column("pnl_r", sa.Float(), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(
            ["setup_id"], ["setups.id"], ondelete="CASCADE", name="fk_live_trades_setup",
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_live_trades_symbol",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["broker_accounts.id"], ondelete="CASCADE", name="fk_live_trades_account",
        ),
    )
    op.create_index("ix_live_trades_setup", "live_trades", ["setup_id"])
    op.create_index("ix_live_trades_account_status", "live_trades", ["account_id", "status"])
    op.create_index("ix_live_trades_symbol_status", "live_trades", ["symbol_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_live_trades_symbol_status", table_name="live_trades")
    op.drop_index("ix_live_trades_account_status", table_name="live_trades")
    op.drop_index("ix_live_trades_setup", table_name="live_trades")
    op.drop_table("live_trades")
    op.drop_index("ix_broker_fills_symbol_ts", table_name="broker_fills")
    op.drop_index("ix_broker_fills_client_order", table_name="broker_fills")
    op.drop_table("broker_fills")
    op.drop_table("broker_orders")
    op.drop_index("ix_positions_account_symbol_status", table_name="positions")
    op.drop_index("ix_positions_account_status", table_name="positions")
    op.drop_table("positions")
    op.drop_index("ix_equity_snap_account_ts", table_name="account_equity_snapshots")
    op.drop_table("account_equity_snapshots")
    op.drop_table("risk_budgets")
    op.drop_table("broker_accounts")
