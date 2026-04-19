"""Phase 0 ORM models for identity, flags, audit, config, sessions."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _ulid_str() -> str:
    return f"usr_{uuid.uuid4().hex}"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_ulid_str)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    roles: Mapped[list[str]] = mapped_column(
        ARRAY(String(32)), nullable=False, default=list, server_default="{}"
    )
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    refresh_tokens: Mapped[list[RefreshToken]] = relationship(back_populates="user")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    user: Mapped[User] = relationship(back_populates="refresh_tokens")

    __table_args__ = (Index("ix_refresh_tokens_user_id", "user_id"),)


class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    scope: Mapped[str] = mapped_column(String(24), nullable=False, default="global")
    scope_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False, default="system")


class SystemConfig(Base):
    __tablename__ = "system_config"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False, default="system")


class AuditEvent(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    actor_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    source_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_audit_log_occurred_at", "occurred_at"),
        Index("ix_audit_log_actor", "actor_user_id"),
        Index("ix_audit_log_resource", "resource_type", "resource_id"),
    )


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    hash: Mapped[str] = mapped_column(String(255), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), nullable=False, default=list, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("owner_user_id", "name", name="uq_api_key_owner_name"),)


class RateLimitBucket(Base):
    """Lightweight persistent counter used by some endpoints as a fallback
    when Redis is unavailable. Redis remains the primary store; this table
    exists so ops always has a fallback record."""

    __tablename__ = "rate_limit_bucket"

    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


# ────────────────────────────────────────────────────────────────────────
# Phase 1 — Operator surface
# ────────────────────────────────────────────────────────────────────────


class Webhook(Base):
    """Inbound webhook registration (e.g. TradingView, alerting, broker).

    Each row carries a rotating HMAC secret used to verify incoming
    deliveries. The secret itself is never returned after the initial
    create call — only its hash is persisted.
    """

    __tablename__ = "webhooks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    # target_url is empty for *inbound* webhooks; populated when the user
    # wants the platform to deliver signals to *their* endpoint instead.
    target_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    secret_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), nullable=False, default=list, server_default="{}"
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    last_delivery_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("name", name="uq_webhooks_name"),
        Index("ix_webhooks_source", "source"),
    )


class McpServer(Base):
    """Registered MCP server configuration.

    The control plane owns the registry; the actual transport (stdio vs
    http vs sse) is enforced at call time. Secrets are stored as opaque
    references to a secret manager (AWS SM / Vault) — never inline.
    """

    __tablename__ = "mcp_servers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    transport: Mapped[str] = mapped_column(String(16), nullable=False)
    endpoint_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    command: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    auth_mode: Mapped[str] = mapped_column(String(24), nullable=False, default="none")
    secret_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    scopes: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), nullable=False, default=list, server_default="{}"
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    __table_args__ = (UniqueConstraint("name", name="uq_mcp_servers_name"),)


class Slo(Base):
    """Service-level objective definition.

    Burn-rate alerts are computed from `slo_burn_records` (one row per
    window tick). Phase 1 ships a read-heavy surface; background
    collectors land in Phase 12.
    """

    __tablename__ = "slos"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    target: Mapped[str] = mapped_column(String(32), nullable=False)
    window_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    owner_team: Mapped[str] = mapped_column(String(64), nullable=False, default="platform")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Alert(Base):
    """Operational alert record.

    Alerts are triggered by SLO burn evaluators or manual operators.
    The full alert pipeline lands in Phase 12; Phase 1 provides the
    admin surface to browse and acknowledge them.
    """

    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    slo_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    runbook_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acknowledged_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    details: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_alerts_status", "status"),
        Index("ix_alerts_severity", "severity"),
        Index("ix_alerts_opened_at", "opened_at"),
    )


class Incident(Base):
    """Incident lifecycle record.

    Incidents are cross-component investigations that may span multiple
    alerts. Status transitions are gated by role (operator-only) in the
    admin surface.
    """

    __tablename__ = "incidents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="investigating")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    postmortem_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_incidents_status", "status"),
        Index("ix_incidents_opened_at", "opened_at"),
    )


class Deployment(Base):
    """Deployment registration record.

    Recorded by the CI/CD pipeline when a service is deployed to any
    environment. Used by the /ops/deployments surface to build a
    release timeline.
    """

    __tablename__ = "deployments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    service: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str] = mapped_column(String(80), nullable=False)
    environment: Mapped[str] = mapped_column(String(24), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="succeeded")
    initiator: Mapped[str | None] = mapped_column(String(120), nullable=True)
    commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rollback_of: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_deployments_service_started", "service", "started_at"),
        Index("ix_deployments_environment", "environment"),
    )


class UserPreference(Base):
    """Per-user preference KV store.

    Holds UI preferences (theme, density, default symbols) and any
    user-scoped flag overrides. Scoped by user via the PK — one row per
    user.
    """

    __tablename__ = "user_preferences"

    user_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    preferences: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class AuditExport(Base):
    """Background export job for audit log data.

    Status transitions: pending → running → ready | failed. The
    resulting artifact is stored in S3 (bucket `gv-audit-exports`) with
    a signed URL emitted on read.
    """

    __tablename__ = "audit_exports"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False)
    format: Mapped[str] = mapped_column(String(16), nullable=False, default="csv")
    filters: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    artifact_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_audit_exports_requested", "requested_at"),)


# ────────────────────────────────────────────────────────────────────────
# Phase 2 — Market structure + MCP ingest
# ────────────────────────────────────────────────────────────────────────


class Symbol(Base):
    """Tradable instrument registry.

    Populated by operator action via /admin/market/symbols and read by
    the TV webhook ingest path to resolve incoming ticker+exchange
    pairs to stable internal ids. The assetClass + sessionTz fields
    drive session-aware structure detection in later PRs.
    """

    __tablename__ = "market_symbols"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    ticker: Mapped[str] = mapped_column(String(32), nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    asset_class: Mapped[str] = mapped_column(String(16), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    tick_size: Mapped[float] = mapped_column(nullable=False)
    lot_size: Mapped[float] = mapped_column(nullable=False, default=1.0)
    quote_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    session_tz: Mapped[str] = mapped_column(
        String(64), nullable=False, default="America/New_York"
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("ticker", "exchange", name="uq_market_symbols_ticker_exchange"),
        Index("ix_market_symbols_asset_class", "asset_class"),
    )


class TvSignal(Base):
    """Persisted TradingView signal from /v1/tv-webhook.

    Each row captures the full verified payload plus pipeline-status
    metadata. Deduplication is keyed on (payload.alertId, received window)
    in the route handler; this table stores the canonical record for
    the operator drill-down + replay surfaces.
    """

    __tablename__ = "tv_signals"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    webhook_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("webhooks.id", ondelete="SET NULL"), nullable=True
    )
    alert_id: Mapped[str] = mapped_column(String(128), nullable=False)
    symbol_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("market_symbols.id", ondelete="SET NULL"), nullable=True
    )
    ticker: Mapped[str] = mapped_column(String(32), nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    family: Mapped[str] = mapped_column(String(32), nullable=False)
    entry: Mapped[float] = mapped_column(nullable=False)
    stop: Mapped[float] = mapped_column(nullable=False)
    target: Mapped[float] = mapped_column(nullable=False)
    pine_confidence: Mapped[float] = mapped_column(nullable=False, default=0.5)
    risk_reward: Mapped[float | None] = mapped_column(nullable=True)
    fired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="received")
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_tv_signals_alert_id", "alert_id"),
        Index("ix_tv_signals_received_at", "received_at"),
        Index("ix_tv_signals_status", "status"),
        Index("ix_tv_signals_symbol_id", "symbol_id"),
    )


class TvSignalAuditStep(Base):
    """Per-step audit trail for a TV signal's pipeline run."""

    __tablename__ = "tv_signal_audit_steps"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    signal_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tv_signals.id", ondelete="CASCADE"), nullable=False
    )
    step: Mapped[str] = mapped_column(String(48), nullable=False)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    t: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (Index("ix_tv_signal_audit_steps_signal_id", "signal_id"),)


