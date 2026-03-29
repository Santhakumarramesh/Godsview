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
from app.learning.replay import run_replay
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
    with_replay: bool = False,
    replay_timeframe: str | None = None,
) -> dict[str, Any]:
    state = AgentState(
        symbol=symbol.upper(),
        live=live,
        dry_run=dry_run,
    )

    for agent in PIPELINE:
        state = agent.run(state)
        # execution+monitor still run even when blocked for logging/traceability
        if state.blocked and agent.name not in {"execution_agent", "monitor_agent"}:
            continue

    payload = {
        "symbol": state.symbol,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "live": state.live,
        "dry_run": state.dry_run,
        "blocked": state.blocked,
        "block_reason": state.block_reason,
        "errors": state.errors,
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
        with_replay=bool(args.with_replay),
        replay_timeframe=args.replay_timeframe,
    )
    print(result)
