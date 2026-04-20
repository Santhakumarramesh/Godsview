"""Pydantic v2 mirror of ``packages/types/src/mobile.ts``.

The mobile inbox speaks camelCase on the wire — every DTO here uses
``ConfigDict(populate_by_name=True, from_attributes=True)`` so route
handlers can pass ORM-adjacent objects straight through.

The field graph here is a strict 1:1 mirror of the TypeScript schema;
contract-validation CI fails if a key drifts. Keep the two in sync.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class _CamelBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ──────────────────────────── taxonomy ─────────────────────────────────

MobileInboxItemKind = Literal[
    "approval",
    "anomaly",
    "kill_switch",
    "drawdown",
    "rebalance",
    "broker_outage",
    "venue_outage",
    "autonomy_change",
    "governance_decision",
]

MobileInboxSeverity = Literal["info", "warn", "critical"]

MobileInboxStatus = Literal["open", "acknowledged", "resolved"]


# ──────────────────────────── item row ─────────────────────────────────


class MobileInboxItemDto(_CamelBase):
    """One projected inbox row — mirrors ``MobileInboxItemSchema``."""

    id: str
    kind: MobileInboxItemKind
    severity: MobileInboxSeverity
    status: MobileInboxStatus
    title: str
    summary: str
    subject_key: str = Field(alias="subjectKey")
    subject_secondary_key: Optional[str] = Field(alias="subjectSecondaryKey")
    deep_link: str = Field(alias="deepLink")
    badges: List[str] = Field(default_factory=list)
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    acknowledged_at: Optional[datetime] = Field(alias="acknowledgedAt")
    resolved_at: Optional[datetime] = Field(alias="resolvedAt")


# ──────────────────────────── pagination ───────────────────────────────


class MobileInboxListDto(_CamelBase):
    """Paginated feed response — mirrors ``MobileInboxListSchema``."""

    items: List[MobileInboxItemDto]
    next_cursor: Optional[str] = Field(alias="nextCursor")
    total: int = Field(ge=0)
    unread: int = Field(ge=0)
    observed_at: datetime = Field(alias="observedAt")


class MobileInboxFilterDto(_CamelBase):
    """Query filter — mirrors ``MobileInboxFilterSchema``.

    All fields optional; ``limit`` defaults to 50 at the route.
    """

    kind: Optional[MobileInboxItemKind] = None
    severity: Optional[MobileInboxSeverity] = None
    status: Optional[MobileInboxStatus] = None
    cursor: Optional[str] = None
    limit: Optional[int] = Field(default=None, ge=1, le=200)


# ──────────────────────────── acknowledgement ──────────────────────────


class MobileInboxAckRequestDto(_CamelBase):
    """Ack mutation — mirrors ``MobileInboxAckRequestSchema``.

    ``id`` is redundant with the path parameter; both are accepted so
    the mobile client can forward the JSON body verbatim to a shared
    request helper.
    """

    id: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=280)


# ──────────────────────────── summary card ─────────────────────────────


class MobileInboxSummaryDto(_CamelBase):
    """Header counts — mirrors ``MobileInboxSummarySchema``."""

    open: int = Field(ge=0)
    critical: int = Field(ge=0)
    warn: int = Field(ge=0)
    info: int = Field(ge=0)
    observed_at: datetime = Field(alias="observedAt")
    throttled: bool


__all__ = [
    "MobileInboxAckRequestDto",
    "MobileInboxFilterDto",
    "MobileInboxItemDto",
    "MobileInboxItemKind",
    "MobileInboxListDto",
    "MobileInboxSeverity",
    "MobileInboxStatus",
    "MobileInboxSummaryDto",
]
