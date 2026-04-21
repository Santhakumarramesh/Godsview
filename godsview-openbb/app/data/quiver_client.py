from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests

from app.config import settings
from app.data.cache import cached


def _parse_transaction_bias(rows: list[dict[str, Any]]) -> dict[str, Any]:
    buy = 0
    sell = 0
    for row in rows:
        tx = str(row.get("Transaction", row.get("transaction", ""))).lower()
        if "buy" in tx or "purchase" in tx:
            buy += 1
        elif "sell" in tx:
            sell += 1
    total = buy + sell
    score = 0.0 if total == 0 else (buy - sell) / total
    return {
        "buy_count": buy,
        "sell_count": sell,
        "total": total,
        "bias_score": round(float(score), 6),
    }


def get_quiver_snapshot(symbol: str) -> dict[str, Any]:
    ticker = symbol.upper().replace("/", "")
    cache_key = f"quiver:snapshot:{ticker}"

    def _load() -> dict[str, Any]:
        if not settings.quiver_api_key:
            return {
                "available": False,
                "source": "quiver",
                "reason": "missing_quiver_api_key",
                "symbol": ticker,
                "insider": {},
                "congress": {},
                "smart_money_score": 0.0,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        headers = {"accept": "application/json", "Authorization": f"Bearer {settings.quiver_api_key}"}
        # Quiver API routes can vary by account tier; these are best-effort endpoints.
        insider_url = f"https://api.quiverquant.com/beta/live/insiders/{ticker}"
        congress_url = f"https://api.quiverquant.com/beta/live/congresstrading/{ticker}"

        insider_rows: list[dict[str, Any]] = []
        congress_rows: list[dict[str, Any]] = []
        errors: list[str] = []
        try:
            insider_resp = requests.get(insider_url, headers=headers, timeout=8)
            if insider_resp.status_code == 200:
                payload = insider_resp.json()
                if isinstance(payload, list):
                    insider_rows = [row for row in payload if isinstance(row, dict)]
            else:
                errors.append(f"insider_http_{insider_resp.status_code}")
        except Exception as err:  # noqa: BLE001
            errors.append(f"insider_error:{err}")

        try:
            congress_resp = requests.get(congress_url, headers=headers, timeout=8)
            if congress_resp.status_code == 200:
                payload = congress_resp.json()
                if isinstance(payload, list):
                    congress_rows = [row for row in payload if isinstance(row, dict)]
            else:
                errors.append(f"congress_http_{congress_resp.status_code}")
        except Exception as err:  # noqa: BLE001
            errors.append(f"congress_error:{err}")

        insider_bias = _parse_transaction_bias(insider_rows)
        congress_bias = _parse_transaction_bias(congress_rows)
        smart_money_score = (insider_bias["bias_score"] * 0.55) + (congress_bias["bias_score"] * 0.45)
        available = bool(insider_rows or congress_rows)
        return {
            "available": available,
            "source": "quiver",
            "reason": "ok" if available else ",".join(errors) if errors else "empty_response",
            "symbol": ticker,
            "insider": insider_bias,
            "congress": congress_bias,
            "smart_money_score": round(float(smart_money_score), 6),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return cached(cache_key, ttl_seconds=180, loader=_load)

