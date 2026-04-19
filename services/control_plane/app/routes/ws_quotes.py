"""``/ws/quotes`` — authenticated live quote WebSocket bridge.

Wire protocol
-------------

Authentication
~~~~~~~~~~~~~~
The client must present a valid Phase 1 access token in one of:

  * ``Authorization: Bearer <token>`` header (preferred)
  * ``?token=<token>`` query string (fallback, e.g. browser
    ``new WebSocket(url)`` cannot set headers)

If the token is missing or invalid the server closes the socket with
``4401`` (auth failure). A disabled or unknown user closes with
``4403``.

Client → Server
~~~~~~~~~~~~~~~
JSON messages, one envelope per frame::

    {"type": "subscribe",   "symbolIds": ["sym_eurusd", "sym_btcusd"]}
    {"type": "unsubscribe", "symbolIds": ["sym_btcusd"]}
    {"type": "ping"}

Server → Client
~~~~~~~~~~~~~~~
::

    {"type": "ack",   "subscribed":   ["sym_eurusd", "sym_btcusd"]}
    {"type": "ack",   "unsubscribed": ["sym_btcusd"]}
    {"type": "pong"}
    {"type": "quote", "data": {Quote}}                      # fan-out
    {"type": "error", "code": "...", "message": "..."}      # malformed

Lifecycle
~~~~~~~~~
On disconnect the socket is removed from every symbol it was
subscribed to via :meth:`QuoteHub.unsubscribe_all` so memory cannot
leak. There is no broadcast on disconnect.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Query, WebSocket, status
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.config import get_settings
from app.db import get_session_factory
from app.models import User
from app.realtime import QuoteHub, QuoteSubscriber, get_quote_hub
from app.security import verify_token

router = APIRouter(tags=["realtime"])


_CLOSE_AUTH = 4401
_CLOSE_FORBIDDEN = 4403
_CLOSE_PROTOCOL = 4400


# ─────────────────────────── helpers ─────────────────────────────────


def _bearer_from_header(authorization: str | None) -> str | None:
    if not authorization:
        return None
    if not authorization.lower().startswith("bearer "):
        return None
    return authorization.split(" ", 1)[1].strip() or None


async def _resolve_token_to_user(token: str) -> User | None:
    """Verify a JWT and load the user; ``None`` on any failure."""
    settings = get_settings()
    try:
        payload = verify_token(
            settings=settings, token=token, expected_type="access"
        )
    except ValueError:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    factory = get_session_factory()
    async with factory() as session:
        user = await session.scalar(select(User).where(User.id == user_id))
        if user is None or user.disabled:
            return None
        return user


class _WsQuoteSubscriber:
    """Adapter wrapping a Starlette ``WebSocket`` to the hub's subscriber protocol."""

    __slots__ = ("connection_id", "_ws")

    def __init__(self, ws: WebSocket) -> None:
        self.connection_id = f"wsq_{uuid.uuid4().hex}"
        self._ws = ws

    async def send_json(self, msg: dict[str, Any]) -> None:
        await self._ws.send_text(json.dumps(msg, separators=(",", ":")))


# ─────────────────────────── route ───────────────────────────────────


@router.websocket("/ws/quotes")
async def ws_quotes(
    websocket: WebSocket,
    token: str | None = Query(None),
) -> None:
    # Accept first so we can issue a structured close frame on auth
    # failure. Browsers close immediately on a 401 handshake reject and
    # never deliver the close code, so we surface the failure as a
    # post-accept close instead.
    await websocket.accept()

    auth_header = websocket.headers.get("authorization")
    bearer = _bearer_from_header(auth_header) or token
    if not bearer:
        await websocket.close(code=_CLOSE_AUTH, reason="missing token")
        return
    user = await _resolve_token_to_user(bearer)
    if user is None:
        await websocket.close(code=_CLOSE_AUTH, reason="invalid token")
        return

    hub: QuoteHub = get_quote_hub()
    sub: QuoteSubscriber = _WsQuoteSubscriber(websocket)
    await sub.send_json({"type": "ready", "userId": user.id})
    try:
        await _serve(websocket, hub, sub)
    except WebSocketDisconnect:
        pass
    finally:
        await hub.unsubscribe_all(sub)
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.close()


async def _serve(
    websocket: WebSocket, hub: QuoteHub, sub: QuoteSubscriber
) -> None:
    """Drive the per-frame command loop until the client disconnects."""
    while True:
        raw = await websocket.receive_text()
        try:
            envelope = json.loads(raw)
        except json.JSONDecodeError:
            await sub.send_json(
                {
                    "type": "error",
                    "code": "invalid_json",
                    "message": "frame is not valid JSON",
                }
            )
            continue
        if not isinstance(envelope, dict):
            await sub.send_json(
                {
                    "type": "error",
                    "code": "invalid_envelope",
                    "message": "expected an object envelope",
                }
            )
            continue
        kind = envelope.get("type")
        if kind == "ping":
            await sub.send_json({"type": "pong"})
        elif kind == "subscribe":
            symbol_ids = envelope.get("symbolIds")
            if not isinstance(symbol_ids, list):
                await sub.send_json(
                    {
                        "type": "error",
                        "code": "invalid_payload",
                        "message": "symbolIds must be a list",
                    }
                )
                continue
            added = await hub.subscribe(sub, [str(s) for s in symbol_ids])
            await sub.send_json({"type": "ack", "subscribed": added})
        elif kind == "unsubscribe":
            symbol_ids = envelope.get("symbolIds")
            if not isinstance(symbol_ids, list):
                await sub.send_json(
                    {
                        "type": "error",
                        "code": "invalid_payload",
                        "message": "symbolIds must be a list",
                    }
                )
                continue
            removed = await hub.unsubscribe(
                sub, [str(s) for s in symbol_ids]
            )
            await sub.send_json({"type": "ack", "unsubscribed": removed})
        else:
            await sub.send_json(
                {
                    "type": "error",
                    "code": "unknown_type",
                    "message": f"unsupported envelope type: {kind!r}",
                }
            )
