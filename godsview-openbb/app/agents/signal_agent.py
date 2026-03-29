from __future__ import annotations

from app.agents.base import Agent, AgentState
from app.infer import get_latest_signal


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
            setup = _infer_setup(signal, market)
            signal["setup"] = setup
            state.data["signal"] = signal

            if str(signal.get("action", "skip")) == "skip":
                state.set_blocked("neutral_signal")
            return state
        except Exception as err:  # noqa: BLE001
            state.add_error(f"signal_agent_error: {err}")
            state.set_blocked("signal_agent_failed")
            return state

