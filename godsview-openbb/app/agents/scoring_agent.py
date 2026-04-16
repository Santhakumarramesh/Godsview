from __future__ import annotations

import time
from typing import Any

from app.agents.base import Agent, AgentState


class ScoringAgent(Agent):
    """
    Independent Scoring Agent - produces composite confidence score.

    Takes all agent outputs and produces independent confidence score using
    weighted scoring model:
      - Structure confidence: 25%
      - Order flow confirmation: 20%
      - Macro alignment: 15%
      - Recall historical success: 15%
      - Risk assessment: 15%
      - Signal quality: 10%

    Returns final_score (0-1), breakdown, conflicts, and recommendation.
    """

    name = "scoring_agent"

    # Weights must sum to 1.0
    WEIGHTS = {
        "structure": 0.25,
        "order_flow": 0.20,
        "macro": 0.15,
        "recall": 0.15,
        "risk": 0.15,
        "signal": 0.10,
    }

    def run(self, state: AgentState) -> AgentState:
        """
        Compute independent confidence score from all agent outputs.

        Args:
            state: Current agent state with all prior agent data

        Returns:
            Updated agent state with scoring_agent data
        """
        if state.blocked:
            return state

        try:
            start_time = time.time()

            # Extract input data from all sources
            signal = state.data.get("signal", {})
            setup_validation = signal.get("setup_validation", {})
            macro_agent = state.data.get("macro_agent", {})
            recall_agent = state.data.get("recall_agent", {})
            risk = state.data.get("risk", {})

            # Compute component scores
            scores = {
                "structure": self._score_structure(setup_validation),
                "order_flow": self._score_order_flow(signal),
                "macro": self._score_macro(macro_agent),
                "recall": self._score_recall(recall_agent),
                "risk": self._score_risk(risk),
                "signal": self._score_signal(signal),
            }

            # Compute weighted final score
            final_score = sum(
                scores[key] * self.WEIGHTS[key]
                for key in self.WEIGHTS
            )
            final_score = max(0.0, min(1.0, final_score))

            # Determine recommendation
            recommendation = self._get_recommendation(final_score)

            # Detect conflicts between components
            conflicts = self._detect_conflicts(scores)

            scoring_assessment = {
                "final_score": float(final_score),
                "breakdown": {k: float(v) for k, v in scores.items()},
                "weights": self.WEIGHTS,
                "recommendation": recommendation,
                "conflicts": conflicts,
                "elapsed_ms": int((time.time() - start_time) * 1000),
            }

            state.data["scoring_agent"] = scoring_assessment
            return state

        except Exception as err:  # noqa: BLE001
            state.add_error(f"scoring_agent_error: {err}")
            # Graceful degradation: return conservative score
            state.data["scoring_agent"] = {
                "final_score": 0.3,
                "breakdown": {
                    "structure": 0.5,
                    "order_flow": 0.3,
                    "macro": 0.5,
                    "recall": 0.5,
                    "risk": 0.3,
                    "signal": 0.3,
                },
                "weights": self.WEIGHTS,
                "recommendation": "hold",
                "conflicts": ["scoring_compute_error"],
                "error": str(err),
            }
            return state

    @staticmethod
    def _score_structure(setup_validation: dict[str, Any]) -> float:
        """
        Score structure confidence based on setup validation.

        Args:
            setup_validation: Setup validation result from signal agent

        Returns:
            Score (0-1)
        """
        if not isinstance(setup_validation, dict):
            return 0.5

        valid = bool(setup_validation.get("valid", False))
        if not valid:
            return 0.2

        confidence = float(setup_validation.get("confidence", 0.5))
        return min(1.0, max(0.0, confidence))

    @staticmethod
    def _score_order_flow(signal: dict[str, Any]) -> float:
        """
        Score order flow confirmation from signal data.

        Args:
            signal: Signal agent output

        Returns:
            Score (0-1)
        """
        if not isinstance(signal, dict):
            return 0.5

        confidence = float(signal.get("confidence", 0.5))
        action = str(signal.get("action", "skip")).lower()

        # Skip signals score low
        if action == "skip":
            return 0.2

        # High confidence signals score high
        return min(1.0, max(0.0, confidence))

    @staticmethod
    def _score_macro(macro_agent: dict[str, Any]) -> float:
        """
        Score macro alignment.

        Args:
            macro_agent: Macro agent output

        Returns:
            Score (0-1)
        """
        if not isinstance(macro_agent, dict):
            return 0.5

        macro_score = float(macro_agent.get("macro_score", 0.5))
        regime = str(macro_agent.get("regime", "neutral")).lower()

        # Risk-off regimes score lower
        if regime == "risk_off":
            macro_score *= 0.8

        return min(1.0, max(0.0, macro_score))

    @staticmethod
    def _score_recall(recall_agent: dict[str, Any]) -> float:
        """
        Score based on historical recall statistics.

        Args:
            recall_agent: Recall agent output

        Returns:
            Score (0-1)
        """
        if not isinstance(recall_agent, dict):
            return 0.5

        win_rate = float(recall_agent.get("historical_win_rate", 0.5))
        similar_count = int(recall_agent.get("similar_count", 0))

        # No history = neutral
        if similar_count < 3:
            return 0.5

        # High win rate = high score
        return min(1.0, max(0.0, win_rate))

    @staticmethod
    def _score_risk(risk: dict[str, Any]) -> float:
        """
        Score risk assessment approval.

        Args:
            risk: Risk agent output

        Returns:
            Score (0-1)
        """
        if not isinstance(risk, dict):
            return 0.5

        allowed = bool(risk.get("allowed", False))
        if not allowed:
            return 0.1

        # Risk approved: score based on qty vs account
        qty = int(risk.get("qty", 0))
        if qty > 0:
            return 0.8
        return 0.3

    @staticmethod
    def _score_signal(signal: dict[str, Any]) -> float:
        """
        Score signal quality independently.

        Args:
            signal: Signal agent output

        Returns:
            Score (0-1)
        """
        if not isinstance(signal, dict):
            return 0.5

        confidence = float(signal.get("confidence", 0.5))
        action = str(signal.get("action", "skip")).lower()

        if action == "skip":
            return 0.2

        # Scale confidence but cap it
        return min(1.0, max(0.0, confidence * 0.9))

    @staticmethod
    def _detect_conflicts(scores: dict[str, float]) -> list[str]:
        """
        Detect conflicts between component scores.

        Args:
            scores: Component scores dictionary

        Returns:
            List of detected conflicts
        """
        conflicts = []

        # If signal is high but risk is low, conflict
        if scores["signal"] > 0.65 and scores["risk"] < 0.3:
            conflicts.append("signal_vs_risk_conflict")

        # If signal is high but macro is low, conflict
        if scores["signal"] > 0.65 and scores["macro"] < 0.35:
            conflicts.append("signal_vs_macro_conflict")

        # If recall is bad but other signals good, warning
        if scores["recall"] < 0.3 and scores["signal"] > 0.65:
            conflicts.append("historical_performance_warning")

        # If structure is weak but overall high, conflict
        if scores["structure"] < 0.4 and sum(scores.values()) / len(scores) > 0.6:
            conflicts.append("structure_vs_consensus_conflict")

        return conflicts

    @staticmethod
    def _get_recommendation(final_score: float) -> str:
        """
        Generate recommendation based on final score.

        Args:
            final_score: Weighted final score (0-1)

        Returns:
            Recommendation: 'strong_buy', 'buy', 'hold', 'sell', 'strong_sell'
        """
        if final_score >= 0.80:
            return "strong_buy"
        if final_score >= 0.65:
            return "buy"
        if final_score >= 0.40:
            return "hold"
        if final_score >= 0.25:
            return "sell"
        return "strong_sell"
