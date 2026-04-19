"""phase3 catchup — setups + paper_trades tables.

Revision ID: 20260419_0008
Revises: 20260419_0007
Create Date: 2026-04-19 12:40:00+00:00

Phase 3 PR5 + PR8 added the ``Setup`` and ``PaperTrade`` ORM models but
never shipped an Alembic migration — the test harness bootstraps the
schema via ``Base.metadata.create_all`` so the tests pass. This
migration catches production up. It is additive only (no existing
Phase 3 prod deployment has these rows — there was no migration).

Tables added:

  * ``setups`` — detected setup rows: price zone, confidence,
    structure + order-flow evidence, recall matches, status FSM.
  * ``paper_trades`` — the output of the Phase 3 paper-mode execution
    gate; FK-linked to ``setups`` + ``market_symbols``.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0008"
down_revision: Union[str, None] = "20260419_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "setups",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("setup_type", sa.String(length=32), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'detected'")),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entry_low", sa.Float(), nullable=False),
        sa.Column("entry_high", sa.Float(), nullable=False),
        sa.Column("entry_ref", sa.Float(), nullable=False),
        sa.Column("stop_loss", sa.Float(), nullable=False),
        sa.Column("take_profit", sa.Float(), nullable=False),
        sa.Column("rr", sa.Float(), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("confidence_components", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("history_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("reasoning", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("structure_event_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("order_flow_event_ids", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("recall_matches", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.ForeignKeyConstraint(
            ["symbol_id"],
            ["market_symbols.id"],
            ondelete="CASCADE",
            name="fk_setups_symbol_id",
        ),
    )
    op.create_index("ix_setups_symbol_status", "setups", ["symbol_id", "status"])
    op.create_index("ix_setups_status_detected", "setups", ["status", "detected_at"])

    op.create_table(
        "paper_trades",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("setup_id", sa.String(length=64), nullable=False),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("entry_ref", sa.Float(), nullable=False),
        sa.Column("stop_loss", sa.Float(), nullable=False),
        sa.Column("take_profit", sa.Float(), nullable=False),
        sa.Column("size_multiplier", sa.Float(), nullable=False, server_default=sa.text("1")),
        sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'pending_fill'")),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("approved_by_user_id", sa.String(length=64), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("filled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pnl_r", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["setup_id"], ["setups.id"], ondelete="CASCADE", name="fk_paper_trades_setup_id",
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"], ["market_symbols.id"], ondelete="CASCADE", name="fk_paper_trades_symbol_id",
        ),
    )
    op.create_index("ix_paper_trades_setup", "paper_trades", ["setup_id"])
    op.create_index("ix_paper_trades_status", "paper_trades", ["status"])
    op.create_index(
        "ix_paper_trades_symbol_status", "paper_trades", ["symbol_id", "status"]
    )


def downgrade() -> None:
    op.drop_index("ix_paper_trades_symbol_status", table_name="paper_trades")
    op.drop_index("ix_paper_trades_status", table_name="paper_trades")
    op.drop_index("ix_paper_trades_setup", table_name="paper_trades")
    op.drop_table("paper_trades")
    op.drop_index("ix_setups_status_detected", table_name="setups")
    op.drop_index("ix_setups_symbol_status", table_name="setups")
    op.drop_table("setups")
