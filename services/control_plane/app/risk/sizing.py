"""Position sizing — turn a dollar risk budget into a share/contract quantity.

The sizing math is deliberately split out of the evaluator so callers
can preview the size before running the full risk gate (e.g. the
``/v1/execution/live/preview`` route in PR5).

Math
----

* ``dollar_risk = equity * risk_per_trade_r``
* ``stop_distance = |entry - stop_loss|``
* ``qty = dollar_risk / stop_distance``

The function refuses to return a non-positive quantity — a zero-distance
stop is a logic error upstream, and zero qty is refused as
:class:`SizingError`.

``round_mode`` lets the caller pick how to handle fractional shares:

* ``"down"`` (default) — floor to the nearest ``lot_size`` — never
  over-risk.
* ``"exact"``          — return the raw fraction (useful for forex).

``lot_size`` ≥ 1 floors to whole shares by default.
"""

from __future__ import annotations

import math
from typing import Literal


class SizingError(ValueError):
    """Raised when the inputs make a valid size impossible."""


def size_for_trade(
    *,
    equity: float,
    risk_per_trade_r: float,
    entry_price: float,
    stop_loss: float,
    lot_size: float = 1.0,
    round_mode: Literal["down", "exact"] = "down",
) -> float:
    """Return the position size for the given risk envelope.

    Raises :class:`SizingError` when inputs make sizing ill-defined.
    """

    if equity <= 0:
        raise SizingError(f"equity must be positive, got {equity}")
    if risk_per_trade_r <= 0:
        raise SizingError(
            f"risk_per_trade_r must be positive, got {risk_per_trade_r}"
        )
    if entry_price <= 0:
        raise SizingError(f"entry_price must be positive, got {entry_price}")
    if lot_size <= 0:
        raise SizingError(f"lot_size must be positive, got {lot_size}")

    stop_distance = abs(entry_price - stop_loss)
    if stop_distance <= 0:
        raise SizingError(
            "entry_price and stop_loss must differ to compute size"
        )

    dollar_risk = equity * risk_per_trade_r
    raw_qty = dollar_risk / stop_distance

    if round_mode == "exact":
        return raw_qty

    # Floor to the nearest multiple of lot_size. Use math.floor so we
    # never over-risk. If qty rounds to zero the caller gets a 0, not
    # an error — that's a signal the risk budget is too small for the
    # stop distance given current equity.
    units = math.floor(raw_qty / lot_size)
    return max(units * lot_size, 0.0)
