from __future__ import annotations

from typing import Any

from app.config import settings


def _get_trading_client():
    if not settings.has_alpaca_keys:
        raise RuntimeError(
            "Missing Alpaca credentials. Set ALPACA_API_KEY and ALPACA_SECRET_KEY."
        )

    from alpaca.trading.client import TradingClient

    return TradingClient(
        api_key=settings.alpaca_api_key,
        secret_key=settings.alpaca_secret_key,
        paper=settings.alpaca_paper,
    )


def get_account() -> Any:
    client = _get_trading_client()
    return client.get_account()


def place_market_order(symbol: str, qty: int, side: str) -> Any:
    if qty <= 0:
        raise ValueError("Order quantity must be greater than zero.")
    if side.lower() not in {"buy", "sell"}:
        raise ValueError(f"Invalid order side: {side}")

    from alpaca.trading.enums import OrderSide, TimeInForce
    from alpaca.trading.requests import MarketOrderRequest

    client = _get_trading_client()
    order = MarketOrderRequest(
        symbol=symbol,
        qty=qty,
        side=OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL,
        time_in_force=TimeInForce.DAY,
    )
    return client.submit_order(order_data=order)
