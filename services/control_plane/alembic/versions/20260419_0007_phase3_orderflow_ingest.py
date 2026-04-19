"""phase3 order-flow ingest — depth_snapshots + delta_bars.

Revision ID: 20260419_0007
Revises: 20260419_0006
Create Date: 2026-04-19 06:00:00+00:00

Adds the two persistence tables for the Phase 3 ingest path:

  * ``depth_snapshots`` — point-in-time order-book ladders (bids + asks
    as JSON), cumulative trade delta, last print, and source tag.
    Each row is one snapshot from a Bookmap-style feed (or the operator
    test-pump endpoint for paper-mode dev).

  * ``delta_bars`` — per-bar buy/sell volume rollup keyed identically to
    ``market_bars`` so the detector can join the two on
    ``(symbol_id, tf, t)`` for combined OHLCV + delta analysis.

Both tables are CASCADE-deleted with their parent symbol so a symbol
deletion doesn't leave orphaned book state behind.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0007"
down_revision: Union[str, None] = "20260419_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "depth_snapshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("t", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "bids",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "asks",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "delta", sa.Float(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("last", sa.Float(), nullable=False),
        sa.Column(
            "source",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'synthetic'"),
        ),
        sa.Column(
            "ingested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"],
            ["market_symbols.id"],
            ondelete="CASCADE",
            name="fk_depth_snapshots_symbol_id",
        ),
    )
    op.create_index(
        "ix_depth_snapshots_symbol_t",
        "depth_snapshots",
        ["symbol_id", "t"],
    )
    op.create_index(
        "ix_depth_snapshots_source",
        "depth_snapshots",
        ["source"],
    )

    op.create_table(
        "delta_bars",
        sa.Column("symbol_id", sa.String(length=64), primary_key=True),
        sa.Column("tf", sa.String(length=8), primary_key=True),
        sa.Column("t", sa.DateTime(timezone=True), primary_key=True),
        sa.Column(
            "buy_volume",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "sell_volume",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "delta", sa.Float(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "cumulative_delta",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "ingested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"],
            ["market_symbols.id"],
            ondelete="CASCADE",
            name="fk_delta_bars_symbol_id",
        ),
    )
    op.create_index(
        "ix_delta_bars_symbol_tf_t",
        "delta_bars",
        ["symbol_id", "tf", "t"],
    )


def downgrade() -> None:
    op.drop_index("ix_delta_bars_symbol_tf_t", table_name="delta_bars")
    op.drop_table("delta_bars")
    op.drop_index("ix_depth_snapshots_source", table_name="depth_snapshots")
    op.drop_index("ix_depth_snapshots_symbol_t", table_name="depth_snapshots")
    op.drop_table("depth_snapshots")
