"""phase6 governance tables.

Revision ID: 20260419_0012
Revises: 20260419_0011
Create Date: 2026-04-20 10:00:00+00:00

Phase 6 (part 2 of 3) — Governance surface.

Adds the five persistence tables needed to back the governance layer:

  * ``approval_policies``       — (action → requirements) lookup.
  * ``governance_approvals``    — one row per approval request.
  * ``approval_decisions``      — per-approver signature row (append-only).
  * ``anomaly_alerts``          — detector-emitted alert with ack/resolve
                                  state machine.
  * ``trust_tier_assignments``  — per-user trust-tier history.

And one additive column on ``users``:

  * ``users.trust_tier``        — effective trust tier; defaults to
                                  ``'operator'`` so Phase 0–5 behaviour
                                  is preserved.

Strictly additive — no Phase 0-5 table is modified (only ``users`` gains
a new column with a server-side default). A v2.5.0 production database
can run ``alembic upgrade head`` in-place without downtime.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0012"
down_revision: Union[str, None] = "20260419_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ──────────────────────────── users.trust_tier ─────────────────────
    op.add_column(
        "users",
        sa.Column(
            "trust_tier",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'operator'"),
        ),
    )

    # ──────────────────────────── approval_policies ────────────────────
    op.create_table(
        "approval_policies",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column(
            "requires_approval",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "min_requester_tier",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'operator'"),
        ),
        sa.Column(
            "min_approver_tier",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'senior_operator'"),
        ),
        sa.Column(
            "approver_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "ttl_seconds",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("86400"),
        ),
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
        sa.Column("updated_by_user_id", sa.String(length=64), nullable=True),
        sa.UniqueConstraint("action", name="uq_approval_policies_action"),
    )

    # ──────────────────────────── governance_approvals ─────────────────
    op.create_table(
        "governance_approvals",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("subject_key", sa.String(length=120), nullable=True),
        sa.Column(
            "payload",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column("reason", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "state",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("requested_by_user_id", sa.String(length=64), nullable=False),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_user_id", sa.String(length=64), nullable=True),
        sa.Column(
            "required_approver_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.create_index(
        "ix_governance_approvals_action",
        "governance_approvals",
        ["action"],
    )
    op.create_index(
        "ix_governance_approvals_state",
        "governance_approvals",
        ["state"],
    )
    op.create_index(
        "ix_governance_approvals_requested_at",
        "governance_approvals",
        ["requested_at"],
    )

    # ──────────────────────────── approval_decisions ───────────────────
    op.create_table(
        "approval_decisions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "approval_id",
            sa.String(length=64),
            sa.ForeignKey("governance_approvals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("approver_user_id", sa.String(length=64), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column(
            "decided_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.UniqueConstraint(
            "approval_id",
            "approver_user_id",
            name="uq_approval_decisions_approval_user",
        ),
    )
    op.create_index(
        "ix_approval_decisions_approval",
        "approval_decisions",
        ["approval_id"],
    )

    # ──────────────────────────── anomaly_alerts ───────────────────────
    op.create_table(
        "anomaly_alerts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'open'"),
        ),
        sa.Column("subject_key", sa.String(length=120), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "evidence",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::json"),
        ),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "acknowledged_by_user_id", sa.String(length=64), nullable=True
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_user_id", sa.String(length=64), nullable=True),
        sa.Column("suppressed_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("related_approval_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_anomaly_alerts_status",
        "anomaly_alerts",
        ["status"],
    )
    op.create_index(
        "ix_anomaly_alerts_detected_at",
        "anomaly_alerts",
        ["detected_at"],
    )
    op.create_index(
        "ix_anomaly_alerts_source_subject",
        "anomaly_alerts",
        ["source", "subject_key"],
    )

    # ──────────────────────────── trust_tier_assignments ───────────────
    op.create_table(
        "trust_tier_assignments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=64),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tier", sa.String(length=24), nullable=False),
        sa.Column(
            "assigned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("assigned_by_user_id", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=sa.text("''")),
    )
    op.create_index(
        "ix_trust_tier_assignments_user",
        "trust_tier_assignments",
        ["user_id"],
    )
    op.create_index(
        "ix_trust_tier_assignments_assigned_at",
        "trust_tier_assignments",
        ["assigned_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_trust_tier_assignments_assigned_at",
        table_name="trust_tier_assignments",
    )
    op.drop_index(
        "ix_trust_tier_assignments_user",
        table_name="trust_tier_assignments",
    )
    op.drop_table("trust_tier_assignments")

    op.drop_index(
        "ix_anomaly_alerts_source_subject",
        table_name="anomaly_alerts",
    )
    op.drop_index(
        "ix_anomaly_alerts_detected_at",
        table_name="anomaly_alerts",
    )
    op.drop_index(
        "ix_anomaly_alerts_status",
        table_name="anomaly_alerts",
    )
    op.drop_table("anomaly_alerts")

    op.drop_index(
        "ix_approval_decisions_approval",
        table_name="approval_decisions",
    )
    op.drop_table("approval_decisions")

    op.drop_index(
        "ix_governance_approvals_requested_at",
        table_name="governance_approvals",
    )
    op.drop_index(
        "ix_governance_approvals_state",
        table_name="governance_approvals",
    )
    op.drop_index(
        "ix_governance_approvals_action",
        table_name="governance_approvals",
    )
    op.drop_table("governance_approvals")

    op.drop_table("approval_policies")

    op.drop_column("users", "trust_tier")
