# `@workspace/strategy-ob-retest-long-1h`

Pure-function 1H Order Block Retest Long strategy.

This module is intentionally narrow: one strategy, one timeframe, one direction.
It contains **no I/O, no ML, no probabilities, no fake metrics, no UI**. It is a
set of pure functions that turn a series of 1-hour candles (and an optional list
of news events) into either a long signal with explicit entry/stop/target/
invalidation, or a `no_trade` decision with one or more rejection reasons.

It does not import from any other repo package. It does not call the broker.
It does not read or write the database. It is safe to test in isolation and
safe to wire into the existing execution path later as a single dependency.

## Status

- **Phase 2 (this module):** strategy logic + tests. Not yet wired into routes
  or the order-execution path. That comes in Phase 3 (risk gate hardening) and
  Phase 4 (paper-trading proof system).
- Existing OB-related code in the repo (`smc_engine.ts`, `quant_lab_engine.ts`,
  `super_intelligence.ts`, `route_aliases.ts`, etc.) is untouched. The fake
  prior `baseWR: 0.52, basePF: 1.6` in `quant_lab_engine.ts:237` is **not**
  used here — this module emits no win-rate or profit-factor estimates.

## The rules (locked from your Phase 1 answers)

| Rule | Value |
|---|---|
| Timeframe | 1H |
| Side | Long only |
| OB candle | Last bar where `Close < Open` before the impulse leg |
| BOS up | Bar whose `High >` most recent confirmed swing high |
| Min impulse displacement | `(rangeHigh − rangeLow) ≥ 1.5 × ATR(14)[bos]` |
| Retest | Bar with `Low ≤ obHigh AND High ≥ obLow` (wick or body inside zone) |
| Confirmation | The retest bar must close bullish (`Close > Open`) |
| Max bars to retest | 24 hours after BOS bar |
| Entry | Market on confirmation bar's close |
| Stop | `obLow − 0.25 × ATR(14)[signal]` |
| Take profit | `entry + 2 × (entry − stop)` (= 2R) |
| Invalidation | Any bar closes below `obLow`, OR opposite BOS down before retest, OR 24 bars elapsed without confirmation |
| No-trade: news | High-severity event within ±30 minutes of confirmation bar |
| No-trade: ATR low | `ATR(14)[signal] < 0.5 × SMA(ATR, 50)[signal]` |
| No-trade: regime | Last two confirmed swing highs must ascend AND last two confirmed swing lows must ascend (HH + HL) |

All thresholds are configurable via the `Config` interface. Defaults match the
table above.

## Public API (slim signal — only fields you specified)

```ts
import { evaluate, type EvaluateInput, type Signal } from "@workspace/strategy-ob-retest-long-1h";

const result: Signal = evaluate({
  symbol: "BTCUSD",     // accepted for caller convenience; NOT in output
  bars,                 // Bar[], oldest → newest, 1H timeframe
  news,                 // optional NewsEvent[]
  config,               // optional Partial<Config>
});

if (result.kind === "long") {
  // Only these fields are present:
  //   result.timestamp                 ISO 8601 of confirmation bar
  //   result.entry                     market price on confirmation close
  //   result.stop                      obLow - 0.25 * ATR(14)
  //   result.target                    entry + 2R
  //   result.invalidation.obLow        a 1H close below this invalidates
  //   result.invalidation.expireAt     ISO 8601 of expiry bar
} else {
  // Only these fields are present:
  //   result.timestamp                 ISO 8601 of last bar (eval time)
  //   result.reason                    single RejectionReason (upstream-first precedence)
}
```

## File map

```
src/
  types.ts         Bar, NewsEvent, Config, OrderBlock1H, Signal, RejectionReason, DEFAULT_CONFIG
  atr.ts           trueRange, atr (Wilder), smaIgnoreNaN
  structure.ts     detectPivots (L=R=2), findLatestBOSUp, findBOSDownAfter, isBullishStructure
  order_block.ts   findOrderBlockForBOS, displacementATR
  retest.ts        findRetestConfirmation
  filters.ts       atrTooLow, inNewsWindow
  signal.ts        buildLongSignal
  strategy.ts      evaluate (top-level orchestrator)
  index.ts         barrel re-export
tests/
  fixtures/
    builders.ts    buildBaseFixture (60-bar synthetic series with one valid setup)
  atr.test.ts            7  cases
  structure.test.ts      7  cases
  order_block.test.ts    4  cases
  retest.test.ts         3  cases
  filters.test.ts        8  cases
  signal.test.ts         1  case
  strategy.test.ts       6  cases (end-to-end + 5 rejection paths)
```

