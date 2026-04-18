from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests

from app.config import settings
from app.data.cache import cached

FRED_SERIES = {
    "fed_funds": "FEDFUNDS",
    "cpi": "CPIAUCSL",
    "unemployment": "UNRATE",
    "yield_10y": "DGS10",
    "yield_2y": "DGS2",
}


def _fetch_fred_series(series_id: str) -> dict[str, Any] | None:
    if not settings.fred_api_key:
        return None
    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series_id,
        "api_key": settings.fred_api_key,
        "file_type": "json",
        "sort_order": "desc",
        "limit": 30,
    }
    resp = requests.get(url, params=params, timeout=8)
    if resp.status_code != 200:
        return None
    payload = resp.json()
    observations = payload.get("observations", [])
    for row in observations:
        raw = str(row.get("value", "")).strip()
        if raw in {"", "."}:
            continue
        try:
            value = float(raw)
        except Exception:
            continue
        return {
            "series_id": series_id,
            "date": str(row.get("date", "")),
            "value": value,
        }
    return None


def get_fred_macro_snapshot() -> dict[str, Any]:
    def _load() -> dict[str, Any]:
        if not settings.fred_api_key:
            return {
                "available": False,
                "source": "fred",
                "reason": "missing_fred_api_key",
                "series": {},
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        series: dict[str, Any] = {}
        for name, series_id in FRED_SERIES.items():
            series[name] = _fetch_fred_series(series_id)

        y10 = series.get("yield_10y", {}) or {}
        y2 = series.get("yield_2y", {}) or {}
        y10_val = y10.get("value")
        y2_val = y2.get("value")
        yield_curve_spread = None
        if isinstance(y10_val, (int, float)) and isinstance(y2_val, (int, float)):
            yield_curve_spread = float(y10_val) - float(y2_val)

        return {
            "available": True,
            "source": "fred",
            "series": series,
            "yield_curve_10y_2y": yield_curve_spread,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return cached("fred:snapshot", ttl_seconds=900, loader=_load)
