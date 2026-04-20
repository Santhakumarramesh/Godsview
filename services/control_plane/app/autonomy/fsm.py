"""Autonomy FSM transition matrix.

Transition rules (operator + system actions collapse into 5 actions):

  action      allowed from-state set                  resulting to-state
  ─────────   ───────────────────────────────────     ──────────────────
  promote     assisted_live                      →   autonomous_candidate
  promote     autonomous_candidate               →   autonomous
  demote      autonomous | autonomous_candidate  →   assisted_live
  override    {assisted_live, autonomous_candidate,
               autonomous}                       →   overridden
  suspend     *                                  →   suspended
  resume      overridden | suspended             →   assisted_live

Governance approval is required for:
  * promote ``autonomous_candidate → autonomous``

Everything else is an operator-level mutation gated only on the FSM.
"""

from __future__ import annotations

from typing import Dict, FrozenSet, Set, Tuple

from app.autonomy.dto import (
    AutonomyReason,
    AutonomyState,
    AutonomyTransitionAction,
)


# ──────────────────────────── errors ───────────────────────────────────


class AutonomyFSMError(Exception):
    """Invalid FSM transition attempted."""

    code: str = "autonomy_fsm_error"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ──────────────────────────── matrix ───────────────────────────────────

# (from_state, action) → (to_state, default_reason)
_MATRIX: Dict[Tuple[AutonomyState, AutonomyTransitionAction], Tuple[AutonomyState, AutonomyReason]] = {
    ("assisted_live", "promote"): ("autonomous_candidate", "gates_green"),
    ("autonomous_candidate", "promote"): ("autonomous", "governance_approved"),
    ("autonomous", "demote"): ("assisted_live", "manual_demote"),
    ("autonomous_candidate", "demote"): ("assisted_live", "manual_demote"),
    ("assisted_live", "override"): ("overridden", "operator_override"),
    ("autonomous_candidate", "override"): ("overridden", "operator_override"),
    ("autonomous", "override"): ("overridden", "operator_override"),
    ("assisted_live", "suspend"): ("suspended", "operator_suspend"),
    ("autonomous_candidate", "suspend"): ("suspended", "operator_suspend"),
    ("autonomous", "suspend"): ("suspended", "operator_suspend"),
    ("overridden", "suspend"): ("suspended", "operator_suspend"),
    ("overridden", "resume"): ("assisted_live", "operator_resume"),
    ("suspended", "resume"): ("assisted_live", "operator_resume"),
}

# Actions that require a governance approval pre-condition.
_APPROVAL_REQUIRED: Set[Tuple[AutonomyState, AutonomyTransitionAction]] = {
    ("autonomous_candidate", "promote"),
}


# ──────────────────────────── api ──────────────────────────────────────


def apply_action(
    from_state: AutonomyState,
    action: AutonomyTransitionAction,
) -> Tuple[AutonomyState, AutonomyReason]:
    """Return ``(to_state, default_reason)`` for a valid transition.

    Raises :class:`AutonomyFSMError` with code ``invalid_transition`` if
    the combination is not permitted.
    """
    key = (from_state, action)
    if key not in _MATRIX:
        raise AutonomyFSMError(
            "invalid_transition",
            f"cannot apply action {action!r} from state {from_state!r}",
        )
    return _MATRIX[key]


def valid_actions_for(from_state: AutonomyState) -> FrozenSet[AutonomyTransitionAction]:
    """Return the set of actions permitted out of ``from_state``."""
    return frozenset(
        action for (state, action) in _MATRIX.keys() if state == from_state
    )


def requires_governance_approval(
    from_state: AutonomyState,
    action: AutonomyTransitionAction,
) -> bool:
    """Does this transition need a governance approval row?"""
    return (from_state, action) in _APPROVAL_REQUIRED


__all__ = [
    "AutonomyFSMError",
    "apply_action",
    "requires_governance_approval",
    "valid_actions_for",
]
