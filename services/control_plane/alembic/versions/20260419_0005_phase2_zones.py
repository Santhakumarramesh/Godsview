"""phase2 zone tables — order_blocks, fvgs.

Revision ID: 20260419_0005
Revises: 20260419_0004
Create Date: 2026-04-19 04:00:00+00:00

Adds the persistence tables for the two retest-zone primitives that
sit downstream of the structure detector:

  * ``order_blocks`` — emitted by :func:`app.structure.detect_order_blocks`
    for every BOS/CHOCH event. Each row carries the OB body (high/low),
    a 0..1 strength score, and the ``retested``/``violated`` mutation
    flags that the PR6 fusion engine updates as new bars arrive.
  * ``fvgs`` — emitted by :func:`app.structure.detect_fvgs` from the
    raw bar series. Each row carries the gap envelope (top/bottom) and
    a ``mitigated`` flag that flips when subsequent bars close through.

Both tables FK to ``market_symbols`` with CASCADE so dropping a symbol
also drops its zones. ``order_blocks.structure_event_id`` FKs to
``structure_events`` with SET NULL so the zone survives if the source
event is later pruned (e.g., by a structure recompute).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0005"
down_revision: Union[str, None] = "20260419_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "order_blocks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("high", sa.Float(), nullable=False),
        sa.Column("low", sa.Float(), nullable=False),
        sa.Column("t", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "strength", sa.Float(), nullable=False, server_default=sa.text("0.5")
        ),
        sa.Column(
            "retested",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "violated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("structure_event_id", sa.String(length=64), nullable=True),
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
            name="fk_order_blocks_symbol_id",
        ),
        sa.ForeignKeyConstraint(
            ["structure_event_id"],
            ["structure_events.id"],
            ondelete="SET NULL",
            name="fk_order_blocks_structure_event_id",
        ),
    )
    op.create_index(
        "ix_order_blocks_symbol_tf_t",
        "order_blocks",
        ["symbol_id", "tf", "t"],
    )
    op.create_index(
        "ix_order_blocks_active", "order_blocks", ["symbol_id", "violated"]
    )

    op.create_table(
        "fvgs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("tf", sa.String(length=8), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("top", sa.Float(), nullable=False),
        sa.Column("bottom", sa.Float(), nullable=False),
        sa.Column("t", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "mitigated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "mitigated_at", sa.DateTime(timezone=True), nullable=True
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
            name="fk_fvgs_symbol_id",
        ),
    )
    op.create_index(
        "ix_fvgs_symbol_tf_t", "fvgs", ["symbol_id", "tf", "t"]
    )
    op.create_index(
        "ix_fvgs_active", "fvgs", ["symbol_id", "mitigated"]
    )


def downgrade() -> None:
    op.drop_index("ix_fvgs_active", table_name="fvgs")
    op.drop_index("ix_fvgs_symbol_tf_t", table_name="fvgs")
    op.drop_table("fvgs")
    op.drop_index("ix_order_blocks_active", table_name="order_blocks")
    op.drop_index(
        "ix_order_blocks_symbol_tf_t", table_name="order_blocks"
    )
    op.drop_table("order_blocks")
