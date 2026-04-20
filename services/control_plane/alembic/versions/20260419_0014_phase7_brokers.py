"""phase7 multi-broker adapter registry tables.

Revision ID: 20260419_0014
Revises: 20260419_0013
Create Date: 2026-04-20 18:00:00+00:00

Phase 7 (part 1 of 4) — Multi-broker adapter registry.

Phase 4 shipped a single-kind Alpaca adapter keyed by the existing
``broker_accounts`` row. Phase 7 promotes the adapter surface to a
first-class registry so the live gate, portfolio rebalancer, autonomy
FSM, and ops dashboards can quorum-check across vendors (Alpaca paper /
live, IB paper / live, …) without special-casing per-vendor code paths.

Adds three append-only / record-of-truth tables:

  * ``broker_adapters``           — one row per registered broker
                                    connection; carries kind + role +
                                    display name + masked credential
                                    projection + current status.
  * ``broker_account_bindings``   — one row per (adapter, accountId)
                                    pair; the portfolio engine rolls up
                                    positions across bindings and the
                                    live gate resolves routing via
                                    ``role + enabled + latest health``.
  * ``broker_health_snapshots``   — rolling probe snapshots; the probe
                                    cron writes one row per adapter per
                                    minute and the live gate reads the
                                    most-recent row per adapter.

Strictly additive — no Phase 0-6 table is modified. A v2.6.0 production
database that has already run 0011..0013 can apply this revision
in-place without downtime.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0014"
down_revision: Union[str, None] = "20260419_0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ──────────────────────────── broker_adapters ─────────────────────
    op.create_table(
        "broker_adapters",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("host", sa.String(length=253), nullable=False),
        sa.Column("api_key_masked", sa.String(length=32), nullable=True),
        sa.Column(
            "api_secret_ref",
            sa.String(length=120),
            nullable=False,
            server_default=sa.text("''"),
        ),
        sa.Column(
            "latest_snapshot_id", sa.String(length=64), nullable=True
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
        sa.Column(
            "live_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "probe_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
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
        sa.UniqueConstraint(
            "kind", "display_name", name="uq_broker_adapters_kind_name"
        ),
    )
    op.create_index(
        "ix_broker_adapters_kind", "broker_adapters", ["kind"]
    )
    op.create_index(
        "ix_broker_adapters_role", "broker_adapters", ["role"]
    )
    op.create_index(
        "ix_broker_adapters_status", "broker_adapters", ["status"]
    )

    # ──────────────────────────── broker_account_bindings ─────────────
    op.create_table(
        "broker_account_bindings",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "adapter_id",
            sa.String(length=64),
            sa.ForeignKey("broker_adapters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "account_id",
            sa.String(length=64),
            sa.ForeignKey("broker_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "external_account_id", sa.String(length=128), nullable=False
        ),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "weight",
            sa.Float(),
            nullable=False,
            server_default=sa.text("1.0"),
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
        sa.UniqueConstraint(
            "adapter_id",
            "account_id",
            name="uq_broker_account_bindings_adapter_account",
        ),
    )
    op.create_index(
        "ix_broker_account_bindings_adapter",
        "broker_account_bindings",
        ["adapter_id"],
    )
    op.create_index(
        "ix_broker_account_bindings_account",
        "broker_account_bindings",
        ["account_id"],
    )
    op.create_index(
        "ix_broker_account_bindings_enabled",
        "broker_account_bindings",
        ["enabled"],
    )

    # ──────────────────────────── broker_health_snapshots ─────────────
    op.create_table(
        "broker_health_snapshots",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "adapter_id",
            sa.String(length=64),
            sa.ForeignKey("broker_adapters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "last_probe_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "sample_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("latency_p50_ms", sa.Float(), nullable=True),
        sa.Column("latency_p95_ms", sa.Float(), nullable=True),
        sa.Column("latency_p99_ms", sa.Float(), nullable=True),
        sa.Column(
            "error_rate",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_broker_health_snapshots_adapter",
        "broker_health_snapshots",
        ["adapter_id"],
    )
    op.create_index(
        "ix_broker_health_snapshots_observed_at",
        "broker_health_snapshots",
        ["observed_at"],
    )
    op.create_index(
        "ix_broker_health_snapshots_status",
        "broker_health_snapshots",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_broker_health_snapshots_status",
        table_name="broker_health_snapshots",
    )
    op.drop_index(
        "ix_broker_health_snapshots_observed_at",
        table_name="broker_health_snapshots",
    )
    op.drop_index(
        "ix_broker_health_snapshots_adapter",
        table_name="broker_health_snapshots",
    )
    op.drop_table("broker_health_snapshots")

    op.drop_index(
        "ix_broker_account_bindings_enabled",
        table_name="broker_account_bindings",
    )
    op.drop_index(
        "ix_broker_account_bindings_account",
        table_name="broker_account_bindings",
    )
    op.drop_index(
        "ix_broker_account_bindings_adapter",
        table_name="broker_account_bindings",
    )
    op.drop_table("broker_account_bindings")

    op.drop_index("ix_broker_adapters_status", table_name="broker_adapters")
    op.drop_index("ix_broker_adapters_role", table_name="broker_adapters")
    op.drop_index("ix_broker_adapters_kind", table_name="broker_adapters")
    op.drop_table("broker_adapters")
