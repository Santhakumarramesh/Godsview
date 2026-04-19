"""In-memory fake broker adapter — used by the unit + integration tests.

Records every call in ``calls`` and services reads from a dict of
pre-seeded fills + positions + equity. Tests register a fresh instance
in ``conftest.py`` via::

    from app.broker import FakeAdapter, broker_registry
    adapter = FakeAdapter(account_id="acc_1", mode="paper")
    broker_registry.register("acc_1", adapter)

and can inspect ``adapter.calls`` after the request to assert the
control_plane wrote the expected envelope.
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
class FakeAdapterCall:
    """One recorded call — used by tests to assert adapter invocation."""

    method: str
    kwargs: dict[str, Any]
    at: datetime = field(default_factory=_utcnow)


class FakeAdapter(BrokerProtocol):
    """In-memory adapter suitable for tests + demos.

    The adapter is deterministic:
      * ``submit_order`` always returns ``status="accepted"`` unless the
        caller pre-sets ``self.next_submit_status``
      * ``cancel_order`` is a no-op unless ``self.next_cancel_raises`` is set
      * ``list_fills`` / ``list_positions`` / ``get_equity`` return whatever
        seed the test plugged in
    """

    def __init__(
        self,
        *,
        account_id: str,
        mode: Literal["paper", "live"] = "paper",
        provider: str = "fake",
    ) -> None:
        self.provider = provider
        self.mode = mode
        self.account_id = account_id

        self.calls: list[FakeAdapterCall] = []

        self._submitted: dict[str, BrokerSubmitResult] = {}
        self._fills: dict[str, BrokerFillDto] = {}
        self._positions: list[BrokerPositionDto] = []
        self._equity: BrokerEquityDto | None = None

        # Test knobs.
        self.next_submit_status: str = "accepted"
        self.next_submit_raises: BrokerUnavailable | None = None
        self.next_cancel_raises: BrokerUnavailable | None = None
        self.next_get_fill_raises: BrokerUnavailable | None = None
        self.next_list_fills_raises: BrokerUnavailable | None = None
        self.next_list_positions_raises: BrokerUnavailable | None = None
        self.next_equity_raises: BrokerUnavailable | None = None

    # ── test helpers ─────────────────────────────────────────────────

    def seed_fill(self, fill: BrokerFillDto) -> None:
        self._fills[fill.client_order_id] = fill

    def seed_position(self, position: BrokerPositionDto) -> None:
        self._positions.append(position)

    def seed_equity(self, equity: BrokerEquityDto) -> None:
        self._equity = equity

    def reset(self) -> None:
        self.calls.clear()
        self._submitted.clear()
        self._fills.clear()
        self._positions.clear()
        self._equity = None
        self.next_submit_status = "accepted"
        self.next_submit_raises = None
        self.next_cancel_raises = None
        self.next_get_fill_raises = None
        self.next_list_fills_raises = None
        self.next_list_positions_raises = None
        self.next_equity_raises = None

    # ── BrokerProtocol ───────────────────────────────────────────────

    async def submit_order(
        self, request: BrokerSubmitRequest
    ) -> BrokerSubmitResult:
        self.calls.append(
            FakeAdapterCall(method="submit_order", kwargs={"request": request})
        )
        if self.next_submit_raises is not None:
            raise self.next_submit_raises

        # Idempotent — returning the same client_order_id twice is an ack,
        # not a duplicate.
        if request.client_order_id in self._submitted:
            return self._submitted[request.client_order_id]

        result = BrokerSubmitResult(
            client_order_id=request.client_order_id,
            broker_order_id=f"fake_{len(self._submitted) + 1:06d}",
            status=self.next_submit_status,  # type: ignore[arg-type]
            submitted_at=_utcnow(),
            raw={"fake": True, "symbol": request.symbol, "qty": request.qty},
        )
        self._submitted[request.client_order_id] = result
        return result

    async def cancel_order(self, *, client_order_id: str) -> None:
        self.calls.append(
            FakeAdapterCall(
                method="cancel_order",
                kwargs={"client_order_id": client_order_id},
            )
        )
        if self.next_cancel_raises is not None:
            raise self.next_cancel_raises

    async def get_fill(
        self, *, client_order_id: str
    ) -> BrokerFillDto | None:
        self.calls.append(
            FakeAdapterCall(
                method="get_fill",
                kwargs={"client_order_id": client_order_id},
            )
        )
        if self.next_get_fill_raises is not None:
            raise self.next_get_fill_raises
        return self._fills.get(client_order_id)

    async def list_fills(
        self,
        *,
        symbol: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 100,
    ) -> list[BrokerFillDto]:
        self.calls.append(
            FakeAdapterCall(
                method="list_fills",
                kwargs={
                    "symbol": symbol,
                    "since": since,
                    "until": until,
                    "limit": limit,
                },
            )
        )
        if self.next_list_fills_raises is not None:
            raise self.next_list_fills_raises

        out = list(self._fills.values())
        if symbol is not None:
            out = [f for f in out if f.symbol == symbol]
        if since is not None:
            out = [f for f in out if f.observed_at >= since]
        if until is not None:
            out = [f for f in out if f.observed_at < until]
        out.sort(key=lambda f: f.observed_at, reverse=True)
        return out[:limit]

    async def list_positions(
        self, *, symbol: str | None = None
    ) -> list[BrokerPositionDto]:
        self.calls.append(
            FakeAdapterCall(
                method="list_positions", kwargs={"symbol": symbol}
            )
        )
        if self.next_list_positions_raises is not None:
            raise self.next_list_positions_raises
        if symbol is None:
            return list(self._positions)
        return [p for p in self._positions if p.symbol == symbol]

    async def get_equity(self) -> BrokerEquityDto:
        self.calls.append(
            FakeAdapterCall(method="get_equity", kwargs={})
        )
        if self.next_equity_raises is not None:
            raise self.next_equity_raises
        if self._equity is None:
            # Return a deterministic default — tests that actually care
            # about equity should always seed one explicitly.
            return BrokerEquityDto(
                total_equity=100_000.0,
                start_of_day_equity=100_000.0,
                realized_pnl=0.0,
                unrealized_pnl=0.0,
                margin_used=0.0,
                buying_power=400_000.0,
                observed_at=_utcnow(),
            )
        return self._equity


__all__ = ["FakeAdapter", "FakeAdapterCall"]
