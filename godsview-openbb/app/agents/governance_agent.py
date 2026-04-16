from __future__ import annotations

import time
from typing import Any

from app.agents.base import Agent, AgentState
from app.config import settings


class GovernanceAgent(Agent):
    """
    Governance Agent - policy enforcement and human approval gating.

    Checks trust tier of the strategy, validates against:
      - Daily trade limits
      - Loss limits
      - Exposure limits
      - Human approval requirements based on confidence/size thresholds

    Returns: approved (bool), tier (str), requires_human (bool), reason, restrictions.
    """

    name = "governance_agent"

    # Trust tiers and thresholds
    TIERS = {
        "trusted": {"score_threshold": 0.80, "requires_human": False},
        "standard": {"score_threshold": 0.65, "requires_human": False},
        "cautious": {"score_threshold": 0.50, "requires_human": True},
        "restricted": {"score_threshold": 0.40, "requires_human": True},
    }

    def run(self, state: AgentState) -> AgentState:
        """
        Evaluate governance constraints and determine approval.

        Args:
            state: Current agent state

        Returns:
            Updated agent state with governance assessment
        """
        if state.blocked:
            return state

        try:
            start_time = time.time()

            # Extract scoring and risk data
            scoring = state.data.get("scoring_agent", {})
            risk = state.data.get("risk", {})
            reasoning = state.data.get("reasoning", {})

            final_score = float(scoring.get("final_score", 0.3))
            action = str(reasoning.get("final_action", "skip")).lower()
            qty = int(risk.get("qty", 0))

            # Classify trust tier
            tier = self._classify_tier(final_score)

            # Check all governance constraints
            restrictions = []
            approved = True
            reason = "governance_approved"

            # Kill switch override
            if settings.godsview_kill_switch:
                approved = False
                reason = "kill_switch_active"
                restrictions.append("kill_switch_active")

            # Action validation
            if action not in {"buy", "sell"}:
                approved = False
                reason = "invalid_action"
                restrictions.append("invalid_action")

            # Quantity validation
            if qty <= 0:
                approved = False
                reason = "invalid_quantity"
                restrictions.append("zero_or_negative_qty")

            # Score threshold for tier
            tier_config = self.TIERS.get(tier, self.TIERS["restricted"])
            if final_score < tier_config["score_threshold"]:
                approved = False
                reason = f"score_below_tier_threshold_{tier}"
                restrictions.append(f"tier_{tier}_score_threshold")

            # Daily trade limit check
            from app.execution.journal import get_trade_count_today
            trades_today = get_trade_count_today(state.symbol)
            if trades_today >= settings.max_trades_per_day:
                approved = False
                reason = "max_daily_trades_exceeded"
                restrictions.append(f"daily_trade_limit ({trades_today}/{settings.max_trades_per_day})")

            # Daily loss check
            max_daily_loss = settings.max_daily_loss
            day_pnl_pct = float(risk.get("day_pnl_pct", 0.0))
            if day_pnl_pct <= -max_daily_loss:
                approved = False
                reason = "max_daily_loss_exceeded"
                restrictions.append(f"daily_loss_limit ({day_pnl_pct:.2%})")

            # Position count check
            max_positions = settings.max_positions
            if qty > max_positions:
                approved = False
                reason = "position_size_exceeds_limit"
                restrictions.append(f"max_position_size ({qty} > {max_positions})")

            # Risk per trade check
            max_risk = settings.max_risk_per_trade
            position_risk_pct = float(risk.get("position_risk_pct", 0.0))
            if position_risk_pct > max_risk:
                approved = False
                reason = "risk_exceeds_max_per_trade"
                restrictions.append(f"max_risk_per_trade ({position_risk_pct:.2%} > {max_risk:.2%})")

            # Determine if human approval required
            requires_human = False
            if state.live and settings.human_approval_required:
                requires_human = True
            elif tier_config["requires_human"] and state.live:
                requires_human = True
            elif final_score < 0.60 and qty > 0:
                requires_human = True

            governance_assessment = {
                "approved": approved,
                "tier": tier,
                "requires_human": requires_human,
                "reason": reason,
                "restrictions": restrictions,
                "constraints_checked": {
                    "kill_switch": not settings.godsview_kill_switch,
                    "daily_trade_limit": trades_today < settings.max_trades_per_day,
                    "daily_loss_limit": day_pnl_pct > -max_daily_loss,
                    "position_limit": qty <= max_positions,
                    "risk_per_trade": position_risk_pct <= max_risk,
                    "tier_score_threshold": final_score >= tier_config["score_threshold"],
                },
                "elapsed_ms": int((time.time() - start_time) * 1000),
            }

            state.data["governance_agent"] = governance_assessment
            return state

        except Exception as err:  # noqa: BLE001
            state.add_error(f"governance_agent_error: {err}")
            # Graceful degradation: conservative approval
            state.data["governance_agent"] = {
                "approved": False,
                "tier": "restricted",
                "requires_human": True,
                "reason": "governance_error",
                "restrictions": ["governance_evaluation_failed"],
                "error": str(err),
            }
            return state

    @staticmethod
    def _classify_tier(final_score: float) -> str:
        """
        Classify strategy trust tier based on final score.

        Args:
            final_score: Final confidence score (0-1)

        Returns:
            Tier: 'trusted', 'standard', 'cautious', or 'restricted'
        """
        if final_score >= 0.80:
            return "trusted"
        if final_score >= 0.65:
            return "standard"
        if final_score >= 0.50:
            return "cautious"
        return "restricted"
