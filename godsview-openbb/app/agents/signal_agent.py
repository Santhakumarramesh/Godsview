from __future__ import annotations

from app.agents.base import Agent, AgentState
from app.infer import get_latest_signal
from app.strategy.hard_gates import evaluate_hard_gates
from app.strategy.scoring_engine import score_setup_pipeline
from app.strategy.setup_engine import generate_setup_candidate
from app.strategy.validator import validate_candidate


def _infer_setup(signal: dict[str, object], market: dict[str, object]) -> str:
    action = str(signal.get("action", "skip"))
    confidence = float(signal.get("confidence", 0.0))
    trend_20 = float(market.get("trend_20", 0.0))
    regime = str(market.get("regime", "chop"))

    if action == "skip":
        return "no_setup"
    if regime == "high_volatility" and confidence > 0.6:
        return "breakout_expansion"
    if regime == "mean_reversion" and confidence > 0.45:
        return "vwap_reclaim"
    if abs(trend_20) > 0.035 and confidence > 0.5:
        return "continuation_pullback"
    return "sweep_reclaim"


class SignalAgent(Agent):
    name = "signal_agent"

    def run(self, state: AgentState) -> AgentState:
        if state.blocked:
            return state

        try:
            signal = get_latest_signal()
            market = state.data.get("market", {})
            bars = state.data.get("bars")
            session = state.data.get("session", {})
            macro = state.data.get("macro", {})
            sentiment = state.data.get("sentiment", {})

            setup_candidate = None
            setup_validation = {"valid": False, "reason": "missing_setup_candidate"}
            hard_gates = {
                "pass": False,
                "checks": [],
                "failed_reasons": ["missing_bars_for_hard_gates"],
                "pass_ratio": 0.0,
            }
            scoring = {
                "pass": False,
                "final_score": 0.0,
                "grade": "C",
                "reasons": ["scoring_not_computed"],
            }
            if bars is not None:
                hard_gates = evaluate_hard_gates(
                    bars=bars,
                    market=market if isinstance(market, dict) else {},
                    session=session if isinstance(session, dict) else {},
                    macro=macro if isinstance(macro, dict) else {},
                    sentiment=sentiment if isinstance(sentiment, dict) else {},
                )
                setup_candidate = generate_setup_candidate(
                    bars,
                    session=session if isinstance(session, dict) else None,
                )
                setup_validation = validate_candidate(setup_candidate)

            setup = _infer_setup(signal, market)
            if setup_candidate and setup_candidate.get("valid"):
                setup = str(setup_candidate.get("setup", setup))
            signal["setup"] = setup
            signal["setup_candidate"] = setup_candidate
            signal["setup_validation"] = setup_validation
            scoring = score_setup_pipeline(
                signal=signal,
                setup_candidate=setup_candidate if isinstance(setup_candidate, dict) else None,
                market=market if isinstance(market, dict) else None,
                hard_gates=hard_gates if isinstance(hard_gates, dict) else None,
                validation=setup_validation,
            )
            signal["scoring"] = scoring
            signal["pipeline_stage"] = {
                "hard_gates_pass": bool(hard_gates.get("pass", False)),
                "setup_valid": bool(setup_validation.get("valid", False)),
                "scoring_pass": bool(scoring.get("pass", False)),
            }
            state.data["signal"] = signal
            state.data["hard_gates"] = hard_gates
            state.data["scoring"] = scoring

            if not hard_gates.get("pass", False):
                failed = hard_gates.get("failed_reasons", [])
                first = failed[0] if isinstance(failed, list) and failed else "hard_gate_failed"
                state.set_blocked(f"hard_gate_failed:{first}")
                return state
            if not setup_validation.get("valid", False):
                state.set_blocked(f"invalid_setup:{setup_validation.get('reason', 'unknown')}")
                return state
            if not scoring.get("pass", False):
                reasons = scoring.get("reasons", [])
                first = reasons[0] if isinstance(reasons, list) and reasons else "score_rejected"
                state.set_blocked(f"scoring_rejected:{first}")
                return state
            if str(signal.get("action", "skip")) == "skip":
                state.set_blocked("neutral_signal")
            return state
        except Exception as err:  # noqa: BLE001
            state.add_error(f"signal_agent_error: {err}")
            state.set_blocked("signal_agent_failed")
            return state
