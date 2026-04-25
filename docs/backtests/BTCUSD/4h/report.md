# GodsView Backtest Report: BTCUSD 4h

**Generated:** 2026-04-25 05:42 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | BTCUSD |
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
| Total trades | 17 |
| Win rate | 47.1% |
| Profit factor | 2.02 |
| Sharpe ratio | 4.47 |
| Max drawdown | 5.07% |
| Total return | 15.45% |
| Avg R-multiple | 0.34 |
| Best trade | 7.61% |
| Worst trade | -5.07% |
| Final equity | $115,619.01 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 12 | 50.0% | 11.79% |
| SHORT | 5 | 40.0% | 3.66% |

## Structure detected

- Order blocks: 115 (58 bullish, 57 bearish)
- BOS/CHOCH events: 51
- Unmitigated OBs: 12

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: PASS (2.02)
- At least 30 trades: FAIL (17)
- Max drawdown < 25%: PASS (5.07%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
