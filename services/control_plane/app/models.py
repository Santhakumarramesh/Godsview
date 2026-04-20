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
    # Phase 6 governance: effective trust tier for this user. The
    # ``trust_tier_assignments`` table holds the authoritative history.
    # A missing/default value of "operator" keeps Phase 0–5 behaviour
    # intact.
    trust_tier: Mapped[str] = mapped_column(
        String(24), nullable=False, default="operator", server_default="operator"
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


# ──────────────────────────── Phase 5 — Quant Lab ───────────────────────
#
# Twenty-one additive tables that back the Phase 5 control-plane surfaces.
# Everything is strictly additive — no Phase 0-4 table is modified — so a
# v2.4.0 database can run ``alembic upgrade head`` without downtime.
#
# Persistence boundaries:
#
#   Quant Lab               strategies, strategy_versions, backtest_runs,
#                           backtest_trades, backtest_equity_points,
#                           replay_runs, replay_frames, experiments,
#                           experiment_backtests, strategy_rankings,
#                           promotion_events
#   Recall                  recall_trades, recall_embeddings,
#                           recall_screenshots, missed_trades
#   Learning + Governance   learning_events, confidence_calibrations,
#                           regime_snapshots, session_snapshots,
#                           data_truth_checks, strategy_dna_cells


def _strategy_id() -> str:
    return f"stg_{uuid.uuid4().hex}"


def _strategy_version_id() -> str:
    return f"stv_{uuid.uuid4().hex}"


def _backtest_run_id() -> str:
    return f"bkt_{uuid.uuid4().hex}"


def _backtest_trade_id() -> str:
    return f"bkt_trd_{uuid.uuid4().hex}"


def _backtest_equity_id() -> str:
    return f"bkt_eq_{uuid.uuid4().hex}"


def _replay_run_id() -> str:
    return f"rpl_{uuid.uuid4().hex}"


def _replay_frame_id() -> str:
    return f"rpl_fr_{uuid.uuid4().hex}"


def _experiment_id() -> str:
    return f"exp_{uuid.uuid4().hex}"


def _ranking_id() -> str:
    return f"rnk_{uuid.uuid4().hex}"


def _promotion_event_id() -> str:
    return f"prm_{uuid.uuid4().hex}"


def _recall_trade_id() -> str:
    return f"rct_{uuid.uuid4().hex}"


def _recall_embedding_id() -> str:
    return f"rce_{uuid.uuid4().hex}"


def _recall_screenshot_id() -> str:
    return f"scr_{uuid.uuid4().hex}"


def _missed_trade_id() -> str:
    return f"mis_{uuid.uuid4().hex}"


def _learning_event_id() -> str:
    return f"lrn_{uuid.uuid4().hex}"


def _calibration_id() -> str:
    return f"cal_{uuid.uuid4().hex}"


def _regime_snap_id() -> str:
    return f"rgm_{uuid.uuid4().hex}"


def _session_snap_id() -> str:
    return f"sss_{uuid.uuid4().hex}"


def _data_truth_id() -> str:
    return f"dtc_{uuid.uuid4().hex}"


def _dna_cell_id() -> str:
    return f"dna_{uuid.uuid4().hex}"


class Strategy(Base):
    """A named trading strategy registered in Quant Lab.

    ``active_version_id`` points at the currently-blessed
    :class:`StrategyVersion`. Versions are immutable, so a ``Strategy``
    row only tracks mutable governance state (tier, promotion state).
    """

    __tablename__ = "strategies"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_strategy_id)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    setup_type: Mapped[str] = mapped_column(String(48), nullable=False)
    active_version_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    current_tier: Mapped[str] = mapped_column(String(2), nullable=False, default="C")
    current_state: Mapped[str] = mapped_column(
        String(32), nullable=False, default="experimental"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_strategies_state_tier", "current_state", "current_tier"),
        Index("ix_strategies_setup_type", "setup_type"),
    )


