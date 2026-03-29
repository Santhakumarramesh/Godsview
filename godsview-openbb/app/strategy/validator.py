from __future__ import annotations

from typing import Any

from app.config import settings


def validate_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    if not candidate.get("valid", False):
        return {"valid": False, "reason": candidate.get("reason", "invalid_candidate")}

    if not bool(candidate.get("time_window_trigger", True)):
        return {"valid": False, "reason": "outside_time_window"}

    rr = float(candidate.get("rr", 0.0))
    if rr < settings.min_rr:
        return {"valid": False, "reason": "rr_below_threshold"}

    structure_score = float(candidate.get("structure", {}).get("structure_score", 0.0))
    if structure_score < 0.45:
        return {"valid": False, "reason": "weak_structure_score"}

    choch = bool(candidate.get("structure", {}).get("choch", False))
    bos = bool(candidate.get("structure", {}).get("bos", False))
    if not choch and not bos:
        return {"valid": False, "reason": "missing_structure_shift"}

    has_order_block = bool(candidate.get("has_order_block", False))
    has_fvg = bool(candidate.get("has_fvg", False))
    if not has_order_block and not has_fvg:
        return {"valid": False, "reason": "missing_ob_or_fvg_entry_zone"}

    return {"valid": True, "reason": "ok"}
