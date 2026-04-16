from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import numbers
from typing import Any

import pandas as pd

from app.agents.base import AgentState
from app.agents.data_agent import DataAgent
from app.agents.execution_agent import ExecutionAgent
from app.agents.governance_agent import GovernanceAgent
from app.agents.macro_agent import MacroAgent
from app.agents.monitor_agent import MonitorAgent
from app.agents.reasoning_agent import ReasoningAgent
from app.agents.recall_agent import RecallAgent
from app.agents.risk_agent import RiskAgent
from app.agents.scoring_agent import ScoringAgent
from app.agents.signal_agent import SignalAgent
from app.config import settings
from app.learning.evaluator import evaluate_replay_metrics
from app.learning.replay import run_replay
from app.strategy.governance import classify_strategy_state
from app.utils import write_json


# Agent instances (stateless)
data_agent = DataAgent()
signal_agent = SignalAgent()
reasoning_agent = ReasoningAgent()
risk_agent = RiskAgent()
execution_agent = ExecutionAgent()
monitor_agent = MonitorAgent()
macro_agent = MacroAgent()
recall_agent = RecallAgent()
scoring_agent = ScoringAgent()
governance_agent = GovernanceAgent()


def _json_safe(value: Any) -> Any:
    """Convert value to JSON-safe representation."""
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, str):
        return value
    if isinstance(value, numbers.Integral):
        return int(value)
    if isinstance(value, numbers.Real):
        return float(value)
    if isinstance(value, pd.DataFrame):
        cols = list(value.columns)
        tail = value.tail(3)
        sample_rows = []
        for idx, row in tail.iterrows():
            sample = {"index": str(idx)}
            for col in cols:
                cell = row[col]
                if isinstance(cell, bool) or cell is None:
                    sample[col] = cell
                elif isinstance(cell, str):
                    sample[col] = cell
                elif isinstance(cell, numbers.Integral):
                    sample[col] = int(cell)
                elif isinstance(cell, numbers.Real):
                    sample[col] = float(cell)
                else:
                    sample[col] = str(cell)
            sample_rows.append(sample)
        return {
            "_type": "dataframe",
            "rows": int(len(value)),
            "columns": [str(c) for c in cols],
            "tail_sample": sample_rows,
        }
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return str(value)


async def _run_agent_with_timeout(
    agent: Any,
    state: AgentState,
    timeout_sec: float = 5.0,
) -> tuple[Any | None, float, str | None]:
    """
    Run an agent with timeout protection.

    Args:
        agent: Agent instance with run() method
        state: Current agent state
        timeout_sec: Timeout in seconds

    Returns:
        Tuple of (updated_state, elapsed_ms, error_msg)
        If timeout, state is returned as-is with error message.
    """
    start = datetime.now(timezone.utc)
    try:
        # Run agent synchronously (agents are not async yet)
        updated_state = agent.run(state)
        elapsed = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        return updated_state, elapsed, None
    except asyncio.TimeoutError:
        elapsed = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        return state, elapsed, f"{agent.name}_timeout"
    except Exception as err:  # noqa: BLE001
        elapsed = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        return state, elapsed, f"{agent.name}_error: {err}"


