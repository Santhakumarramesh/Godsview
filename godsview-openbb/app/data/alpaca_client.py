from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.broker import get_account
from app.config import settings
from app.data.cache import cached


def get_alpaca_execution_context() -> dict[str, Any]:
    def _load() -> dict[str, Any]:
        if not settings.has_alpaca_keys:
            return {
                "available": False,
                "source": "alpaca",
                "reason": "missing_alpaca_credentials",
                "paper": settings.alpaca_paper,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        try:
            account = get_account()
            equity = float(getattr(account, "equity", 0.0))
            buying_power = float(getattr(account, "buying_power", 0.0))
            status = str(getattr(account, "status", "unknown"))
            return {
                "available": True,
                "source": "alpaca",
                "reason": "ok",
                "paper": settings.alpaca_paper,
                "status": status,
                "equity": equity,
                "buying_power": buying_power,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as err:  # noqa: BLE001
            return {
                "available": False,
                "source": "alpaca",
                "reason": f"account_fetch_error:{err}",
                "paper": settings.alpaca_paper,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

    return cached("alpaca:execution_context", ttl_seconds=20, loader=_load)

