# GodsView Backtest Report: ETHUSD 1h

**Generated:** 2026-04-25 05:42 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | ETHUSD |
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
| Total trades | 13 |
| Win rate | 76.9% |
| Profit factor | 10.58 |
| Sharpe ratio | 16.05 |
| Max drawdown | 1.81% |
| Total return | 18.58% |
| Avg R-multiple | 1.16 |
| Best trade | 3.64% |
| Worst trade | -1.16% |
| Final equity | $120,105.72 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 9 | 77.8% | 16.11% |
| SHORT | 4 | 75.0% | 2.47% |

## Structure detected

- Order blocks: 80 (37 bullish, 43 bearish)
- BOS/CHOCH events: 55
- Unmitigated OBs: 14

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: PASS (10.58)
- At least 30 trades: FAIL (13)
- Max drawdown < 25%: PASS (1.81%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
