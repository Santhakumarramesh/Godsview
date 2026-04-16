from __future__ import annotations

import uuid
from typing import Any

from app.governance.engine import GovernanceEngine
from app.governance.trust_tiers import TrustTierLevel


class GovernanceIntegrationExample:
    """Example code showing how to integrate GovernanceEngine into trading system."""

    @staticmethod
    def initialize_governance() -> GovernanceEngine:
        """Initialize the governance engine at startup.

        Example:
            engine = GovernanceIntegrationExample.initialize_governance()
            from app.governance.routes import set_governance_engine
            set_governance_engine(engine)
        """
        engine = GovernanceEngine(
            initial_tier=TrustTierLevel.TIER_1_OBSERVER,
        )
        return engine

    @staticmethod
    def evaluate_trade_before_execution(
        engine: GovernanceEngine,
        symbol: str = "BTCUSD",
        action: str = "buy",
        quantity: int = 1,
        price: float = 42000.0,
        signal_confidence: float = 0.75,
        signal_data: dict[str, Any] | None = None,
        scoring_data: dict[str, Any] | None = None,
        risk_assessment: dict[str, Any] | None = None,
        recall_data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Example: Call governance engine to evaluate a trade decision.

        This is the critical gate that happens BEFORE executing any trade.

        Usage in your signal/execution pipeline:
            governance_result = evaluate_trade_before_execution(
                engine, symbol, action, qty, price, confidence, ...
            )
            if governance_result["approved"]:
                # Execute trade
                pass
            elif governance_result["requires_human_approval"]:
                # Wait for human approval via API
                pass
            else:
                # Skip trade (blocked by governance)
                pass
        """
        correlation_id = str(uuid.uuid4())

        result = engine.evaluate_trade_permission(
            symbol=symbol,
            action=action,
            quantity=quantity,
            price=price,
            signal_confidence=signal_confidence,
            correlation_id=correlation_id,
            signal_data=signal_data or {},
            scoring_data=scoring_data or {},
            risk_assessment=risk_assessment or {},
            recall_data=recall_data or {},
        )

        return {
            "correlation_id": correlation_id,
            **result,
        }

    @staticmethod
    def record_trade_execution_example(
        engine: GovernanceEngine,
        correlation_id: str,
        symbol: str = "BTCUSD",
        action: str = "buy",
        quantity: int = 1,
        entry_price: float = 42000.0,
        order_id: str = "BROKER_ORDER_123",
    ) -> None:
        """
        Example: Record that a trade was submitted to broker.

        Call this immediately after broker executes order.
        """
        engine.record_trade_execution(
            correlation_id=correlation_id,
            symbol=symbol,
            action=action,
            quantity=quantity,
            entry_price=entry_price,
            order_id=order_id,
        )

    @staticmethod
    def record_trade_fill_example(
        engine: GovernanceEngine,
        correlation_id: str,
        symbol: str = "BTCUSD",
        action: str = "buy",
        filled_qty: int = 1,
        filled_price: float = 41950.0,
        slippage_pct: float = 0.119,
        order_id: str = "BROKER_ORDER_123",
    ) -> None:
        """
        Example: Record that a trade was filled by the market.

        Call this when broker confirms trade fill.
        """
        engine.record_trade_fill(
            correlation_id=correlation_id,
            symbol=symbol,
            action=action,
            filled_qty=filled_qty,
            filled_price=filled_price,
            slippage_pct=slippage_pct,
            order_id=order_id,
        )

    @staticmethod
    def record_trade_outcome_example(
        engine: GovernanceEngine,
        correlation_id: str,
        symbol: str = "BTCUSD",
        exit_price: float = 42500.0,
        pnl: float = 550.0,  # $550 profit
        pnl_pct: float = 0.0131,  # 1.31% return
    ) -> None:
        """
        Example: Record final outcome when position closes.

        Call this when position closes with realized P&L.
        """
        engine.record_trade_outcome(
            correlation_id=correlation_id,
            symbol=symbol,
            exit_price=exit_price,
            pnl=pnl,
            pnl_pct=pnl_pct,
        )

    @staticmethod
    def run_periodic_anomaly_check(
        engine: GovernanceEngine,
        backtest_metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Example: Run anomaly detection periodically (e.g., daily or after 20 trades).

        Backtest metrics should come from strategy backtest results.

        Usage: Call this in your monitoring loop:
            backtest = {"win_rate": 0.55, "max_drawdown_pct": 18.0, ...}
            anomaly_result = run_periodic_anomaly_check(engine, backtest)
            if anomaly_result["anomalies"]:
                # Alert: anomalies detected
                pass
        """
        if backtest_metrics is None:
            backtest_metrics = {
                "win_rate": 0.55,
                "max_drawdown_pct": 18.0,
                "profit_factor": 1.4,
            }

        anomalies = engine.run_anomaly_detection(backtest_metrics)

        return {
            "anomalies": anomalies,
            "count": len(anomalies),
            "current_tier": engine.current_tier.name,
            "tier_changed": len(anomalies) > 0,  # Auto-demotion may occur
        }

    @staticmethod
    def manual_tier_promotion_example(
        engine: GovernanceEngine,
        new_tier: str = "TIER_3_ASSISTED",
        user_id: str = "admin@example.com",
    ) -> dict[str, Any]:
        """
        Example: Manually promote/demote tier (admin operation).

        Requires authentication in real system.
        """
        from app.governance.trust_tiers import TrustTierLevel

        try:
            target_tier = TrustTierLevel[new_tier]
        except KeyError:
            return {"error": f"Unknown tier: {new_tier}"}

        result = engine.promote_or_demote_tier(
            new_tier=target_tier,
            reason=f"Manual override by {user_id}",
            triggered_by="manual_override",
            user_id=user_id,
        )

        return result

    @staticmethod
    def emergency_kill_switch_example(
        engine: GovernanceEngine,
        user_id: str = "admin@example.com",
        reason: str = "Market circuit breaker triggered",
    ) -> dict[str, Any]:
        """
        Example: Trigger emergency demotion to TIER_0_DISABLED.

        This is the nuclear option - instantly disables all trading.
        """
        result = engine.emergency_demote_to_tier_0(
            reason=reason,
            user_id=user_id,
        )

        return result

    @staticmethod
    def check_approval_requests_example(
        engine: GovernanceEngine,
        symbol: str | None = None,
    ) -> dict[str, Any]:
        """
        Example: Check for pending approval requests in a polling loop.

        Usage: Call periodically (e.g., every 10 seconds) in your monitoring:
            pending = check_approval_requests_example(engine)
            for request in pending["pending_requests"]:
                # Alert human: Trade needs approval
                # Show request.to_dict() in UI
        """
        pending = engine.approval_workflow.get_pending_requests(symbol=symbol)

        return {
            "pending_requests": [p.to_dict() for p in pending],
            "count": len(pending),
            "symbol_filter": symbol,
        }

    @staticmethod
    def approve_pending_request_example(
        engine: GovernanceEngine,
        request_id: str = "12345",
        approver_id: str = "analyst@example.com",
        notes: str | None = "Looks good, approve for execution",
    ) -> dict[str, Any]:
        """
        Example: Human approves a pending trade request.

        This would be called from your UI when analyst clicks "Approve" button.
        """
        request = engine.approval_workflow.approve_request(
            request_id=request_id,
            approved_by=approver_id,
            notes=notes,
        )

        if not request:
            return {"error": "Request not found", "request_id": request_id}

        return {
            "status": "approved",
            "request_id": request_id,
            "approved_by": approver_id,
            "symbol": request.symbol,
            "action": request.action,
            "quantity": request.quantity,
        }

    @staticmethod
    def get_governance_status_example(engine: GovernanceEngine) -> dict[str, Any]:
        """
        Example: Get full governance status for dashboard/monitoring.

        Returns current tier, limits, pending approvals, event count, etc.
        """
        return engine.get_status()

    @staticmethod
    def query_audit_trail_example(
        engine: GovernanceEngine,
        correlation_id: str,
    ) -> dict[str, Any]:
        """
        Example: Get full audit trail for a specific trade (for compliance).

        Trace from signal -> approval -> execution -> fill -> outcome.
        """
        logger = engine.audit_logger
        events = logger.get_decision_trail(correlation_id)

        return {
            "correlation_id": correlation_id,
            "event_count": len(events),
            "timeline": [
                {
                    "timestamp": e["timestamp"],
                    "event_type": e["event_type"],
                    "payload": e["payload"],
                }
                for e in events
            ],
        }

    @staticmethod
    def export_compliance_report_example(
        engine: GovernanceEngine,
        start_time: str = "2026-01-01T00:00:00Z",
        end_time: str = "2026-04-16T23:59:59Z",
    ) -> str:
        """
        Example: Export audit log for compliance/regulatory review.

        Returns CSV or JSON data ready for submission.
        """
        logger = engine.audit_logger
        csv_data = logger.export_audit(
            start_time=start_time,
            end_time=end_time,
            format="csv",
        )

        return csv_data


# Example workflow integration
def full_trade_workflow_example() -> None:
    """
    Complete example showing full trade lifecycle with governance.

    This demonstrates how the governance engine integrates into a trading system.
    """
    engine = GovernanceIntegrationExample.initialize_governance()

    # Step 1: Signal generates a trade idea
    symbol = "BTCUSD"
    signal_confidence = 0.78

    # Step 2: Check governance before execution
    gov_result = GovernanceIntegrationExample.evaluate_trade_before_execution(
        engine,
        symbol=symbol,
        action="buy",
        quantity=1,
        price=42000.0,
        signal_confidence=signal_confidence,
        signal_data={"ma_crossover": True, "rsi": 45},
        scoring_data={"final_score": 0.75},
        risk_assessment={"max_loss": 1000, "risk_reward": 2.5},
        recall_data={"backtest_win_rate": 0.55},
    )

    correlation_id = gov_result["correlation_id"]

    if gov_result["approved"]:
        # Step 3: Execute trade
        GovernanceIntegrationExample.record_trade_execution_example(
            engine,
            correlation_id=correlation_id,
            symbol=symbol,
            action="buy",
            quantity=1,
            entry_price=42000.0,
            order_id="ORD_123456",
        )

        # Step 4: Record fill
        GovernanceIntegrationExample.record_trade_fill_example(
            engine,
            correlation_id=correlation_id,
            symbol=symbol,
            action="buy",
            filled_qty=1,
            filled_price=41950.0,
            slippage_pct=0.119,
            order_id="ORD_123456",
        )

        # Step 5: Record outcome
        GovernanceIntegrationExample.record_trade_outcome_example(
            engine,
            correlation_id=correlation_id,
            symbol=symbol,
            exit_price=42500.0,
            pnl=550.0,
            pnl_pct=0.0131,
        )

    elif gov_result["requires_human_approval"]:
        # Human needs to approve
        # In real system, this would show in UI and analyst clicks "Approve"
        request_id = gov_result["approval_request_id"]
        GovernanceIntegrationExample.approve_pending_request_example(
            engine,
            request_id=request_id,
            approver_id="analyst@example.com",
            notes="Approved after review",
        )

    else:
        # Trade blocked by governance
        print(f"Trade blocked: {gov_result['reason']}")

    # Step 6: Periodic anomaly checks
    anomalies = GovernanceIntegrationExample.run_periodic_anomaly_check(
        engine,
        backtest_metrics={"win_rate": 0.55, "max_drawdown_pct": 18.0},
    )

    # Step 7: Get status for dashboard
    status = GovernanceIntegrationExample.get_governance_status_example(engine)
    print(f"Current tier: {status['current_tier']}")
    print(f"Pending approvals: {status['pending_approvals_count']}")

    # Step 8: Audit trail for compliance
    trail = GovernanceIntegrationExample.query_audit_trail_example(engine, correlation_id)
    print(f"Audit events for trade: {trail['event_count']}")


if __name__ == "__main__":
    full_trade_workflow_example()
