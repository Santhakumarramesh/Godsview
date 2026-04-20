"""phase7 portfolio rebalancer plans + intents.

Revision ID: 20260419_0015
Revises: 20260419_0014
Create Date: 2026-04-20 19:00:00+00:00

Phase 7 (part 2 of 4) — Portfolio rebalancer.

The rebalancer cron reads :class:`~app.models.AllocationPlanRow`
targets, compares them against current per-strategy / per-symbol
notional, and emits a ``RebalancePlanRow`` + one ``RebalanceIntentRow``
per symbol that needs to move more than the configured band. A plan is
inert until approved via governance action ``rebalance_execute``; on
approval the execution engine drains the plan's intent rows into the
Phase 4 execution bus, one at a time, using the intent id as
``clientOrderId`` so retries are idempotent.

Strictly additive — no Phase 0–6 table is modified. Applies cleanly on
top of 0014 without downtime.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0015"
down_revision: Union[str, None] = "20260419_0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ──────────────────────────── rebalance_plans ─────────────────────
    op.create_table(
        "rebalance_plans",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "account_id",
            sa.String(length=64),
            sa.ForeignKey("broker_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'proposed'"),
        ),
        sa.Column(
            "trigger",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'scheduled'"),
        ),
        sa.Column(
            "initiated_by_user_id", sa.String(length=64), nullable=True
        ),
        sa.Column("approval_id", sa.String(length=64), nullable=True),
        sa.Column(
            "intent_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "gross_delta_notional",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "net_delta_notional",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("estimated_r", sa.Float(), nullable=True),
        sa.Column(
            "warnings",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "proposed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "approved_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "executed_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "completed_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_rebalance_plans_account", "rebalance_plans", ["account_id"]
    )
    op.create_index(
        "ix_rebalance_plans_status", "rebalance_plans", ["status"]
    )
    op.create_index(
        "ix_rebalance_plans_proposed_at",
        "rebalance_plans",
        ["proposed_at"],
    )

    # ──────────────────────────── rebalance_intents ───────────────────
    op.create_table(
        "rebalance_intents",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "plan_id",
            sa.String(length=64),
            sa.ForeignKey("rebalance_plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "strategy_id",
            sa.String(length=64),
            sa.ForeignKey("strategies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "symbol_id",
            sa.String(length=64),
            sa.ForeignKey("market_symbols.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "correlation_class", sa.String(length=32), nullable=False
        ),
        sa.Column("side", sa.String(length=8), nullable=False),
        sa.Column(
            "current_notional",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "target_notional",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "delta_notional",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "current_percent",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "target_percent",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "delta_percent",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'queued'"),
        ),
        sa.Column(
            "execution_intent_id", sa.String(length=64), nullable=True
        ),
        sa.Column("adapter_id", sa.String(length=64), nullable=True),
        sa.Column(
            "filled_notional",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("reason", sa.Text(), nullable=True),
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
    op.create_index(
        "ix_rebalance_intents_plan", "rebalance_intents", ["plan_id"]
    )
    op.create_index(
        "ix_rebalance_intents_strategy",
        "rebalance_intents",
        ["strategy_id"],
    )
    op.create_index(
        "ix_rebalance_intents_symbol", "rebalance_intents", ["symbol_id"]
    )
    op.create_index(
        "ix_rebalance_intents_status", "rebalance_intents", ["status"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_rebalance_intents_status", table_name="rebalance_intents"
    )
    op.drop_index(
        "ix_rebalance_intents_symbol", table_name="rebalance_intents"
    )
    op.drop_index(
        "ix_rebalance_intents_strategy", table_name="rebalance_intents"
    )
    op.drop_index(
        "ix_rebalance_intents_plan", table_name="rebalance_intents"
    )
    op.drop_table("rebalance_intents")

    op.drop_index(
        "ix_rebalance_plans_proposed_at", table_name="rebalance_plans"
    )
    op.drop_index(
        "ix_rebalance_plans_status", table_name="rebalance_plans"
    )
    op.drop_index(
        "ix_rebalance_plans_account", table_name="rebalance_plans"
    )
    op.drop_table("rebalance_plans")
