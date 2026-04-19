"""Alpaca broker adapter — paper + live share the same REST schema.

The adapter wraps these endpoints:

  * ``POST /v2/orders``                       — submit_order
  * ``DELETE /v2/orders:by_client_order_id``  — cancel_order
  * ``GET /v2/orders:by_client_order_id``     — get_fill (order state)
  * ``GET /v2/account/activities/FILL``       — list_fills
  * ``GET /v2/positions``                     — list_positions
  * ``GET /v2/account``                       — get_equity

Paper vs live is a :class:`base_url` flip only — Alpaca has identical
JSON envelopes on both. Credentials live in Vault/Secrets Manager and
are injected at bootstrap via the per-account ``api_key_ref`` +
``api_secret_ref`` (see ``BrokerAccount``).

The adapter is httpx-based and expects the caller to inject the shared
``httpx.AsyncClient`` so timeouts + connection pooling are managed
centrally. Every network error becomes :class:`BrokerUnavailable`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

import httpx

from app.broker.base import (
    BrokerEquityDto,
    BrokerFillDto,
    BrokerPositionDto,
    BrokerSubmitRequest,
    BrokerSubmitResult,
    BrokerUnavailable,
)


_ALPACA_SIDE_BY_DIRECTION = {"long": "buy", "short": "sell"}
_DIRECTION_BY_ALPACA_SIDE = {"buy": "long", "sell": "short"}


def _parse_iso(value: str | None) -> datetime | None:
    if value is None:
        return None
    # Alpaca suffixes with Z.
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _parse_iso_required(value: str | None) -> datetime:
    dt = _parse_iso(value)
    if dt is None:
        return datetime.now(timezone.utc)
    return dt


def _map_status(alpaca_status: str) -> str:
    """Map Alpaca's order status vocabulary to the BrokerOrderStatus union."""

    mapping = {
        "new": "accepted",
        "accepted": "accepted",
        "pending_new": "submitted",
        "accepted_for_bidding": "accepted",
        "partially_filled": "partially_filled",
        "filled": "filled",
        "done_for_day": "cancelled",
        "canceled": "cancelled",
        "cancelled": "cancelled",
        "expired": "expired",
        "replaced": "accepted",
        "pending_cancel": "submitted",
        "pending_replace": "submitted",
        "rejected": "rejected",
        "suspended": "rejected",
        "calculated": "submitted",
    }
    return mapping.get(alpaca_status, "submitted")


