from __future__ import annotations

import uuid

from app.agents.base import Agent, AgentState, utc_now_iso
from app.brain.learning import build_learning_summary
from app.brain.schema import TradeMemory
from app.execution.journal import append_journal_entry


class MonitorAgent(Agent):
    name = "monitor_agent"

    def run(self, state: AgentState) -> AgentState:
        signal = state.data.get("signal", {})
        market = state.data.get("market", {})
        reasoning = state.data.get("reasoning", {})
        risk = state.data.get("risk", {})
        execution = state.data.get("execution", {})

        action = str(reasoning.get("final_action", signal.get("action", "skip")))
        setup = str(signal.get("setup", "unknown"))
        regime = str(market.get("regime", "unknown"))
        status = str(execution.get("status", "blocked"))

        outcome = "open"
        if status in {"blocked", "error"}:
            outcome = "skipped"

        trade_memory = TradeMemory(
            symbol=state.symbol,
            title="Pipeline trade decision",
            content=f"status={status}, action={action}, setup={setup}",
            confidence=float(signal.get("confidence", 0.5)),
            tags=["trade", "pipeline", status],
            context={
                "execution": execution,
                "risk": risk,
                "reasoning": reasoning,
            },
            trade_id=str(uuid.uuid4()),
            signal_action=action,
            entry_price=float(signal.get("close_price", 0.0)),
            setup=setup,
            regime=regime,
            outcome=outcome,
        )
        state.brain.add_memory(trade_memory)
        append_journal_entry(
            {
                "symbol": state.symbol,
                "setup": setup,
                "regime": regime,
                "action": action,
                "status": status,
                "execution": execution,
                "risk": risk,
                "reasoning": reasoning,
            }
        )

        # Keep stats moving with a neutral outcome unless caller updates later.
        if outcome == "open":
            state.brain.update_trade_outcome(
                symbol=state.symbol,
                setup=setup,
                regime=regime,
                outcome="open",
                confidence_delta=0.0,
            )

        state.data["monitor"] = {
            "recorded_at": utc_now_iso(),
            "brain_stats": state.brain.snapshot().get("stats", {}),
            "learning": build_learning_summary(state.brain, state.symbol),
            "trade_outcome": outcome,
        }
        return state