class Bar(Base):
    """OHLCV bar for a (symbol, timeframe).

    The detector pipelines (BOS/CHOCH, OB, FVG) consume contiguous Bar
    rows ordered by `t` ascending. We keep only `closed=True` bars in
    the detector windows; live in-progress bars stream through the
    quote/WebSocket path in PR8.
    """

    __tablename__ = "market_bars"

    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tf: Mapped[str] = mapped_column(String(8), primary_key=True)
    t: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    o: Mapped[float] = mapped_column(nullable=False)
    h: Mapped[float] = mapped_column(nullable=False)
    l: Mapped[float] = mapped_column(nullable=False)
    c: Mapped[float] = mapped_column(nullable=False)
    v: Mapped[float] = mapped_column(nullable=False, default=0.0)
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_market_bars_symbol_tf_t", "symbol_id", "tf", "t"),
    )


class StructureEvent(Base):
    """Detector output — BOS, CHOCH, inducement, equilibrium.

    Each row records the pivot that was broken, the bar that confirmed
    the break, and a confidence in [0, 1] derived from the displacement
    magnitude relative to the prior swing leg. Consumed by the Fusion
    Engine (PR6) and surfaced via /v1/structure/symbols/:id/events
    (PR7).
    """

    __tablename__ = "structure_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    level: Mapped[float] = mapped_column(nullable=False)
    broken_pivot_t: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    broken_pivot_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    broken_pivot_price: Mapped[float] = mapped_column(nullable=False)
    broken_pivot_bar_index: Mapped[int] = mapped_column(Integer, nullable=False)
    confirmation_t: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    confidence: Mapped[float] = mapped_column(nullable=False, default=0.5)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_structure_events_symbol_tf_t", "symbol_id", "tf", "confirmation_t"),
        Index("ix_structure_events_kind", "kind"),
    )


