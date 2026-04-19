"""phase2 fusion engine — market_contexts.

Revision ID: 20260419_0006
Revises: 20260419_0005
Create Date: 2026-04-19 05:00:00+00:00

Persists the per-symbol multi-timeframe Fusion Engine snapshot. Each
row carries the rolled-up HTF + LTF biases, a conflict flag, and the
materialised lists of the structure events / order blocks / FVGs that
were active at ``generated_at``.

The materialised JSON columns let the snapshot serve as the canonical
"context at scoring time" without requiring an at-rest join across
five tables. Source-of-truth remains the dedicated ``structure_events``
/ ``order_blocks`` / ``fvgs`` tables.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0006"
down_revision: Union[str, None] = "20260419_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_contexts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("symbol_id", sa.String(length=64), nullable=False),
        sa.Column("htf_bias", sa.String(length=8), nullable=False),
        sa.Column("ltf_bias", sa.String(length=8), nullable=False),
        sa.Column(
            "conflict",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "recent_events",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "active_order_blocks",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "active_fvgs",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["symbol_id"],
            ["market_symbols.id"],
            ondelete="CASCADE",
            name="fk_market_contexts_symbol_id",
        ),
    )
    op.create_index(
        "ix_market_contexts_symbol_generated",
        "market_contexts",
        ["symbol_id", "generated_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_market_contexts_symbol_generated", table_name="market_contexts"
    )
    op.drop_table("market_contexts")
