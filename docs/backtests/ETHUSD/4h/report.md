# GodsView Backtest Report: ETHUSD 4h

**Generated:** 2026-04-25 05:43 UTC

## Data

| Field | Value |
|-------|-------|
| Symbol | ETHUSD |
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
| Total trades | 14 |
| Win rate | 64.3% |
| Profit factor | 2.4 |
| Sharpe ratio | 5.56 |
| Max drawdown | 11.59% |
| Total return | 22.39% |
| Avg R-multiple | 0.78 |
| Best trade | 10.79% |
| Worst trade | -8.49% |
| Final equity | $123,102.37 |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | 10 | 70.0% | 24.56% |
| SHORT | 4 | 50.0% | -2.17% |

## Structure detected

- Order blocks: 149 (74 bullish, 75 bearish)
- BOS/CHOCH events: 49
- Unmitigated OBs: 20

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**NOT APPROVED**

Criteria check:
- Profit factor > 1.3: PASS (2.4)
- At least 30 trades: FAIL (14)
- Max drawdown < 25%: PASS (11.59%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
