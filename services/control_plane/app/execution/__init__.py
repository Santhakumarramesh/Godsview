"""Execution gate — Setup → paper-trade approval path.

The execution module is a *deterministic safety floor*: a pure-function
gate that inspects a ``Setup`` row + the runtime risk/flag state and
returns either:

  * :class:`GateDecision.approve(...)` — the setup is cleared; the
    caller can create the paper-trade row, or
  * :class:`GateDecision.reject(reason=..., code=...)` — the setup is
    blocked; the caller returns a 409 / 403 to the operator.

Rejections are enumerated (not stringly-typed) so the UI can localise
and the recall/calibration pipeline can bucket them for post-hoc
analysis. No I/O, no DB, no audit — this is a unit-testable predicate
that the ``/v1/setups/{id}/approve`` route calls after loading the
relevant state.

Phase 3 ships the paper-mode branch. The ``mode='live'`` branch is a
hard reject until Phase 4's risk engine + kill-switch wiring is in
place.
"""

from app.execution.gate import (
    GateDecision,
    GateInput,
    GateReason,
    evaluate_gate,
)

__all__ = [
    "GateDecision",
    "GateInput",
    "GateReason",
    "evaluate_gate",
]
