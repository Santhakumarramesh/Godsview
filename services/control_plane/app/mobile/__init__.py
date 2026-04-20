"""Mobile operator inbox (Phase 7).

The mobile inbox is a read-only aggregated feed over a handful of
first-class governance tables — it is not a materialised view. This
package houses:

  * :mod:`dto`     — Pydantic v2 wire models that mirror
    ``packages/types/src/mobile.ts``.
  * :mod:`cursor`  — base64-url keyset cursor encode/decode used by the
    paginated list endpoint.
  * :mod:`inbox`   — the aggregator that composes the feed from
    :class:`AnomalyAlertRow`, :class:`GovernanceApprovalRow`,
    :class:`KillSwitchEventRow` and :class:`RebalancePlanRow`, then
    projects acknowledgement state from
    :class:`MobileInboxAckEventRow` on top.

No mutation of first-class rows happens here — the inbox is a thin
projection layer. The only persisted side-effect is appending a row to
``mobile_inbox_ack_events`` when an operator ack's from their phone.
"""

from __future__ import annotations

from app.mobile.cursor import (
    InboxCursor,
    decode_cursor,
    encode_cursor,
)
from app.mobile.dto import (
    MobileInboxAckRequestDto,
    MobileInboxFilterDto,
    MobileInboxItemDto,
    MobileInboxItemKind,
    MobileInboxListDto,
    MobileInboxSeverity,
    MobileInboxStatus,
    MobileInboxSummaryDto,
)
from app.mobile.inbox import (
    acknowledge_inbox_item,
    build_inbox_page,
    build_inbox_summary,
    fetch_inbox_item,
)

__all__ = [
    "InboxCursor",
    "MobileInboxAckRequestDto",
    "MobileInboxFilterDto",
    "MobileInboxItemDto",
    "MobileInboxItemKind",
    "MobileInboxListDto",
    "MobileInboxSeverity",
    "MobileInboxStatus",
    "MobileInboxSummaryDto",
    "acknowledge_inbox_item",
    "build_inbox_page",
    "build_inbox_summary",
    "decode_cursor",
    "encode_cursor",
    "fetch_inbox_item",
]