class OrderBlock(Base):
    """Persisted Order Block emitted by ``app.structure.order_blocks``.

    The (high, low) pair is the OB body — the zone of interest for
    retest entries. ``retested`` and ``violated`` are mutated by the
    fusion engine as new bars arrive.
    """

    __tablename__ = "order_blocks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    high: Mapped[float] = mapped_column(nullable=False)
    low: Mapped[float] = mapped_column(nullable=False)
    t: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    strength: Mapped[float] = mapped_column(nullable=False, default=0.5)
    retested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    violated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    structure_event_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("structure_events.id", ondelete="SET NULL"),
        nullable=True,
    )
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_order_blocks_symbol_tf_t", "symbol_id", "tf", "t"),
        Index("ix_order_blocks_active", "symbol_id", "violated"),
    )


class Fvg(Base):
    """Persisted Fair Value Gap emitted by ``app.structure.fvgs``."""

    __tablename__ = "fvgs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    top: Mapped[float] = mapped_column(nullable=False)
    bottom: Mapped[float] = mapped_column(nullable=False)
    t: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    mitigated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    mitigated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_fvgs_symbol_tf_t", "symbol_id", "tf", "t"),
        Index("ix_fvgs_active", "symbol_id", "mitigated"),
    )


class MarketContext(Base):
    """Snapshot of the multi-timeframe Fusion Engine output.

    One row per ``(symbol_id, generated_at)``. Older rows are kept
    so we can replay context at the time a setup was scored — the
    PR8 setup detector references this for governance audits.
    """

    __tablename__ = "market_contexts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_ulid_str)
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    htf_bias: Mapped[str] = mapped_column(String(8), nullable=False)
    ltf_bias: Mapped[str] = mapped_column(String(8), nullable=False)
    conflict: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Materialised JSON copies of the lists so the row is self-describing
    # without a multi-table join. Each list is a ``[StructureEvent]`` /
    # ``[OrderBlock]`` / ``[Fvg]`` projection — the canonical source of
    # truth still lives in those tables.
    recent_events: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    active_order_blocks: Mapped[Any] = mapped_column(
        JSON, nullable=False, default=list
    )
    active_fvgs: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index(
            "ix_market_contexts_symbol_generated",
            "symbol_id",
            "generated_at",
        ),
    )


# ─────────────────────────── Phase 3 — order flow ───────────────────────