class StrategyVersion(Base):
    """Immutable configuration snapshot for a :class:`Strategy`.

    Every backtest + replay pins to a specific version so historical
    runs remain reproducible. ``code_hash`` is a content hash of the
    serialised strategy config — two identical configs share the hash.
    """

    __tablename__ = "strategy_versions"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_strategy_version_id
    )
    strategy_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    config: Mapped[Any] = mapped_column(JSON, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        UniqueConstraint("strategy_id", "version", name="uq_strategy_versions_n"),
        Index("ix_strategy_versions_strategy", "strategy_id"),
    )


class BacktestRun(Base):
    """One backtest execution of a ``StrategyVersion`` over a window.

    Aggregate metrics land in ``metrics`` as a JSON envelope mirroring
    :class:`BacktestMetricsSchema`. Per-trade and equity-curve detail
    live in companion tables (``backtest_trades``, ``backtest_equity_points``).
    """

    __tablename__ = "backtest_runs"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_backtest_run_id
    )
    strategy_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("strategy_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="queued"
    )
    requested_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    symbol_ids: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    from_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    to_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    slippage_bps: Mapped[float] = mapped_column(nullable=False, default=1.0)
    spread_bps: Mapped[float] = mapped_column(nullable=False, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    commission_per_share: Mapped[float] = mapped_column(nullable=False, default=0.0)
    seed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    metrics: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_backtest_runs_strategy_status", "strategy_id", "status"),
        Index("ix_backtest_runs_requested_at", "requested_at"),
    )


class BacktestTrade(Base):
    """One simulated trade inside a :class:`BacktestRun`."""

    __tablename__ = "backtest_trades"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_backtest_trade_id
    )
    run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("backtest_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    trade_index: Mapped[int] = mapped_column(Integer, nullable=False)
    symbol_id: Mapped[str] = mapped_column(String(64), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    entry_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    exit_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    entry_price: Mapped[float] = mapped_column(nullable=False)
    exit_price: Mapped[float] = mapped_column(nullable=False)
    stop_loss: Mapped[float] = mapped_column(nullable=False)
    take_profit: Mapped[float] = mapped_column(nullable=False)
    qty: Mapped[float] = mapped_column(nullable=False, default=1.0)
    pnl_r: Mapped[float] = mapped_column(nullable=False, default=0.0)
    pnl_dollars: Mapped[float] = mapped_column(nullable=False, default=0.0)
    mae_r: Mapped[float | None] = mapped_column(nullable=True)
    mfe_r: Mapped[float | None] = mapped_column(nullable=True)
    setup_type: Mapped[str] = mapped_column(String(48), nullable=False)
    exit_reason: Mapped[str] = mapped_column(String(16), nullable=False)

    __table_args__ = (
        UniqueConstraint("run_id", "trade_index", name="uq_backtest_trade_index"),
        Index("ix_backtest_trades_run", "run_id"),
    )


class BacktestEquityPoint(Base):
    """One equity-curve sample for a :class:`BacktestRun`."""

    __tablename__ = "backtest_equity_points"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_backtest_equity_id
    )
    run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("backtest_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    equity: Mapped[float] = mapped_column(nullable=False)
    drawdown: Mapped[float] = mapped_column(nullable=False, default=0.0)

    __table_args__ = (
        Index("ix_backtest_equity_run_ts", "run_id", "ts"),
    )


class ReplayRun(Base):
    """Candle-by-candle simulation cursor persisted across restarts.

    A replay can run without a ``Strategy`` (pure chart time-travel for
    operator inspection). Frames stream via SSE in real time when
    ``step_ms > 0``, and are persisted via ``replay_frames`` so the UI
    can seek backward.
    """

    __tablename__ = "replay_runs"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_replay_run_id
    )
    strategy_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="SET NULL"),
        nullable=True,
    )
    version_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("strategy_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="queued"
    )
    symbol_ids: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    from_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    to_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cursor_ts: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    step_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    requested_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    __table_args__ = (
        Index("ix_replay_runs_status", "status"),
        Index("ix_replay_runs_strategy", "strategy_id"),
    )


