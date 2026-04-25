# GodsView Backtest Report: BTCUSD 1h

**Generated:** 2026-04-25 05:42 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | BTCUSD |
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
| Total trades | 6 |
| Win rate | 50.0% |
| Profit factor | 0.97 |
| Sharpe ratio | -0.2 |
| Max drawdown | 3.61% |
| Total return | -0.09% |
| Avg R-multiple | 0.34 |
| Best trade | 1.58% |
| Worst trade | -1.39% |
| Final equity | $99,862.46 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 3 | 66.7% | 1.09% |
| SHORT | 3 | 33.3% | -1.18% |

## Structure detected

- Order blocks: 52 (23 bullish, 29 bearish)
- BOS/CHOCH events: 52
- Unmitigated OBs: 8

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: FAIL (0.97)
- At least 30 trades: FAIL (6)
- Max drawdown < 25%: PASS (3.61%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
