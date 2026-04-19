"""phase2 structure detector tables — market_bars, structure_events.

Revision ID: 20260419_0004
Revises: 20260419_0003
Create Date: 2026-04-19 03:00:00+00:00

Adds the OHLCV bar store and the BOS/CHOCH/inducement/equilibrium
event log produced by the structure detectors. ``market_bars`` uses
a composite primary key (symbol_id, tf, t) for natural deduplication
of an upserted bar feed.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0004"
down_revision: Union[str, None] = "20260419_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_bars",
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("t", sa.DateTime(timezone=True), nullable=False),
        sa.Column("o", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("l", sa.Float(), nullable=False),
        sa.Column("c", sa.Float(), nullable=False),
        sa.Column("v", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "closed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "ingested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("symbol_id", "tf", "t", name="pk_market_bars"),
        sa.ForeignKeyConstraint(
            ["symbol_id"],
            ["market_symbols.id"],
            ondelete="CASCADE",
            name="fk_market_bars_symbol_id",
        ),
    )
    op.create_index(
        "ix_market_bars_symbol_tf_t", "market_bars", ["symbol_id", "tf", "t"]
    )

    op.create_table(
        "structure_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("level", sa.Float(), nullable=False),
        sa.Column(
            "broken_pivot_t", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column("broken_pivot_kind", sa.String(length=16), nullable=False),
        sa.Column("broken_pivot_price", sa.Float(), nullable=False),
        sa.Column("broken_pivot_bar_index", sa.Integer(), nullable=False),
        sa.Column(
            "confirmation_t", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "confidence", sa.Float(), nullable=False, server_default=sa.text("0.5")
        ),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"],
            ["market_symbols.id"],
            ondelete="CASCADE",
            name="fk_structure_events_symbol_id",
        ),
    )
    op.create_index(
        "ix_structure_events_symbol_tf_t",
        "structure_events",
        ["symbol_id", "tf", "confirmation_t"],
    )
    op.create_index(
        "ix_structure_events_kind", "structure_events", ["kind"]
    )


def downgrade() -> None:
    op.drop_index("ix_structure_events_kind", table_name="structure_events")
    op.drop_index(
        "ix_structure_events_symbol_tf_t", table_name="structure_events"
    )
    op.drop_table("structure_events")
    op.drop_index("ix_market_bars_symbol_tf_t", table_name="market_bars")
    op.drop_table("market_bars")
