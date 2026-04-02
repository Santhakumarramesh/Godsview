"""Tests for services.shared.circuit_breaker"""
from __future__ import annotations

import asyncio

import pytest

from services.shared.circuit_breaker import (
    CBState,
    CircuitBreaker,
    CircuitBreakerOpen,
    CircuitBreakerRegistry,
)


async def _ok() -> str:
    return "ok"


async def _fail() -> str:
    raise ValueError("boom")


class TestCircuitBreakerClosed:
    @pytest.mark.asyncio
    async def test_successful_call(self):
        cb = CircuitBreaker("test", failure_threshold=3)
        result = await cb.call(_ok)
        assert result == "ok"
        assert cb.state == "closed"

    @pytest.mark.asyncio
    async def test_failure_increments_count(self):
        cb = CircuitBreaker("test", failure_threshold=3)
        with pytest.raises(ValueError):
            await cb.call(_fail)
        assert cb.failures == 1
        assert cb.state == "closed"

    @pytest.mark.asyncio
    async def test_threshold_opens_circuit(self):
        cb = CircuitBreaker("test", failure_threshold=3)
        for _ in range(3):
            with pytest.raises(ValueError):
                await cb.call(_fail)
        assert cb.state == "open"

    @pytest.mark.asyncio
    async def test_success_resets_failures(self):
        cb = CircuitBreaker("test", failure_threshold=5)
        with pytest.raises(ValueError):
            await cb.call(_fail)
        assert cb.failures == 1
        await cb.call(_ok)
        assert cb.failures == 0


class TestCircuitBreakerOpen:
    @pytest.mark.asyncio
    async def test_open_raises_circuit_breaker_open(self):
        cb = CircuitBreaker("test", failure_threshold=1)
        with pytest.raises(ValueError):
            await cb.call(_fail)
        assert cb.state == "open"
        with pytest.raises(CircuitBreakerOpen):
            await cb.call(_ok)

    @pytest.mark.asyncio
    async def test_open_returns_fallback(self):
        cb = CircuitBreaker("test", failure_threshold=1)
        with pytest.raises(ValueError):
            await cb.call(_fail)
        result = await cb.call(_ok, fallback="fallback_value")
        assert result == "fallback_value"

    @pytest.mark.asyncio
    async def test_failure_fallback_returned(self):
        cb = CircuitBreaker("test", failure_threshold=5)
        result = await cb.call(_fail, fallback="default")
        assert result == "default"


class TestCircuitBreakerHalfOpen:
    @pytest.mark.asyncio
    async def test_half_open_after_timeout(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.0)
        with pytest.raises(ValueError):
            await cb.call(_fail)
        assert cb.state == "open"
        # With 0 timeout, next call should transition to half-open then closed on success
        result = await cb.call(_ok)
        assert result == "ok"
        assert cb.state == "closed"

    @pytest.mark.asyncio
    async def test_half_open_failure_reopens(self):
        cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.0)
        with pytest.raises(ValueError):
            await cb.call(_fail)
        # Next call → half-open → failure → open again
        with pytest.raises(ValueError):
            await cb.call(_fail)
        assert cb.state == "open"


class TestCircuitBreakerReset:
    @pytest.mark.asyncio
    async def test_manual_reset(self):
        cb = CircuitBreaker("test", failure_threshold=1)
        with pytest.raises(ValueError):
            await cb.call(_fail)
        assert cb.state == "open"
        cb.reset()
        assert cb.state == "closed"
        assert cb.failures == 0

    def test_to_dict(self):
        cb = CircuitBreaker("svc", failure_threshold=5, recovery_timeout=30.0)
        d = cb.to_dict()
        assert d["name"] == "svc"
        assert d["state"] == "closed"
        assert d["failures"] == 0
        assert d["failure_threshold"] == 5


class TestCircuitBreakerRegistry:
    def test_get_returns_same_instance(self):
        reg = CircuitBreakerRegistry()
        cb1 = reg.get("svc_a")
        cb2 = reg.get("svc_a")
        assert cb1 is cb2

    def test_different_names_different_instances(self):
        reg = CircuitBreakerRegistry()
        cb1 = reg.get("svc_a")
        cb2 = reg.get("svc_b")
        assert cb1 is not cb2

    def test_status_returns_all(self):
        reg = CircuitBreakerRegistry()
        reg.get("svc_x")
        reg.get("svc_y")
        status = reg.status()
        assert "svc_x" in status
        assert "svc_y" in status

    @pytest.mark.asyncio
    async def test_reset_all(self):
        reg = CircuitBreakerRegistry()
        cb = reg.get("svc_z", failure_threshold=1)
        with pytest.raises(ValueError):
            await cb.call(_fail)
        assert cb.state == "open"
        reg.reset_all()
        assert cb.state == "closed"
