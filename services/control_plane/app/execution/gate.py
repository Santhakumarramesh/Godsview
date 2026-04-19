"""Pure execution gate — the deterministic safety floor.

The gate takes a pre-loaded view of the world (Setup row + flags +
open-trade count + "now") and returns a single, enumerated decision.

Design rules
------------

*   No I/O. The caller is responsible for loading every piece of state.
*   Deterministic. Same input → same output. Unit tests can pin the
    exact decision matrix without mocking a database.
*   Enumerated rejections. ``GateReason`` is a closed Literal so the
    frontend, audit log, and metrics can bucket rejections reliably.
*   Paper-mode only (Phase 3). ``mode="live"`` is a hard reject under
    ``live_disallowed`` until Phase 4 ships the full risk engine.
*   Kill switch beats everything. A single ``execution.kill_switch``
    flag rejects *any* request, paper or live.

Limits applied (Phase 3 defaults, mirrored in
``tests/test_execution_gate.py``):

*   ``max_concurrent_per_symbol``  = 3 open paper trades
*   ``max_concurrent_global``      = 20 open paper trades
*   ``min_confidence``             = 0.35
*   ``size_multiplier``            ≤ 5.0 (upstream Zod also enforces)
*   Setup status                   must be ``detected``
*   Setup.expiresAt                must be in the future (or null)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

# Frozen knobs — keep in one place so the test file and route layer
# can import the same source of truth.
DEFAULT_MAX_PER_SYMBOL = 3
DEFAULT_MAX_GLOBAL = 20
DEFAULT_MIN_CONFIDENCE = 0.35
DEFAULT_MAX_SIZE_MULTIPLIER = 5.0

GateReason = Literal[
    "approved",
    "kill_switch_active",
    "live_disallowed",
    "setup_not_detected",
    "setup_expired",
    "size_multiplier_out_of_range",
    "confidence_below_threshold",
    "per_symbol_cap_exceeded",
    "global_cap_exceeded",
    "duplicate_active_trade",
]


@dataclass(frozen=True, slots=True)
class GateInput:
    """Snapshot of the world the gate needs to decide.

    Fields are primitives / plain dataclasses so the caller can build
    this from a Setup ORM row + three tiny counter queries without
    pulling the SQLAlchemy session into the gate.
    """

    mode: Literal["paper", "live"]
    size_multiplier: float
    # --- setup snapshot ---
    setup_status: str
    setup_confidence: float
    setup_expires_at: datetime | None
    # --- runtime flags + counters ---
    kill_switch_active: bool
    active_trades_for_symbol: int
    active_trades_global: int
    setup_has_active_paper_trade: bool
    # --- "now" (injectable for deterministic tests) ---
    now: datetime

    # --- knobs (overridable for tests / future system-config wiring) ---
    max_per_symbol: int = DEFAULT_MAX_PER_SYMBOL
    max_global: int = DEFAULT_MAX_GLOBAL
    min_confidence: float = DEFAULT_MIN_CONFIDENCE
    max_size_multiplier: float = DEFAULT_MAX_SIZE_MULTIPLIER


@dataclass(frozen=True, slots=True)
class GateDecision:
    approved: bool
    reason: GateReason
    detail: str = ""

    @classmethod
    def approve(cls, detail: str = "") -> "GateDecision":
        return cls(approved=True, reason="approved", detail=detail)

    @classmethod
    def reject(cls, reason: GateReason, detail: str = "") -> "GateDecision":
        return cls(approved=False, reason=reason, detail=detail)


def evaluate_gate(gi: GateInput) -> GateDecision:
    """Apply the deterministic safety floor.

    Order matters: kill-switch and live-mode are absolute, then
    per-setup checks, then size checks, then capacity checks. First
    failing rule wins so ``detail`` carries the specific number that
    tripped the gate.
    """

    # 1. absolute overrides
    if gi.kill_switch_active:
        return GateDecision.reject(
            "kill_switch_active",
            detail="execution.kill_switch flag is on",
        )
    if gi.mode == "live":
        return GateDecision.reject(
            "live_disallowed",
            detail="live mode requires the Phase 4 risk engine",
        )

    # 2. setup-state preconditions
    if gi.setup_status != "detected":
        return GateDecision.reject(
            "setup_not_detected",
            detail=f"setup in state '{gi.setup_status}'",
        )
    if gi.setup_has_active_paper_trade:
        return GateDecision.reject(
            "duplicate_active_trade",
            detail="an open paper trade already exists for this setup",
        )
    if gi.setup_expires_at is not None:
        # Tolerate naive datetimes by normalising to UTC.
        expires = gi.setup_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        now = gi.now if gi.now.tzinfo is not None else gi.now.replace(
            tzinfo=timezone.utc
        )
        if expires <= now:
            return GateDecision.reject(
                "setup_expired",
                detail=f"setup expired at {expires.isoformat()}",
            )

    # 3. sizing
    if gi.size_multiplier <= 0.0 or gi.size_multiplier > gi.max_size_multiplier:
        return GateDecision.reject(
            "size_multiplier_out_of_range",
            detail=(
                f"sizeMultiplier={gi.size_multiplier} outside "
                f"(0, {gi.max_size_multiplier}]"
            ),
        )

    # 4. confidence floor
    if gi.setup_confidence < gi.min_confidence:
        return GateDecision.reject(
            "confidence_below_threshold",
            detail=(
                f"confidence={gi.setup_confidence:.3f} < "
                f"threshold={gi.min_confidence:.3f}"
            ),
        )

    # 5. capacity caps
    if gi.active_trades_for_symbol >= gi.max_per_symbol:
        return GateDecision.reject(
            "per_symbol_cap_exceeded",
            detail=(
                f"open paper trades for symbol = "
                f"{gi.active_trades_for_symbol} / {gi.max_per_symbol}"
            ),
        )
    if gi.active_trades_global >= gi.max_global:
        return GateDecision.reject(
            "global_cap_exceeded",
            detail=(
                f"open paper trades globally = "
                f"{gi.active_trades_global} / {gi.max_global}"
            ),
        )

    return GateDecision.approve(
        detail=(
            f"passed (conf={gi.setup_confidence:.3f}, "
            f"size={gi.size_multiplier:g}, "
            f"sym_open={gi.active_trades_for_symbol})"
        )
    )
