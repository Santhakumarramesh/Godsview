from __future__ import annotations

from typing import Any


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _regime_fit_score(setup: str, regime: str) -> float:
    setup = (setup or "").lower()
    regime = (regime or "").lower()

    if setup in {"sweep_reclaim", "sweep_reclaim_choch", "breakout_failure"}:
        return 0.85 if regime in {"mean_reversion", "chop"} else 0.6
    if setup in {"continuation_pullback", "trend_impulse_reentry", "vwap_continuation"}:
        return 0.85 if regime == "trend" else 0.55
    if setup in {"breakout_expansion", "opening_range_breakout"}:
        return 0.85 if regime == "high_volatility" else 0.5
    if setup in {"vwap_reclaim", "vwap_rejection"}:
        return 0.8 if regime in {"mean_reversion", "chop"} else 0.55
    return 0.6


def score_setup_pipeline(
    *,
    signal: dict[str, Any] | None,
    setup_candidate: dict[str, Any] | None,
    market: dict[str, Any] | None,
    hard_gates: dict[str, Any] | None,
    validation: dict[str, Any] | None,
) -> dict[str, Any]:
    signal = signal or {}
    setup_candidate = setup_candidate or {}
    market = market or {}
    hard_gates = hard_gates or {}
    validation = validation or {}

    structure_score = _safe_float(setup_candidate.get("structure", {}).get("structure_score"), 0.0)
    model_confidence = _safe_float(signal.get("confidence"), 0.0)
    rr = _safe_float(setup_candidate.get("rr"), 0.0)
    rr_score = _clip01(rr / 3.0)
    setup = str(signal.get("setup") or setup_candidate.get("setup") or "unknown")
    regime = str(market.get("regime", "chop"))

    choch = bool(setup_candidate.get("structure", {}).get("choch", False))
    bos = bool(setup_candidate.get("structure", {}).get("bos", False))
    has_order_block = bool(setup_candidate.get("has_order_block", False))
    has_fvg = bool(setup_candidate.get("has_fvg", False))
    time_window_trigger = bool(setup_candidate.get("time_window_trigger", True))
    has_sweep = bool(setup_candidate.get("sweep", {}).get("detected", False))

    setup_pattern_quality = 0.0
    setup_pattern_quality += 0.3 if has_sweep else 0.0
    setup_pattern_quality += 0.2 if choch else 0.0
    setup_pattern_quality += 0.15 if bos else 0.0
    setup_pattern_quality += 0.2 if has_order_block else 0.0
    setup_pattern_quality += 0.1 if has_fvg else 0.0
    setup_pattern_quality += 0.05 if time_window_trigger else 0.0
    setup_pattern_quality = _clip01(setup_pattern_quality)

    strategy_score = _clip01(
        0.45 * structure_score + 0.35 * setup_pattern_quality + 0.20 * ((model_confidence + rr_score) / 2.0)
    )
    regime_score = _clip01(_regime_fit_score(setup, regime))

    gate_pass_ratio = _safe_float(hard_gates.get("pass_ratio"), 0.0)
    gate_liquidity_score = _safe_float(hard_gates.get("liquidity_score"), 0.0)
    gate_volatility_score = _safe_float(hard_gates.get("volatility_score"), 0.0)
    gate_spread_quality_score = _safe_float(hard_gates.get("spread_quality_score"), 0.0)
    risk_score = _clip01(
        0.35 * gate_pass_ratio
        + 0.25 * gate_liquidity_score
        + 0.2 * gate_volatility_score
        + 0.2 * gate_spread_quality_score
    )

    final_score = _clip01(0.45 * strategy_score + 0.3 * regime_score + 0.25 * risk_score)
    score_grade = "A" if final_score >= 0.75 else "B" if final_score >= 0.62 else "C"

    reasons: list[str] = []
    if not validation.get("valid", False):
        reasons.append(f"setup_validation_failed:{validation.get('reason', 'unknown')}")
    if not hard_gates.get("pass", False):
        reasons.extend([f"gate_failed:{gate}" for gate in hard_gates.get("failed_reasons", [])])
    if final_score < 0.55:
        reasons.append("final_score_below_threshold")
    if model_confidence < 0.2:
        reasons.append("model_confidence_too_low")

    return {
        "strategy_score": round(strategy_score, 6),
        "regime_score": round(regime_score, 6),
        "risk_score": round(risk_score, 6),
        "final_score": round(final_score, 6),
        "grade": score_grade,
        "pass": len(reasons) == 0,
        "reasons": reasons if reasons else ["scoring_passed"],
        "components": {
            "structure_score": round(structure_score, 6),
            "setup_pattern_quality": round(setup_pattern_quality, 6),
            "model_confidence": round(model_confidence, 6),
            "rr_score": round(rr_score, 6),
            "gate_pass_ratio": round(gate_pass_ratio, 6),
            "gate_liquidity_score": round(gate_liquidity_score, 6),
            "gate_volatility_score": round(gate_volatility_score, 6),
            "gate_spread_quality_score": round(gate_spread_quality_score, 6),
            "regime": regime,
            "setup": setup,
        },
    }

