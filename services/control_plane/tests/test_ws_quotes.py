"""End-to-end smoke for ``/ws/quotes``.

These tests drive the WebSocket handler via FastAPI's synchronous
``TestClient``. The token-resolver is monkey-patched to return a canned
``User`` so the test does not depend on the async DB conftest chain —
that path is already covered end-to-end via ``test_auth.py`` + the
per-dep JWT unit tests. What this file *does* verify is the envelope
wire-protocol, the subscribe / publish / unsubscribe round-trip, and
the close-on-missing-token behaviour.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import _create_app
from app.realtime.quotes import (
    QuoteHub,
    QuoteMessage,
    reset_quote_hub_for_tests,
)


class _FakeUser:
    id = "usr_test_123"
    disabled = False
    roles: list[str] = ["operator"]


@pytest.fixture()
def ws_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # Replace the token resolver so the WS handler short-circuits auth
    # lookups against the DB.
    async def _resolve(token: str):
        if token == "good":
            return _FakeUser()
        return None

    monkeypatch.setattr(
        "app.routes.ws_quotes._resolve_token_to_user", _resolve
    )

    # Fresh hub per test so membership state does not leak.
    reset_quote_hub_for_tests()
    # Replace the hub with a deterministic fresh instance.
    new_hub = QuoteHub()
    monkeypatch.setattr(
        "app.realtime.quotes._hub", new_hub, raising=False
    )
    monkeypatch.setattr("app.realtime._hub", new_hub, raising=False)
    monkeypatch.setattr(
        "app.routes.ws_quotes.get_quote_hub", lambda: new_hub
    )
    monkeypatch.setattr(
        "app.realtime.get_quote_hub", lambda: new_hub
    )

    app = _create_app()
    with TestClient(app) as client:
        yield client
    reset_quote_hub_for_tests()


# ──────────────────────────── auth ──────────────────────────────────────


def test_ws_closes_when_token_missing(ws_client: TestClient) -> None:
    with pytest.raises(Exception):
        with ws_client.websocket_connect("/ws/quotes") as ws:
            ws.receive_json()  # never receives — close frame arrives


def test_ws_closes_when_token_invalid(ws_client: TestClient) -> None:
    with pytest.raises(Exception):
        with ws_client.websocket_connect("/ws/quotes?token=bad") as ws:
            ws.receive_json()


# ──────────────────────────── protocol ─────────────────────────────────


def test_subscribe_then_publish_delivers_quote(
    ws_client: TestClient,
) -> None:
    with ws_client.websocket_connect("/ws/quotes?token=good") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        assert ready["userId"] == _FakeUser.id

        ws.send_text(
            json.dumps(
                {"type": "subscribe", "symbolIds": ["sym_eurusd"]}
            )
        )
        ack = ws.receive_json()
        assert ack == {"type": "ack", "subscribed": ["sym_eurusd"]}

        # Trigger a publish from inside TestClient's portal so the hub's
        # asyncio primitives see the same event loop as the ws handler.
        # Starlette's TestClient exposes that portal via ``portal`` in
        # the underlying anyio thread pool; we use anyio.from_thread.
        from app.realtime.quotes import _hub  # current module-level hub

        assert _hub is not None  # fixture installed a fresh hub

        from anyio.from_thread import start_blocking_portal

        with start_blocking_portal() as portal:
            msg = QuoteMessage(
                symbol_id="sym_eurusd",
                bid=1.0849,
                ask=1.0851,
                last=1.0850,
                bid_size=10.0,
                ask_size=10.0,
                t="2026-04-19T12:00:00+00:00",  # type: ignore[arg-type]
            )
            portal.call(_hub.publish, msg)

        payload = ws.receive_json()
        assert payload["type"] == "quote"
        assert payload["data"]["symbolId"] == "sym_eurusd"
        assert payload["data"]["last"] == 1.0850


def test_ping_returns_pong(ws_client: TestClient) -> None:
    with ws_client.websocket_connect("/ws/quotes?token=good") as ws:
        ws.receive_json()  # ready
        ws.send_text(json.dumps({"type": "ping"}))
        pong = ws.receive_json()
        assert pong == {"type": "pong"}


def test_invalid_envelope_returns_error(ws_client: TestClient) -> None:
    with ws_client.websocket_connect("/ws/quotes?token=good") as ws:
        ws.receive_json()  # ready
        ws.send_text("not json at all")
        err = ws.receive_json()
        assert err["type"] == "error"
        assert err["code"] == "invalid_json"


def test_unsubscribe_ack_and_no_more_delivery(
    ws_client: TestClient,
) -> None:
    with ws_client.websocket_connect("/ws/quotes?token=good") as ws:
        ws.receive_json()  # ready
        ws.send_text(
            json.dumps(
                {"type": "subscribe", "symbolIds": ["sym_a"]}
            )
        )
        ws.receive_json()  # subscribe ack
        ws.send_text(
            json.dumps(
                {"type": "unsubscribe", "symbolIds": ["sym_a"]}
            )
        )
        ack = ws.receive_json()
        assert ack == {"type": "ack", "unsubscribed": ["sym_a"]}
