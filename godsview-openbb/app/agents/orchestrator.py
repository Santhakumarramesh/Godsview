from __future__ import annotations

import argparse
from datetime import datetime, timezone
from typing import Any

from app.agents.base import AgentState
from app.agents.data_agent import DataAgent
from app.agents.execution_agent import ExecutionAgent
from app.agents.monitor_agent import MonitorAgent
from app.agents.reasoning_agent import ReasoningAgent
from app.agents.risk_agent import RiskAgent
from app.agents.signal_agent import SignalAgent
from app.config import settings
from app.learning.evaluator import evaluate_replay_metrics
from app.learning.replay import run_replay
from app.strategy.governance import classify_strategy_state
from app.utils import write_json


PIPELINE = [
    DataAgent(),
    SignalAgent(),
    ReasoningAgent(),
    RiskAgent(),
    ExecutionAgent(),
    MonitorAgent(),
]


def run_orchestrator(
    *,
    symbol: str,
    live: bool = False,
    dry_run: bool = True,
    human_approval: bool = False,
    with_replay: bool = False,
    replay_timeframe: str | None = None,
) -> dict[str, Any]:
    replay_snapshot = run_replay(
        symbol=symbol.upper(),
        timeframe=(replay_timeframe or settings.timeframe),
        max_steps=250,
        screenshot_interval=0,
    )
    strategy_control = classify_strategy_state(evaluate_replay_metrics(replay_snapshot))

    state = AgentState(
        symbol=symbol.upper(),
        live=live,
        dry_run=dry_run,
    )
    state.data["human_approval"] = human_approval
    state.data["strategy_control"] = strategy_control
    if strategy_control["status"] == "DISABLED":
        state.set_blocked("strategy_disabled")
    if strategy_control["status"] == "WEAK" and live:
        state.set_blocked("strategy_not_promoted_for_live")

    for agent in PIPELINE:
        state = agent.run(state)
        # execution+monitor still run even when blocked for logging/traceability
        if state.blocked and agent.name not in {"execution_agent", "monitor_agent"}:
            continue

    pipeline = {
        "market_data_news_sentiment": {
            "status": "pass" if "market" in state.data else "fail",
            "summary": {
                "regime": state.data.get("market", {}).get("regime"),
                "session": state.data.get("session", {}).get("session"),
                "sentiment_score": state.data.get("sentiment", {}).get("sentiment_score"),
                "macro_blackout": state.data.get("macro", {}).get("blackout"),
            },
        },
        "hard_gates": {
            "status": "pass" if bool(state.data.get("hard_gates", {}).get("pass", False)) else "fail",
            "failed_reasons": state.data.get("hard_gates", {}).get("failed_reasons", []),
        },
        "setup_engine": {
            "status": "pass" if bool(state.data.get("signal", {}).get("setup_validation", {}).get("valid", False)) else "fail",
            "setup": state.data.get("signal", {}).get("setup"),
            "validation_reason": state.data.get("signal", {}).get("setup_validation", {}).get("reason"),
        },
        "scoring_engine": {
            "status": "pass" if bool(state.data.get("scoring", {}).get("pass", False)) else "fail",
            "final_score": state.data.get("scoring", {}).get("final_score"),
            "grade": state.data.get("scoring", {}).get("grade"),
            "reasons": state.data.get("scoring", {}).get("reasons", []),
        },
        "ai_reasoner": {
            "status": "pass" if bool(state.data.get("reasoning", {}).get("approved", False)) else "fail",
            "action": state.data.get("reasoning", {}).get("final_action"),
            "reasons": state.data.get("reasoning", {}).get("reasons", []),
            "challenge_points": state.data.get("reasoning", {}).get("challenge_points", []),
        },
        "risk_policy_engine": {
            "status": "pass" if bool(state.data.get("risk", {}).get("allowed", False)) else "fail",
            "reason": state.data.get("risk", {}).get("reason"),
            "qty": state.data.get("risk", {}).get("qty"),
        },
        "approval_or_execution": {
            "status": state.data.get("execution", {}).get("status", "blocked"),
            "human_approval": human_approval,
            "live": live,
            "dry_run": dry_run,
        },
        "journal_memory_review": {
            "status": "pass" if "monitor" in state.data else "fail",
            "recorded_at": state.data.get("monitor", {}).get("recorded_at"),
            "trade_outcome": state.data.get("monitor", {}).get("trade_outcome"),
        },
    }

    payload = {
        "symbol": state.symbol,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "live": state.live,
        "dry_run": state.dry_run,
        "human_approval": human_approval,
        "blocked": state.blocked,
        "block_reason": state.block_reason,
        "errors": state.errors,
        "pipeline": pipeline,
        "data": state.data,
    }
    if with_replay:
        try:
            payload["replay"] = run_replay(
                symbol=state.symbol,
                timeframe=(replay_timeframe or settings.timeframe),
                max_steps=400,
                screenshot_interval=50,
            )
            payload["strategy_control_after_replay"] = classify_strategy_state(
                evaluate_replay_metrics(payload["replay"])
            )
        except Exception as err:  # noqa: BLE001
            payload["replay"] = {"error": str(err)}
    write_json("data/processed/latest_orchestrator_run.json", payload)
    return payload


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Godsview multi-agent orchestrator")
    parser.add_argument("--symbol", type=str, default=settings.symbol, help="Symbol to evaluate (e.g. AAPL, BTCUSD)")
    parser.add_argument(
        "--live",
        action="store_true",
        help="Enable live execution path (requires ALPACA keys and DRY_RUN=false).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=settings.dry_run,
        help="Force dry-run simulation mode.",
    )
    parser.add_argument("--with-replay", action="store_true", help="Run replay learning pass after agent pipeline.")
    parser.add_argument("--replay-timeframe", type=str, default=None, help="Optional replay timeframe override.")
    parser.add_argument("--approve", action="store_true", help="Provide explicit human approval token for live execution.")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    # Safety first: if --live passed but env still dry-run true, stay dry-run.
    effective_dry_run = bool(args.dry_run)
    if args.live and settings.dry_run and not args.dry_run:
        effective_dry_run = True
    result = run_orchestrator(
        symbol=args.symbol,
        live=bool(args.live),
        dry_run=effective_dry_run,
        human_approval=bool(args.approve),
        with_replay=bool(args.with_replay),
        replay_timeframe=args.replay_timeframe,
    )
    print(result)
