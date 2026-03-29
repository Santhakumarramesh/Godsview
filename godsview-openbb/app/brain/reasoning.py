from __future__ import annotations

from typing import Any


def compose_reasoning_decision(
    *,
    symbol: str,
    signal: dict[str, Any],
    setup_candidate: dict[str, Any] | None,
    sentiment: dict[str, Any] | None,
    macro: dict[str, Any] | None,
    memory_tail: list[dict[str, Any]],
) -> dict[str, Any]:
    reasons: list[str] = []
    approved = True
    action = str(signal.get("action", "skip"))
    confidence = float(signal.get("confidence", 0.0))

    if action == "skip":
        approved = False
        reasons.append("model_action_skip")

    if setup_candidate is None or not setup_candidate.get("valid", False):
        approved = False
        reasons.append(f"setup_invalid:{(setup_candidate or {}).get('reason', 'missing')}")

    if macro and bool(macro.get("blackout", False)):
        approved = False
        reasons.append("macro_blackout_window")

    sentiment_score = float((sentiment or {}).get("sentiment_score", 0.0))
    if action == "buy" and sentiment_score < -0.02:
        approved = False
        reasons.append("sentiment_contradiction_long")
    if action == "sell" and sentiment_score > 0.02:
        approved = False
        reasons.append("sentiment_contradiction_short")

    recent_losses = len([m for m in memory_tail if str(m.get("outcome")) == "loss"])
    recent_total = len(memory_tail)
    if recent_total >= 8 and recent_losses / recent_total > 0.65:
        approved = False
        reasons.append("recent_memory_loss_cluster")

    if confidence < 0.2:
        approved = False
        reasons.append("low_model_confidence")

    return {
        "symbol": symbol.upper(),
        "approved": approved,
        "final_action": action if approved else "skip",
        "confidence": confidence,
        "reasons": reasons if reasons else ["all_checks_passed"],
        "inputs": {
            "sentiment_score": sentiment_score,
            "macro_blackout": bool((macro or {}).get("blackout", False)),
            "recent_trades": recent_total,
            "recent_losses": recent_losses,
        },
    }

