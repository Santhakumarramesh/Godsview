"""Market structure detector pipelines.

Sub-modules:
  * :mod:`pivots`    — swing-high/swing-low detection.
  * :mod:`bos_choch` — Break-of-Structure / Change-of-Character.

The detectors are pure functions over bar series so they can be unit
tested without a database. The persistence layer (PR7) wraps them in
async SQLAlchemy queries that read `market_bars` and write
`structure_events`.
"""

from app.structure.bos_choch import (
    BarLike,
    StructureEventOut,
    detect_bos_choch,
)
from app.structure.pivots import PivotOut, detect_pivots

__all__ = [
    "BarLike",
    "PivotOut",
    "StructureEventOut",
    "detect_bos_choch",
    "detect_pivots",
]
