from __future__ import annotations

import fnmatch
import inspect
import logging
from collections import defaultdict
from threading import RLock
from typing import Any, Callable

from .events import BrainEvent

logger = logging.getLogger(__name__)
Handler = Callable[[BrainEvent], Any]


class EventDispatcher:
    """
    Thread-safe in-process pub/sub bus with wildcard topic support.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, topic: str, handler: Handler) -> None:
        if not topic:
            raise ValueError("topic is required")
        with self._lock:
            self._handlers[topic].append(handler)

    def unsubscribe(self, topic: str, handler: Handler) -> None:
        with self._lock:
            if topic not in self._handlers:
                return
            self._handlers[topic] = [
                h for h in self._handlers[topic] if h is not handler
            ]
            if not self._handlers[topic]:
                del self._handlers[topic]

    def clear(self) -> None:
        with self._lock:
            self._handlers.clear()

    def publish(self, event: BrainEvent) -> int:
        handlers = self._matching_handlers(event.event_type)
        called = 0
        for handler in handlers:
            try:
                result = handler(event)
                if inspect.isawaitable(result):
                    # Keep dispatcher sync and explicit for now.
                    logger.warning(
                        "Async handler returned awaitable for topic=%s; ignored await",
                        event.event_type,
                    )
                called += 1
            except Exception:  # noqa: BLE001
                logger.exception("Event handler failed for topic=%s", event.event_type)
        return called

    def _matching_handlers(self, topic: str) -> list[Handler]:
        with self._lock:
            snapshot = dict(self._handlers)
        matched: list[Handler] = []
        for pattern, handlers in snapshot.items():
            if pattern == topic or fnmatch.fnmatch(topic, pattern):
                matched.extend(handlers)
        return matched

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "topics": len(self._handlers),
                "handlers": sum(len(v) for v in self._handlers.values()),
                "by_topic": {k: len(v) for k, v in self._handlers.items()},
            }


_DISPATCHER: EventDispatcher | None = None


def get_dispatcher() -> EventDispatcher:
    global _DISPATCHER  # noqa: PLW0603
    if _DISPATCHER is None:
        _DISPATCHER = EventDispatcher()
    return _DISPATCHER
