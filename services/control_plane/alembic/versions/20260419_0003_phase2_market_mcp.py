"""phase2 market structure + MCP ingest — market_symbols, tv_signals,
tv_signal_audit_steps.

Revision ID: 20260419_0003
Revises: 20260419_0002
Create Date: 2026-04-19 02:00:00+00:00

Adds the persistence layer for TradingView signal ingest and the
symbol registry that resolves (ticker, exchange) → stable internal id.
All changes are additive; downgrade drops the three tables in FK-safe
order.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260419_0003"
down_revision: Union[str, None] = "20260419_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── market_symbols ────────────────────────────────────────────────
    op.create_table(
        "market_symbols",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("ticker", sa.String(length=32), nullable=False),
        sa.Column("exchange", sa.String(length=32), nullable=False),
        sa.Column("asset_class", sa.String(length=16), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("tick_size", sa.Float(), nullable=False),
        sa.Column(
            "lot_size", sa.Float(), nullable=False, server_default=sa.text("1.0")
        ),
        sa.Column(
            "quote_currency",
            sa.String(length=3),
            nullable=False,
            server_default="USD",
        ),
        sa.Column(
            "session_tz",
            sa.String(length=64),
            nullable=False,
            server_default="America/New_York",
        ),
        sa.Column(
            "active", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "ticker", "exchange", name="uq_market_symbols_ticker_exchange"
        ),
    )
    op.create_index(
        "ix_market_symbols_asset_class", "market_symbols", ["asset_class"]
    )

    # ── tv_signals ────────────────────────────────────────────────────
    op.create_table(
        "tv_signals",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("webhook_id", sa.String(length=64), nullable=True),
        sa.Column("alert_id", sa.String(length=128), nullable=False),
        sa.Column("symbol_id", sa.String(length=64), nullable=True),
        sa.Column("ticker", sa.String(length=32), nullable=False),
        sa.Column("exchange", sa.String(length=32), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("family", sa.String(length=32), nullable=False),
        sa.Column("entry", sa.Float(), nullable=False),
        sa.Column("stop", sa.Float(), nullable=False),
        sa.Column("target", sa.Float(), nullable=False),
        sa.Column(
            "pine_confidence",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0.5"),
        ),
        sa.Column("risk_reward", sa.Float(), nullable=True),
        sa.Column("fired_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="received",
        ),
        sa.Column("rejection_reason", sa.String(length=255), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "processed_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.ForeignKeyConstraint(
            ["webhook_id"],
            ["webhooks.id"],
            ondelete="SET NULL",
            name="fk_tv_signals_webhook_id",
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"],
            ["market_symbols.id"],
            ondelete="SET NULL",
            name="fk_tv_signals_symbol_id",
        ),
    )
    op.create_index("ix_tv_signals_alert_id", "tv_signals", ["alert_id"])
    op.create_index(
        "ix_tv_signals_received_at", "tv_signals", ["received_at"]
    )
    op.create_index("ix_tv_signals_status", "tv_signals", ["status"])
    op.create_index(
        "ix_tv_signals_symbol_id", "tv_signals", ["symbol_id"]
    )

    # ── tv_signal_audit_steps ─────────────────────────────────────────
    op.create_table(
        "tv_signal_audit_steps",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("signal_id", sa.String(length=64), nullable=False),
        sa.Column("step", sa.String(length=48), nullable=False),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=True),
        sa.Column(
            "t",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["signal_id"],
            ["tv_signals.id"],
            ondelete="CASCADE",
            name="fk_tv_signal_audit_steps_signal_id",
        ),
    )
    op.create_index(
        "ix_tv_signal_audit_steps_signal_id",
        "tv_signal_audit_steps",
        ["signal_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tv_signal_audit_steps_signal_id", table_name="tv_signal_audit_steps"
    )
    op.drop_table("tv_signal_audit_steps")
    op.drop_index("ix_tv_signals_symbol_id", table_name="tv_signals")
    op.drop_index("ix_tv_signals_status", table_name="tv_signals")
    op.drop_index("ix_tv_signals_received_at", table_name="tv_signals")
    op.drop_index("ix_tv_signals_alert_id", table_name="tv_signals")
    op.drop_table("tv_signals")
    op.drop_index(
        "ix_market_symbols_asset_class", table_name="market_symbols"
    )
    op.drop_table("market_symbols")
