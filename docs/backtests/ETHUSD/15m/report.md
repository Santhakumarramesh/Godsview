# GodsView Backtest Report: ETHUSD 15m

**Generated:** 2026-04-25 05:42 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | ETHUSD |
| Timeframe | 15m |
| Data source | Binance (via CCXT) |
| Date range | 2026-04-17 to 2026-04-25 |
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
| Win rate | 40.0% |
| Profit factor | 0.84 |
| Sharpe ratio | -1.11 |
| Max drawdown | 1.7% |
| Total return | -0.53% |
| Avg R-multiple | 0.31 |
| Best trade | 1.22% |
| Worst trade | -1.41% |
| Final equity | $99,447.14 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 2 | 0.0% | -0.52% |
| SHORT | 8 | 50.0% | -0.01% |

## Structure detected

- Order blocks: 29 (13 bullish, 16 bearish)
- BOS/CHOCH events: 61
- Unmitigated OBs: 7

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: FAIL (0.84)
- At least 30 trades: FAIL (10)
- Max drawdown < 25%: PASS (1.7%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
