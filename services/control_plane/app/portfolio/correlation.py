"""Symbol → CorrelationClass mapping for the portfolio engine.

The canonical mapping lives in
``system_config.portfolio.correlation_map`` as a dict ``{symbol_id:
class}``. Anything not in the map falls through the prefix heuristics
below; if those miss it gets ``other``.

The nine canonical classes match
``packages/types/src/portfolio.ts::CorrelationClassSchema``.
"""

from __future__ import annotations

from typing import Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SystemConfig

CORRELATION_CLASSES = frozenset(
    {
        "equity_index",
        "single_stock",
        "crypto_major",
        "crypto_alt",
        "fx_major",
        "fx_minor",
        "commodity",
        "treasury",
        "other",
    }
)

_DEFAULT_PREFIX_HEURISTICS: tuple[tuple[str, str], ...] = (
    ("SPY", "equity_index"),
    ("QQQ", "equity_index"),
    ("ES", "equity_index"),
    ("NQ", "equity_index"),
    ("RTY", "equity_index"),
    ("BTC", "crypto_major"),
    ("ETH", "crypto_major"),
    ("SOL", "crypto_alt"),
    ("EUR", "fx_major"),
    ("GBP", "fx_major"),
    ("JPY", "fx_major"),
    ("AUD", "fx_major"),
    ("NZD", "fx_minor"),
    ("CAD", "fx_minor"),
    ("CHF", "fx_minor"),
    ("GC", "commodity"),
    ("GOLD", "commodity"),
    ("CL", "commodity"),
    ("OIL", "commodity"),
    ("ZB", "treasury"),
    ("ZN", "treasury"),
    ("TLT", "treasury"),
)


async def load_correlation_map(session: AsyncSession) -> Dict[str, str]:
    """Fetch the operator-configured map from ``system_config`` (or {}).

    The row's value must be a JSON object; any non-dict or missing row
    falls back to an empty map (every symbol then hits the prefix
    heuristics or lands on ``other``).
    """
    stmt = select(SystemConfig).where(
        SystemConfig.key == "portfolio.correlation_map"
    )
    result = await session.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None or not isinstance(row.value, dict):
        return {}
    out: Dict[str, str] = {}
    for k, v in row.value.items():
        if isinstance(k, str) and isinstance(v, str) and v in CORRELATION_CLASSES:
            out[k] = v
    return out


def classify(symbol_id: str, mapping: Dict[str, str]) -> str:
    """Return the correlation class for ``symbol_id``.

    Resolution order:
      1. exact match in ``mapping``
      2. prefix heuristic match (longest prefix wins)
      3. ``"other"``
    """
    hit = mapping.get(symbol_id)
    if hit is not None:
        return hit
    upper = symbol_id.upper()
    best: tuple[int, str] | None = None
    for prefix, cls in _DEFAULT_PREFIX_HEURISTICS:
        if upper.startswith(prefix):
            cand = (len(prefix), cls)
            if best is None or cand[0] > best[0]:
                best = cand
    if best is not None:
        return best[1]
    return "other"
