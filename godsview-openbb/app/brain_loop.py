"""
brain_loop.py — Brain Update Loop

Runs as a background thread or standalone process.
Periodically fetches market data and runs the full brain update pipeline:

  1. Fetch bars from Alpaca for all watched symbols
  2. Run stock_node.update_stock_brain() for each symbol
  3. Detect market regime (multi-method ensemble)
  4. Run supreme_node.update_supreme() to orchestrate
  5. Check for exit signals on open positions
  6. Optionally trigger evolution on schedule

Can be started via:
  python -m app.brain_loop              (standalone)
  brain_loop.start_background_loop()    (from API server)
"""

from __future__ import annotations
import os
import time
import logging
import threading
from datetime import datetime, timezone

from .state.store import get_store
from .state.schemas import Regime
from .nodes.stock_node import update_stock_brain
from .nodes.supreme_node import update_supreme
from .nodes.risk_node import evaluate_risk, quick_risk_check
from .nodes.execution_node import get_position_tracker
from .nodes.evolution_node import run_evolution

# Regime detection imports
from .analysis.regime_detector import detect_regime_from_bars, RegimeAnalysis
from .analysis.regime_history import RegimeTracker

logger = logging.getLogger("godsview.brain_loop")

# ─── Configuration ──────────────────────────────────────────────────────────

DEFAULT_SYMBOLS = ["BTC/USD", "ETH/USD"]
UPDATE_INTERVAL_S = 30       # Full brain cycle every 30s
EVOLUTION_INTERVAL_S = 3600  # Evolution check every hour
POSITION_CHECK_S = 5         # Check exits every 5s

# Module-level regime tracker singleton
_regime_tracker = RegimeTracker()


# ─── Data Fetcher (Alpaca bars) ─────────────────────────────────────────────

def fetch_bars(symbol: str) -> dict:
    """
    Fetch OHLCV bars from Alpaca for multiple timeframes.
    Returns: {bars_1m: [...], bars_5m: [...], bars_15m: [...], bars_1h: [...]}
    """
    try:
        from .data.alpaca_client import AlpacaClient
        client = AlpacaClient()

        # Map symbol format
        alpaca_symbol = symbol.replace("/", "")  # BTC/USD -> BTCUSD
        bars_1m = client.get_crypto_bars(alpaca_symbol, "1Min", limit=200)
        bars_5m = client.get_crypto_bars(alpaca_symbol, "5Min", limit=100)
        bars_15m = client.get_crypto_bars(alpaca_symbol, "15Min", limit=50)
        bars_1h = client.get_crypto_bars(alpaca_symbol, "1Hour", limit=30)

        return {
            "bars_1m": bars_1m,
            "bars_5m": bars_5m,
            "bars_15m": bars_15m,
            "bars_1h": bars_1h,
        }
    except Exception as e:
        logger.error(f"Failed to fetch bars for {symbol}: {e}")
        return {"bars_1m": [], "bars_5m": [], "bars_15m": [], "bars_1h": []}


# ─── Regime Detection ──────────────────────────────────────────────────────

def detect_and_track_regime(symbol: str, bars: dict) -> dict[str, RegimeAnalysis]:
    """
    Run regime detection across multiple timeframes and update the tracker.
    Returns {timeframe: RegimeAnalysis} for each timeframe with data.
    """
    results: dict[str, RegimeAnalysis] = {}

    tf_mapping = {
        "1M": bars.get("bars_1m", []),
        "5M": bars.get("bars_5m", []),
        "15M": bars.get("bars_15m", []),
        "1H": bars.get("bars_1h", []),
    }

    for tf_name, tf_bars in tf_mapping.items():
        if not tf_bars or len(tf_bars) < 20:
            continue

        try:
            # Get previous state for duration tracking
            prev_regime, prev_bars = _regime_tracker.get_current(symbol, tf_name)

            analysis = detect_regime_from_bars(
                tf_bars,
                prev_regime=prev_regime if prev_bars > 0 else None,
                prev_regime_bars=prev_bars,
            )

            # Update tracker (will log transitions)
            transition = _regime_tracker.update(symbol, tf_name, analysis)
            results[tf_name] = analysis

            if transition:
                logger.info(
                    "REGIME CHANGE: %s %s %s → %s (conf=%.2f)",
                    symbol, tf_name,
                    transition.from_regime.value,
                    transition.to_regime.value,
                    transition.confidence,
                )
        except Exception as e:
            logger.error(f"Regime detection failed for {symbol} {tf_name}: {e}")

    return results


def get_regime_tracker() -> RegimeTracker:
    """Expose the regime tracker for external use (e.g., API routes)."""
    return _regime_tracker


# ─── Main Brain Cycle ──────────────────────────────────────────────────────

