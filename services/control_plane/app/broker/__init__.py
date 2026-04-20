"""Broker adapter layer — the pluggable integration seam.

A broker adapter wraps one downstream broker's REST/WebSocket surface
in the ``BrokerProtocol`` shape so the live execution gate can stay
broker-agnostic. The Phase 4 launch ships one concrete adapter:

  * ``app.broker.alpaca.AlpacaAdapter`` — Alpaca paper + live

The module also exposes:

  * ``BrokerProtocol``   — the abstract interface every adapter implements
  * ``BrokerRegistry``   — the per-process registry keyed by adapter id
  * ``BrokerUnavailable`` — raised when the adapter cannot reach the broker

Route-layer code MUST go through ``BrokerRegistry.get(account_id)`` —
never instantiate an adapter directly. Tests can register a
``FakeAdapter`` that records every call and returns pre-seeded fills.
"""

from app.broker.base import (
    BrokerProtocol,
    BrokerRegistry,
    BrokerSubmitResult,
    BrokerUnavailable,
    broker_registry,
)
from app.broker.fake import FakeAdapter

__all__ = [
    "BrokerProtocol",
    "BrokerRegistry",
    "BrokerSubmitResult",
    "BrokerUnavailable",
    "FakeAdapter",
    "broker_registry",
]
