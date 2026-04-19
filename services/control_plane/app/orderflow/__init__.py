"""Order-flow detector pipelines (Phase 3 PR4+).

Sub-modules:
  * :mod:`delta`      — cumulative + session-relative delta utilities
    over a sequence of :class:`DeltaBarLike` rows.
  * :mod:`imbalance`  — N-consecutive same-side imbalance detection.
  * :mod:`absorption` — large-volume bars whose net delta is small —
    one side absorbed the other.
  * :mod:`state`      — roll-up of the live order-flow state used by
    ``/v1/orderflow/symbols/{id}/state``.

Like ``app.structure``, every detector is a pure function over a typed
input sequence so it is unit-testable without the database. The route
layer (``app/routes/orderflow.py``) loads the rows, hands them to the
detector, and serialises the result to camelCase.
"""

from app.orderflow.absorption import (
    AbsorptionEventOut,
    detect_absorption,
)
from app.orderflow.delta import (
    DeltaBarLike,
    DeltaPoint,
    compute_cumulative_delta,
    compute_session_delta,
)
from app.orderflow.imbalance import (
    ImbalanceEventOut,
    detect_imbalances,
)
from app.orderflow.state import (
    OrderFlowStateRollup,
    derive_net_bias,
    rollup_state,
)

__all__ = [
    "AbsorptionEventOut",
    "DeltaBarLike",
    "DeltaPoint",
    "ImbalanceEventOut",
    "OrderFlowStateRollup",
    "compute_cumulative_delta",
    "compute_session_delta",
    "derive_net_bias",
    "detect_absorption",
    "detect_imbalances",
    "rollup_state",
]