class DepthSnapshot(Base):
    """Persisted point-in-time order-book snapshot.

    Each row is one moment in the symbol's book life with both sides
    materialised as JSON ladders ordered best→worst, plus the cumulative
    traded delta and last print since the previous snapshot. The
    detector pipeline (``app.detectors.orderflow``) consumes contiguous
    rows ordered by ``t`` ascending.
    """

    __tablename__ = "depth_snapshots"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    t: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Ladders are stored as JSON of [{price, size, orders?}, ...].
    bids: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    asks: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    delta: Mapped[float] = mapped_column(nullable=False, default=0.0)
    last: Mapped[float] = mapped_column(nullable=False)
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="synthetic"
    )
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_depth_snapshots_symbol_t", "symbol_id", "t"),
        Index("ix_depth_snapshots_source", "source"),
    )


class DeltaBar(Base):
    """Per-bar order-flow rollup — buy/sell volume + delta + cum delta.

    Keyed on ``(symbol_id, tf, t)`` like ``Bar``. The cumulative-delta
    column resets at each session boundary; the rollup job in PR4 owns
    the reset logic (it sees ``Symbol.session_tz``).
    """

    __tablename__ = "delta_bars"

    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tf: Mapped[str] = mapped_column(String(8), primary_key=True)
    t: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    buy_volume: Mapped[float] = mapped_column(nullable=False, default=0.0)
    sell_volume: Mapped[float] = mapped_column(nullable=False, default=0.0)
    delta: Mapped[float] = mapped_column(nullable=False, default=0.0)
    cumulative_delta: Mapped[float] = mapped_column(
        nullable=False, default=0.0
    )
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_delta_bars_symbol_tf_t", "symbol_id", "tf", "t"),
    )


# ─────────────────────────── Phase 3 — setups ───────────────────────


def _setup_id() -> str:
    return f"stp_{uuid.uuid4().hex}"


class Setup(Base):
    """Persisted detector output — one row per fired setup.

    The detector chain (``app.setups.orchestrator.detect_all_setups``)
    produces immutable :class:`app.setups.types.SetupOut` envelopes.
    The route layer in PR7 serialises each one into this table so the
    UI / execution gate can list, filter and update status without
    re-running the detectors.

    Confidence components are denormalised onto scalar columns so the
    setup-list UI can sort by ``order_flow_score`` (or any individual
    component) without unpacking JSON. ``provenance`` is stored as a
    pair of JSON arrays — these are foreign references to
    ``structure_events.id`` / order-flow event ids, but we don't add
    SQL FKs because order-flow events are pure-function output that
    does not currently round-trip through the DB.
    """

    __tablename__ = "setups"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_setup_id
    )
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="detected"
    )

    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # PriceZoneOut entry — low/high/ref triple.
    entry_low: Mapped[float] = mapped_column(nullable=False)
    entry_high: Mapped[float] = mapped_column(nullable=False)
    entry_ref: Mapped[float] = mapped_column(nullable=False)
    stop_loss: Mapped[float] = mapped_column(nullable=False)
    take_profit: Mapped[float] = mapped_column(nullable=False)
    rr: Mapped[float] = mapped_column(nullable=False, default=0.0)

    # Calibrated confidence + components (denormalised for filtering).
    confidence_score: Mapped[float] = mapped_column(nullable=False, default=0.5)
    structure_score: Mapped[float] = mapped_column(nullable=False, default=0.5)
    order_flow_score: Mapped[float] = mapped_column(nullable=False, default=0.5)
    regime_score: Mapped[float] = mapped_column(nullable=False, default=0.5)
    session_score: Mapped[float] = mapped_column(nullable=False, default=0.5)
    history_score: Mapped[float] = mapped_column(nullable=False, default=0.5)
    history_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    reasoning: Mapped[str] = mapped_column(Text, nullable=False, default="")
    structure_event_ids: Mapped[Any] = mapped_column(
        JSON, nullable=False, default=list
    )
    order_flow_event_ids: Mapped[Any] = mapped_column(
        JSON, nullable=False, default=list
    )

    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_pnl_r: Mapped[float | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index("ix_setups_symbol_tf_t", "symbol_id", "tf", "detected_at"),
        Index("ix_setups_status", "status"),
        Index("ix_setups_type", "type"),
    )


