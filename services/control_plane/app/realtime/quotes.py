"""In-memory pub/sub fan-out for live quote messages.

The ``QuoteHub`` owns a per-symbol set of subscribers. Each subscriber
satisfies the :class:`QuoteSubscriber` protocol — practically that means
"anything with an ``async send_json(dict) -> None`` and a stable
``connection_id`` attribute". The WebSocket route in
``app.routes.ws_quotes`` wraps a Starlette ``WebSocket`` to satisfy
this protocol.

Design notes
------------

* The hub is **process-local**. A multi-pod deploy needs a Redis pub/sub
  fan-out layer in front of it; this PR scopes itself to single-process
  correctness.
* All mutating methods take an ``asyncio.Lock`` to keep the subscription
  map consistent under concurrent accept / drop / publish. Publish reads
  a *copy* of the subscriber set so a slow client cannot block the
  publisher.
* Failed sends are caught and the subscriber is dropped from every
  symbol it was registered to. The route layer is responsible for
  closing the underlying socket — the hub only manages the membership
  set.
* The hub is a singleton accessed via :func:`get_quote_hub`. Tests get
  a fresh hub by calling :func:`reset_quote_hub_for_tests` from a
  pytest fixture or by instantiating ``QuoteHub`` directly.

Wire schema
-----------

``QuoteMessage`` is the canonical inbound shape used by both the
``POST /market/quotes`` admin endpoint and the synthetic test feed. It
mirrors ``packages/types/src/market.ts::QuoteSchema`` (camelCase via
Pydantic alias). The serialised dict that gets pushed to subscribers
matches that schema exactly.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from datetime import datetime
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

logger = logging.getLogger("godsview.realtime.quotes")


class QuoteMessage(BaseModel):
    """A single quote-tick wire payload.

    Mirrors ``QuoteSchema`` from ``packages/types/src/market.ts``.
    """

    symbol_id: str = Field(..., alias="symbolId", min_length=1)
    bid: float
    ask: float
    last: float
    bid_size: float = Field(..., alias="bidSize", ge=0)
    ask_size: float = Field(..., alias="askSize", ge=0)
    t: datetime

    model_config = {"populate_by_name": True}

    def to_wire(self) -> dict[str, Any]:
        """Return the camelCase-aliased dict pushed to subscribers."""
        return self.model_dump(by_alias=True, mode="json")


@runtime_checkable
class QuoteSubscriber(Protocol):
    """Anything the hub can fan-out a quote to.

    Implementations must provide a stable ``connection_id`` so the hub
    can de-duplicate and unsubscribe a socket without holding a
    reference to the socket itself.
    """

    connection_id: str

    async def send_json(self, msg: dict[str, Any]) -> None:  # pragma: no cover - protocol
        ...


class QuoteHub:
    """Process-local pub/sub for :class:`QuoteMessage` fan-out."""

    def __init__(self) -> None:
        self._subs: dict[str, set[QuoteSubscriber]] = {}
        self._sub_index: dict[str, set[str]] = {}  # connection_id → symbol_ids
        self._lock = asyncio.Lock()

    # ────────────────────── introspection ─────────────────────────

    def subscriber_count(self, symbol_id: str) -> int:
        return len(self._subs.get(symbol_id, ()))

    def symbols_for(self, subscriber: QuoteSubscriber) -> set[str]:
        return set(self._sub_index.get(subscriber.connection_id, set()))

    def known_symbols(self) -> list[str]:
        return sorted(self._subs.keys())

    # ────────────────────── mutators ──────────────────────────────

    async def subscribe(
        self, subscriber: QuoteSubscriber, symbol_ids: Iterable[str]
    ) -> list[str]:
        """Add ``subscriber`` to each ``symbol_id``'s fan-out set.

        Returns the de-duplicated list of symbols actually subscribed to
        (including any that were already in the set).
        """
        normalised = sorted({s for s in symbol_ids if s})
        if not normalised:
            return []
        async with self._lock:
            for sid in normalised:
                self._subs.setdefault(sid, set()).add(subscriber)
            self._sub_index.setdefault(
                subscriber.connection_id, set()
            ).update(normalised)
        return normalised

    async def unsubscribe(
        self, subscriber: QuoteSubscriber, symbol_ids: Iterable[str]
    ) -> list[str]:
        normalised = sorted({s for s in symbol_ids if s})
        if not normalised:
            return []
        async with self._lock:
            removed: list[str] = []
            for sid in normalised:
                bucket = self._subs.get(sid)
                if bucket and subscriber in bucket:
                    bucket.discard(subscriber)
                    removed.append(sid)
                    if not bucket:
                        self._subs.pop(sid, None)
            idx = self._sub_index.get(subscriber.connection_id)
            if idx is not None:
                idx.difference_update(normalised)
                if not idx:
                    self._sub_index.pop(subscriber.connection_id, None)
        return removed

    async def unsubscribe_all(self, subscriber: QuoteSubscriber) -> int:
        """Drop ``subscriber`` from every symbol. Returns count removed."""
        async with self._lock:
            symbols = self._sub_index.pop(subscriber.connection_id, set())
            for sid in symbols:
                bucket = self._subs.get(sid)
                if bucket is None:
                    continue
                bucket.discard(subscriber)
                if not bucket:
                    self._subs.pop(sid, None)
            return len(symbols)

    # ────────────────────── publish ───────────────────────────────

    async def publish(self, message: QuoteMessage) -> int:
        """Fan out ``message`` to every current subscriber.

        Returns the number of sockets the message was successfully
        pushed to. Failed sockets are evicted from every symbol they
        were subscribed to so a stuck client cannot leak memory.
        """
        async with self._lock:
            targets = list(self._subs.get(message.symbol_id, ()))
        if not targets:
            return 0
        wire = {"type": "quote", "data": message.to_wire()}
        delivered = 0
        for sub in targets:
            try:
                await sub.send_json(wire)
                delivered += 1
            except Exception as exc:  # noqa: BLE001 — defensive against any IO error
                logger.warning(
                    "quote-hub send failed; dropping subscriber",
                    extra={
                        "connection_id": sub.connection_id,
                        "symbol_id": message.symbol_id,
                        "error": str(exc),
                    },
                )
                await self.unsubscribe_all(sub)
        return delivered


# ──────────────────────────── singleton ────────────────────────────

_hub: QuoteHub | None = None


def get_quote_hub() -> QuoteHub:
    """Return the process-wide :class:`QuoteHub` singleton."""
    global _hub
    if _hub is None:
        _hub = QuoteHub()
    return _hub


def reset_quote_hub_for_tests() -> None:
    """Drop the singleton so the next ``get_quote_hub()`` returns a fresh hub.

    Tests should call this from a fixture so they don't leak subscribers
    across modules.
    """
    global _hub
    _hub = None