class ReplayFrameRow(Base):
    """One persisted decision envelope for a :class:`ReplayRun`.

    Named ``replay_frames`` in SQL but ``ReplayFrameRow`` in Python so
    it doesn't collide with the Phase 4 :class:`app.execution.replay`
    value-object that has the same concept but a different shape
    (tick-level cursor vs. decision envelope).
    """

    __tablename__ = "replay_frames"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_replay_frame_id
    )
    replay_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("replay_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    frame_index: Mapped[int] = mapped_column(Integer, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    decision: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    bars_applied: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("replay_id", "frame_index", name="uq_replay_frame_index"),
        Index("ix_replay_frames_replay", "replay_id"),
    )


class Experiment(Base):
    """A hypothesis that groups several :class:`BacktestRun` candidates."""

    __tablename__ = "experiments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_experiment_id)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    hypothesis: Mapped[str] = mapped_column(Text, nullable=False, default="")
    strategy_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    winning_backtest_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("backtest_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    verdict: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_experiments_strategy_status", "strategy_id", "status"),
    )


class ExperimentBacktest(Base):
    """Join row attaching a ``BacktestRun`` to an :class:`Experiment`."""

    __tablename__ = "experiment_backtests"

    experiment_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("experiments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    backtest_run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("backtest_runs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(
        String(16), nullable=False, default="candidate"
    )
    attached_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class StrategyRanking(Base):
    """Daily tier snapshot — drives the promotion / demotion pipeline."""

    __tablename__ = "strategy_rankings"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_ranking_id)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    strategy_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="CASCADE"),
        nullable=False,
    )
    tier: Mapped[str] = mapped_column(String(2), nullable=False, default="C")
    score: Mapped[float] = mapped_column(nullable=False, default=0.0)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sharpe: Mapped[float] = mapped_column(nullable=False, default=0.0)
    profit_factor: Mapped[float] = mapped_column(nullable=False, default=0.0)
    win_rate: Mapped[float] = mapped_column(nullable=False, default=0.0)
    drawdown: Mapped[float] = mapped_column(nullable=False, default=0.0)
    expectancy: Mapped[float] = mapped_column(nullable=False, default=0.0)
    reasons: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)

    __table_args__ = (
        Index("ix_strategy_rankings_ts", "computed_at"),
        Index("ix_strategy_rankings_strategy_ts", "strategy_id", "computed_at"),
    )


class PromotionEvent(Base):
    """Audit row for every ``Strategy.current_state`` FSM transition."""

    __tablename__ = "promotion_events"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_promotion_event_id
    )
    strategy_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_state: Mapped[str] = mapped_column(String(32), nullable=False)
    to_state: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    actor_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    auto: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ranking_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("strategy_rankings.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("ix_promotion_events_strategy_ts", "strategy_id", "occurred_at"),
    )


# ──────────────────────────── Phase 5 — Recall ──────────────────────────


class RecallTrade(Base):
    """Canonical trade memory — superset of paper + live + backtest outcomes.

    One row per completed trade. The companion :class:`RecallEmbedding`
    row holds the 64-dimensional feature vector powering similarity
    search so the hot recall list query never has to touch the JSON
    vector column.
    """

    __tablename__ = "recall_trades"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_recall_trade_id
    )
    source_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    source_id: Mapped[str] = mapped_column(String(64), nullable=False)
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    setup_type: Mapped[str] = mapped_column(String(48), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    entry_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    exit_ts: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    entry_price: Mapped[float] = mapped_column(nullable=False)
    exit_price: Mapped[float | None] = mapped_column(nullable=True)
    stop_loss: Mapped[float] = mapped_column(nullable=False)
    take_profit: Mapped[float] = mapped_column(nullable=False)
    pnl_r: Mapped[float | None] = mapped_column(nullable=True)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False, default="scratch")
    regime: Mapped[str | None] = mapped_column(String(16), nullable=True)
    session: Mapped[str | None] = mapped_column(String(16), nullable=True)
    structure_flags: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    order_flow_sign: Mapped[str | None] = mapped_column(String(8), nullable=True)
    confidence_at_detection: Mapped[float | None] = mapped_column(nullable=True)
    strategy_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="SET NULL"),
        nullable=True,
    )
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "source_kind", "source_id", name="uq_recall_trades_source",
        ),
        Index("ix_recall_trades_symbol_ts", "symbol_id", "captured_at"),
        Index("ix_recall_trades_setup_type", "setup_type"),
        Index("ix_recall_trades_outcome", "outcome"),
        Index("ix_recall_trades_strategy", "strategy_id"),
    )