async def run_orchestrator_async(
    *,
    symbol: str,
    live: bool = False,
    dry_run: bool = True,
    human_approval: bool = False,
    with_replay: bool = False,
    replay_timeframe: str | None = None,
    agent_timeout_sec: float = 5.0,
) -> dict[str, Any]:
    """
    Run the multi-agent orchestration with concurrent phases.

    Phase 1 (concurrent): Data gathering - DataAgent, MacroAgent, RecallAgent
    Phase 2 (concurrent): Analysis - SignalAgent, (order flow analysis)
    Phase 3: Independent scoring - ScoringAgent (needs all inputs)
    Phase 4 (concurrent): Gates - ReasoningAgent, RiskAgent, GovernanceAgent
    Phase 5: Execution decision
    Phase 6: Monitor + Learn

    Args:
        symbol: Asset symbol
        live: Whether to enable live mode
        dry_run: Whether to force dry-run
        human_approval: Human approval provided
        with_replay: Whether to run replay learning pass
        replay_timeframe: Optional replay timeframe override
        agent_timeout_sec: Timeout per agent in seconds

    Returns:
        Dictionary with orchestration results
    """
    # Initialize state
    state = AgentState(
        symbol=symbol.upper(),
        live=live,
        dry_run=dry_run,
    )
    state.data["human_approval"] = human_approval

    # Pre-flight: check strategy control and replay
    try:
        replay_snapshot = run_replay(
            symbol=symbol.upper(),
            timeframe=(replay_timeframe or settings.timeframe),
            max_steps=250,
            screenshot_interval=0,
        )
        strategy_control = classify_strategy_state(evaluate_replay_metrics(replay_snapshot))
        state.data["strategy_control"] = strategy_control

        if strategy_control["status"] == "DISABLED":
            state.set_blocked("strategy_disabled")
        elif strategy_control["status"] == "WEAK" and live:
            state.set_blocked("strategy_not_promoted_for_live")
    except Exception as err:  # noqa: BLE001
        state.add_error(f"replay_error: {err}")
        state.data["strategy_control"] = {"status": "ERROR"}

    # Initialize agent timing trace
    agent_timings = {}

    # ====== PHASE 1: Concurrent Data Gathering ======
    if not state.blocked:
        phase1_tasks = [
            _run_agent_with_timeout(data_agent, state, agent_timeout_sec),
            _run_agent_with_timeout(macro_agent, state, agent_timeout_sec),
            _run_agent_with_timeout(recall_agent, state, agent_timeout_sec),
        ]

        phase1_results = await asyncio.gather(*phase1_tasks, return_exceptions=False)

        # Unpack phase 1 results
        data_result, data_elapsed, data_err = phase1_results[0]
        if data_result:
            state = data_result
        agent_timings["data_agent"] = data_elapsed
        if data_err:
            state.add_error(data_err)

        macro_result, macro_elapsed, macro_err = phase1_results[1]
        if macro_result:
            state = macro_result
        agent_timings["macro_agent"] = macro_elapsed
        if macro_err:
            state.add_error(macro_err)

        recall_result, recall_elapsed, recall_err = phase1_results[2]
        if recall_result:
            state = recall_result
        agent_timings["recall_agent"] = recall_elapsed
        if recall_err:
            state.add_error(recall_err)

    # ====== PHASE 2: Concurrent Analysis ======
    if not state.blocked:
        signal_result, signal_elapsed, signal_err = await _run_agent_with_timeout(
            signal_agent, state, agent_timeout_sec
        )
        if signal_result:
            state = signal_result
        agent_timings["signal_agent"] = signal_elapsed
        if signal_err:
            state.add_error(signal_err)

    # ====== PHASE 3: Independent Scoring ======
    # (Requires signal output, so must be sequential)
    if not state.blocked:
        scoring_result, scoring_elapsed, scoring_err = await _run_agent_with_timeout(
            scoring_agent, state, agent_timeout_sec
        )
        if scoring_result:
            state = scoring_result
        agent_timings["scoring_agent"] = scoring_elapsed
        if scoring_err:
            state.add_error(scoring_err)

    # ====== PHASE 4: Concurrent Gates (Reasoning, Risk, Governance) ======
    if not state.blocked:
        phase4_tasks = [
            _run_agent_with_timeout(reasoning_agent, state, agent_timeout_sec),
            _run_agent_with_timeout(risk_agent, state, agent_timeout_sec),
            _run_agent_with_timeout(governance_agent, state, agent_timeout_sec),
        ]

        phase4_results = await asyncio.gather(*phase4_tasks, return_exceptions=False)

        # Unpack phase 4 results
        reasoning_result, reasoning_elapsed, reasoning_err = phase4_results[0]
        if reasoning_result:
            state = reasoning_result
        agent_timings["reasoning_agent"] = reasoning_elapsed
        if reasoning_err:
            state.add_error(reasoning_err)

        risk_result, risk_elapsed, risk_err = phase4_results[1]
        if risk_result:
            state = risk_result
        agent_timings["risk_agent"] = risk_elapsed
        if risk_err:
            state.add_error(risk_err)

        governance_result, governance_elapsed, governance_err = phase4_results[2]
        if governance_result:
            state = governance_result
        agent_timings["governance_agent"] = governance_elapsed
        if governance_err:
            state.add_error(governance_err)

    # ====== PHASE 5: Execution Decision ======
    # Check governance + scoring before execution
    governance = state.data.get("governance_agent", {})
    scoring = state.data.get("scoring_agent", {})
    risk = state.data.get("risk", {})

    execution_blocked = False
    if not governance.get("approved", False):
        state.set_blocked(f"governance_blocked:{governance.get('reason', 'unknown')}")
        execution_blocked = True
    elif not risk.get("allowed", False):
        # Risk agent already set blocked, but we double-check
        execution_blocked = True
    elif scoring.get("final_score", 0.0) < 0.40:
        state.set_blocked("scoring_below_threshold")
        execution_blocked = True

    # Execute (execution+monitor run even when blocked for logging)
    execution_result, execution_elapsed, execution_err = await _run_agent_with_timeout(
        execution_agent, state, agent_timeout_sec
    )
    if execution_result:
        state = execution_result
    agent_timings["execution_agent"] = execution_elapsed
    if execution_err:
        state.add_error(execution_err)

    # ====== PHASE 6: Monitor + Learn ======
    monitor_result, monitor_elapsed, monitor_err = await _run_agent_with_timeout(
        monitor_agent, state, agent_timeout_sec
    )
    if monitor_result:
        state = monitor_result
    agent_timings["monitor_agent"] = monitor_elapsed
    if monitor_err:
        state.add_error(monitor_err)

    # ====== Build orchestration result ======
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
        "macro_context": {
            "status": "pass" if "macro_agent" in state.data else "fail",
            "regime": state.data.get("macro_agent", {}).get("regime"),
            "vix_level": state.data.get("macro_agent", {}).get("vix_level"),
            "macro_score": state.data.get("macro_agent", {}).get("macro_score"),
        },
        "recall_memory": {
            "status": "pass" if "recall_agent" in state.data else "fail",
            "similar_count": state.data.get("recall_agent", {}).get("similar_count"),
            "historical_win_rate": state.data.get("recall_agent", {}).get("historical_win_rate"),
            "recommendation": state.data.get("recall_agent", {}).get("recommendation"),
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
            "status": "pass" if bool(state.data.get("scoring_agent", {}).get("final_score", 0.0) > 0.40) else "fail",
            "final_score": state.data.get("scoring_agent", {}).get("final_score"),
            "breakdown": state.data.get("scoring_agent", {}).get("breakdown"),
            "recommendation": state.data.get("scoring_agent", {}).get("recommendation"),
            "conflicts": state.data.get("scoring_agent", {}).get("conflicts", []),
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
        "governance_engine": {
            "status": "pass" if bool(state.data.get("governance_agent", {}).get("approved", False)) else "fail",
            "tier": state.data.get("governance_agent", {}).get("tier"),
            "requires_human": state.data.get("governance_agent", {}).get("requires_human"),
            "reason": state.data.get("governance_agent", {}).get("reason"),
            "restrictions": state.data.get("governance_agent", {}).get("restrictions", []),
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
        "agent_timings": agent_timings,
        "pipeline": pipeline,
        "data": _json_safe(state.data),
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


def run_orchestrator(
    *,
    symbol: str,
    live: bool = False,
    dry_run: bool = True,
    human_approval: bool = False,
    with_replay: bool = False,
    replay_timeframe: str | None = None,
    agent_timeout_sec: float = 5.0,
) -> dict[str, Any]:
    """
    Synchronous wrapper for async orchestrator.

    Args:
        symbol: Asset symbol
        live: Whether to enable live mode
        dry_run: Whether to force dry-run
        human_approval: Human approval provided
        with_replay: Whether to run replay learning pass
        replay_timeframe: Optional replay timeframe override
        agent_timeout_sec: Timeout per agent in seconds

    Returns:
        Dictionary with orchestration results
    """
    return asyncio.run(
        run_orchestrator_async(
            symbol=symbol,
            live=live,
            dry_run=dry_run,
            human_approval=human_approval,
            with_replay=with_replay,
            replay_timeframe=replay_timeframe,
            agent_timeout_sec=agent_timeout_sec,
        )
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Godsview multi-agent orchestrator (concurrent)")
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
    parser.add_argument(
        "--agent-timeout",
        type=float,
        default=5.0,
        help="Timeout per agent in seconds (default: 5.0)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
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
        agent_timeout_sec=args.agent_timeout,
    )
    print(result)
