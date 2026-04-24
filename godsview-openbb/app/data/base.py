"""
Base data client — shared caching, retry, and rate-limit logic.

Every provider client inherits from this so we get uniform error handling
and caching without repeating boilerplate.
"""

from __future__ import annotations

import time
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

T = TypeVar("T")
logger = logging.getLogger("godsview.data")


@dataclass
class CacheEntry:
    """Single cache entry with TTL."""
    data: Any
    fetched_at: float  # monotonic clock
    ttl: float         # seconds


class BaseDataClient:
    """
    Base class for all data provider clients.

    Provides:
      - In-memory TTL cache per key
      - Retry with exponential backoff
      - Standardized error logging
      - Provider health tracking
    """

    def __init__(self, name: str, default_ttl: float = 300.0, max_retries: int = 3):
        self.name = name
        self.default_ttl = default_ttl
        self.max_retries = max_retries
        self._cache: dict[str, CacheEntry] = {}
        self._consecutive_failures = 0
        self._last_success: float | None = None
        self._last_failure: float | None = None

    # ── Cache ──────────────────────────────────────────────────────────────

    def _cache_get(self, key: str) -> Any | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        if (time.monotonic() - entry.fetched_at) > entry.ttl:
            del self._cache[key]
            return None
        return entry.data

    def _cache_set(self, key: str, data: Any, ttl: float | None = None):
        self._cache[key] = CacheEntry(
            data=data,
            fetched_at=time.monotonic(),
            ttl=ttl if ttl is not None else self.default_ttl,
        )

    def clear_cache(self):
        self._cache.clear()

    # ── Retry with backoff ─────────────────────────────────────────────────

    def _fetch_with_retry(
        self,
        fn: Callable[[], T],
        label: str = "fetch",
        retries: int | None = None,
    ) -> T | None:
        """
        Execute `fn` with exponential backoff on failure.
        Returns None if all retries exhausted.
        """
        max_attempts = retries if retries is not None else self.max_retries
        for attempt in range(1, max_attempts + 1):
            try:
                result = fn()
                self._consecutive_failures = 0
                self._last_success = time.monotonic()
                return result
            except Exception as exc:
                self._consecutive_failures += 1
                self._last_failure = time.monotonic()
                backoff = min(2 ** (attempt - 1), 30)
                logger.warning(
                    "[%s] %s attempt %d/%d failed: %s — retrying in %ds",
                    self.name, label, attempt, max_attempts, exc, backoff,
                )
                if attempt < max_attempts:
                    time.sleep(backoff)

        logger.error("[%s] %s failed after %d attempts", self.name, label, max_attempts)
        return None

    # ── Health ─────────────────────────────────────────────────────────────

    def health(self) -> dict:
        return {
            "provider": self.name,
            "status": "healthy" if self._consecutive_failures < 3 else "degraded",
            "consecutive_failures": self._consecutive_failures,
            "last_success": self._last_success,
            "last_failure": self._last_failure,
            "cache_entries": len(self._cache),
        }

    @staticmethod
    def utcnow() -> datetime:
        return datetime.now(timezone.utc)
