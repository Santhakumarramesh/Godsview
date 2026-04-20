"""phase6 portfolio intelligence tables.

Revision ID: 20260419_0011
Revises: 20260419_0010
Create Date: 2026-04-20 09:00:00+00:00

Phase 6 (part 1 of 3) — Portfolio Intelligence surface.

Adds the single persistence table needed to back the portfolio layer:

  * ``allocation_plans``   — operator-set strategy allocation targets

Everything else the portfolio layer surfaces (per-symbol exposure,
per-class exposure, daily PnL, drawdown) is *projected at read time*
from Phase 4 state (``positions``, ``live_trades``,
``account_equity_snapshots``), so no new tables are required for it.

Strictly additive — no Phase 0-5 table is modified — so a v2.5.0
production database can run ``alembic upgrade head`` in-place without
downtime.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0011"
down_revision: Union[str, None] = "20260419_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "allocation_plans",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "account_id",
            sa.String(length=64),
            sa.ForeignKey("broker_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "strategy_id",
            sa.String(length=64),
            sa.ForeignKey("strategies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_percent", sa.Float(), nullable=False),
        sa.Column(
            "source",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'operator'"),
        ),
        sa.Column("reason", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "reviewed_at",
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
        sa.Column("updated_by_user_id", sa.String(length=64), nullable=True),
        sa.UniqueConstraint(
            "account_id", "strategy_id", name="uq_allocation_plans_account_strategy"
        ),
    )
    op.create_index(
        "ix_allocation_plans_account",
        "allocation_plans",
        ["account_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_allocation_plans_account", table_name="allocation_plans")
    op.drop_table("allocation_plans")
