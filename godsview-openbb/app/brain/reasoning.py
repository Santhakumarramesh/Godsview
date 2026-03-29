from __future__ import annotations

from typing import Any


def compose_reasoning_decision(
    *,
    symbol: str,
    signal: dict[str, Any],
    setup_candidate: dict[str, Any] | None,
    scoring: dict[str, Any] | None,
    sentiment: dict[str, Any] | None,
    macro: dict[str, Any] | None,
    memory_tail: list[dict[str, Any]],
) -> dict[str, Any]:
    reasons: list[str] = []
    approved = True
    action = str(signal.get("action", "skip"))
    confidence = float(signal.get("confidence", 0.0))
    scoring = scoring or {}

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

    final_score = float(scoring.get("final_score", 0.0))
    if final_score < 0.58:
        approved = False
        reasons.append("score_below_reasoning_threshold")

    setup_name = str(signal.get("setup", "unknown"))
    setup_rows = [
        row
        for row in memory_tail
        if str(row.get("setup", row.get("title", ""))).lower().find(setup_name.lower()) >= 0
    ]
    setup_wins = len([row for row in setup_rows if str(row.get("outcome", "")).lower() == "win"])
    setup_losses = len([row for row in setup_rows if str(row.get("outcome", "")).lower() == "loss"])
    setup_samples = setup_wins + setup_losses
    setup_win_rate = (setup_wins / setup_samples) if setup_samples > 0 else 0.0
    if setup_samples >= 8 and setup_win_rate < 0.35:
        approved = False
        reasons.append("historical_setup_underperformance")

    challenge_points: list[str] = []
    if bool((macro or {}).get("blackout", False)):
        challenge_points.append("macro_blackout")
    if recent_total >= 8 and recent_losses / max(recent_total, 1) > 0.65:
        challenge_points.append("recent_loss_cluster")
    if confidence < 0.35:
        challenge_points.append("weak_model_confidence")
    if final_score < 0.65:
        challenge_points.append("composite_score_not_a_grade")

    return {
        "symbol": symbol.upper(),
        "approved": approved,
        "final_action": action if approved else "skip",
        "confidence": confidence,
        "final_score": final_score,
        "reasons": reasons if reasons else ["all_checks_passed"],
        "challenge_points": challenge_points,
        "past_episode_stats": {
            "setup": setup_name,
            "samples": setup_samples,
            "wins": setup_wins,
            "losses": setup_losses,
            "win_rate": round(setup_win_rate, 6),
        },
        "inputs": {
            "sentiment_score": sentiment_score,
            "macro_blackout": bool((macro or {}).get("blackout", False)),
            "recent_trades": recent_total,
            "recent_losses": recent_losses,
        },
    }