def _paper_trade_id() -> str:
    return f"pap_{uuid.uuid4().hex}"


class PaperTrade(Base):
    """Paper-mode trade approved by the Phase 3 PR8 execution gate.

    Mirrors ``packages/types/src/setups.ts::PaperTradeSchema``. Each
    row is an approved Setup that the gate has cleared for paper-mode
    execution. Lifecycle:

        pending_fill → filled → won | lost | scratched
                              \\→ cancelled  (operator override)

    A Setup may have at most one *active* (non-terminal) PaperTrade at
    a time — enforced by the route layer rather than a partial unique
    index for portability across SQLite + Postgres.
    """

    __tablename__ = "paper_trades"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_paper_trade_id
    )
    setup_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("setups.id", ondelete="CASCADE"),
        nullable=False,
    )
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    entry_ref: Mapped[float] = mapped_column(nullable=False)
    stop_loss: Mapped[float] = mapped_column(nullable=False)
    take_profit: Mapped[float] = mapped_column(nullable=False)
    size_multiplier: Mapped[float] = mapped_column(nullable=False, default=1.0)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending_fill"
    )

    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    approved_by_user_id: Mapped[str] = mapped_column(
        String(64), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    filled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    pnl_r: Mapped[float | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index("ix_paper_trades_setup", "setup_id"),
        Index("ix_paper_trades_status", "status"),
        Index(
            "ix_paper_trades_symbol_status", "symbol_id", "status"
        ),
    )


# ──────────────────────────── Phase 4 — execution + risk ─────────────────


def _broker_account_id() -> str:
    return f"bac_{uuid.uuid4().hex}"


def _broker_order_id() -> str:
    return f"bor_{uuid.uuid4().hex}"


def _broker_fill_id() -> str:
    return f"bfl_{uuid.uuid4().hex}"


def _position_id() -> str:
    return f"pos_{uuid.uuid4().hex}"


def _live_trade_id() -> str:
    return f"liv_{uuid.uuid4().hex}"


def _equity_snapshot_id() -> str:
    return f"eqs_{uuid.uuid4().hex}"


def _risk_budget_id() -> str:
    return f"rsk_{uuid.uuid4().hex}"


class BrokerAccount(Base):
    """An operator-configured broker account (Alpaca paper + live share a shape).

    A single GodsView account may register multiple broker accounts — e.g.
    one Alpaca paper + one Alpaca live — keyed by provider + display name.
    The active account for live approvals is whichever one the operator
    pins via ``system_config.execution.live_account_id``.
    """

    __tablename__ = "broker_accounts"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_broker_account_id
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    mode: Mapped[str] = mapped_column(String(8), nullable=False, default="paper")
    api_key_ref: Mapped[str] = mapped_column(String(120), nullable=False)
    api_secret_ref: Mapped[str] = mapped_column(String(120), nullable=False)
    base_url: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("provider", "display_name", name="uq_broker_accounts_name"),
    )


class RiskBudget(Base):
    """Per-account risk envelope consumed by the live gate."""

    __tablename__ = "risk_budgets"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_risk_budget_id
    )
    account_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    max_risk_per_trade_r: Mapped[float] = mapped_column(nullable=False, default=0.005)
    max_daily_drawdown_r: Mapped[float] = mapped_column(nullable=False, default=0.03)
    max_open_positions: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    max_correlated_exposure: Mapped[float] = mapped_column(nullable=False, default=1.0)
    max_gross_exposure: Mapped[float] = mapped_column(nullable=False, default=2.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class AccountEquitySnapshot(Base):
    """Point-in-time broker equity snapshot — the numerator of every risk ratio."""

    __tablename__ = "account_equity_snapshots"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_equity_snapshot_id
    )
    account_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    total_equity: Mapped[float] = mapped_column(nullable=False)
    start_of_day_equity: Mapped[float] = mapped_column(nullable=False)
    realized_pnl: Mapped[float] = mapped_column(nullable=False, default=0.0)
    unrealized_pnl: Mapped[float] = mapped_column(nullable=False, default=0.0)
    margin_used: Mapped[float] = mapped_column(nullable=False, default=0.0)
    buying_power: Mapped[float] = mapped_column(nullable=False)

    __table_args__ = (
        Index("ix_equity_snap_account_ts", "account_id", "observed_at"),
    )


