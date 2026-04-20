"""phase7 mobile inbox acknowledgement events.

Revision ID: 20260419_0016
Revises: 20260419_0015
Create Date: 2026-04-20 19:30:00+00:00

Phase 7 (part 3 of 4) — Mobile operator inbox.

The mobile inbox is a read-only aggregated feed that unifies
governance approvals pending an operator signature, open anomaly
alerts, active kill-switch trips, and proposed rebalance plans. The
server composes the feed on demand from the first-class tables — it
is never a materialised view — so this migration only introduces the
acknowledgement-event audit table the mobile client writes to when
an operator ack's a row from their phone.

Strictly additive. Applies cleanly on top of 0015 without downtime.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260419_0016"
down_revision: Union[str, None] = "20260419_0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ──────────────────────────── mobile_inbox_ack_events ─────────────
    # Append-only audit rows: one row per (inbox_item_id, user_id,
    # acknowledged_at) tuple. The mobile client POSTs one row on every
    # acknowledgement — the inbox feed itself stays derived from the
    # underlying governance/anomaly/kill-switch tables and simply
    # projects ``status='acknowledged'`` whenever the most recent row
    # for the ``inbox_item_id`` predates the first-class object's
    # ``updated_at``. The row is also idempotent-safe — the unique
    # constraint prevents a double-ack from the same user within the
    # same wall-clock second.
    op.create_table(
        "mobile_inbox_ack_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "inbox_item_id", sa.String(length=120), nullable=False
        ),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("subject_key", sa.String(length=120), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "acknowledged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_mobile_inbox_ack_events_inbox_item",
        "mobile_inbox_ack_events",
        ["inbox_item_id"],
    )
    op.create_index(
        "ix_mobile_inbox_ack_events_user",
        "mobile_inbox_ack_events",
        ["user_id"],
    )
    op.create_index(
        "ix_mobile_inbox_ack_events_acknowledged_at",
        "mobile_inbox_ack_events",
        ["acknowledged_at"],
    )
    op.create_unique_constraint(
        "uq_mobile_inbox_ack_events_item_user",
        "mobile_inbox_ack_events",
        ["inbox_item_id", "user_id", "acknowledged_at"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_mobile_inbox_ack_events_item_user",
        "mobile_inbox_ack_events",
        type_="unique",
    )
    op.drop_index(
        "ix_mobile_inbox_ack_events_acknowledged_at",
        table_name="mobile_inbox_ack_events",
    )
    op.drop_index(
        "ix_mobile_inbox_ack_events_user",
        table_name="mobile_inbox_ack_events",
    )
    op.drop_index(
        "ix_mobile_inbox_ack_events_inbox_item",
        table_name="mobile_inbox_ack_events",
    )
    op.drop_table("mobile_inbox_ack_events")
