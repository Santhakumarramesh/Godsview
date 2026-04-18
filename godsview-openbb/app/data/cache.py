from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, TypeVar

T = TypeVar("T")

_CACHE: dict[str, dict[str, Any]] = {}


def cached(key: str, ttl_seconds: int, loader: Callable[[], T]) -> T:
    now = datetime.now(timezone.utc)
    item = _CACHE.get(key)
    if item is not None:
        expires_at = item.get("expires_at")
        if isinstance(expires_at, datetime) and expires_at > now:
            return item["value"]  # type: ignore[return-value]

    value = loader()
    _CACHE[key] = {
        "value": value,
        "expires_at": now + timedelta(seconds=max(ttl_seconds, 1)),
    }
    return value


def clear_cache(prefix: str | None = None) -> int:
    if prefix is None:
        removed = len(_CACHE)
        _CACHE.clear()
        return removed
    keys = [k for k in _CACHE if k.startswith(prefix)]
    for key in keys:
        _CACHE.pop(key, None)
    return len(keys)
