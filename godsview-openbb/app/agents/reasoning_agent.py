from __future__ import annotations

from app.agents.base import Agent, AgentState
from app.brain.reasoning import compose_reasoning_decision
from app.brain.schema import EpisodicMemory


class ReasoningAgent(Agent):
    name = "reasoning_agent"

    def run(self, state: AgentState) -> AgentState:
        if state.blocked:
            return state

        signal = state.data.get("signal")
        # market context is consumed by other agents; reasoning_agent only
        # uses signal/mtf/sentiment/macro/scoring.
        mtf = state.data.get("mtf", {})
        sentiment = state.data.get("sentiment", {})
        macro = state.data.get("macro", {})
        scoring = state.data.get("scoring", {})
        setup_candidate = None
        if isinstance(signal, dict):
            setup_candidate = signal.get("setup_candidate")
        if not isinstance(signal, dict):
            state.set_blocked("missing_signal")
            return state

        memory_tail = state.brain.get_memories(
            state.symbol, memory_type="trade", limit=40
        )
        recent_losses = len([m for m in memory_tail if str(m.get("outcome")) == "loss"])
        recent_total = len(memory_tail)
        recent_loss_rate = (recent_losses / recent_total) if recent_total > 0 else 0.0

        decision = compose_reasoning_decision(
            symbol=state.symbol,
            signal=signal,
            setup_candidate=setup_candidate
            if isinstance(setup_candidate, dict)
            else None,
            scoring=scoring if isinstance(scoring, dict) else None,
            sentiment=sentiment if isinstance(sentiment, dict) else None,
            macro=macro if isinstance(macro, dict) else None,
            memory_tail=memory_tail,
        )
        confluence = (
            float(mtf.get("summary", {}).get("confluence", 0.0))
            if isinstance(mtf, dict)
            else 0.0
        )
        if confluence < 0.45 and bool(decision.get("approved", False)):
            decision["approved"] = False
            decision["final_action"] = "skip"
            reasons = list(decision.get("reasons", []))
            reasons.append("mtf_confluence_too_low")
            decision["reasons"] = reasons
        reasoning = {
            "approved": bool(decision.get("approved", False)),
            "final_action": str(decision.get("final_action", "skip")),
            "reasons": decision.get("reasons", []),
            "recent_loss_rate": recent_loss_rate,
            "recent_trades": recent_total,
            "mtf_confluence": confluence,
            "final_score": float(decision.get("final_score", 0.0)),
            "challenge_points": decision.get("challenge_points", []),
            "past_episode_stats": decision.get("past_episode_stats", {}),
            "inputs": decision.get("inputs", {}),
        }
        reasoning["explanation"] = (
            f"action={reasoning['final_action']} approved={reasoning['approved']} "
            f"score={reasoning['final_score']:.3f} "
            f"recent_loss_rate={reasoning['recent_loss_rate']:.2f}"
        )
        state.data["reasoning"] = reasoning

        state.brain.add_memory(
            EpisodicMemory(
                symbol=state.symbol,
                title="Reasoning decision",
                content=f"approved={reasoning['approved']}, action={reasoning['final_action']}",
                confidence=float(signal.get("confidence", 0.5)),
                tags=["reasoning", "decision"],
                context=reasoning,
            )
        )

        if not reasoning["approved"]:
            state.set_blocked("reasoning_veto")

        return state
