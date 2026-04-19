"""Broker adapter contract — the pluggable integration seam.

The live execution path talks to every downstream broker through the
:class:`BrokerProtocol` interface. Adapters are stored in
:class:`BrokerRegistry`, keyed by broker-account id, and resolved at
request time by the route layer. Tests register a ``FakeAdapter`` that
records every call and returns pre-seeded fills.

Design rules
------------

* **Async-first.** Every outbound call is ``async`` so adapters can
  reuse the control_plane's shared ``httpx.AsyncClient`` pool.
* **Idempotent.** Every write carries a caller-supplied
  ``client_order_id``. Adapters MUST treat duplicate client-order-ids as
  an ack of the same order, never a new one.
* **No hidden DB writes.** Adapters never touch SQLAlchemy. The route
  layer persists the resulting :class:`BrokerSubmitResult` so the DB
  transaction stays under route control and the adapter stays unit-
  testable.
* **Fail closed.** Every remote failure surfaces as
  :class:`BrokerUnavailable`. Route code turns that into a ``503`` via
  :class:`~app.errors.ApiError` — never a silent drop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol, runtime_checkable


BrokerDirection = Literal["long", "short"]
BrokerOrderType = Literal["market", "limit", "stop", "stop_limit", "bracket"]
BrokerTimeInForce = Literal["day", "gtc", "ioc", "fok"]
BrokerOrderStatus = Literal[
    "accepted",
    "rejected",
    "submitted",
    "partially_filled",
    "filled",
    "cancelled",
    "expired",
]


class BrokerUnavailable(RuntimeError):
    """Raised when the adapter cannot reach the downstream broker.

    The route layer MUST translate this into a ``503`` via
    :class:`~app.errors.ApiError(code="broker_unavailable")`. Internal
    code MUST NOT swallow it — a broker outage is an operator-visible
    condition, not a retry-silently one.
    """

    def __init__(self, provider: str, reason: str, *, retriable: bool = True) -> None:
        super().__init__(f"[{provider}] {reason}")
        self.provider = provider
        self.reason = reason
        self.retriable = retriable


@dataclass(frozen=True)
class BrokerSubmitRequest:
    """One envelope handed to ``BrokerProtocol.submit_order``.

    The set of fields is deliberately minimal — every concrete adapter
    maps these onto its own REST schema. Bracket orders carry the
    ``take_profit`` + ``stop_loss`` envelope so the protective legs
    ship alongside the entry in a single broker call.
    """

    client_order_id: str
    symbol: str
    direction: BrokerDirection
    qty: float
    order_type: BrokerOrderType
    time_in_force: BrokerTimeInForce = "day"
    limit_price: float | None = None
    stop_price: float | None = None
    take_profit: float | None = None
    stop_loss: float | None = None
    # Free-form operator note — adapters MAY forward this as the broker's
    # ``client_ref`` or drop it on the floor.
    note: str | None = None


@dataclass(frozen=True)
class BrokerSubmitResult:
    """What ``BrokerProtocol.submit_order`` returns on a successful ack.

    Represents the broker's first ack of the order envelope — not
    necessarily a fill. Fills arrive later via
    :meth:`BrokerProtocol.get_fill` or via a streaming fill feed.
    """

    client_order_id: str
    broker_order_id: str
    status: BrokerOrderStatus
    submitted_at: datetime
    raw: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class BrokerFillDto:
    """One execution report (may be partial)."""

    client_order_id: str
    broker_order_id: str
    symbol: str
    direction: BrokerDirection
    filled_qty: float
    avg_fill_price: float | None
    status: BrokerOrderStatus
    commission: float
    slippage: float | None
    observed_at: datetime
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True)
class BrokerPositionDto:
    """One broker-reported open position."""

    symbol: str
    direction: BrokerDirection
    qty: float
    avg_entry_price: float
    mark_price: float
    unrealized_pnl: float


@dataclass(frozen=True)
class BrokerEquityDto:
    """Point-in-time equity snapshot — broker-side truth."""

    total_equity: float
    start_of_day_equity: float
    realized_pnl: float
    unrealized_pnl: float
    margin_used: float
    buying_power: float
    observed_at: datetime


@runtime_checkable
class BrokerProtocol(Protocol):
    """The shape every broker adapter implements.

    Implementations are ``async`` — they're expected to reuse the
    control_plane's shared ``httpx.AsyncClient`` pool and MUST NOT
    block the event loop.
    """

    #: Stable identifier (``"alpaca"``, ``"fake"``, …) used in logs +
    #: metrics labels.
    provider: str

    #: ``"paper"`` or ``"live"`` — operator-visible, drives the UI badge.
    mode: Literal["paper", "live"]

    async def submit_order(
        self, request: BrokerSubmitRequest
    ) -> BrokerSubmitResult: ...

    async def cancel_order(self, *, client_order_id: str) -> None: ...

    async def get_fill(
        self, *, client_order_id: str
    ) -> BrokerFillDto | None: ...

    async def list_fills(
        self,
        *,
        symbol: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 100,
    ) -> list[BrokerFillDto]: ...

    async def list_positions(
        self, *, symbol: str | None = None
    ) -> list[BrokerPositionDto]: ...

    async def get_equity(self) -> BrokerEquityDto: ...


class BrokerRegistry:
    """Per-process registry of broker adapters keyed by account_id.

    The control_plane boots with an empty registry; the first place
    that wires a real adapter is the Alpaca bootstrap hook (not in this
    PR — that lands in PR6). Tests register a ``FakeAdapter`` directly
    via :meth:`register`.

    The registry is deliberately in-memory. There is no persistence +
    no cross-process fan-out: every worker of the ``uvicorn`` fleet
    holds its own registry. That's fine — registration is idempotent
    and driven by the DB row in ``broker_accounts``.
    """

    def __init__(self) -> None:
        self._by_account: dict[str, BrokerProtocol] = {}

    def register(self, account_id: str, adapter: BrokerProtocol) -> None:
        """Install an adapter for ``account_id`` (overwrites any prior)."""
        self._by_account[account_id] = adapter

    def unregister(self, account_id: str) -> None:
        self._by_account.pop(account_id, None)

    def get(self, account_id: str) -> BrokerProtocol:
        adapter = self._by_account.get(account_id)
        if adapter is None:
            raise BrokerUnavailable(
                provider="unknown",
                reason=f"no broker adapter registered for account {account_id}",
                retriable=False,
            )
        return adapter

    def get_or_none(self, account_id: str) -> BrokerProtocol | None:
        return self._by_account.get(account_id)

    def ids(self) -> list[str]:
        return list(self._by_account.keys())

    def clear(self) -> None:
        self._by_account.clear()


#: Process-global registry. Import this from route code to resolve
#: adapters. Tests should call ``broker_registry.clear()`` in their
#: ``conftest.py`` teardown hook.
broker_registry = BrokerRegistry()


__all__ = [
    "BrokerDirection",
    "BrokerOrderType",
    "BrokerTimeInForce",
    "BrokerOrderStatus",
    "BrokerUnavailable",
    "BrokerSubmitRequest",
    "BrokerSubmitResult",
    "BrokerFillDto",
    "BrokerPositionDto",
    "BrokerEquityDto",
    "BrokerProtocol",
    "BrokerRegistry",
    "broker_registry",
]
