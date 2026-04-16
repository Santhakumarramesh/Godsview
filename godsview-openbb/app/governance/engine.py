from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.config import settings
from app.governance.anomaly_detector import AnomalyDetector, AnomalyDetectionConfig
from app.governance.approval_workflow import ApprovalStatus, ApprovalWorkflow
from app.governance.audit_log import AuditLogger, EventType, get_audit_logger
from app.governance.trust_tiers import TrustTierLevel, get_tier_config


class GovernanceEngine:
    """
    Comprehensive governance engine managing:
    - Trust tiers with configurable limits
    - Tier transitions (promotion/demotion)
    - Anomaly detection with auto-demotion
    - Audit logging of all decisions
    - Human approval workflow
    - Emergency kill switch support
    """

    def __init__(
        self,
        initial_tier: TrustTierLevel = TrustTierLevel.TIER_1_OBSERVER,
        audit_logger: Optional[AuditLogger] = None,
        approval_workflow: Optional[ApprovalWorkflow] = None,
        anomaly_detector: Optional[AnomalyDetector] = None,
    ):
        """Initialize governance engine.

        Args:
            initial_tier: Starting trust tier
            audit_logger: AuditLogger instance (uses global if None)
            approval_workflow: ApprovalWorkflow instance (created if None)
            anomaly_detector: AnomalyDetector instance (created if None)
        """
        self.current_tier = initial_tier
        self.audit_logger = audit_logger or get_audit_logger()
        self.approval_workflow = approval_workflow or ApprovalWorkflow()
        self.anomaly_detector = anomaly_detector or AnomalyDetector(AnomalyDetectionConfig())

        # Track state for anomaly detection
        self._backtest_metrics: dict[str, Any] = {}
        self._live_trades: list[dict[str, Any]] = []
        self._daily_trade_counts: list[int] = []
        self._consecutive_profitable_days = 0

    def set_current_tier(self, tier: TrustTierLevel) -> None:
        """Set current trust tier.

        Args:
            tier: New trust tier
        """
        self.current_tier = tier

    def evaluate_trade_permission(
        self,
        symbol: str,
        action: str,
        quantity: int,
        price: float,
        signal_confidence: float,
        correlation_id: str,
        signal_data: dict[str, Any],
        scoring_data: dict[str, Any],
        risk_assessment: dict[str, Any],
        recall_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Evaluate whether a trade should be approved, rejected, or sent for human review.

        This is the main governance decision point called before trade execution.

        Args:
            symbol: Trading symbol
            action: 'buy' or 'sell'
            quantity: Trade quantity
            price: Entry price
            signal_confidence: Signal confidence (0-1)
            correlation_id: Correlation ID for audit trail
            signal_data: Signal analysis data
            scoring_data: Scoring agent results
            risk_assessment: Risk assessment data
            recall_data: Historical performance data

        Returns:
            Dict with keys:
                - approved: bool (should trade execute)
                - tier: TrustTierLevel
                - requires_human_approval: bool
                - approval_request_id: Optional[str] (if human review needed)
                - reason: str
                - restrictions: list[str]
                - metrics: dict
        """
        tier_config = get_tier_config(self.current_tier)

        # Initialize response
        response = {
            "approved": False,
            "tier": self.current_tier,
            "requires_human_approval": False,
            "approval_request_id": None,
            "reason": "unknown",
            "restrictions": [],
            "metrics": {
                "max_position_size_pct": tier_config.max_position_size_pct,
                "max_daily_trades": tier_config.max_daily_trades,
                "max_single_trade_usd": tier_config.max_single_trade_usd,
            },
        }

        # Check kill switch
        if settings.godsview_kill_switch:
            response["reason"] = "kill_switch_active"
            response["restrictions"].append("kill_switch_active")
            self.audit_logger.log_event(
                EventType.KILL_SWITCH_ACTIVATED,
                correlation_id,
                symbol,
                {"reason": "Trade blocked by kill switch"},
                severity="critical",
            )
            return response

        # TIER_0_DISABLED: no trades allowed
        if self.current_tier == TrustTierLevel.TIER_0_DISABLED:
            response["reason"] = "tier_disabled"
            response["restrictions"].append("trading_disabled_tier_0")
            self.audit_logger.log_event(
                EventType.TRADE_SIGNAL,
                correlation_id,
                symbol,
                {
                    "action": action,
                    "quantity": quantity,
                    "signal_confidence": signal_confidence,
                    "blocked_reason": "tier_0_disabled",
                },
                severity="warning",
            )
            return response

        # TIER_1_OBSERVER: no order submission allowed (analysis only)
        if self.current_tier == TrustTierLevel.TIER_1_OBSERVER:
            response["reason"] = "observer_mode"
            response["restrictions"].append("observer_mode_no_orders")
            self.audit_logger.log_event(
                EventType.TRADE_SIGNAL,
                correlation_id,
                symbol,
                {
                    "action": action,
                    "quantity": quantity,
                    "signal_confidence": signal_confidence,
                    "mode": "observer_analysis_only",
                },
            )
            return response

        # Check position size limits
        position_usd = quantity * price
        if position_usd > tier_config.max_single_trade_usd:
            response["reason"] = "exceeds_max_single_trade_usd"
            response["restrictions"].append(
                f"max_single_trade_usd ({position_usd:.2f} > {tier_config.max_single_trade_usd:.2f})"
            )
            response["requires_human_approval"] = True

        # Check daily trade limit
        # NOTE: In real implementation, query actual trade count from execution journal
        daily_trades = len(self._live_trades)  # Simplified
        if daily_trades >= tier_config.max_daily_trades:
            response["reason"] = "daily_trade_limit_reached"
            response["restrictions"].append(
                f"daily_trade_limit ({daily_trades}/{tier_config.max_daily_trades})"
            )
            response["requires_human_approval"] = True

        # TIER_2_SUPERVISED: always requires human approval
        if self.current_tier == TrustTierLevel.TIER_2_SUPERVISED:
            response["requires_human_approval"] = True
            response["reason"] = "tier_supervised_requires_approval"

        # TIER_3_ASSISTED: human approval only for large trades or low confidence
        if self.current_tier == TrustTierLevel.TIER_3_ASSISTED:
            if (
                position_usd > (tier_config.max_single_trade_usd * 0.5)
                or signal_confidence < 0.60
            ):
                response["requires_human_approval"] = True
                response["reason"] = "high_risk_or_low_confidence"

        # TIER_4_AUTONOMOUS: minimal restrictions
        if self.current_tier == TrustTierLevel.TIER_4_AUTONOMOUS:
            response["approved"] = True
            response["reason"] = "autonomous_auto_approved"

        # Create approval request if needed
        if response["requires_human_approval"] and not response["approved"]:
            approval_request = self.approval_workflow.create_approval_request(
                symbol=symbol,
                action=action,
                quantity=quantity,
                price=price,
                signal_confidence=signal_confidence,
                correlation_id=correlation_id,
                signal_data=signal_data,
                scoring_data=scoring_data,
                risk_assessment=risk_assessment,
                recall_data=recall_data,
            )
            response["approval_request_id"] = approval_request.request_id
            response["reason"] = "awaiting_human_approval"

            self.audit_logger.log_event(
                EventType.APPROVAL_REQUIRED,
                correlation_id,
                symbol,
                {
                    "action": action,
                    "quantity": quantity,
                    "price": price,
                    "signal_confidence": signal_confidence,
                    "approval_request_id": approval_request.request_id,
                    "tier": self.current_tier.name,
                },
            )
        elif not response["restrictions"]:
            response["approved"] = True
            response["reason"] = "governance_approved"

            self.audit_logger.log_event(
                EventType.TRADE_SIGNAL,
                correlation_id,
                symbol,
                {
                    "action": action,
                    "quantity": quantity,
                    "price": price,
                    "signal_confidence": signal_confidence,
                    "tier": self.current_tier.name,
                    "status": "approved",
                },
            )

        return response

    def record_trade_execution(
        self,
        correlation_id: str,
        symbol: str,
        action: str,
        quantity: int,
        entry_price: float,
        order_id: str,
    ) -> None:
        """Record that a trade was submitted to the market.

        Args:
            correlation_id: Correlation ID from signal
            symbol: Trading symbol
            action: 'buy' or 'sell'
            quantity: Trade quantity
            entry_price: Execution price
            order_id: Broker order ID
        """
        self.audit_logger.log_event(
            EventType.TRADE_SUBMITTED,
            correlation_id,
            symbol,
            {
                "action": action,
                "quantity": quantity,
                "entry_price": entry_price,
                "order_id": order_id,
                "tier": self.current_tier.name,
            },
        )

    def record_trade_fill(
        self,
        correlation_id: str,
        symbol: str,
        action: str,
        filled_qty: int,
        filled_price: float,
        slippage_pct: float,
        order_id: str,
    ) -> None:
        """Record that a trade was filled by the market.

        Args:
            correlation_id: Correlation ID
            symbol: Trading symbol
            action: 'buy' or 'sell'
            filled_qty: Quantity filled
            filled_price: Execution price
            slippage_pct: Slippage as percentage
            order_id: Broker order ID
        """
        self.audit_logger.log_event(
            EventType.TRADE_FILLED,
            correlation_id,
            symbol,
            {
                "action": action,
                "filled_qty": filled_qty,
                "filled_price": filled_price,
                "slippage_pct": slippage_pct,
                "order_id": order_id,
            },
        )

        # Track for anomaly detection
        self._live_trades.append(
            {
                "symbol": symbol,
                "action": action,
                "quantity": filled_qty,
                "price": filled_price,
                "slippage_pct": slippage_pct,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    def record_trade_outcome(
        self,
        correlation_id: str,
        symbol: str,
        exit_price: float,
        pnl: float,
        pnl_pct: float,
    ) -> None:
        """Record that a trade closed with a P&L outcome.

        Args:
            correlation_id: Correlation ID
            symbol: Trading symbol
            exit_price: Exit price
            pnl: P&L in dollars
            pnl_pct: P&L as percentage
        """
        self.audit_logger.log_event(
            EventType.TRADE_FILLED,
            correlation_id,
            symbol,
            {
                "exit_price": exit_price,
                "pnl": pnl,
                "pnl_pct": pnl_pct,
            },
        )

        # Update tracking for anomaly detection
        if self._live_trades:
            self._live_trades[-1]["pnl"] = pnl
            self._live_trades[-1]["pnl_pct"] = pnl_pct

    def run_anomaly_detection(
        self,
        backtest_metrics: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Run anomaly detection checks against live performance.

        Auto-demotes tier by 1 level if anomalies detected.

        Args:
            backtest_metrics: Dict with backtest metrics (win_rate, max_drawdown_pct, etc.)

        Returns:
            List of detected anomalies
        """
        self._backtest_metrics = backtest_metrics

        # Run all checks
        anomalies = self.anomaly_detector.run_all_checks(
            backtest_metrics=backtest_metrics,
            live_trades=self._live_trades,
            daily_trade_counts=self._daily_trade_counts,
        )

        # Log each anomaly and demote tier if critical
        for anomaly in anomalies:
            severity = "critical" if anomaly.severity == "critical" else "warning"

            self.audit_logger.log_event(
                EventType.ANOMALY_DETECTED,
                f"anomaly_{uuid.uuid4().hex[:8]}",
                "",
                {
                    "anomaly_type": anomaly.anomaly_type.value if anomaly.anomaly_type else None,
                    "message": anomaly.message,
                    "metrics": anomaly.metrics,
                    "current_tier": self.current_tier.name,
                },
                severity=severity,
            )

            # Auto-demote by 1 tier on critical anomalies
            if anomaly.severity == "critical" and self.current_tier.value > 0:
                new_tier = TrustTierLevel(self.current_tier.value - 1)
                self.promote_or_demote_tier(
                    new_tier=new_tier,
                    reason=f"anomaly_detection_{anomaly.anomaly_type.value if anomaly.anomaly_type else 'unknown'}",
                    triggered_by="anomaly_detector",
                )

        return [
            {
                "anomaly_type": a.anomaly_type.value if a.anomaly_type else None,
                "severity": a.severity,
                "message": a.message,
                "metrics": a.metrics,
            }
            for a in anomalies
        ]

    def promote_or_demote_tier(
        self,
        new_tier: TrustTierLevel,
        reason: str,
        triggered_by: str = "manual",
        user_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Promote or demote the trust tier.

        Args:
            new_tier: Target trust tier
            reason: Reason for tier change
            triggered_by: Who/what triggered it ('anomaly_detector', 'manual', 'performance_check')
            user_id: User ID if manually triggered

        Returns:
            Dict with transition details
        """
        old_tier = self.current_tier

        if new_tier == old_tier:
            return {
                "changed": False,
                "old_tier": old_tier.name,
                "new_tier": new_tier.name,
                "reason": "no_change_requested",
            }

        event_type = (
            EventType.TIER_PROMOTED
            if new_tier.value > old_tier.value
            else EventType.TIER_DEMOTED
        )

        self.current_tier = new_tier

        self.audit_logger.log_event(
            event_type,
            f"tier_change_{uuid.uuid4().hex[:8]}",
            "",
            {
                "old_tier": old_tier.name,
                "new_tier": new_tier.name,
                "reason": reason,
                "triggered_by": triggered_by,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            user_id=user_id,
            severity="warning" if event_type == EventType.TIER_DEMOTED else "info",
        )

        return {
            "changed": True,
            "old_tier": old_tier.name,
            "new_tier": new_tier.name,
            "reason": reason,
            "triggered_by": triggered_by,
        }

    def emergency_demote_to_tier_0(
        self,
        reason: str = "emergency_kill_switch",
        user_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Emergency demote to TIER_0_DISABLED (instant kill switch).

        Args:
            reason: Reason for emergency demotion
            user_id: User ID who triggered it

        Returns:
            Dict with transition details
        """
        old_tier = self.current_tier
        self.current_tier = TrustTierLevel.TIER_0_DISABLED

        self.audit_logger.log_event(
            EventType.TIER_EMERGENCY_DEMOTION,
            f"emergency_kill_{uuid.uuid4().hex[:8]}",
            "",
            {
                "old_tier": old_tier.name,
                "new_tier": TrustTierLevel.TIER_0_DISABLED.name,
                "reason": reason,
            },
            user_id=user_id,
            severity="critical",
        )

        return {
            "changed": True,
            "old_tier": old_tier.name,
            "new_tier": TrustTierLevel.TIER_0_DISABLED.name,
            "reason": reason,
            "is_emergency": True,
        }

    def get_status(self) -> dict[str, Any]:
        """Get current governance status.

        Returns:
            Dict with current tier, limits, pending approvals, recent anomalies
        """
        tier_config = get_tier_config(self.current_tier)
        pending = self.approval_workflow.get_pending_requests()

        return {
            "current_tier": self.current_tier.name,
            "tier_level": self.current_tier.value,
            "tier_config": {
                "name": tier_config.name,
                "description": tier_config.description,
                "max_position_size_pct": tier_config.max_position_size_pct,
                "max_daily_trades": tier_config.max_daily_trades,
                "max_single_trade_usd": tier_config.max_single_trade_usd,
                "requires_human_approval": tier_config.requires_human_approval,
                "profit_factor_threshold": tier_config.profit_factor_threshold,
                "max_drawdown_threshold_pct": tier_config.max_drawdown_threshold_pct,
            },
            "pending_approvals_count": len(pending),
            "live_trades_count": len(self._live_trades),
            "kill_switch_active": settings.godsview_kill_switch,
            "audit_event_count": self.audit_logger.get_event_count(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
