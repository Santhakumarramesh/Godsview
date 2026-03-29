from __future__ import annotations

from app.agents.base import Agent, AgentState
from app.ai_filter import ai_trade_filter
from app.brain.schema import EpisodicMemory


class ReasoningAgent(Agent):
    name = "reasoning_agent"

    def run(self, state: AgentState) -> AgentState:
        if state.blocked:
            return state

        signal = state.data.get("signal")
        market = state.data.get("market", {})
        if not isinstance(signal, dict):
            state.set_blocked("missing_signal")
            return state

        memory_tail = state.brain.get_memories(state.symbol, memory_type="trade", limit=40)
        recent_losses = len([m for m in memory_tail if str(m.get("outcome")) == "loss"])
        recent_total = len(memory_tail)
        recent_loss_rate = (recent_losses / recent_total) if recent_total > 0 else 0.0

        context = {
            "high_volatility": str(market.get("regime", "")) == "high_volatility",
            "major_news_window": False,
            "spread_too_wide": False,
            "degraded_data": False,
            "recent_loss_rate": recent_loss_rate,
        }
        if recent_total >= 10 and recent_loss_rate > 0.65:
            context["degraded_data"] = True

        decision = ai_trade_filter(signal, context)
        reasoning = {
            "approved": decision.approved,
            "final_action": decision.final_action,
            "reasons": decision.reasons,
            "recent_loss_rate": recent_loss_rate,
            "recent_trades": recent_total,
        }
        state.data["reasoning"] = reasoning

        state.brain.add_memory(
            EpisodicMemory(
                symbol=state.symbol,
                title="Reasoning decision",
                content=f"approved={decision.approved}, action={decision.final_action}",
                confidence=float(signal.get("confidence", 0.5)),
                tags=["reasoning", "decision"],
                context=reasoning,
            )
        )

        if not decision.approved:
            state.set_blocked("reasoning_veto")

        return state

