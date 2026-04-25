# GodsView Backtest Report: SOLUSD 4h

**Generated:** 2026-04-25 05:43 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | SOLUSD |
| Timeframe | 4h |
| Data source | Binance (via CCXT) |
| Date range | 2025-12-26 to 2026-04-25 |
| Total candles | 721 |
| Order flow method | **OHLCV PROXY** (not real order book) |

## Strategy rules

**Strategy A — OB Retest Long:** Bullish order block retest with delta/volume confirmation. TP=2R, SL below OB.

**Strategy B — OB Retest Short:** Bearish order block retest with delta/volume confirmation. TP=2R, SL above OB.

**Strategy C — Breakout + Retest:** BOS level retest with order flow confirmation. TP=2R, SL beyond level.

## Performance

| Metric | Value |
|--------|-------|
| Total trades | 16 |
| Win rate | 81.2% |
| Profit factor | 7.33 |
| Sharpe ratio | 13.99 |
| Max drawdown | 3.88% |
| Total return | 48.97% |
| Avg R-multiple | 1.25 |
| Best trade | 10.29% |
| Worst trade | -3.88% |
| Final equity | $160,512.78 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 8 | 75.0% | 20.71% |
| SHORT | 8 | 87.5% | 28.26% |

## Structure detected

- Order blocks: 173 (79 bullish, 94 bearish)
- BOS/CHOCH events: 52
- Unmitigated OBs: 26

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: PASS (7.33)
- At least 30 trades: FAIL (16)
- Max drawdown < 25%: PASS (3.88%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