class RecallEmbedding(Base):
    """64-dim feature vector + structured projection for similarity search."""

    __tablename__ = "recall_embeddings"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_recall_embedding_id
    )
    trade_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("recall_trades.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    dims: Mapped[int] = mapped_column(Integer, nullable=False, default=64)
    vector: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    norm: Mapped[float] = mapped_column(nullable=False, default=0.0)
    features: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class RecallScreenshot(Base):
    """Chart screenshot attached to a :class:`Setup` or :class:`RecallTrade`."""

    __tablename__ = "recall_screenshots"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_recall_screenshot_id
    )
    trade_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("recall_trades.id", ondelete="CASCADE"),
        nullable=True,
    )
    setup_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("setups.id", ondelete="SET NULL"),
        nullable=True,
    )
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    image_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    annotations: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    __table_args__ = (
        Index("ix_recall_screenshots_symbol_ts", "symbol_id", "captured_at"),
        Index("ix_recall_screenshots_setup", "setup_id"),
    )


class MissedTrade(Base):
    """A setup that should have traded but didn't — the systematic-miss log."""

    __tablename__ = "missed_trades"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_missed_trade_id
    )
    setup_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("setups.id", ondelete="SET NULL"),
        nullable=True,
    )
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    would_be_direction: Mapped[str] = mapped_column(String(8), nullable=False)
    theoretical_pnl_r: Mapped[float | None] = mapped_column(nullable=True)
    detected_confidence: Mapped[float | None] = mapped_column(nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (
        Index("ix_missed_trades_symbol_ts", "symbol_id", "detected_at"),
        Index("ix_missed_trades_reason", "reason"),
    )


# ──────────────────────────── Phase 5 — Learning + Governance ───────────


class LearningEvent(Base):
    """Append-only event-bus tail used by the Learning Agent.

    Every emitter (detectors, gate, broker adapter, calibration worker,
    promotion worker) writes here so the UI + downstream analytics have
    a single unified stream to tail.
    """

    __tablename__ = "learning_events"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_learning_event_id
    )
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    symbol_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="SET NULL"),
        nullable=True,
    )
    setup_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("setups.id", ondelete="SET NULL"),
        nullable=True,
    )
    strategy_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="SET NULL"),
        nullable=True,
    )
    payload: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_learning_events_kind_ts", "kind", "occurred_at"),
        Index("ix_learning_events_strategy_ts", "strategy_id", "occurred_at"),
        Index("ix_learning_events_symbol_ts", "symbol_id", "occurred_at"),
    )


class ConfidenceCalibration(Base):
    """Per-scope reliability curve so raw scores can be calibrated to truth."""

    __tablename__ = "confidence_calibrations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_calibration_id)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    scope_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="bucket")
    bins: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    platt_a: Mapped[float | None] = mapped_column(nullable=True)
    platt_b: Mapped[float | None] = mapped_column(nullable=True)
    ece: Mapped[float] = mapped_column(nullable=False, default=0.0)
    brier: Mapped[float] = mapped_column(nullable=False, default=0.0)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index(
            "ix_confidence_calibrations_scope_ts",
            "scope_kind",
            "scope_ref",
            "computed_at",
        ),
    )


class RegimeSnapshot(Base):
    """Per ``(symbol, tf)`` regime classification observed at a point in time."""

    __tablename__ = "regime_snapshots"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_regime_snap_id)
    symbol_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=False,
    )
    tf: Mapped[str] = mapped_column(String(8), nullable=False)
    regime: Mapped[str] = mapped_column(String(16), nullable=False)
    confidence: Mapped[float] = mapped_column(nullable=False, default=0.5)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    atr: Mapped[float | None] = mapped_column(nullable=True)
    adx: Mapped[float | None] = mapped_column(nullable=True)
    news_pressure: Mapped[float | None] = mapped_column(nullable=True)
    details: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_regime_snapshots_symbol_tf_ts", "symbol_id", "tf", "observed_at"),
    )


