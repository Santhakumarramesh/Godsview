from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from app.analysis.fvg import detect_fvg
from app.analysis.order_blocks import detect_order_blocks
from app.analysis.structure import analyze_structure
from app.brain import BrainMemoryStore, TradeMemory
from app.config import settings
from app.data_fetch import fetch_price_history
from app.utils import write_json
from app.visuals.screenshot import save_analysis_screenshot


@dataclass
class ReplayTrade:
    symbol: str
    timeframe: str
    bar_index: int
    ts: str
    side: str
    setup: str
    entry: float
    stop: float
    target: float
    exit: float
    outcome: str
    rr: float
    pnl_pct: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _generate_trade_signal(history: pd.DataFrame) -> dict[str, Any] | None:
    structure = analyze_structure(history)
    if not structure.get("bos", False):
        return None

    direction = str(structure.get("bos_direction", "none"))
    if direction not in {"bullish", "bearish"}:
        return None

    order_blocks = detect_order_blocks(history)
    latest_close = float(history["Close"].iloc[-1])
    side = "long" if direction == "bullish" else "short"
    setup = "sweep_reclaim" if structure.get("choch") else "continuation_pullback"

    candidate = None
    for block in reversed(order_blocks):
        if block["side"] == direction:
            candidate = block
            break

    if candidate is not None:
        if side == "long":
            stop = float(candidate["low"])
        else:
            stop = float(candidate["high"])
    else:
        # fallback using recent range
        recent = history.tail(20)
        stop = (
            float(recent["Low"].min())
            if side == "long"
            else float(recent["High"].max())
        )

    risk = abs(latest_close - stop)
    if risk <= 0:
        return None

    rr = 2.0
    target = latest_close + rr * risk if side == "long" else latest_close - rr * risk
    return {
        "side": side,
        "setup": setup,
        "entry": latest_close,
        "stop": stop,
        "target": target,
        "rr": rr,
        "structure": structure,
        "order_blocks": order_blocks,
        "fvgs": detect_fvg(history),
    }


def _resolve_trade(future: pd.DataFrame, signal: dict[str, Any]) -> tuple[float, str]:
    side = signal["side"]
    stop = float(signal["stop"])
    target = float(signal["target"])
    entry = float(signal["entry"])

    for _, row in future.iterrows():
        low = float(row["Low"])
        high = float(row["High"])
        if side == "long":
            # conservative fill ordering: stop first if both touched in same bar
            if low <= stop:
                return stop, "loss"
            if high >= target:
                return target, "win"
        else:
            if high >= stop:
                return stop, "loss"
            if low <= target:
                return target, "win"

    # timed exit on final future close
    final_close = float(future["Close"].iloc[-1])
    if side == "long":
        return final_close, ("win" if final_close > entry else "loss")
    return final_close, ("win" if final_close < entry else "loss")


