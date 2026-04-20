"""phase6 autonomy + kill-switch tables.

Revision ID: 20260419_0013
Revises: 20260419_0012
Create Date: 2026-04-20 11:00:00+00:00

Phase 6 (part 3 of 3) — Autonomy FSM + kill-switch event log.

Adds three append-only / record-of-truth tables:

  * ``autonomy_records``          — one row per strategy; the current
                                    autonomy tier and gate snapshot.
  * ``autonomy_history_events``   — append-only transition log.
  * ``kill_switch_events``        — append-only trip/reset log. Active
                                    state per (scope, subject_key) is
                                    derived from the most recent row.

Strictly additive — no Phase 0-5 or earlier Phase 6 table is modified.
A v2.5.0 production database that has already run 0011 + 0012 can apply
this revision in-place without downtime.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0013"
down_revision: Union[str, None] = "20260419_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ──────────────────────────── autonomy_records ─────────────────────
    op.create_table(
        "autonomy_records",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "strategy_id",
            sa.String(length=64),
            sa.ForeignKey("strategies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "current_state",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'assisted_live'"),
        ),
        sa.Column(
            "entered_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_reason",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'initial_promotion'"),
        ),
        sa.Column("last_transition_id", sa.String(length=64), nullable=False),
        sa.Column(
            "next_review_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("lockout_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "fills_in_state",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "r_in_state",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "gates",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("strategy_id", name="uq_autonomy_records_strategy"),
    )
    op.create_index(
        "ix_autonomy_records_current_state",
        "autonomy_records",
        ["current_state"],
    )
    op.create_index(
        "ix_autonomy_records_next_review_at",
        "autonomy_records",
        ["next_review_at"],
    )

    # ──────────────────────────── autonomy_history_events ──────────────
    op.create_table(
        "autonomy_history_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "strategy_id",
            sa.String(length=64),
            sa.ForeignKey("strategies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_state", sa.String(length=24), nullable=True),
        sa.Column("to_state", sa.String(length=24), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.String(length=64), nullable=True),
        sa.Column("approval_id", sa.String(length=64), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("gate_snapshot", sa.JSON(), nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_autonomy_history_strategy",
        "autonomy_history_events",
        ["strategy_id"],
    )
    op.create_index(
        "ix_autonomy_history_occurred_at",
        "autonomy_history_events",
        ["occurred_at"],
    )
    op.create_index(
        "ix_autonomy_history_to_state",
        "autonomy_history_events",
        ["to_state"],
    )

    # ──────────────────────────── kill_switch_events ───────────────────
    op.create_table(
        "kill_switch_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("subject_key", sa.String(length=120), nullable=True),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.String(length=64), nullable=True),
        sa.Column(
            "reason",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
        sa.Column("approval_id", sa.String(length=64), nullable=True),
        sa.Column(
            "evidence",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_kill_switch_events_scope_subject",
        "kill_switch_events",
        ["scope", "subject_key"],
    )
    op.create_index(
        "ix_kill_switch_events_occurred_at",
        "kill_switch_events",
        ["occurred_at"],
    )
    op.create_index(
        "ix_kill_switch_events_action",
        "kill_switch_events",
        ["action"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_kill_switch_events_action",
        table_name="kill_switch_events",
    )
    op.drop_index(
        "ix_kill_switch_events_occurred_at",
        table_name="kill_switch_events",
    )
    op.drop_index(
        "ix_kill_switch_events_scope_subject",
        table_name="kill_switch_events",
    )
    op.drop_table("kill_switch_events")

    op.drop_index(
        "ix_autonomy_history_to_state",
        table_name="autonomy_history_events",
    )
    op.drop_index(
        "ix_autonomy_history_occurred_at",
        table_name="autonomy_history_events",
    )
    op.drop_index(
        "ix_autonomy_history_strategy",
        table_name="autonomy_history_events",
    )
    op.drop_table("autonomy_history_events")

    op.drop_index(
        "ix_autonomy_records_next_review_at",
        table_name="autonomy_records",
    )
    op.drop_index(
        "ix_autonomy_records_current_state",
        table_name="autonomy_records",
    )
    op.drop_table("autonomy_records")
