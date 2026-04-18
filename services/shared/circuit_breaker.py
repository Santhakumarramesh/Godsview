"""
Circuit Breaker — prevents cascading failures between microservices.

States:
  CLOSED   → normal operation; failures counted
  OPEN     → calls rejected immediately; recovery timer running
  HALF_OPEN → one trial call allowed; success → CLOSED, failure → OPEN
"""

from __future__ import annotations

import asyncio
import logging
import time
from enum import Enum
from typing import Any, Callable, Coroutine, TypeVar

log = logging.getLogger(__name__)

T = TypeVar("T")


class CBState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerOpen(Exception):
    """Raised when a call is rejected because the circuit is OPEN."""


class CircuitBreaker:
    """Async circuit breaker for inter-service HTTP calls."""

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        expected_exception: type[Exception] = Exception,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exception = expected_exception

        self._state = CBState.CLOSED
        self._failures = 0
        self._last_failure_time: float = 0.0
        self._lock = asyncio.Lock()

    @property
    def state(self) -> str:
        return self._state.value

    @property
    def failures(self) -> int:
        return self._failures

    async def call(
        self,
        coro_fn: Callable[..., Coroutine[Any, Any, T]],
        *args: Any,
        fallback: T | None = None,
        **kwargs: Any,
    ) -> T:
        """
        Execute ``coro_fn(*args, **kwargs)`` through the circuit breaker.

        If ``fallback`` is provided, it is returned instead of raising
        ``CircuitBreakerOpen`` when the circuit is open.
        """
        async with self._lock:
            if self._state == CBState.OPEN:
                if time.monotonic() - self._last_failure_time >= self.recovery_timeout:
                    self._state = CBState.HALF_OPEN
                    log.info("circuit_breaker.half_open name=%s", self.name)
                else:
                    if fallback is not None:
                        return fallback
                    raise CircuitBreakerOpen(
                        f"Circuit '{self.name}' is OPEN — call rejected"
                    )

        try:
            result = await coro_fn(*args, **kwargs)
            await self._on_success()
            return result
        except self.expected_exception as exc:
            await self._on_failure()
            if fallback is not None:
                log.warning(
                    "circuit_breaker.fallback name=%s error=%s",
                    self.name,
                    str(exc),
                )
                return fallback
            raise

    async def _on_success(self) -> None:
        async with self._lock:
            if self._state == CBState.HALF_OPEN:
                log.info("circuit_breaker.closed name=%s", self.name)
            self._state = CBState.CLOSED
            self._failures = 0

    async def _on_failure(self) -> None:
        async with self._lock:
            self._failures += 1
            self._last_failure_time = time.monotonic()
            if (
                self._failures >= self.failure_threshold
                or self._state == CBState.HALF_OPEN
            ):
                self._state = CBState.OPEN
                log.warning(
                    "circuit_breaker.opened name=%s failures=%d threshold=%d",
                    self.name,
                    self._failures,
                    self.failure_threshold,
                )

    def reset(self) -> None:
        self._state = CBState.CLOSED
        self._failures = 0
        self._last_failure_time = 0.0
        log.info("circuit_breaker.reset name=%s", self.name)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "state": self.state,
            "failures": self._failures,
            "failure_threshold": self.failure_threshold,
            "recovery_timeout": self.recovery_timeout,
        }


# ---------------------------------------------------------------------------
# Registry — one breaker per downstream service
# ---------------------------------------------------------------------------


class CircuitBreakerRegistry:
    def __init__(self) -> None:
        self._breakers: dict[str, CircuitBreaker] = {}

    def get(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ) -> CircuitBreaker:
        if name not in self._breakers:
            self._breakers[name] = CircuitBreaker(
                name=name,
                failure_threshold=failure_threshold,
                recovery_timeout=recovery_timeout,
                expected_exception=Exception,
            )
        return self._breakers[name]

    def status(self) -> dict[str, Any]:
        return {name: cb.to_dict() for name, cb in self._breakers.items()}

    def reset_all(self) -> None:
        for cb in self._breakers.values():
            cb.reset()


registry = CircuitBreakerRegistry()