def run_replay(
    *,
    symbol: str,
    timeframe: str,
    warmup: int = 90,
    forward_bars: int = 20,
    max_steps: int = 1200,
    screenshot_interval: int = 25,
) -> dict[str, Any]:
    df = fetch_price_history(symbol, timeframe)
    if len(df) < warmup + forward_bars + 5:
        raise RuntimeError(f"Not enough bars for replay: {len(df)}")

    brain = BrainMemoryStore()
    trades: list[ReplayTrade] = []
    steps = 0
    screenshot_paths: list[str] = []

    for i in range(warmup, len(df) - forward_bars):
        if steps >= max_steps:
            break
        steps += 1

        history = df.iloc[:i].copy()
        future = df.iloc[i : i + forward_bars].copy()
        signal = _generate_trade_signal(history)
        if signal is None:
            continue

        exit_price, outcome = _resolve_trade(future, signal)
        entry = float(signal["entry"])
        side = str(signal["side"])
        pnl_pct = (
            (exit_price / entry - 1.0) * 100.0
            if side == "long"
            else (entry / exit_price - 1.0) * 100.0
        )
        rr = float(signal["rr"])

        trade = ReplayTrade(
            symbol=symbol.upper(),
            timeframe=timeframe,
            bar_index=i,
            ts=str(df.index[i]),
            side=side,
            setup=str(signal["setup"]),
            entry=entry,
            stop=float(signal["stop"]),
            target=float(signal["target"]),
            exit=float(exit_price),
            outcome=outcome,
            rr=rr,
            pnl_pct=round(float(pnl_pct), 5),
        )
        trades.append(trade)

        if screenshot_interval > 0 and len(trades) % screenshot_interval == 0:
            path = save_analysis_screenshot(
                symbol=symbol,
                timeframe=timeframe,
                df=history.tail(220),
                order_blocks=signal["order_blocks"][-20:],
                fvgs=signal["fvgs"][-20:],
                trade={
                    "entry": trade.entry,
                    "stop": trade.stop,
                    "target": trade.target,
                },
                suffix=f"replay_{len(trades)}",
            )
            screenshot_paths.append(str(path))

        brain.add_memory(
            TradeMemory(
                symbol=symbol.upper(),
                title=f"Replay {trade.setup} {trade.side}",
                content=f"Replay outcome={trade.outcome}, pnl_pct={trade.pnl_pct:.4f}",
                confidence=0.55 if trade.outcome == "win" else 0.45,
                tags=["replay", trade.setup, trade.side, trade.outcome],
                context=trade.to_dict(),
                signal_action="buy" if trade.side == "long" else "sell",
                entry_price=trade.entry,
                exit_price=trade.exit,
                pnl_pct=trade.pnl_pct,
                setup=trade.setup,
                regime=str(signal["structure"].get("trend", "unknown")),
                outcome=trade.outcome,
            )
        )

    wins = [t for t in trades if t.outcome == "win"]
    losses = [t for t in trades if t.outcome == "loss"]
    win_rate = len(wins) / len(trades) if trades else 0.0
    gross_win = sum(max(t.pnl_pct, 0) for t in trades)
    gross_loss = abs(sum(min(t.pnl_pct, 0) for t in trades))
    profit_factor = (
        (gross_win / gross_loss)
        if gross_loss > 0
        else (999.0 if gross_win > 0 else 0.0)
    )
    expectancy = sum(t.pnl_pct for t in trades) / len(trades) if trades else 0.0

    summary = {
        "symbol": symbol.upper(),
        "timeframe": timeframe,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bars": int(len(df)),
        "steps": steps,
        "trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(float(win_rate), 6),
        "profit_factor": round(float(profit_factor), 6),
        "expectancy_pct": round(float(expectancy), 6),
        "total_pnl_pct": round(float(sum(t.pnl_pct for t in trades)), 6),
        "screenshots": screenshot_paths,
        "records": [t.to_dict() for t in trades],
    }

    safe_symbol = symbol.upper().replace("/", "")
    safe_tf = timeframe.lower().replace(" ", "")
    write_json(f"data/processed/replay_{safe_symbol}_{safe_tf}.json", summary)
    write_json("data/processed/replay_latest.json", summary)
    return summary


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replay engine with no-lookahead setup evaluation."
    )
    parser.add_argument("--symbol", type=str, default=settings.symbol)
    parser.add_argument("--timeframe", type=str, default=settings.timeframe)
    parser.add_argument("--warmup", type=int, default=90)
    parser.add_argument("--forward-bars", type=int, default=20)
    parser.add_argument("--max-steps", type=int, default=1200)
    parser.add_argument("--screenshot-interval", type=int, default=25)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    result = run_replay(
        symbol=args.symbol,
        timeframe=args.timeframe,
        warmup=args.warmup,
        forward_bars=args.forward_bars,
        max_steps=args.max_steps,
        screenshot_interval=args.screenshot_interval,
    )
    print(result)
