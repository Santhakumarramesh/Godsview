from __future__ import annotations

import uuid

from app.agents.base import Agent, AgentState, utc_now_iso
from app.brain.learning import build_learning_summary
from app.brain.schema import TradeMemory
from app.execution.journal import append_journal_entry
from app.utils import write_json


class MonitorAgent(Agent):
    name = "monitor_agent"

    def run(self, state: AgentState) -> AgentState:
        signal = state.data.get("signal", {})
        market = state.data.get("market", {})
        reasoning = state.data.get("reasoning", {})
        risk = state.data.get("risk", {})
        execution = state.data.get("execution", {})
        hard_gates = state.data.get("hard_gates", {})
        scoring = state.data.get("scoring", {})

        action = str(reasoning.get("final_action", signal.get("action", "skip")))
        setup = str(signal.get("setup", "unknown"))
        regime = str(market.get("regime", "unknown"))
        status = str(execution.get("status", "blocked"))

        outcome = "open"
        if status in {"blocked", "error", "pending_human_approval"}:
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
                "hard_gates": hard_gates,
                "scoring": scoring,
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
                "hard_gates": hard_gates,
                "scoring": scoring,
                "block_reason": state.block_reason,
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
        review_snapshot = {
            "symbol": state.symbol,
            "recorded_at": utc_now_iso(),
            "setup": setup,
            "regime": regime,
            "action": action,
            "status": status,
            "block_reason": state.block_reason,
            "hard_gates": hard_gates,
            "scoring": scoring,
            "reasoning": reasoning,
            "risk": risk,
            "execution": execution,
        }
        write_json("data/processed/latest_review_snapshot.json", review_snapshot)
        state.data["review_snapshot"] = review_snapshot
        return state
