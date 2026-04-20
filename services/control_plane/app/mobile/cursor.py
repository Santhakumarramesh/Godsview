"""Opaque keyset cursor for the mobile-inbox feed.

The feed merges four first-class tables on the fly, so classic
offset-paginated SQL doesn't work. Each page is sorted by
``(updated_at DESC, id DESC)`` across the merged stream; the cursor
carries the pivot tuple of the *last* returned row so the next page
resumes strictly after it.

The cursor is base64-url encoded JSON to keep it opaque to clients and
safe to drop inside a querystring. It is **not** signed — the pagination
surface is read-only and already rate-limited per operator, and a
client that hand-crafts a malicious cursor can only skip to an earlier
page of their own feed. If that assumption changes, sign the cursor
with the existing `jwt` secret and reject on mismatch.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.errors import ApiError

UTC = timezone.utc


@dataclass(frozen=True)
class InboxCursor:
    """Pivot tuple for keyset pagination.

    ``updated_at`` is the row's ``updated_at`` (or the best-available
    last-touched timestamp for the kind). ``item_id`` tie-breaks rows
    with identical timestamps — the projected feed sort key is
    ``(updated_at DESC, item_id DESC)`` so the next page resumes with
    ``(updated_at, item_id) < pivot``.
    """

    updated_at: datetime
    item_id: str


def encode_cursor(cursor: InboxCursor) -> str:
    """Serialise a cursor to a URL-safe opaque token."""
    payload: Dict[str, Any] = {
        "u": cursor.updated_at.astimezone(UTC).isoformat(),
        "i": cursor.item_id,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_cursor(token: str) -> InboxCursor:
    """Parse a cursor produced by :func:`encode_cursor`.

    Raises :class:`ApiError` (400 ``mobile_inbox_bad_cursor``) if the
    cursor is malformed — that bubbles up cleanly to the client.
    """
    padded = token + "=" * (-len(token) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
        updated_at = datetime.fromisoformat(payload["u"])
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        item_id = str(payload["i"])
    except Exception as exc:  # pragma: no cover - defensive
        raise ApiError(
            status_code=400,
            code="mobile_inbox_bad_cursor",
            message="invalid pagination cursor",
        ) from exc
    return InboxCursor(updated_at=updated_at, item_id=item_id)


def before_pivot(
    updated_at: datetime, item_id: str, pivot: Optional[InboxCursor]
) -> bool:
    """Return True if the (updated_at, item_id) tuple is strictly older than
    ``pivot`` under the ``(updated_at DESC, id DESC)`` sort order. Used by
    the aggregator to filter already-seen rows when resuming.
    """
    if pivot is None:
        return True
    if updated_at < pivot.updated_at:
        return True
    if updated_at > pivot.updated_at:
        return False
    return item_id < pivot.item_id


__all__ = [
    "InboxCursor",
    "before_pivot",
    "decode_cursor",
    "encode_cursor",
]
