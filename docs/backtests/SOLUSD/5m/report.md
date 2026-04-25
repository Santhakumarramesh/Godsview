# GodsView Backtest Report: SOLUSD 5m

**Generated:** 2026-04-25 05:43 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | SOLUSD |
| Timeframe | 5m |
| Data source | Binance (via CCXT) |
| Date range | 2026-04-22 to 2026-04-25 |
| Total candles | 721 |
| Order flow method | **OHLCV PROXY** (not real order book) |

## Strategy rules

**Strategy A — OB Retest Long:** Bullish order block retest with delta/volume confirmation. TP=2R, SL below OB.

**Strategy B — OB Retest Short:** Bearish order block retest with delta/volume confirmation. TP=2R, SL above OB.

**Strategy C — Breakout + Retest:** BOS level retest with order flow confirmation. TP=2R, SL beyond level.

## Performance

| Metric | Value |
|--------|-------|
| Total trades | 11 |
| Win rate | 9.1% |
| Profit factor | 0.13 |
| Sharpe ratio | -16.47 |
| Max drawdown | 6.77% |
| Total return | -6.09% |
| Avg R-multiple | -0.53 |
| Best trade | 0.89% |
| Worst trade | -1.03% |
| Final equity | $94,058.81 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 3 | 0.0% | -2.23% |
| SHORT | 8 | 12.5% | -3.86% |

## Structure detected

- Order blocks: 12 (8 bullish, 4 bearish)
- BOS/CHOCH events: 79
- Unmitigated OBs: 0

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: FAIL (0.13)
- At least 30 trades: FAIL (11)
- Max drawdown < 25%: PASS (6.77%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