class SessionSnapshot(Base):
    """Per-session (asia/london/ny_am/ny_pm/off_hours) rollup."""

    __tablename__ = "session_snapshots"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_session_snap_id)
    symbol_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("market_symbols.id", ondelete="CASCADE"),
        nullable=True,
    )
    session: Mapped[str] = mapped_column(String(16), nullable=False)
    bucket_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    avg_range_r: Mapped[float] = mapped_column(nullable=False, default=0.0)
    avg_volume: Mapped[float] = mapped_column(nullable=False, default=0.0)
    setup_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    win_rate: Mapped[float] = mapped_column(nullable=False, default=0.0)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_session_snapshots_session_ts", "session", "bucket_ts"),
        Index("ix_session_snapshots_symbol_session", "symbol_id", "session"),
    )


class DataTruthCheck(Base):
    """Per-check feed/broker health row consumed by the kill-switch."""

    __tablename__ = "data_truth_checks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_data_truth_id)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="green")
    last_observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    last_value: Mapped[float | None] = mapped_column(nullable=True)
    threshold: Mapped[float | None] = mapped_column(nullable=True)
    message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    kill_switch_tripped: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    kill_switch_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("kind", name="uq_data_truth_checks_kind"),
        Index("ix_data_truth_checks_status", "status"),
    )


class StrategyDNACell(Base):
    """One cell of a strategy's (regime × session) performance grid.

    Together these rows form the Strategy DNA grid — "this strategy
    wins 64% in ranging / london and only 31% in volatile / ny_pm".
    """

    __tablename__ = "strategy_dna_cells"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_dna_cell_id)
    strategy_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="CASCADE"),
        nullable=False,
    )
    regime: Mapped[str] = mapped_column(String(16), nullable=False)
    session: Mapped[str] = mapped_column(String(16), nullable=False)
    win_rate: Mapped[float] = mapped_column(nullable=False, default=0.0)
    mean_r: Mapped[float] = mapped_column(nullable=False, default=0.0)
    median_r: Mapped[float] = mapped_column(nullable=False, default=0.0)
    drawdown: Mapped[float] = mapped_column(nullable=False, default=0.0)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "strategy_id", "regime", "session", name="uq_strategy_dna_cells",
        ),
        Index("ix_strategy_dna_strategy", "strategy_id"),
    )


# ──────────────────────────── Phase 6 — Portfolio Intelligence ──────────
#
# Only one new table is required for the portfolio layer: operator-set
# strategy allocation targets. Everything else (exposure, PnL timeseries)
# is projected at read time from Phase 4 state (positions, live_trades,
# account_equity_snapshots).


def _allocation_plan_id() -> str:
    return f"alc_{uuid.uuid4().hex}"


class AllocationPlanRow(Base):
    """Operator-set allocation target for a single strategy on a single account.

    ``actual_percent`` and ``delta_r`` are NOT persisted — they are
    recomputed each read from live equity + open live-trade risk. This
    row is only the operator's *intent*: "strategy stg_xxx should take
    up ≤ 20% of equity on account brk_yyy".

    A missing row means the strategy inherits the catalog default in
    ``system_config.portfolio.default_strategy_target``.
    """

    __tablename__ = "allocation_plans"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_allocation_plan_id
    )
    account_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    strategy_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("strategies.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_percent: Mapped[float] = mapped_column(nullable=False)
    source: Mapped[str] = mapped_column(
        String(24), nullable=False, default="operator"
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    updated_by_user_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "account_id", "strategy_id", name="uq_allocation_plans_account_strategy"
        ),
        Index("ix_allocation_plans_account", "account_id"),
    )


# ──────────────────────────── Phase 6 — Governance ──────────────────────
#
# The governance surface is split across five tables:
#
#   * approval_policies      — (action → requirements) lookup.
#   * governance_approvals   — one row per request, append-only state.
#   * approval_decisions     — per-approver signature row (append-only).
#   * anomaly_alerts         — detector-emitted alert with ack/resolve
#                              state machine.
#   * trust_tier_assignments — per-user tier history (append-only).
#
# User.trust_tier remains the *current* effective tier for fast reads; the
# history table is authoritative.