41 tests across 7 files. All green. `tsc --noEmit` clean.

## Algorithm flow (what `evaluate` does)

1. Validate enough bars exist to compute ATR(14) + pivots + ATR-50 SMA. If not → `no_trade(insufficient_bars)`.
2. Compute ATR(14) Wilder series and pivot list (L=R=2 confirmed swings).
3. Find the latest BOS-up event: walk confirmed swing highs from newest to oldest; for each, take the first subsequent bar whose `High > pivot.price`; return the (pivot, bos-bar) pair with the most recent bos-bar index. If none exists → `no_trade(no_bos_up)`.
4. Walk back from `bosIndex - 1` for the last `Close < Open` bar. That's the OB candle. If none exists in the search window → `no_trade(no_order_block)`.
5. Compute displacement = `(rangeHigh − rangeLow) / ATR(14)[bos]` over `[obIndex, bosIndex]`. If `< 1.5` → `no_trade(displacement_too_small)`.
6. Scan bars after BOS up to `bosIndex + 24` for the retest:
   - If any bar closes below `obLow` → `no_trade(ob_broken_before_retest)`.
   - Else if a bar touches the OB zone AND closes bullish → confirmation found.
   - Else after 24 bars → `no_trade(retest_window_expired)`.
7. Check for opposite BOS down between `bosIndex+1` and the retest bar. If found before retest → `no_trade(opposite_bos_before_retest)`.
8. Apply no-trade filters at the confirmation bar:
   - `atr_too_low` if `ATR(14)[sig] / SMA(ATR, 50)[sig] < 0.5`
   - `news_window` if any high-severity news within ±30 min of `bars[sig].Timestamp`
   - `regime_not_bullish` if last 2 confirmed swing highs not ascending OR last 2 confirmed swing lows not ascending
   - If any of the three trigger → `no_trade` with all triggered reasons.
9. Otherwise, build the long signal:
   - `entry = bars[sig].Close`
   - `stop = obLow − 0.25 × ATR(14)[sig]`
   - `target = entry + 2 × (entry − stop)`
   - `invalidation = { obLow, expireAtIndex: bosIndex + 24 }`

## Rejection reasons (exhaustive)

```
insufficient_bars              fewer bars than needed for ATR + pivots + ATR-50 SMA
no_bos_up                      no swing high has been broken in the series
no_order_block                 no down-close bar exists in the OB search window
displacement_too_small         impulse leg < 1.5 × ATR(14) at BOS bar
ob_broken_before_retest        a bar closed below obLow before any retest confirmation
opposite_bos_before_retest     a swing low was broken between BOS up and the retest bar
retest_window_expired          24 bars elapsed with no qualifying retest confirmation
atr_too_low                    ATR at signal bar < 0.5 × 50-bar average
news_window                    high-severity news within ±30 min of confirmation bar
regime_not_bullish             last 2 swing highs and/or lows not ascending
```

## What this module does NOT do

- Does **not** size positions. Capital allocation belongs in the risk/execution layer (Phase 3).
- Does **not** decide *when* to evaluate. The caller is responsible for re-running on bar close.
- Does **not** persist state between calls. Every call is a function of `(bars, news, config)`.
- Does **not** subscribe to or fetch market data. Bars are passed in.
- Does **not** call the broker. Signal output is data, not an order.
- Does **not** make probabilistic claims. `LongSignal` has no `confidence` field by design.
- Does **not** integrate with the existing `super_intelligence`, `quant_lab_engine`, or autonomous brain pipelines yet. Those wirings are Phase 3+.

## How to run tests

This module is a self-contained pnpm/npm package. You can either install it as
its own workspace (add `lib/strategies/*` to `pnpm-workspace.yaml`) or test
standalone:

```bash
cd lib/strategies/ob-retest-long-1h
npm install                  # or: pnpm install
npx vitest run               # 41 tests, ~1s
npx tsc --noEmit             # type check
```

## Next steps (require user approval)

- **Phase 3:** wire `evaluate()` output into a single execution choke point that
  collapses the two existing order-submit paths (`order_executor.executeOrder`
  and `routes/alpaca.ts POST /alpaca/orders`) into one.
- **Phase 4:** persist every `evaluate()` call result to a `signal_log` table
  (accepted and rejected), with bar timestamp, fingerprint, reasons, and OB
  metadata. This is the foundation for the paper-trading proof log.
