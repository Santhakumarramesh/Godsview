# GodsView Backtest Report: SOLUSD 15m

**Generated:** 2026-04-25 05:43 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | SOLUSD |
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
| Total trades | 15 |
| Win rate | 26.7% |
| Profit factor | 0.36 |
| Sharpe ratio | -8.14 |
| Max drawdown | 9.3% |
| Total return | -7.35% |
| Avg R-multiple | -0.33 |
| Best trade | 1.31% |
| Worst trade | -1.81% |
| Final equity | $92,829.51 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 6 | 16.7% | -3.8% |
| SHORT | 9 | 33.3% | -3.55% |

## Structure detected

- Order blocks: 31 (15 bullish, 16 bearish)
- BOS/CHOCH events: 60
- Unmitigated OBs: 6

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: FAIL (0.36)
- At least 30 trades: FAIL (15)
- Max drawdown < 25%: PASS (9.3%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
