"""Adapter contract tests for ``app.broker.alpaca.AlpacaAdapter``.

The tests mount an ``httpx.MockTransport`` so the adapter talks to an
in-process mock of Alpaca's REST surface. Each test exercises one
BrokerProtocol method end-to-end — request envelope shape, response
parsing, and error fan-out into :class:`BrokerUnavailable`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
import pytest

from app.broker.alpaca import AlpacaAdapter
from app.broker.base import BrokerSubmitRequest, BrokerUnavailable


API_KEY = "AKXXXXXXXXXXX"
API_SECRET = "secret-value-0123456789"
BASE_URL = "https://paper-api.alpaca.markets"


def _make_adapter(
    handler: httpx.MockTransport,
) -> tuple[AlpacaAdapter, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=handler)
    adapter = AlpacaAdapter(
        client=client,
        base_url=BASE_URL,
        api_key=API_KEY,
        api_secret=API_SECRET,
        mode="paper",
    )
    return adapter, client


@pytest.mark.asyncio
async def test_submit_order_accepted() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["headers"] = dict(request.headers)
        captured["json"] = _safe_json(request.content)
        return httpx.Response(
            200,
            json={
                "id": "ord_abc123",
                "client_order_id": "cli_xyz",
                "status": "new",
                "submitted_at": "2026-04-19T10:00:00Z",
                "symbol": "AAPL",
                "side": "buy",
                "qty": "10",
                "filled_qty": "0",
            },
        )

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        result = await adapter.submit_order(
            BrokerSubmitRequest(
                client_order_id="cli_xyz",
                symbol="AAPL",
                direction="long",
                qty=10.0,
                order_type="bracket",
                time_in_force="day",
                take_profit=180.50,
                stop_loss=170.25,
            )
        )
    finally:
        await client.aclose()

    assert result.broker_order_id == "ord_abc123"
    assert result.status == "accepted"
    assert captured["url"] == f"{BASE_URL}/v2/orders"
    assert captured["method"] == "POST"
    assert captured["headers"].get("apca-api-key-id") == API_KEY
    assert captured["headers"].get("apca-api-secret-key") == API_SECRET
    assert captured["json"]["order_class"] == "bracket"
    assert captured["json"]["take_profit"] == {"limit_price": "180.5"}
    assert captured["json"]["stop_loss"] == {"stop_price": "170.25"}
    assert captured["json"]["side"] == "buy"


@pytest.mark.asyncio
async def test_submit_order_duplicate_ack_is_idempotent() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "existing_order_id": "ord_prev",
                "submitted_at": "2026-04-19T10:00:00Z",
            },
        )

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        result = await adapter.submit_order(
            BrokerSubmitRequest(
                client_order_id="cli_dupe",
                symbol="AAPL",
                direction="long",
                qty=1.0,
                order_type="market",
            )
        )
    finally:
        await client.aclose()

    assert result.broker_order_id == "ord_prev"
    assert result.status == "accepted"


@pytest.mark.asyncio
async def test_submit_order_rejected_by_broker_raises_nonretriable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422, json={"message": "insufficient buying power"}
        )

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        with pytest.raises(BrokerUnavailable) as exc_info:
            await adapter.submit_order(
                BrokerSubmitRequest(
                    client_order_id="cli_rej",
                    symbol="AAPL",
                    direction="long",
                    qty=1.0,
                    order_type="market",
                )
            )
    finally:
        await client.aclose()

    assert exc_info.value.retriable is False
    assert "insufficient buying power" in exc_info.value.reason


@pytest.mark.asyncio
async def test_submit_order_network_failure_raises_retriable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        with pytest.raises(BrokerUnavailable) as exc_info:
            await adapter.submit_order(
                BrokerSubmitRequest(
                    client_order_id="cli_net",
                    symbol="AAPL",
                    direction="long",
                    qty=1.0,
                    order_type="market",
                )
            )
    finally:
        await client.aclose()

    assert exc_info.value.retriable is True


@pytest.mark.asyncio
async def test_submit_order_5xx_is_retriable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream unavailable")

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        with pytest.raises(BrokerUnavailable) as exc_info:
            await adapter.submit_order(
                BrokerSubmitRequest(
                    client_order_id="cli_5xx",
                    symbol="AAPL",
                    direction="long",
                    qty=1.0,
                    order_type="market",
                )
            )
    finally:
        await client.aclose()

    assert exc_info.value.retriable is True


@pytest.mark.asyncio
async def test_cancel_order_idempotent_on_404() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.method + " " + str(request.url))
        return httpx.Response(404, json={"message": "not found"})

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        # 404 must NOT raise — the order is already gone, which is what
        # cancel was trying to accomplish anyway.
        await adapter.cancel_order(client_order_id="cli_missing")
    finally:
        await client.aclose()

    assert len(calls) == 1
    assert calls[0].startswith("DELETE ")


@pytest.mark.asyncio
async def test_get_fill_returns_parsed_fill() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(
            200,
            json={
                "id": "ord_filled",
                "symbol": "MSFT",
                "side": "sell",
                "status": "filled",
                "filled_qty": "5",
                "filled_avg_price": "412.10",
                "filled_at": "2026-04-19T11:00:00Z",
            },
        )

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        fill = await adapter.get_fill(client_order_id="cli_filled")
    finally:
        await client.aclose()

    assert fill is not None
    assert fill.broker_order_id == "ord_filled"
    assert fill.symbol == "MSFT"
    assert fill.direction == "short"
    assert fill.filled_qty == 5.0
    assert fill.avg_fill_price == 412.10
    assert fill.status == "filled"


@pytest.mark.asyncio
async def test_get_fill_404_returns_none() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        fill = await adapter.get_fill(client_order_id="cli_nope")
    finally:
        await client.aclose()

    assert fill is None


@pytest.mark.asyncio
async def test_list_fills_filters_by_symbol_and_caps_limit() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "order_id": "ord_a",
                    "symbol": "AAPL",
                    "side": "buy",
                    "qty": "2",
                    "price": "180.00",
                    "transaction_time": "2026-04-19T09:30:00Z",
                },
                {
                    "order_id": "ord_b",
                    "symbol": "MSFT",
                    "side": "buy",
                    "qty": "3",
                    "price": "410.00",
                    "transaction_time": "2026-04-19T09:31:00Z",
                },
            ],
        )

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        rows = await adapter.list_fills(symbol="AAPL", limit=5)
    finally:
        await client.aclose()

    assert len(rows) == 1
    assert rows[0].symbol == "AAPL"
    assert rows[0].filled_qty == 2.0


@pytest.mark.asyncio
async def test_list_positions_parses_direction_from_signed_qty() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "symbol": "AAPL",
                    "qty": "10",
                    "avg_entry_price": "175.50",
                    "current_price": "180.00",
                    "unrealized_pl": "45.00",
                },
                {
                    "symbol": "TSLA",
                    "qty": "-5",
                    "avg_entry_price": "250.00",
                    "current_price": "245.00",
                    "unrealized_pl": "25.00",
                },
            ],
        )

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        rows = await adapter.list_positions()
    finally:
        await client.aclose()

    by_symbol = {p.symbol: p for p in rows}
    assert by_symbol["AAPL"].direction == "long"
    assert by_symbol["AAPL"].qty == 10.0
    assert by_symbol["TSLA"].direction == "short"
    assert by_symbol["TSLA"].qty == 5.0  # absolute value


@pytest.mark.asyncio
async def test_get_equity_parses_account_snapshot() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url).endswith("/v2/account")
        return httpx.Response(
            200,
            json={
                "equity": "125000.00",
                "last_equity": "120000.00",
                "initial_margin": "5000.00",
                "buying_power": "500000.00",
            },
        )

    adapter, client = _make_adapter(httpx.MockTransport(handler))
    try:
        snap = await adapter.get_equity()
    finally:
        await client.aclose()

    assert snap.total_equity == 125000.00
    assert snap.start_of_day_equity == 120000.00
    assert snap.margin_used == 5000.00
    assert snap.buying_power == 500000.00


def _safe_json(payload: bytes) -> Any:
    import json

    try:
        return json.loads(payload)
    except ValueError:
        return None
