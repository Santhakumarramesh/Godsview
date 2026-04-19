"""Pure-function tests for the QuoteHub fan-out.

These tests construct a fresh ``QuoteHub`` directly so they don't
require the FastAPI singleton machinery and so they can run on any
Python version supported by the test sandbox.

Subscribers are recorded via the ``_FakeSub`` adapter which stores
every message in an in-memory list. The ``failing_after`` slot lets
tests simulate a misbehaving client whose ``send_json`` starts
raising — the hub must evict it.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import pytest

from app.realtime.quotes import QuoteHub, QuoteMessage

UTC = timezone.utc


class _FakeSub:
    def __init__(self, conn_id: str, *, fail_after: int | None = None) -> None:
        self.connection_id = conn_id
        self.received: list[dict[str, Any]] = []
        self._fail_after = fail_after

    async def send_json(self, msg: dict[str, Any]) -> None:
        if (
            self._fail_after is not None
            and len(self.received) >= self._fail_after
        ):
            raise RuntimeError("simulated socket failure")
        self.received.append(msg)


def _quote(sym: str = "sym_eurusd", *, last: float = 1.085) -> QuoteMessage:
    return QuoteMessage(
        symbol_id=sym,
        bid=last - 0.0001,
        ask=last + 0.0001,
        last=last,
        bid_size=10.0,
        ask_size=10.0,
        t=datetime(2026, 4, 19, 12, 0, 0, tzinfo=UTC),
    )


# ────────────────────────── subscribe / publish ─────────────────────────


@pytest.mark.asyncio
async def test_subscribe_then_publish_delivers_to_one_socket() -> None:
    hub = QuoteHub()
    s = _FakeSub("c1")
    await hub.subscribe(s, ["sym_eurusd"])
    delivered = await hub.publish(_quote("sym_eurusd", last=1.0850))
    assert delivered == 1
    assert len(s.received) == 1
    assert s.received[0]["type"] == "quote"
    assert s.received[0]["data"]["symbolId"] == "sym_eurusd"
    assert s.received[0]["data"]["last"] == 1.0850


@pytest.mark.asyncio
async def test_publish_to_no_subscribers_returns_zero() -> None:
    hub = QuoteHub()
    delivered = await hub.publish(_quote("sym_btcusd"))
    assert delivered == 0


@pytest.mark.asyncio
async def test_subscribe_dedupes_same_symbol_for_same_connection() -> None:
    hub = QuoteHub()
    s = _FakeSub("c1")
    added1 = await hub.subscribe(s, ["sym_eurusd", "sym_eurusd"])
    added2 = await hub.subscribe(s, ["sym_eurusd"])
    assert added1 == ["sym_eurusd"]
    assert added2 == ["sym_eurusd"]
    assert hub.subscriber_count("sym_eurusd") == 1


@pytest.mark.asyncio
async def test_publish_fans_out_to_every_subscriber() -> None:
    hub = QuoteHub()
    a, b, c = _FakeSub("a"), _FakeSub("b"), _FakeSub("c")
    await hub.subscribe(a, ["sym_eurusd"])
    await hub.subscribe(b, ["sym_eurusd"])
    await hub.subscribe(c, ["sym_btcusd"])  # different symbol
    delivered = await hub.publish(_quote("sym_eurusd"))
    assert delivered == 2
    assert len(a.received) == 1
    assert len(b.received) == 1
    assert len(c.received) == 0


# ────────────────────────── unsubscribe paths ───────────────────────────


@pytest.mark.asyncio
async def test_unsubscribe_removes_only_named_symbols() -> None:
    hub = QuoteHub()
    s = _FakeSub("c1")
    await hub.subscribe(s, ["sym_eurusd", "sym_btcusd"])
    removed = await hub.unsubscribe(s, ["sym_eurusd"])
    assert removed == ["sym_eurusd"]
    assert hub.subscriber_count("sym_eurusd") == 0
    assert hub.subscriber_count("sym_btcusd") == 1
    # Still receives btc fan-out.
    delivered = await hub.publish(_quote("sym_btcusd", last=70000.0))
    assert delivered == 1


@pytest.mark.asyncio
async def test_unsubscribe_unknown_symbol_is_noop() -> None:
    hub = QuoteHub()
    s = _FakeSub("c1")
    await hub.subscribe(s, ["sym_eurusd"])
    removed = await hub.unsubscribe(s, ["sym_does_not_exist"])
    assert removed == []
    assert hub.subscriber_count("sym_eurusd") == 1


@pytest.mark.asyncio
async def test_unsubscribe_all_clears_every_symbol() -> None:
    hub = QuoteHub()
    s = _FakeSub("c1")
    await hub.subscribe(s, ["sym_a", "sym_b", "sym_c"])
    count = await hub.unsubscribe_all(s)
    assert count == 3
    assert hub.known_symbols() == []
    assert hub.symbols_for(s) == set()


@pytest.mark.asyncio
async def test_subscribe_empty_list_is_noop() -> None:
    hub = QuoteHub()
    s = _FakeSub("c1")
    added = await hub.subscribe(s, [])
    assert added == []
    assert hub.symbols_for(s) == set()


# ────────────────────────── failure handling ────────────────────────────


@pytest.mark.asyncio
async def test_failing_subscriber_is_evicted_on_publish() -> None:
    """When ``send_json`` raises the hub must drop the subscriber so a
    follow-up publish doesn't re-attempt the same broken socket."""

    hub = QuoteHub()
    healthy = _FakeSub("ok")
    broken = _FakeSub("bad", fail_after=0)
    await hub.subscribe(healthy, ["sym_eurusd"])
    await hub.subscribe(broken, ["sym_eurusd"])

    delivered_first = await hub.publish(_quote("sym_eurusd"))
    # Healthy got it; broken raised, was evicted.
    assert delivered_first == 1
    assert len(healthy.received) == 1
    assert hub.subscriber_count("sym_eurusd") == 1

    delivered_second = await hub.publish(_quote("sym_eurusd"))
    assert delivered_second == 1
    assert len(healthy.received) == 2


# ────────────────────────── concurrency safety ──────────────────────────


@pytest.mark.asyncio
async def test_concurrent_subscribe_unsubscribe_is_consistent() -> None:
    """Run many parallel mutators and assert the membership map ends
    in a state that matches the *last* operation per (sub, symbol)."""

    hub = QuoteHub()
    subs = [_FakeSub(f"c{i}") for i in range(20)]
    sym = "sym_eurusd"

    async def churn(s: _FakeSub) -> None:
        await hub.subscribe(s, [sym])
        await hub.unsubscribe(s, [sym])
        await hub.subscribe(s, [sym])

    await asyncio.gather(*(churn(s) for s in subs))
    assert hub.subscriber_count(sym) == len(subs)
    delivered = await hub.publish(_quote(sym))
    assert delivered == len(subs)


# ────────────────────────── wire shape ─────────────────────────────────


def test_quote_message_to_wire_is_camelcase() -> None:
    msg = QuoteMessage(
        symbol_id="sym_x",
        bid=1.0,
        ask=2.0,
        last=1.5,
        bid_size=3.0,
        ask_size=4.0,
        t=datetime(2026, 4, 19, 12, 0, 0, tzinfo=UTC),
    )
    wire = msg.to_wire()
    assert set(wire.keys()) == {
        "symbolId",
        "bid",
        "ask",
        "last",
        "bidSize",
        "askSize",
        "t",
    }
    assert wire["symbolId"] == "sym_x"
    assert wire["bidSize"] == 3.0
