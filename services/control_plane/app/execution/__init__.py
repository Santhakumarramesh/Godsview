"""Execution gate — Setup → paper-trade + live-trade approval path.

The execution module is a *deterministic safety floor*: pure-function
gates that inspect a ``Setup`` row + the runtime risk/flag state and
return either an approval or an enumerated rejection reason.

Phase 3 shipped the paper-mode gate (:mod:`app.execution.gate`). Phase 4
adds the live-mode gate (:mod:`app.execution.live_gate`), which extends
the paper gate's setup-level checks with the risk engine's dollar-math
rules (per-trade R, daily drawdown, gross + correlated exposure,
buying power, equity freshness).

Both gates share the same contract:

  * :class:`GateDecision.approve(...)` / :class:`LiveGateDecision.approve(...)`
    — the setup is cleared; the route can create the paper- or live-trade
    row.
  * :class:`GateDecision.reject(reason=..., detail=...)` — the setup is
    blocked; the route returns a 409 with the enumerated reason code.

Rejections are a closed Literal so the UI can localise and the recall /
calibration pipeline can bucket them for post-hoc analysis. No I/O, no
DB, no audit — these are unit-testable predicates the route layer calls
after loading the relevant state.
"""

from app.execution.gate import (
    GateDecision,
    GateInput,
    GateReason,
    evaluate_gate,
)
from app.execution.live_gate import (
    DEFAULT_MAX_EQUITY_AGE_S,
    LiveGateDecision,
    LiveGateInput,
    LiveGateReason,
    LiveSizingPreview,
    evaluate_live_gate,
    preview_live_sizing,
)

__all__ = [
    "DEFAULT_MAX_EQUITY_AGE_S",
    "GateDecision",
    "GateInput",
    "GateReason",
    "LiveGateDecision",
    "LiveGateInput",
    "LiveGateReason",
    "LiveSizingPreview",
    "evaluate_gate",
    "evaluate_live_gate",
    "preview_live_sizing",
]
