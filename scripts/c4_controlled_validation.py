#!/usr/bin/env python3
"""
GodsView — C4 Controlled Validation
=====================================
Temporarily lowers threshold to 65 to generate paper trades for validation.
Tracks: entry, SL, TP, PnL, R multiple, C1-C4 breakdown.
Then compares results at threshold 65 vs 80.

PAPER MODE ONLY. OHLCV PROXY ORDER FLOW.
"""

import os
import sys
import json
import logging
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from c4_strategy import C4Backtester, C4Scorer, C4StructureAnalyzer

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

try:
    import ccxt
    HAS_CCXT = True
except ImportError:
    HAS_CCXT = False

BASE_DIR = Path(os.path.dirname(os.path.abspath(__file__))).parent
OUTPUT_DIR = BASE_DIR / 'docs' / 'backtests' / 'c4' / 'validation'

SYMBOLS = ['BTC/USD', 'ETH/USD', 'SOL/USD']
TIMEFRAMES = ['5m', '15m', '1h', '4h']
THRESHOLDS = [65, 70, 75, 80]  # Compare across multiple thresholds


def fetch_ohlcv(symbol: str, timeframe: str, limit: int = 500) -> pd.DataFrame:
    """Fetch live OHLCV from Kraken."""
    if not HAS_CCXT:
        logger.error("ccxt required for controlled validation — need real data")
        sys.exit(1)

    try:
        exchange = ccxt.kraken({'enableRateLimit': True})
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        df = df.astype(float)
        logger.info(f"Fetched {len(df)} candles for {symbol} {timeframe} from Kraken")
        return df
    except Exception as e:
        logger.error(f"Failed to fetch {symbol} {timeframe}: {e}")
        return pd.DataFrame()


