from __future__ import annotations

from app.agents.base import Agent, AgentState
from app.broker import get_account
from app.config import settings
from app.risk import apply_risk_checks


class RiskAgent(Agent):
    name = "risk_agent"

    def run(self, state: AgentState) -> AgentState:
        if state.blocked:
            return state

        signal = state.data.get("signal")
        reasoning = state.data.get("reasoning")
        if not isinstance(signal, dict) or not isinstance(reasoning, dict):
            state.set_blocked("missing_reasoning_or_signal")
            return state

        entry_price = float(signal.get("close_price", 0.0))
        action = str(reasoning.get("final_action", "skip"))
        if entry_price <= 0 or action not in {"buy", "sell"}:
            state.set_blocked("invalid_entry_or_action")
            return state

        # Account/equity source:
        # - if live mode and keys configured, query Alpaca
        # - otherwise fallback to a deterministic simulation equity
        account_equity = 10_000.0
        day_pnl_pct = 0.0
        if state.live and settings.has_alpaca_keys:
            try:
                account = get_account()
                account_equity = float(getattr(account, "equity", 10_000.0))
                day_pnl_pct = float(getattr(account, "equity", account_equity)) / max(
                    float(getattr(account, "last_equity", account_equity)),
                    1.0,
                ) - 1.0
            except Exception as err:  # noqa: BLE001
                state.add_error(f"risk_agent_account_fetch_error: {err}")

        stop_price = entry_price * (1.0 - settings.default_stop_pct)
        if action == "sell":
            stop_price = entry_price * (1.0 + settings.default_stop_pct)

        risk = apply_risk_checks(
            day_pnl_pct=day_pnl_pct,
            max_daily_loss_pct=settings.max_daily_loss,
            account_equity=account_equity,
            entry_price=entry_price,
            stop_price=stop_price,
            max_risk_pct=settings.max_risk_per_trade,
        )

        risk_payload = {
            "allowed": risk.allowed,
            "reason": risk.reason,
            "qty": risk.qty,
            "entry_price": entry_price,
            "stop_price": stop_price,
            "account_equity": account_equity,
            "day_pnl_pct": day_pnl_pct,
        }
        state.data["risk"] = risk_payload
        if not risk.allowed:
            state.set_blocked("risk_blocked")
        return state

