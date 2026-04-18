from __future__ import annotations

from typing import Any

import pandas as pd


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _build_check(
    *,
    gate_id: str,
    label: str,
    passed: bool,
    actual: Any,
    target: Any,
    detail: str,
) -> dict[str, Any]:
    return {
        "id": gate_id,
        "label": label,
        "passed": bool(passed),
        "actual": actual,
        "target": target,
        "detail": detail,
    }


def evaluate_hard_gates(
    *,
    bars: pd.DataFrame,
    market: dict[str, Any] | None,
    session: dict[str, Any] | None,
    macro: dict[str, Any] | None,
    sentiment: dict[str, Any] | None,
) -> dict[str, Any]:
    if bars is None or len(bars) < 50:
        return {
            "pass": False,
            "checks": [
                _build_check(
                    gate_id="market_data_quality",
                    label="Market data quality",
                    passed=False,
                    actual=int(len(bars) if bars is not None else 0),
                    target=">= 50 bars",
                    detail="insufficient bars for gating",
                )
            ],
            "failed_reasons": ["insufficient_market_data"],
            "pass_ratio": 0.0,
            "liquidity_score": 0.0,
            "volatility_score": 0.0,
            "spread_quality_score": 0.0,
        }

    market = market or {}
    session = session or {}
    macro = macro or {}
    sentiment = sentiment or {}

    vol_recent = _safe_float(bars["Volume"].tail(20).mean(), 0.0)
    vol_baseline = _safe_float(bars["Volume"].tail(100).mean(), 1.0)
    liquidity_ratio = vol_recent / max(vol_baseline, 1e-9)
    liquidity_pass = liquidity_ratio >= 0.35

    volatility = _safe_float(market.get("volatility_100"), 0.0)
    volatility_pass = volatility <= 0.08

    avg_hl_range = _safe_float(
        ((bars["High"] - bars["Low"]) / bars["Close"]).tail(40).mean(), 0.0
    )
    spread_quality_pass = avg_hl_range <= 0.04

    macro_blackout = bool(macro.get("blackout", False))
    news_pass = not macro_blackout

    session_allowed = bool(session.get("allowed", False))
    session_pass = session_allowed

    sentiment_score = _safe_float(sentiment.get("sentiment_score"), 0.0)
    sentiment_pass = abs(sentiment_score) <= 0.35

    checks = [
        _build_check(
            gate_id="liquidity_quality",
            label="Liquidity quality",
            passed=liquidity_pass,
            actual=round(liquidity_ratio, 6),
            target=">= 0.35",
            detail="recent volume / baseline volume ratio",
        ),
        _build_check(
            gate_id="volatility_limit",
            label="Volatility limit",
            passed=volatility_pass,
            actual=round(volatility, 6),
            target="<= 0.08",
            detail="realized volatility over recent bars",
        ),
        _build_check(
            gate_id="news_event_risk",
            label="Earnings/news blackout",
            passed=news_pass,
            actual=macro_blackout,
            target=False,
            detail="macro blackout gate from calendar context",
        ),
        _build_check(
            gate_id="spread_quality",
            label="Spread quality proxy",
            passed=spread_quality_pass,
            actual=round(avg_hl_range, 6),
            target="<= 0.04",
            detail="average high-low range proxy for spread quality",
        ),
        _build_check(
            gate_id="session_rules",
            label="Session rules",
            passed=session_pass,
            actual=str(session.get("session", "OFF")),
            target="allowed session",
            detail="time-window allowlist gate",
        ),
        _build_check(
            gate_id="sentiment_extreme",
            label="Sentiment extreme filter",
            passed=sentiment_pass,
            actual=round(sentiment_score, 6),
            target="abs(score) <= 0.35",
            detail="blocks extreme sentiment shock conditions",
        ),
    ]

    failed = [str(check["id"]) for check in checks if not check["passed"]]
    passed_count = sum(1 for check in checks if check["passed"])
    total = max(len(checks), 1)
    pass_ratio = passed_count / total
    return {
        "pass": len(failed) == 0,
        "checks": checks,
        "failed_reasons": failed,
        "pass_ratio": round(pass_ratio, 6),
        "liquidity_score": round(max(min(liquidity_ratio / 1.5, 1.0), 0.0), 6),
        "volatility_score": round(max(min((0.08 - volatility) / 0.08, 1.0), 0.0), 6),
        "spread_quality_score": round(
            max(min((0.04 - avg_hl_range) / 0.04, 1.0), 0.0), 6
        ),
        "session_allowed": session_allowed,
        "news_blackout": macro_blackout,
    }
