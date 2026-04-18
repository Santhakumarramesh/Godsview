from __future__ import annotations

from datetime import datetime, timezone

from app.ai_filter import ai_trade_filter
from app.broker import get_account, place_market_order
from app.config import settings
from app.infer import get_latest_signal
from app.risk import apply_risk_checks
from app.utils import write_json


def run_pipeline() -> dict[str, object]:
    signal = get_latest_signal()

    # TODO: Replace placeholders with real market health/news checks.
    context = {
        "high_volatility": False,
        "major_news_window": False,
        "spread_too_wide": False,
        "degraded_data": False,
    }
    filter_decision = ai_trade_filter(signal, context)

    result: dict[str, object] = {
        "symbol": settings.symbol,
        "timeframe": settings.timeframe,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": settings.dry_run,
        "signal": signal,
        "filter": {
            "approved": filter_decision.approved,
            "final_action": filter_decision.final_action,
            "reasons": filter_decision.reasons,
        },
        "risk": None,
        "execution": None,
    }

    if not filter_decision.approved:
        result["execution"] = {"status": "blocked_by_filter"}
        write_json("data/processed/latest_decision.json", result)
        return result

    if not settings.has_alpaca_keys:
        result["execution"] = {
            "status": "blocked_missing_broker_keys",
            "message": "Set ALPACA_API_KEY and ALPACA_SECRET_KEY to enable execution.",
        }
        write_json("data/processed/latest_decision.json", result)
        return result

    account = get_account()
    equity = float(account.equity)
    day_pnl_pct = 0.0
    entry_price = float(signal["close_price"])
    stop_price = entry_price * (1.0 - settings.default_stop_pct)
    if filter_decision.final_action == "sell":
        stop_price = entry_price * (1.0 + settings.default_stop_pct)

    risk = apply_risk_checks(
        day_pnl_pct=day_pnl_pct,
        max_daily_loss_pct=settings.max_daily_loss,
        account_equity=equity,
        entry_price=entry_price,
        stop_price=stop_price,
        max_risk_pct=settings.max_risk_per_trade,
    )
    result["risk"] = {
        "allowed": risk.allowed,
        "reason": risk.reason,
        "qty": risk.qty,
        "entry_price": entry_price,
        "stop_price": stop_price,
    }

    if not risk.allowed:
        result["execution"] = {"status": "blocked_by_risk"}
        write_json("data/processed/latest_decision.json", result)
        return result

    if settings.dry_run:
        result["execution"] = {
            "status": "simulated",
            "side": filter_decision.final_action,
            "qty": risk.qty,
        }
        write_json("data/processed/latest_decision.json", result)
        return result

    order = place_market_order(settings.symbol, risk.qty, filter_decision.final_action)
    result["execution"] = {
        "status": "submitted",
        "side": filter_decision.final_action,
        "qty": risk.qty,
        "order_id": str(getattr(order, "id", "")),
    }
    write_json("data/processed/latest_decision.json", result)
    return result


if __name__ == "__main__":
    print(run_pipeline())
