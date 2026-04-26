"""phase1 operator surface — webhooks, mcp servers, slos, alerts,
incidents, deployments, user preferences, audit exports.

Revision ID: 20260419_0002
Revises: 20260419_0001
Create Date: 2026-04-19 01:00:00+00:00

Extends the Phase 0 baseline with the tables that back the Phase 1
operator surface. All changes are additive. Downgrade reverses the
creates in the reverse order so a failed Phase 1 roll-out leaves
Phase 0 intact.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260419_0002"
down_revision: Union[str, None] = "20260419_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webhooks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("target_url", sa.String(length=1024), nullable=True),
        sa.Column("secret_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "scopes",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.String(length=64), nullable=True),
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
        sa.Column("last_delivery_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("name", name="uq_webhooks_name"),
    )
    op.create_index("ix_webhooks_source", "webhooks", ["source"])

    op.create_table(
        "mcp_servers",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("transport", sa.String(length=16), nullable=False),
        sa.Column("endpoint_url", sa.String(length=1024), nullable=True),
        sa.Column("command", sa.String(length=1024), nullable=True),
        sa.Column("auth_mode", sa.String(length=24), nullable=False, server_default="none"),
        sa.Column("secret_ref", sa.String(length=255), nullable=True),
        sa.Column(
            "scopes",
            postgresql.ARRAY(sa.String(length=64)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
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
        sa.UniqueConstraint("name", name="uq_mcp_servers_name"),
    )

    op.create_table(
        "slos",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("target", sa.String(length=32), nullable=False),
        sa.Column("window_seconds", sa.Integer(), nullable=False),
        sa.Column("owner_team", sa.String(length=64), nullable=False, server_default="platform"),
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
        sa.UniqueConstraint("key", name="uq_slos_key"),
    )

    op.create_table(
        "alerts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("slo_key", sa.String(length=120), nullable=True),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("runbook_url", sa.String(length=1024), nullable=True),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by", sa.String(length=64), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("ix_alerts_status", "alerts", ["status"])
    op.create_index("ix_alerts_severity", "alerts", ["severity"])
    op.create_index("ix_alerts_opened_at", "alerts", ["opened_at"])

    op.create_table(
        "incidents",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="investigating"),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("postmortem_url", sa.String(length=1024), nullable=True),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("owner_user_id", sa.String(length=64), nullable=True),
        sa.UniqueConstraint("code", name="uq_incidents_code"),
    )
    op.create_index("ix_incidents_status", "incidents", ["status"])
    op.create_index("ix_incidents_opened_at", "incidents", ["opened_at"])

    op.create_table(
        "deployments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("service", sa.String(length=64), nullable=False),
        sa.Column("version", sa.String(length=80), nullable=False),
        sa.Column("environment", sa.String(length=24), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="succeeded"),
        sa.Column("initiator", sa.String(length=120), nullable=True),
        sa.Column("commit_sha", sa.String(length=64), nullable=True),
        sa.Column("rollback_of", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_deployments_service_started", "deployments", ["service", "started_at"]
    )
    op.create_index("ix_deployments_environment", "deployments", ["environment"])

    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.String(length=64), primary_key=True),
        sa.Column("preferences", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_user_preferences_user_id"
        ),
    )

    op.create_table(
        "audit_exports",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("requested_by", sa.String(length=64), nullable=False),
        sa.Column("format", sa.String(length=16), nullable=False, server_default="csv"),
        sa.Column("filters", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("artifact_key", sa.String(length=255), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_audit_exports_requested", "audit_exports", ["requested_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_exports_requested", table_name="audit_exports")
    op.drop_table("audit_exports")
    op.drop_table("user_preferences")
    op.drop_index("ix_deployments_environment", table_name="deployments")
    op.drop_index("ix_deployments_service_started", table_name="deployments")
    op.drop_table("deployments")
    op.drop_index("ix_incidents_opened_at", table_name="incidents")
    op.drop_index("ix_incidents_status", table_name="incidents")
    op.drop_table("incidents")
    op.drop_index("ix_alerts_opened_at", table_name="alerts")
    op.drop_index("ix_alerts_severity", table_name="alerts")
    op.drop_index("ix_alerts_status", table_name="alerts")
    op.drop_table("alerts")
    op.drop_table("slos")
    op.drop_table("mcp_servers")
    op.drop_index("ix_webhooks_source", table_name="webhooks")
    op.drop_table("webhooks")
