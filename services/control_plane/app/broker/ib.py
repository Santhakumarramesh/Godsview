"""Interactive Brokers adapter — Phase 7 stub.

The real IB Gateway integration (client portal REST + TWS) is out of
scope for Phase 7 PR3. This stub satisfies ``BrokerProtocol`` so the
registry + binding layer can route intents without crashing: every
method raises :class:`BrokerUnavailable` with a typed
``reason='ib_stub_not_wired'`` so the route layer surfaces a clean 503
and the live gate refuses to route until the real adapter lands.

The stub intentionally keeps state minimal — it records every call in
``self.calls`` (mirroring :class:`FakeAdapter`) so adapter-aware tests
can assert the registry picked the right adapter even before the wire
is implemented.

Real-wire milestones (tracked in Phase 7 follow-up):

  * ``IBAdapter.submit_order``      — IB gateway POST /iserver/account/{id}/orders
  * ``IBAdapter.cancel_order``      — DELETE /iserver/account/{id}/order/{orderId}
  * ``IBAdapter.get_fill``          — GET /iserver/account/trades
  * ``IBAdapter.list_fills``        — GET /iserver/account/trades with filters
  * ``IBAdapter.list_positions``    — GET /portfolio/{accountId}/positions/0
  * ``IBAdapter.get_equity``        — GET /portfolio/{accountId}/summary

Until those land, the probe cron sees ``BrokerUnavailable`` and writes a
``BrokerHealthSnapshotRow`` with ``status='down'`` +
``notes='ib_stub_not_wired'``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from app.broker.base import (
    BrokerEquityDto,
    BrokerFillDto,
    BrokerPositionDto,
    BrokerProtocol,
    BrokerSubmitRequest,
    BrokerSubmitResult,
    BrokerUnavailable,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class IBAdapterCall:
    """One recorded call — used by tests to assert adapter invocation."""

    method: str
    kwargs: dict[str, Any]
    at: datetime = field(default_factory=_utcnow)


class IBAdapter(BrokerProtocol):
    """Interactive Brokers adapter stub.

    Every outbound call raises :class:`BrokerUnavailable`. The stub is a
    placeholder for the real IB Gateway integration; it exists so the
    Phase 7 registry + binding plumbing can store an
    ``alpaca_live`` + ``ib_live`` pair and quorum-check across vendors
    even when the IB side hasn't been wired yet.
    """

    def __init__(
        self,
        *,
        adapter_id: str,
        mode: Literal["paper", "live"] = "paper",
        host: str = "https://api.ibkr.com",
    ) -> None:
        self.provider = "ib"
        self.mode = mode
        self.adapter_id = adapter_id
        self.host = host
        self.calls: list[IBAdapterCall] = []

    def _record(self, method: str, **kwargs: Any) -> None:
        self.calls.append(IBAdapterCall(method=method, kwargs=kwargs))

    def _fail(self, method: str) -> None:
        raise BrokerUnavailable(
            provider="ib",
            reason=f"ib_stub_not_wired (method={method})",
            retriable=True,
        )

    # ── BrokerProtocol ────────────────────────────────────────────────

    async def submit_order(
        self, request: BrokerSubmitRequest
    ) -> BrokerSubmitResult:
        self._record("submit_order", request=request)
        self._fail("submit_order")
        raise AssertionError("unreachable")  # appease type-checkers

    async def cancel_order(self, *, client_order_id: str) -> None:
        self._record("cancel_order", client_order_id=client_order_id)
        self._fail("cancel_order")

    async def get_fill(
        self, *, client_order_id: str
    ) -> BrokerFillDto | None:
        self._record("get_fill", client_order_id=client_order_id)
        self._fail("get_fill")
        return None  # unreachable

    async def list_fills(
        self,
        *,
        symbol: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 100,
    ) -> list[BrokerFillDto]:
        self._record(
            "list_fills",
            symbol=symbol,
            since=since,
            until=until,
            limit=limit,
        )
        self._fail("list_fills")
        return []  # unreachable

    async def list_positions(
        self, *, symbol: str | None = None
    ) -> list[BrokerPositionDto]:
        self._record("list_positions", symbol=symbol)
        self._fail("list_positions")
        return []  # unreachable

    async def get_equity(self) -> BrokerEquityDto:
        self._record("get_equity")
        self._fail("get_equity")
        raise AssertionError("unreachable")


__all__ = ["IBAdapter", "IBAdapterCall"]
