# GodsView Backtest Report: BTCUSD 15m

**Generated:** 2026-04-25 05:42 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | BTCUSD |
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
| Total trades | 12 |
| Win rate | 41.7% |
| Profit factor | 0.77 |
| Sharpe ratio | -1.91 |
| Max drawdown | 3.06% |
| Total return | -1.1% |
| Avg R-multiple | 0.17 |
| Best trade | 0.96% |
| Worst trade | -1.08% |
| Final equity | $98,873.44 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 5 | 40.0% | 0.7% |
| SHORT | 7 | 42.9% | -1.8% |

## Structure detected

- Order blocks: 17 (9 bullish, 8 bearish)
- BOS/CHOCH events: 57
- Unmitigated OBs: 3

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: FAIL (0.77)
- At least 30 trades: FAIL (12)
- Max drawdown < 25%: PASS (3.06%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