class AlpacaAdapter:
    """Concrete Alpaca paper/live adapter.

    Inject ``client`` at construction (unit tests pass a
    ``httpx.AsyncClient`` wired to a :class:`httpx.MockTransport`).
    """

    provider = "alpaca"

    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        base_url: str,
        api_key: str,
        api_secret: str,
        mode: Literal["paper", "live"] = "paper",
    ) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": api_secret,
            "Content-Type": "application/json",
        }
        self.mode = mode

    # ── internal helpers ─────────────────────────────────────────────

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        url = f"{self._base_url}{path}"
        try:
            response = await self._client.request(
                method,
                url,
                json=json,
                params=params,
                headers=self._headers,
            )
        except httpx.HTTPError as exc:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=f"{method} {path} failed: {exc!r}",
                retriable=True,
            ) from exc

        if response.status_code == 429:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=f"{method} {path} rate limited",
                retriable=True,
            )
        if 500 <= response.status_code < 600:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=f"{method} {path} returned {response.status_code}",
                retriable=True,
            )
        return response

    # ── BrokerProtocol ───────────────────────────────────────────────

    async def submit_order(
        self, request: BrokerSubmitRequest
    ) -> BrokerSubmitResult:
        payload: dict[str, Any] = {
            "client_order_id": request.client_order_id,
            "symbol": request.symbol,
            "side": _ALPACA_SIDE_BY_DIRECTION[request.direction],
            "qty": f"{request.qty}",
            "time_in_force": request.time_in_force,
        }
        if request.order_type == "bracket":
            payload["type"] = "market"
            payload["order_class"] = "bracket"
            if request.take_profit is not None:
                payload["take_profit"] = {"limit_price": f"{request.take_profit}"}
            if request.stop_loss is not None:
                payload["stop_loss"] = {"stop_price": f"{request.stop_loss}"}
        else:
            payload["type"] = request.order_type
            if request.limit_price is not None:
                payload["limit_price"] = f"{request.limit_price}"
            if request.stop_price is not None:
                payload["stop_price"] = f"{request.stop_price}"

        response = await self._request("POST", "/v2/orders", json=payload)

        if response.status_code == 422 or response.status_code == 400:
            data = self._safe_json(response)
            raise BrokerUnavailable(
                provider=self.provider,
                reason=(
                    f"order rejected: {data.get('message', response.text)}"
                ),
                retriable=False,
            )
        if response.status_code == 409:
            # Duplicate client_order_id — idempotent ack.
            data = self._safe_json(response)
            existing = data.get("existing_order_id") or data.get("id")
            return BrokerSubmitResult(
                client_order_id=request.client_order_id,
                broker_order_id=str(existing or ""),
                status="accepted",
                submitted_at=_parse_iso_required(data.get("submitted_at")),
                raw=data,
            )
        if response.status_code >= 400:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=f"POST /v2/orders returned {response.status_code}",
                retriable=False,
            )

        data = self._safe_json(response)
        return BrokerSubmitResult(
            client_order_id=request.client_order_id,
            broker_order_id=str(data.get("id", "")),
            status=_map_status(data.get("status", "new")),  # type: ignore[arg-type]
            submitted_at=_parse_iso_required(data.get("submitted_at")),
            raw=data,
        )

    async def cancel_order(self, *, client_order_id: str) -> None:
        response = await self._request(
            "DELETE",
            "/v2/orders:by_client_order_id",
            params={"client_order_id": client_order_id},
        )
        if response.status_code == 404:
            return  # already gone — treat as cancelled
        if response.status_code >= 400:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=(
                    f"DELETE /v2/orders:by_client_order_id returned "
                    f"{response.status_code}"
                ),
                retriable=False,
            )

    async def get_fill(
        self, *, client_order_id: str
    ) -> BrokerFillDto | None:
        response = await self._request(
            "GET",
            "/v2/orders:by_client_order_id",
            params={"client_order_id": client_order_id},
        )
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=(
                    f"GET /v2/orders:by_client_order_id returned "
                    f"{response.status_code}"
                ),
                retriable=False,
            )

        data = self._safe_json(response)
        filled_qty = float(data.get("filled_qty") or 0.0)
        avg_price = data.get("filled_avg_price")
        return BrokerFillDto(
            client_order_id=client_order_id,
            broker_order_id=str(data.get("id", "")),
            symbol=str(data.get("symbol", "")),
            direction=_DIRECTION_BY_ALPACA_SIDE.get(
                data.get("side", "buy"), "long"  # type: ignore[arg-type]
            ),  # type: ignore[arg-type]
            filled_qty=filled_qty,
            avg_fill_price=float(avg_price) if avg_price is not None else None,
            status=_map_status(data.get("status", "new")),  # type: ignore[arg-type]
            commission=0.0,  # Alpaca is commission-free on equities
            slippage=None,
            observed_at=_parse_iso_required(
                data.get("filled_at") or data.get("updated_at")
            ),
        )

    async def list_fills(
        self,
        *,
        symbol: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 100,
    ) -> list[BrokerFillDto]:
        params: dict[str, Any] = {
            "activity_types": "FILL",
            "page_size": min(max(limit, 1), 100),
        }
        if since is not None:
            params["after"] = since.isoformat()
        if until is not None:
            params["until"] = until.isoformat()

        response = await self._request(
            "GET", "/v2/account/activities/FILL", params=params
        )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=(
                    f"GET /v2/account/activities/FILL returned "
                    f"{response.status_code}"
                ),
                retriable=False,
            )

        rows = self._safe_json(response)
        if not isinstance(rows, list):
            return []

        out: list[BrokerFillDto] = []
        for row in rows:
            row_symbol = str(row.get("symbol", ""))
            if symbol is not None and row_symbol != symbol:
                continue
            qty = float(row.get("qty") or 0.0)
            price = row.get("price")
            out.append(
                BrokerFillDto(
                    client_order_id=str(row.get("order_id") or ""),
                    broker_order_id=str(row.get("order_id") or ""),
                    symbol=row_symbol,
                    direction=_DIRECTION_BY_ALPACA_SIDE.get(
                        row.get("side", "buy"), "long"  # type: ignore[arg-type]
                    ),  # type: ignore[arg-type]
                    filled_qty=qty,
                    avg_fill_price=float(price) if price is not None else None,
                    status="filled",
                    commission=0.0,
                    slippage=None,
                    observed_at=_parse_iso_required(
                        row.get("transaction_time") or row.get("activity_time")
                    ),
                )
            )
        return out[:limit]

    async def list_positions(
        self, *, symbol: str | None = None
    ) -> list[BrokerPositionDto]:
        response = await self._request("GET", "/v2/positions")
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=(
                    f"GET /v2/positions returned {response.status_code}"
                ),
                retriable=False,
            )

        rows = self._safe_json(response)
        if not isinstance(rows, list):
            return []

        out: list[BrokerPositionDto] = []
        for row in rows:
            row_symbol = str(row.get("symbol", ""))
            if symbol is not None and row_symbol != symbol:
                continue
            qty_str = row.get("qty") or "0"
            qty = float(qty_str)
            direction: Literal["long", "short"] = (
                "long" if qty >= 0 else "short"
            )
            out.append(
                BrokerPositionDto(
                    symbol=row_symbol,
                    direction=direction,
                    qty=abs(qty),
                    avg_entry_price=float(row.get("avg_entry_price") or 0.0),
                    mark_price=float(
                        row.get("current_price") or row.get("avg_entry_price") or 0.0
                    ),
                    unrealized_pnl=float(row.get("unrealized_pl") or 0.0),
                )
            )
        return out

    async def get_equity(self) -> BrokerEquityDto:
        response = await self._request("GET", "/v2/account")
        if response.status_code >= 400:
            raise BrokerUnavailable(
                provider=self.provider,
                reason=f"GET /v2/account returned {response.status_code}",
                retriable=False,
            )

        data = self._safe_json(response)
        return BrokerEquityDto(
            total_equity=float(data.get("equity") or 0.0),
            start_of_day_equity=float(
                data.get("last_equity") or data.get("equity") or 0.0
            ),
            realized_pnl=0.0,  # Alpaca's account endpoint doesn't split this
            unrealized_pnl=0.0,
            margin_used=float(data.get("initial_margin") or 0.0),
            buying_power=float(data.get("buying_power") or 0.0),
            observed_at=datetime.now(timezone.utc),
        )

    # ── util ─────────────────────────────────────────────────────────

    @staticmethod
    def _safe_json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            return {}


__all__ = ["AlpacaAdapter"]