def run_validation():
    """Run controlled validation across all thresholds."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_trades = []
    threshold_comparison = []

    for symbol in SYMBOLS:
        for tf in TIMEFRAMES:
            logger.info(f"\n{'='*60}")
            logger.info(f"VALIDATION: {symbol} {tf}")
            logger.info(f"{'='*60}")

            df = fetch_ohlcv(symbol, tf, limit=500)
            if len(df) < 50:
                logger.warning(f"Insufficient data for {symbol} {tf}")
                continue

            bt = C4Backtester()

            for threshold in THRESHOLDS:
                result = bt.run(df, symbol, tf, min_score=threshold)
                m = result['metrics']
                trades = result['trades']

                threshold_comparison.append({
                    'symbol': symbol,
                    'timeframe': tf,
                    'threshold': threshold,
                    'total_trades': m['total_trades'],
                    'win_rate': m['win_rate'],
                    'profit_factor': m['profit_factor'],
                    'total_pnl_pct': round(m['total_pnl_pct'], 4),
                    'max_drawdown_pct': round(m['max_drawdown_pct'], 4),
                    'avg_c4_score': round(m['avg_c4_score'], 1),
                    'long_trades': m['long_trades'],
                    'short_trades': m['short_trades'],
                    'long_wr': m['long_win_rate'],
                    'short_wr': m['short_win_rate'],
                })

                # Collect detailed trades at threshold 65
                if threshold == 65:
                    for t in trades:
                        all_trades.append({
                            'symbol': symbol,
                            'timeframe': tf,
                            'direction': t['direction'],
                            'entry_price': round(t['entry_price'], 4),
                            'stop_loss': round(t['stop_loss'], 4),
                            'take_profit': round(t['take_profit'], 4),
                            'exit_price': round(t['exit_price'], 4),
                            'risk_reward': round(t.get('risk_reward', 0), 2),
                            'pnl': round(t['pnl'], 4),
                            'pnl_pct': round(t.get('pnl_pct', 0), 4),
                            'c4_score': round(t['c4_score'], 1),
                            'c1_context': round(t.get('c1', 0), 1),
                            'c2_confirmation': round(t.get('c2', 0), 1),
                            'c3_commitment': round(t.get('c3', 0), 1),
                            'c4_control': round(t.get('c4_control', 0), 1),
                            'result': 'WIN' if t['pnl'] > 0 else 'LOSS',
                            'r_multiple': round(t['pnl'] / abs(t['entry_price'] - t['stop_loss']) if abs(t['entry_price'] - t['stop_loss']) > 0 else 0, 2),
                            'confirmations': t.get('confirmations', []),
                            'warnings': t.get('warnings', []),
                        })

                logger.info(
                    f"  Threshold {threshold}: {m['total_trades']}T, "
                    f"WR={m['win_rate']}%, PF={m['profit_factor']}, "
                    f"PnL={m['total_pnl_pct']:.2f}%, DD={m['max_drawdown_pct']:.2f}%"
                )

    # ── Save detailed trades ──
    trades_path = OUTPUT_DIR / 'paper_trades_threshold65.json'
    with open(trades_path, 'w') as f:
        json.dump(all_trades, f, indent=2, default=str)
    logger.info(f"\nSaved {len(all_trades)} paper trades to {trades_path}")

    # ── Save threshold comparison ──
    comp_path = OUTPUT_DIR / 'threshold_comparison.json'
    with open(comp_path, 'w') as f:
        json.dump(threshold_comparison, f, indent=2)
    logger.info(f"Saved threshold comparison to {comp_path}")

    # ── Print detailed trade log ──
    logger.info(f"\n{'='*120}")
    logger.info("PAPER TRADE LOG (Threshold 65)")
    logger.info(f"{'='*120}")
    logger.info(f"{'#':>3} {'Symbol':<10} {'TF':<5} {'Dir':<6} {'Entry':>12} {'SL':>12} {'TP':>12} "
                f"{'Exit':>12} {'PnL%':>8} {'R':>6} {'C4':>5} {'Result':<6}")
    logger.info('-' * 120)
    for i, t in enumerate(all_trades, 1):
        logger.info(
            f"{i:>3} {t['symbol']:<10} {t['timeframe']:<5} {t['direction']:<6} "
            f"{t['entry_price']:>12.2f} {t['stop_loss']:>12.2f} {t['take_profit']:>12.2f} "
            f"{t['exit_price']:>12.2f} {t['pnl_pct']:>7.2f}% {t['r_multiple']:>5.1f}R "
            f"{t['c4_score']:>4.0f} {t['result']:<6}"
        )

    # ── Print threshold comparison ──
    logger.info(f"\n{'='*100}")
    logger.info("THRESHOLD COMPARISON")
    logger.info(f"{'='*100}")
    logger.info(f"{'Symbol':<10} {'TF':<5} {'Thresh':>6} {'Trades':>7} {'WR%':>7} {'PF':>7} {'PnL%':>8} {'DD%':>7} {'AvgC4':>7}")
    logger.info('-' * 100)
    for r in threshold_comparison:
        logger.info(
            f"{r['symbol']:<10} {r['timeframe']:<5} {r['threshold']:>6} "
            f"{r['total_trades']:>7} {r['win_rate']:>6.1f}% {r['profit_factor']:>7.2f} "
            f"{r['total_pnl_pct']:>7.2f}% {r['max_drawdown_pct']:>6.2f}% {r['avg_c4_score']:>6.1f}"
        )

    # ── Aggregate metrics ──
    if all_trades:
        wins = [t for t in all_trades if t['result'] == 'WIN']
        losses = [t for t in all_trades if t['result'] == 'LOSS']
        total_pnl = sum(t['pnl_pct'] for t in all_trades)
        avg_rr = np.mean([t['risk_reward'] for t in all_trades])
        avg_r_mult = np.mean([t['r_multiple'] for t in all_trades])
        avg_c4 = np.mean([t['c4_score'] for t in all_trades])
        max_win = max(t['pnl_pct'] for t in all_trades) if wins else 0
        max_loss = min(t['pnl_pct'] for t in all_trades) if losses else 0

        logger.info(f"\n{'='*80}")
        logger.info("AGGREGATE METRICS (Threshold 65)")
        logger.info(f"{'='*80}")
        logger.info(f"Total Trades:     {len(all_trades)}")
        logger.info(f"Wins:             {len(wins)}")
        logger.info(f"Losses:           {len(losses)}")
        logger.info(f"Win Rate:         {len(wins)/len(all_trades)*100:.1f}%")
        logger.info(f"Total PnL:        {total_pnl:+.2f}%")
        logger.info(f"Avg Risk:Reward:  {avg_rr:.2f}")
        logger.info(f"Avg R Multiple:   {avg_r_mult:+.2f}R")
        logger.info(f"Avg C4 Score:     {avg_c4:.1f}")
        logger.info(f"Best Trade:       {max_win:+.2f}%")
        logger.info(f"Worst Trade:      {max_loss:+.2f}%")

        # Profit factor
        gross_profit = sum(t['pnl_pct'] for t in all_trades if t['pnl_pct'] > 0)
        gross_loss = abs(sum(t['pnl_pct'] for t in all_trades if t['pnl_pct'] < 0))
        pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')
        logger.info(f"Profit Factor:    {pf:.2f}")

        # Save summary
        summary = {
            'validation_date': datetime.utcnow().isoformat(),
            'threshold': 65,
            'data_source': 'Kraken OHLCV (PROXY)',
            'total_trades': len(all_trades),
            'wins': len(wins),
            'losses': len(losses),
            'win_rate': round(len(wins)/len(all_trades)*100, 1),
            'total_pnl_pct': round(total_pnl, 2),
            'profit_factor': round(pf, 2),
            'avg_risk_reward': round(avg_rr, 2),
            'avg_r_multiple': round(avg_r_mult, 2),
            'avg_c4_score': round(avg_c4, 1),
            'best_trade_pct': round(max_win, 2),
            'worst_trade_pct': round(max_loss, 2),
            'symbols': SYMBOLS,
            'timeframes': TIMEFRAMES,
            'mode': 'PAPER_ONLY',
        }
        summary_path = OUTPUT_DIR / 'validation_summary.json'
        with open(summary_path, 'w') as f:
            json.dump(summary, f, indent=2)
        logger.info(f"\nSummary saved to {summary_path}")

    return all_trades, threshold_comparison


if __name__ == '__main__':
    trades, comparison = run_validation()
