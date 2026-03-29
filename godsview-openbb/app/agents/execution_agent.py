from __future__ import annotations

from app.agents.base import Agent, AgentState
from app.broker import place_market_order


class ExecutionAgent(Agent):
    name = "execution_agent"

    def run(self, state: AgentState) -> AgentState:
        if state.blocked:
            state.data["execution"] = {"status": "blocked", "reason": state.block_reason}
            return state

        reasoning = state.data.get("reasoning")
        risk = state.data.get("risk")
        if not isinstance(reasoning, dict) or not isinstance(risk, dict):
            state.set_blocked("missing_execution_inputs")
            state.data["execution"] = {"status": "blocked", "reason": state.block_reason}
            return state

        action = str(reasoning.get("final_action", "skip"))
        qty = int(risk.get("qty", 0))
        if action not in {"buy", "sell"} or qty <= 0:
            state.set_blocked("invalid_execution_payload")
            state.data["execution"] = {"status": "blocked", "reason": state.block_reason}
            return state

        if state.dry_run or not state.live:
            state.data["execution"] = {
                "status": "simulated",
                "side": action,
                "qty": qty,
            }
            return state

        try:
            order = place_market_order(state.symbol, qty, action)
            state.data["execution"] = {
                "status": "submitted",
                "side": action,
                "qty": qty,
                "order_id": str(getattr(order, "id", "")),
            }
            return state
        except Exception as err:  # noqa: BLE001
            state.add_error(f"execution_agent_error: {err}")
            state.set_blocked("execution_failed")
            state.data["execution"] = {"status": "error", "reason": str(err)}
            return state

