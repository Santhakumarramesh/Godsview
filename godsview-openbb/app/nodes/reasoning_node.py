from __future__ import annotations

from typing import Any

from app.state.schemas import BrainState, ReasoningVerdict, StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase, utc_now_iso


class ReasoningNode(NodeBase):
    name = "reasoning_node"

    def run(
        self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore
    ) -> StockBrainState:
        data = payload.get("data", payload)
        signal = data.get("signal", {}) if isinstance(data, dict) else {}
        scoring = data.get("scoring", {}) if isinstance(data, dict) else {}
        hard_gates = data.get("hard_gates", {}) if isinstance(data, dict) else {}
        blocked = bool(payload.get("blocked", False))
        block_reason = str(payload.get("block_reason", ""))

        action = str(signal.get("action", "skip"))
        confidence = max(0.0, min(1.0, float(signal.get("confidence", 0.0))))
        final_score = max(0.0, min(1.0, float(scoring.get("final_score", 0.0))))
        gate_pass = bool(hard_gates.get("pass", False))

        contradictions: list[str] = []
        if blocked:
            contradictions.append(block_reason or "pipeline_blocked")
        if not gate_pass:
            contradictions.extend(
                [str(x) for x in hard_gates.get("failed_reasons", [])]
            )

        if blocked or action == "skip":
            verdict = "no_trade"
            next_state = BrainState.BLOCKED if blocked else BrainState.WATCHING
        elif action == "buy":
            verdict = "strong_long" if final_score >= 0.75 else "watch_long"
            next_state = BrainState.READY
        else:
            verdict = "strong_short" if final_score >= 0.75 else "watch_short"
            next_state = BrainState.READY

        brain.last_reasoning = ReasoningVerdict(
            verdict=verdict,
            confidence=confidence,
            reason=f"action={action}, score={final_score:.3f}, gate_pass={gate_pass}",
            key_factors=[str(x) for x in scoring.get("reasons", [])][:6],
            contradictions=contradictions[:6],
            conditions_to_trigger=["hard_gates_pass", "setup_valid", "risk_approved"],
            conditions_to_block=contradictions[:6],
            scenario_ranking=[],
            memory_comparison=f"cluster_similarity={brain.memory.cluster_similarity:.3f}",
            risk_assessment=f"risk_tradeable={brain.risk_gate.tradeable}",
            computed_at=utc_now_iso(),
        )
        brain.decision.confidence = confidence
        brain.decision.reasoning_summary = brain.last_reasoning.reason
        brain.decision.direction = (
            "long" if action == "buy" else "short" if action == "sell" else None
        )
        brain.decision.state = next_state
        self.mark_live(brain)
        return brain
