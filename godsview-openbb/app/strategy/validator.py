from __future__ import annotations

from typing import Any

from app.config import settings


def validate_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    if not candidate.get("valid", False):
        return {"valid": False, "reason": candidate.get("reason", "invalid_candidate")}

    rr = float(candidate.get("rr", 0.0))
    if rr < settings.min_rr:
        return {"valid": False, "reason": "rr_below_threshold"}

    structure_score = float(candidate.get("structure", {}).get("structure_score", 0.0))
    if structure_score < 0.45:
        return {"valid": False, "reason": "weak_structure_score"}

    return {"valid": True, "reason": "ok"}

