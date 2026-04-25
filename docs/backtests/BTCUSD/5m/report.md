# GodsView Backtest Report: BTCUSD 5m

**Generated:** 2026-04-25 05:42 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | BTCUSD |
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
| Total trades | 12 |
| Win rate | 25.0% |
| Profit factor | 0.27 |
| Sharpe ratio | -10.03 |
| Max drawdown | 5.04% |
| Total return | -4.61% |
| Avg R-multiple | -0.32 |
| Best trade | 1.04% |
| Worst trade | -0.93% |
| Final equity | $95,462.11 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 4 | 0.0% | -2.96% |
| SHORT | 8 | 37.5% | -1.65% |

## Structure detected

- Order blocks: 3 (2 bullish, 1 bearish)
- BOS/CHOCH events: 82
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
- Profit factor > 1.3: FAIL (0.27)
- At least 30 trades: FAIL (12)
- Max drawdown < 25%: PASS (5.04%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
