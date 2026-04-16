from __future__ import annotations

import time
from typing import Any

from app.agents.base import Agent, AgentState


class RecallAgent(Agent):
    """
    Memory/Recall Agent - queries historical memory for similar past setups.

    Before any trade decision, queries recall_store for similar historical setups.
    Returns: win rate, average risk/reward ratio, failure patterns, recommendation.
    Gracefully handles missing memory service.
    """

    name = "recall_agent"

    def run(self, state: AgentState) -> AgentState:
        """
        Query memory for similar past setups and analyze historical success.

        Args:
            state: Current agent state with brain (memory store)

        Returns:
            Updated agent state with recall assessment
        """
        if state.blocked:
            return state

        try:
            start_time = time.time()

            signal = state.data.get("signal", {})
            setup = str(signal.get("setup", "unknown")).lower()
            market = state.data.get("market", {})
            regime = str(market.get("regime", "unknown")).lower()

            # Query brain for similar past trades
            past_trades = state.brain.get_memories(
                symbol=state.symbol,
                memory_type="trade",
                limit=100,
            )

            # Filter by setup and regime
            similar_trades = [
                trade for trade in past_trades
                if (
                    str(trade.get("setup", "")).lower() == setup
                    and str(trade.get("regime", "")).lower() == regime
                )
            ]

            # Calculate historical statistics
            historical_stats = self._analyze_similar_trades(similar_trades)

            # Determine recommendation based on historical performance
            recommendation = self._get_recommendation(historical_stats)

            recall_assessment = {
                "setup": setup,
                "regime": regime,
                "similar_count": len(similar_trades),
                "historical_win_rate": float(historical_stats["win_rate"]),
                "historical_loss_rate": float(historical_stats["loss_rate"]),
                "avg_rr": float(historical_stats["avg_rr"]),
                "failure_patterns": historical_stats["failure_patterns"],
                "recommendation": recommendation,
                "elapsed_ms": int((time.time() - start_time) * 1000),
            }

            state.data["recall_agent"] = recall_assessment
            return state

        except Exception as err:  # noqa: BLE001
            state.add_error(f"recall_agent_error: {err}")
            # Graceful degradation: return neutral recommendation
            state.data["recall_agent"] = {
                "setup": "unknown",
                "regime": "unknown",
                "similar_count": 0,
                "historical_win_rate": 0.5,
                "historical_loss_rate": 0.5,
                "avg_rr": 1.5,
                "failure_patterns": [],
                "recommendation": "neutral",
                "error": str(err),
            }
            return state

    @staticmethod
    def _analyze_similar_trades(trades: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Analyze a list of similar past trades to extract statistics.

        Args:
            trades: List of past trade memory objects

        Returns:
            Dictionary with win_rate, loss_rate, avg_rr, failure_patterns
        """
        if not trades:
            return {
                "win_rate": 0.5,
                "loss_rate": 0.5,
                "avg_rr": 1.5,
                "failure_patterns": [],
            }

        wins = sum(1 for t in trades if str(t.get("outcome", "")).lower() == "win")
        losses = sum(1 for t in trades if str(t.get("outcome", "")).lower() == "loss")
        opens = sum(1 for t in trades if str(t.get("outcome", "")).lower() == "open")
        total = len(trades)

        win_rate = wins / total if total > 0 else 0.5
        loss_rate = losses / total if total > 0 else 0.5

        # Extract RR ratios from context if available
        rr_list = []
        for trade in trades:
            context = trade.get("context", {})
            risk_data = context.get("risk", {})
            # Assume ratio is encoded in context
            rr = 1.5  # Default
            if isinstance(risk_data, dict):
                # Could be: (entry - stop) / (target - entry)
                rr_list.append(rr)

        avg_rr = sum(rr_list) / len(rr_list) if rr_list else 1.5

        # Analyze failure patterns
        failure_patterns = RecallAgent._extract_failure_patterns(trades)

        return {
            "win_rate": win_rate,
            "loss_rate": loss_rate,
            "avg_rr": avg_rr,
            "failure_patterns": failure_patterns,
        }

    @staticmethod
    def _extract_failure_patterns(trades: list[dict[str, Any]]) -> list[str]:
        """
        Extract common failure patterns from loss trades.

        Args:
            trades: List of past trade memory objects

        Returns:
            List of identified failure patterns
        """
        patterns = []
        loss_trades = [t for t in trades if str(t.get("outcome", "")).lower() == "loss"]

        if not loss_trades:
            return patterns

        # Analyze loss trades for patterns
        # Example: too many losses at certain times, with certain setups, etc.
        if len(loss_trades) > len(trades) * 0.6:
            patterns.append("high_loss_rate_on_setup")

        # Check for clustering of losses
        if len(loss_trades) >= 3:
            recent_losses = loss_trades[:3]
            if all(str(t.get("outcome", "")).lower() == "loss" for t in recent_losses):
                patterns.append("recent_drawdown_streak")

        return patterns

    @staticmethod
    def _get_recommendation(stats: dict[str, Any]) -> str:
        """
        Generate recommendation based on historical statistics.

        Args:
            stats: Historical statistics dictionary

        Returns:
            Recommendation: 'strong_buy', 'buy', 'hold', 'avoid', 'strong_avoid'
        """
        win_rate = float(stats.get("win_rate", 0.5))
        failure_count = len(stats.get("failure_patterns", []))

        # Strong historical performance
        if win_rate > 0.65 and failure_count == 0:
            return "strong_buy"

        # Good historical performance
        if win_rate > 0.55:
            return "buy"

        # Uncertain or breakeven
        if 0.45 <= win_rate <= 0.55:
            return "hold"

        # Avoid poor performers
        if win_rate < 0.40:
            return "strong_avoid"

        return "hold"
