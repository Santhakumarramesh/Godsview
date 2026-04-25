# GodsView Backtest Report: SOLUSD 1h

**Generated:** 2026-04-25 05:43 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | SOLUSD |
| Timeframe | 1h |
| Data source | Binance (via CCXT) |
| Date range | 2026-03-26 to 2026-04-25 |
| Total candles | 721 |
| Order flow method | **OHLCV PROXY** (not real order book) |

## Strategy rules

**Strategy A — OB Retest Long:** Bullish order block retest with delta/volume confirmation. TP=2R, SL below OB.

**Strategy B — OB Retest Short:** Bearish order block retest with delta/volume confirmation. TP=2R, SL above OB.

**Strategy C — Breakout + Retest:** BOS level retest with order flow confirmation. TP=2R, SL beyond level.

## Performance

| Metric | Value |
|--------|-------|
| Total trades | 10 |
| Win rate | 80.0% |
| Profit factor | 4.8 |
| Sharpe ratio | 11.82 |
| Max drawdown | 1.54% |
| Total return | 10.01% |
| Avg R-multiple | 0.99 |
| Best trade | 2.73% |
| Worst trade | -1.54% |
| Final equity | $110,378.68 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 7 | 100.0% | 10.42% |
| SHORT | 3 | 33.3% | -0.4% |

## Structure detected

- Order blocks: 92 (47 bullish, 45 bearish)
- BOS/CHOCH events: 49
- Unmitigated OBs: 10

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: PASS (4.8)
- At least 30 trades: FAIL (10)
- Max drawdown < 25%: PASS (1.54%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