def run_brain_cycle(symbols: list[str] = None):
    """
    Execute one full brain update cycle across all watched symbols.
    """
    symbols = symbols or DEFAULT_SYMBOLS
    store = get_store()
    cycle_start = time.monotonic()

    for symbol in symbols:
        try:
            # 1. Fetch market data
            bars = fetch_bars(symbol)

            if not bars["bars_1m"]:
                logger.warning(f"No bars for {symbol}, skipping")
                continue

            # 2. Detect regime across timeframes
            regime_results = detect_and_track_regime(symbol, bars)

            # 3. Update stock brain
            brain = update_stock_brain(
                symbol=symbol,
                bars_1m=bars["bars_1m"],
                bars_5m=bars["bars_5m"],
                bars_15m=bars["bars_15m"],
                bars_1h=bars["bars_1h"],
            )

            # 4. Inject regime data into brain state
            if regime_results:
                # Use 1H regime as primary, fall back to lower TFs
                primary_tf = "1H" if "1H" in regime_results else next(iter(regime_results))
                primary_analysis = regime_results[primary_tf]

                if hasattr(brain, "regime"):
                    brain.regime = primary_analysis.current_regime.value
                if hasattr(brain, "regime_confidence"):
                    brain.regime_confidence = primary_analysis.confidence

                # Multi-TF confluence
                confluence_score = _regime_tracker.get_confluence_score(symbol)
                if hasattr(brain, "regime_confluence"):
                    brain.regime_confluence = confluence_score

            # 5. Quick risk check — can we even consider trading?
            supreme = store.get_supreme()
            if quick_risk_check(brain, supreme):
                # 6. Full risk evaluation
                risk_gate = evaluate_risk(brain, supreme)
                brain.risk_gate = risk_gate
                store.update_stock(symbol, brain)

            logger.debug(
                f"Brain cycle: {symbol} "
                f"attention={brain.attention_level.value} "
                f"state={brain.decision.state.value} "
                f"regime={regime_results.get('1H', regime_results.get(next(iter(regime_results), ''), None))}"
            )
        except Exception as e:
            logger.error(f"Brain cycle error for {symbol}: {e}", exc_info=True)

    # 7. Supreme orchestration
    try:
        update_supreme()
    except Exception as e:
        logger.error(f"Supreme update error: {e}", exc_info=True)

    elapsed = time.monotonic() - cycle_start
    logger.info(f"Brain cycle complete: {len(symbols)} symbols in {elapsed:.1f}s")


def check_position_exits():
    """Check all open positions for exit signals."""
    tracker = get_position_tracker()
    store = get_store()

    for pos in tracker.open_positions:
        brain = store.get_stock(pos.symbol)
        if brain and brain.price.last > 0:
            exits = tracker.update_price(pos.symbol, brain.price.last)
            for exit_signal in exits:
                logger.info(
                    f"EXIT SIGNAL: {exit_signal['symbol']} {exit_signal['reason']} "
                    f"R={exit_signal['r_multiple']:.2f}"
                )
                # Close the position
                tracker.close_position(exit_signal["position_id"], exit_signal["exit_price"])


# ─── Background Loop ──────────────────────────────────────────────────────

_loop_thread: threading.Thread | None = None
_stop_event = threading.Event()


def _brain_loop_worker(symbols: list[str]):
    """Background worker that runs the brain cycle on interval."""
    logger.info(f"Brain loop started: {symbols} | interval={UPDATE_INTERVAL_S}s")

    last_evolution = time.monotonic()

    while not _stop_event.is_set():
        try:
            # Full brain cycle
            run_brain_cycle(symbols)

            # Position exit checks (more frequent)
            check_position_exits()

            # Periodic evolution
            if time.monotonic() - last_evolution > EVOLUTION_INTERVAL_S:
                try:
                    store = get_store()
                    supreme = store.get_supreme()
                    run_evolution(supreme)
                    last_evolution = time.monotonic()
                except Exception as e:
                    logger.error(f"Periodic evolution error: {e}")

        except Exception as e:
            logger.error(f"Brain loop error: {e}", exc_info=True)

        # Wait for next cycle
        _stop_event.wait(UPDATE_INTERVAL_S)

    logger.info("Brain loop stopped")


def start_background_loop(symbols: list[str] = None):
    """Start the brain loop in a background daemon thread."""
    global _loop_thread

    if _loop_thread and _loop_thread.is_alive():
        logger.warning("Brain loop already running")
        return

    _stop_event.clear()
    _loop_thread = threading.Thread(
        target=_brain_loop_worker,
        args=(symbols or DEFAULT_SYMBOLS,),
        daemon=True,
        name="godsview-brain-loop",
    )
    _loop_thread.start()


def stop_background_loop():
    """Stop the brain loop."""
    _stop_event.set()
    if _loop_thread:
        _loop_thread.join(timeout=10)


# ─── Standalone Entry ──────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    symbols = os.environ.get("GODSVIEW_SYMBOLS", "BTC/USD,ETH/USD").split(",")
    logger.info(f"Starting brain loop: {symbols}")

    try:
        while True:
            run_brain_cycle(symbols)
            check_position_exits()
            time.sleep(UPDATE_INTERVAL_S)
    except KeyboardInterrupt:
        logger.info("Brain loop terminated by user")
