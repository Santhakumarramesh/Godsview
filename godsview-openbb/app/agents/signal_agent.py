from __future__ import annotations

from app.agents.base import Agent, AgentState
from app.infer import get_latest_signal
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
            if isinstance(session, dict) and not bool(session.get("allowed", False)):
                state.set_blocked("session_not_allowed")
                state.data["signal"] = {"action": "skip", "reason": "session_not_allowed"}
                return state

            setup_candidate = None
            setup_validation = {"valid": False, "reason": "missing_setup_candidate"}
            if bars is not None:
                setup_candidate = generate_setup_candidate(bars)
                setup_validation = validate_candidate(setup_candidate)

            setup = _infer_setup(signal, market)
            if setup_candidate and setup_candidate.get("valid"):
                setup = str(setup_candidate.get("setup", setup))
            signal["setup"] = setup
            signal["setup_candidate"] = setup_candidate
            signal["setup_validation"] = setup_validation
            state.data["signal"] = signal

            if not setup_validation.get("valid", False):
                state.set_blocked(f"invalid_setup:{setup_validation.get('reason', 'unknown')}")
                return state
            if str(signal.get("action", "skip")) == "skip":
                state.set_blocked("neutral_signal")
            return state
        except Exception as err:  # noqa: BLE001
            state.add_error(f"signal_agent_error: {err}")
            state.set_blocked("signal_agent_failed")
            return state
