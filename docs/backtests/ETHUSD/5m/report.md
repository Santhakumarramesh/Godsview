# GodsView Backtest Report: ETHUSD 5m

**Generated:** 2026-04-25 05:42 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | ETHUSD |
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
| Win rate | 16.7% |
| Profit factor | 0.3 |
| Sharpe ratio | -8.29 |
| Max drawdown | 5.64% |
| Total return | -4.27% |
| Avg R-multiple | -0.24 |
| Best trade | 1.51% |
| Worst trade | -1.21% |
| Final equity | $95,782.70 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 1 | 0.0% | -0.54% |
| SHORT | 11 | 18.2% | -3.74% |

## Structure detected

- Order blocks: 17 (5 bullish, 12 bearish)
- BOS/CHOCH events: 74
- Unmitigated OBs: 4

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: FAIL (0.3)
- At least 30 trades: FAIL (12)
- Max drawdown < 25%: PASS (5.64%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