def _approval_policy_id() -> str:
    return f"pol_{uuid.uuid4().hex}"


def _governance_approval_id() -> str:
    return f"apr_{uuid.uuid4().hex}"


def _approval_decision_id() -> str:
    return f"apd_{uuid.uuid4().hex}"


def _anomaly_alert_id() -> str:
    return f"ano_{uuid.uuid4().hex}"


def _trust_assignment_id() -> str:
    return f"tra_{uuid.uuid4().hex}"


class ApprovalPolicyRow(Base):
    """Policy row — which actions require approval and by whom.

    Keyed on ``action`` (unique). A missing row for an action means
    ``requires_approval=False`` and the default minimum tier from
    ``system_config.governance.default_min_tier`` applies.
    """

    __tablename__ = "approval_policies"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_approval_policy_id
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    requires_approval: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    min_requester_tier: Mapped[str] = mapped_column(
        String(24), nullable=False, default="operator"
    )
    min_approver_tier: Mapped[str] = mapped_column(
        String(24), nullable=False, default="senior_operator"
    )
    approver_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1
    )
    ttl_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=86400
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    updated_by_user_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("action", name="uq_approval_policies_action"),
    )


class GovernanceApprovalRow(Base):
    """A single approval request.

    Lifecycle: ``pending → approved | rejected | expired | withdrawn``.
    Terminal rows are never mutated — a withdrawn + re-requested flow
    produces two rows.
    """

    __tablename__ = "governance_approvals"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_governance_approval_id
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    subject_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    state: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending"
    )
    requested_by_user_id: Mapped[str] = mapped_column(
        String(64), nullable=False
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_by_user_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    required_approver_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1
    )

    __table_args__ = (
        Index("ix_governance_approvals_action", "action"),
        Index("ix_governance_approvals_state", "state"),
        Index(
            "ix_governance_approvals_requested_at",
            "requested_at",
        ),
    )


class ApprovalDecisionRow(Base):
    """One signature on a governance approval.

    Unique on (approval_id, approver_user_id) — a given approver can
    only sign once per approval. ``decision`` ∈ {approve, reject, abstain}.
    """

    __tablename__ = "approval_decisions"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_approval_decision_id
    )
    approval_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("governance_approvals.id", ondelete="CASCADE"),
        nullable=False,
    )
    approver_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "approval_id",
            "approver_user_id",
            name="uq_approval_decisions_approval_user",
        ),
        Index("ix_approval_decisions_approval", "approval_id"),
    )


class AnomalyAlertRow(Base):
    """Detector-emitted anomaly.

    Lifecycle: ``open → acknowledged → resolved``. Acknowledge may set
    ``suppressed_until`` to suppress re-fires of the same (source,
    subject_key) tuple until that timestamp. ``evidence`` is a free-form
    JSON payload the detector writes.
    """

    __tablename__ = "anomaly_alerts"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_anomaly_alert_id
    )
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="open"
    )
    subject_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[Any] = mapped_column(JSON, nullable=False, default=dict)
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    acknowledged_by_user_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_by_user_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    suppressed_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    related_approval_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )

    __table_args__ = (
        Index("ix_anomaly_alerts_status", "status"),
        Index("ix_anomaly_alerts_detected_at", "detected_at"),
        Index("ix_anomaly_alerts_source_subject", "source", "subject_key"),
    )


class TrustTierAssignmentRow(Base):
    """Append-only history of trust-tier changes for a user.

    Writes land one row per change. The ``User.trust_tier`` column stays
    in sync with the latest row by user_id.
    """

    __tablename__ = "trust_tier_assignments"

    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=_trust_assignment_id
    )
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    tier: Mapped[str] = mapped_column(String(24), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    assigned_by_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (
        Index("ix_trust_tier_assignments_user", "user_id"),
        Index("ix_trust_tier_assignments_assigned_at", "assigned_at"),
    )