class Position(Base):
    """Canonical live position row — one per open symbol per account."""

    __tablename__ = "positions"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_position_id
    )
    account_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    qty: Mapped[float] = mapped_column(nullable=False)
    avg_entry_price: Mapped[float] = mapped_column(nullable=False)
    mark_price: Mapped[float] = mapped_column(nullable=False)
    unrealized_pnl: Mapped[float] = mapped_column(nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="open")
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    setup_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("setups.id", ondelete="SET NULL"),
        nullable=True,
    )
    live_trade_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )

    __table_args__ = (
        Index("ix_positions_account_status", "account_id", "status"),
        Index("ix_positions_account_symbol_status", "account_id", "symbol_id", "status"),
    )


class BrokerOrder(Base):
    """One idempotent broker order envelope + broker-side order id once accepted."""

    __tablename__ = "broker_orders"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_broker_order_id
    )
    client_order_id: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True
    )
    account_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    qty: Mapped[float] = mapped_column(nullable=False)
    order_type: Mapped[str] = mapped_column(String(16), nullable=False)
    time_in_force: Mapped[str] = mapped_column(String(8), nullable=False)
    limit_price: Mapped[float | None] = mapped_column(nullable=True)
    stop_price: Mapped[float | None] = mapped_column(nullable=True)
    take_profit_price: Mapped[float | None] = mapped_column(nullable=True)
    stop_loss_price: Mapped[float | None] = mapped_column(nullable=True)
    setup_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("setups.id", ondelete="SET NULL"),
        nullable=True,
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    broker_order_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class BrokerFill(Base):
    """One broker execution report — a single order can produce many fills."""

    __tablename__ = "broker_fills"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_broker_fill_id
    )
    client_order_id: Mapped[str] = mapped_column(String(128), nullable=False)
    broker_order_id: Mapped[str] = mapped_column(String(128), nullable=False)
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    filled_qty: Mapped[float] = mapped_column(nullable=False)
    avg_fill_price: Mapped[float | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    commission: Mapped[float] = mapped_column(nullable=False, default=0.0)
    slippage: Mapped[float | None] = mapped_column(nullable=True)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        Index("ix_broker_fills_client_order", "client_order_id"),
        Index("ix_broker_fills_symbol_ts", "symbol_id", "observed_at"),
    )


class LiveTrade(Base):
    """Live sibling of PaperTrade.

    Adds the broker round-trip fields + realised PnL in dollars (paper
    tracks R-multiples only). The row starts at ``pending_submit``, flips
    to ``submitted`` once the broker acknowledges the order, then
    ``partially_filled``/``filled`` on execution, and finally one of
    ``won``, ``lost``, ``scratched``, ``cancelled``, or ``rejected``.
    """

    __tablename__ = "live_trades"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_live_trade_id
    )
    setup_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("setups.id", ondelete="CASCADE"),
        nullable=False,
    )
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    account_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    entry_ref: Mapped[float] = mapped_column(nullable=False)
    stop_loss: Mapped[float] = mapped_column(nullable=False)
    take_profit: Mapped[float] = mapped_column(nullable=False)
    size_multiplier: Mapped[float] = mapped_column(nullable=False, default=1.0)
    qty: Mapped[float] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending_submit"
    )
    client_order_id: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True
    )
    broker_order_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    approved_by_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    filled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    avg_fill_price: Mapped[float | None] = mapped_column(nullable=True)
    filled_qty: Mapped[float] = mapped_column(nullable=False, default=0.0)
    commission: Mapped[float] = mapped_column(nullable=False, default=0.0)
    realized_pnl_dollars: Mapped[float | None] = mapped_column(nullable=True)
    pnl_r: Mapped[float | None] = mapped_column(nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        Index("ix_live_trades_setup", "setup_id"),
        Index("ix_live_trades_account_status", "account_id", "status"),
        Index("ix_live_trades_symbol_status", "symbol_id", "status"),
    )
