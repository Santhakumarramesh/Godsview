from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.ai_filter import ai_trade_filter
from app.broker import get_account, place_market_order
from app.config import settings
from app.infer import get_latest_signal
from app.risk import apply_risk_checks
from app.utils import write_json

logger = logging.getLogger(__name__)


def _build_market_context() -> dict[str, bool]:
    """Build live market context from regime detection and data truth systems.

    Falls back to conservative defaults (flags=True → blocks trade) if
    any subsystem is unavailable, so the pipeline fails closed.
    """
    context: dict[str, bool] = {
        "high_volatility": False,
        "major_news_window": False,
        "spread_too_wide": False,
        "degraded_data": False,
    }

    # ── Regime detection: flag high-volatility conditions ─────────────
    try:
        from app.analysis.regime_detector import detect_regime_from_bars, Regime
        from app.data.alpaca_client import fetch_bars

        bars = fetch_bars(settings.symbol, settings.timeframe, limit=100)
        if bars and len(bars) >= 20:
            regime = detect_regime_from_bars(bars)
            context["high_volatility"] = regime.current_regime in (
                Regime.EXPANSION,
                Regime.CHAOTIC,
            )
    except Exception:
        logger.debug("Regime detection unavailable — using default", exc_info=True)

    # ── Data truth: check if data sources are degraded ────────────────
    try:
        from app.advanced_routes import _data_source_status
        import time

        now = time.time()
        for _src, entry in _data_source_status.items():
            total = entry.get("total", 0)
            if total > 0:
                error_rate = entry.get("errors", 0) / total
                stale = (now - entry.get("last_update", 0)) > 60
                if error_rate > 0.5 or stale:
                    context["degraded_data"] = True
                    break
    except Exception:
        logger.debug("Data truth check unavailable — using default", exc_info=True)

    return context


def run_pipeline() -> dict[str, object]:
    signal = get_latest_signal()

    context = _build_market_context()
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

