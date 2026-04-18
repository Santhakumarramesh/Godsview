from __future__ import annotations

import argparse
import time
from datetime import datetime, timezone

from app.agents.orchestrator import run_orchestrator
from app.config import settings
from app.nodes import (
    ContextNode,
    EvolutionNode,
    ExecutionNode,
    MemoryNode,
    OrderFlowNode,
    PerceptionNode,
    ReasoningNode,
    RiskNode,
    StockNode,
    StructureNode,
    SupremeNode,
)
from app.state.store import get_brain_store
from app.utils import write_json


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_loop(symbol: str, interval_seconds: int, with_replay: bool) -> None:
    store = get_brain_store()
    stock_pipeline = StockNode(
        child_nodes=[
            PerceptionNode(),
            StructureNode(),
            OrderFlowNode(),
            ContextNode(),
            MemoryNode(),
            ReasoningNode(),
            RiskNode(),
            ExecutionNode(),
            EvolutionNode(),
        ]
    )
    supreme = SupremeNode()

    print(
        f"[{utc_now_iso()}] brain_loop start symbol={symbol} interval={interval_seconds}s replay={with_replay}"
    )
    while True:
        try:
            result = run_orchestrator(
                symbol=symbol,
                live=False,
                dry_run=True,
                human_approval=False,
                with_replay=with_replay,
            )
            brain = store.get_or_create_stock(symbol)
            brain = stock_pipeline.run(brain, result, store)
            supreme_state = supreme.run(store)

            write_json(
                "data/processed/latest_stock_brain_state.json",
                {
                    "generated_at": utc_now_iso(),
                    "symbol": symbol,
                    "state": store.stock_json(symbol),
                },
            )
            write_json(
                "data/processed/latest_consciousness_board.json",
                supreme.board_payload(store),
            )
            blocked = bool(result.get("blocked", False))
            reason = str(result.get("block_reason", ""))
            print(
                f"[{utc_now_iso()}] cycle complete symbol={symbol} blocked={blocked} reason={reason} attention={brain.attention_score:.3f} health={supreme_state.system_health}"
            )
        except Exception as err:  # noqa: BLE001
            print(f"[{utc_now_iso()}] cycle error symbol={symbol} error={err}")
        time.sleep(max(5, interval_seconds))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Godsview brain update loop")
    parser.add_argument("--symbol", type=str, default=settings.symbol)
    parser.add_argument(
        "--interval", type=int, default=30, help="Seconds between cycles"
    )
    parser.add_argument(
        "--with-replay", action="store_true", help="Run replay on each cycle"
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    run_loop(
        symbol=args.symbol.upper(),
        interval_seconds=args.interval,
        with_replay=bool(args.with_replay),
    )
