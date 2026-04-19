"""Market structure detector pipelines.

Sub-modules:
  * :mod:`pivots`      — swing-high/swing-low detection.
  * :mod:`bos_choch`   — Break-of-Structure / Change-of-Character.
  * :mod:`order_blocks` — last-opposite-candle Order Block detection.
  * :mod:`fvgs`        — 3-bar Fair Value Gap detection.
  * :mod:`fusion`      — Multi-timeframe Fusion Engine that rolls
    detector output into a per-symbol ``MarketContextOut``.

The detectors are pure functions over bar series so they can be unit
tested without a database. The persistence layer (PR7) wraps them in
async SQLAlchemy queries that read `market_bars` and write
`structure_events`, `order_blocks`, `fvgs`, and `market_contexts`.
"""

from app.structure.bos_choch import (
    BarLike,
    StructureEventOut,
    detect_bos_choch,
)
from app.structure.fusion import (
    MarketContextOut,
    build_market_context,
    derive_bias_from_events,
    update_fvg_state,
    update_order_block_state,
)
from app.structure.fvgs import FvgOut, detect_fvgs
from app.structure.order_blocks import OrderBlockOut, detect_order_blocks
from app.structure.pivots import PivotOut, detect_pivots

__all__ = [
    "BarLike",
    "FvgOut",
    "MarketContextOut",
    "OrderBlockOut",
    "PivotOut",
    "StructureEventOut",
    "build_market_context",
    "derive_bias_from_events",
    "detect_bos_choch",
    "detect_fvgs",
    "detect_order_blocks",
    "detect_pivots",
    "update_fvg_state",
    "update_order_block_state",
]
