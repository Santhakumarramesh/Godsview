/**
 * orderbook.ts — Phase 3 API endpoints for order book and microstructure
 *
 * Endpoints:
 *   GET /api/orderbook/snapshot          Current full snapshot (REST fetch)
 *   GET /api/orderbook/stream            SSE stream of live snapshots
 *   GET /api/market/microstructure       Top-of-book metrics + imbalance
 *   GET /api/market/liquidity-zones      Clustered liquidity zones
 *
 * Data source: Alpaca v1beta3 crypto order books.
 * Polling: REST every 5 s via OrderBookManager.
 *
 * Limitations (Phase 3, documented):
 *  - Alpaca paper accounts receive the same order book as live accounts.
 *  - Depth is limited to ~20–50 visible levels per side.
 *  - This is a REAL data source — not mocked.
 */

import { Router } from "express";
import { orderBookManager } from "../lib/market/orderbook";
import { orderBookRecorder } from "../lib/market/orderbook_recorder";
import { computeLiquidityZones, computeMicrostructure } from "../lib/market/liquidityMap";
import { isCryptoSymbol, normalizeMarketSymbol } from "../lib/market/symbols";
import { getBars } from "../lib/alpaca";

const router = Router();

function validateSymbol(sym: string): string {
  const normalized = normalizeMarketSymbol(sym, "BTCUSD");
  return isCryptoSymbol(normalized) ? normalized : "BTCUSD";
}

function parseBoundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseTimeMs(raw: unknown, fallbackMs: number): number {
  const value = String(raw ?? "").trim();
  if (!value) return fallbackMs;

  if (/^\d+$/.test(value)) {
    const ms = Number.parseInt(value, 10);
    return Number.isFinite(ms) ? ms : Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

// ─── GET /api/orderbook/snapshot ──────────────────────────────────────────────
router.get("/orderbook/snapshot", async (req, res) => {
  const symbol = validateSymbol(String(req.query.symbol ?? "BTCUSD"));
  const depth  = Math.min(parseInt(String(req.query.depth ?? "25"), 10), 100);

  try {
    const snap = await orderBookManager.fetchSnapshot(symbol);
    res.json({
      symbol,
      timestamp:  snap.timestamp,
      receivedAt: new Date(snap.receivedAt).toISOString(),
      source:     snap.source,
      asks:       snap.asks.slice(0, depth),
      bids:       snap.bids.slice(0, depth),
      bestAsk:    snap.asks[0] ?? null,
      bestBid:    snap.bids[0] ?? null,
      spread:     snap.asks[0] && snap.bids[0] ? snap.asks[0].price - snap.bids[0].price : null,
      totalAsks:  snap.asks.length,
      totalBids:  snap.bids.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch order book snapshot");
    res.status(500).json({ error: "orderbook_fetch_failed", message: String(err) });
  }
});

// ─── GET /api/orderbook/stream — SSE live order book ─────────────────────────
router.get("/orderbook/stream", (req, res) => {
  const symbol = validateSymbol(String(req.query.symbol ?? "BTCUSD"));
  const depth  = Math.min(parseInt(String(req.query.depth ?? "20"), 10), 100);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders();

  const send = (data: string) => {
    try {
      res.write(data);
      if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
        (res as unknown as { flush: () => void }).flush();
      }
    } catch { /* client gone */ }
  };

  send(`: connected symbol=${symbol}\n\n`);

  const listener = (snap: import("../lib/market/types").OrderBookSnapshot) => {
    const bids = snap.bids.slice(0, depth);
    const asks = snap.asks.slice(0, depth);
    const bestBid = bids[0] ?? null;
    const bestAsk = asks[0] ?? null;
    const payload = {
      symbol:     snap.symbol,
      timestamp:  snap.timestamp,
      receivedAt: snap.receivedAt,
      source:     snap.source,
      asks,
      bids,
      bestBid,
      bestAsk,
      spread:     bestBid && bestAsk ? bestAsk.price - bestBid.price : null,
      totalBids:  snap.bids.length,
      totalAsks:  snap.asks.length,
    };
    send(`data: ${JSON.stringify(payload)}\n\n`);
  };

  orderBookManager.subscribe(symbol, listener);

  const heartbeat = setInterval(() => send(": ping\n\n"), 10_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    orderBookManager.unsubscribe(symbol, listener);
  });
});

// ─── GET /api/orderbook/replay ───────────────────────────────────────────────
// Returns recorded orderbook frames and optional trade ticks for a time window.
router.get("/orderbook/replay", (req, res) => {
  const symbol = validateSymbol(String(req.query.symbol ?? "BTCUSD"));
  const endMs = parseTimeMs(req.query.end, Date.now());
  const startMs = parseTimeMs(req.query.start, endMs - 15 * 60_000);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    res.status(400).json({
      error: "invalid_time_window",
      message: "start/end must be unix-ms timestamps or ISO-8601 strings",
    });
    return;
  }

  if (startMs >= endMs) {
    res.status(400).json({
      error: "invalid_time_window",
      message: "start must be lower than end",
    });
    return;
  }

  const durationMs = endMs - startMs;
  const maxDurationMs = 48 * 60 * 60 * 1000;
  if (durationMs > maxDurationMs) {
    res.status(400).json({
      error: "window_too_large",
      message: "maximum replay window is 48 hours",
      durationMs,
      maxDurationMs,
    });
    return;
  }

  const downsampleMsRaw = parseBoundedInt(req.query.downsample_ms, 0, 0, 3_600_000);
  const downsampleMs = downsampleMsRaw > 0 ? downsampleMsRaw : undefined;
  const maxFrames = parseBoundedInt(req.query.max_frames, 1_500, 50, 10_000);
  const maxTicks = parseBoundedInt(req.query.max_ticks, 5_000, 50, 25_000);
  const includeTicks = String(req.query.include_ticks ?? "true").toLowerCase() !== "false";

  const replay = orderBookRecorder.getReplayWindow({
    symbol,
    startMs,
    endMs,
    downsampleMs,
    maxFrames,
    maxTicks,
    includeTicks,
  });

  res.json(replay);
});

// ─── GET /api/orderbook/recorder/status ──────────────────────────────────────
router.get("/orderbook/recorder/status", (_req, res) => {
  res.json(orderBookRecorder.getStatus());
});

// ─── GET /api/market/microstructure ──────────────────────────────────────────
router.get("/market/microstructure", async (req, res) => {
  const symbol = validateSymbol(String(req.query.symbol ?? "BTCUSD"));

  try {
    // Try cached snapshot first; fetch if stale or absent
    let snap = orderBookManager.getSnapshot(symbol);
    if (!snap || Date.now() - snap.receivedAt > 8_000) {
      snap = await orderBookManager.fetchSnapshot(symbol);
    }

    const ms = computeMicrostructure(snap);

    res.json({
      symbol:       ms.symbol,
      timestamp:    ms.timestamp,
      mid:          ms.mid,
      bestBid:      ms.bestBid,
      bestAsk:      ms.bestAsk,
      spread:       ms.spread,
      spreadBps:    ms.spreadBps,
      imbalance:    ms.imbalance,
      topBidVolume: ms.topBidVolume,
      topAskVolume: ms.topAskVolume,
      absorbingBid: ms.absorbingBid,
      absorbingAsk: ms.absorbingAsk,
      /** Human-readable signal for dashboard display */
      signal: ms.absorbingBid
        ? "bid_absorption"
        : ms.absorbingAsk
          ? "ask_absorption"
          : "neutral",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute microstructure");
    res.status(500).json({ error: "microstructure_failed", message: String(err) });
  }
});

// ─── GET /api/market/liquidity-zones ─────────────────────────────────────────
router.get("/market/liquidity-zones", async (req, res) => {
  const symbol    = validateSymbol(String(req.query.symbol ?? "BTCUSD"));
  const bucketPct = parseFloat(String(req.query.bucket_pct ?? "0.1"));
  const topN      = Math.min(parseInt(String(req.query.top_n ?? "20"), 10), 50);

  try {
    let snap = orderBookManager.getSnapshot(symbol);
    if (!snap || Date.now() - snap.receivedAt > 8_000) {
      snap = await orderBookManager.fetchSnapshot(symbol);
    }

    const zones = computeLiquidityZones(snap, { bucketPct, topN });
    const ms    = computeMicrostructure(snap);

    res.json({
      symbol,
      timestamp:   snap.timestamp,
      mid:         ms.mid,
      bucketPct,
      /** Ask zones — closest to mid first */
      askZones:    zones.asks,
      /** Bid zones — closest to mid first */
      bidZones:    zones.bids,
      /** Combined zones sorted by strength (highest first) — for heatmap Phase 4 */
      allZones:    [...zones.asks, ...zones.bids].sort((a, b) => b.strength - a.strength),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute liquidity zones");
    res.status(500).json({ error: "liquidity_zones_failed", message: String(err) });
  }
});

// ─── GET /api/market/volume-profile ──────────────────────────────────────────
// Computes a Market Profile / Volume Profile from recent OHLCV bars.
// Returns price levels with volume, POC (Point of Control), VAH, VAL.
router.get("/market/volume-profile", async (req, res) => {
  const symbol    = validateSymbol(String(req.query.symbol ?? "BTCUSD"));
  const timeframe = (["1Min", "5Min", "15Min", "1Hour"] as const).includes(String(req.query.timeframe) as any)
    ? (String(req.query.timeframe) as "1Min" | "5Min" | "15Min" | "1Hour")
    : "1Min";
  const barsCount = Math.min(parseInt(String(req.query.bars ?? "200"), 10), 500);

  try {
    const bars = await getBars(symbol, timeframe, barsCount);
    if (bars.length < 5) {
      res.status(400).json({ error: "insufficient_data", message: "Not enough bars for volume profile" });
      return;
    }

    // ── 1. Determine price range ──────────────────────────────────────────
    let rangeHigh = -Infinity, rangeLow = Infinity;
    for (const b of bars) {
      if (b.High > rangeHigh) rangeHigh = b.High;
      if (b.Low  < rangeLow)  rangeLow  = b.Low;
    }
    const priceRange = rangeHigh - rangeLow;

    // ── 2. Choose bucket size (targeting ~60 levels) ─────────────────────
    const targetBuckets = 60;
    const rawBucket     = priceRange / targetBuckets;
    const magnitude     = Math.pow(10, Math.floor(Math.log10(rawBucket)));
    const bucketSize    = Math.ceil(rawBucket / magnitude) * magnitude;

    // ── 3. Distribute bar volume proportionally across its high-low range ─
    const volumeMap = new Map<number, number>();
    for (const bar of bars) {
      const levelsInBar = Math.max(1, Math.round((bar.High - bar.Low) / bucketSize));
      const volPerLevel = bar.Volume / levelsInBar;
      for (let price = bar.Low; price <= bar.High + bucketSize * 0.01; price += bucketSize) {
        const bucket = Math.round(Math.floor(price / bucketSize) * bucketSize * 100) / 100;
        volumeMap.set(bucket, (volumeMap.get(bucket) ?? 0) + volPerLevel);
      }
    }

    // ── 4. Sort high → low, compute stats ────────────────────────────────
    const sorted = [...volumeMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([price, volume]) => ({ price, volume }));

    const totalVolume = sorted.reduce((s, l) => s + l.volume, 0);
    const maxVolume   = sorted.reduce((m, l) => Math.max(m, l.volume), 1);
    const avgVolume   = totalVolume / sorted.length;

    // ── 5. Find POC ───────────────────────────────────────────────────────
    const poc = sorted.reduce((best, l) => l.volume > best.volume ? l : best, sorted[0]);

    // ── 6. Expand value area to cover 70% of total volume ────────────────
    const targetVA = totalVolume * 0.70;
    const pocIdx   = sorted.findIndex((l) => l.price === poc.price);
    let   upIdx    = pocIdx;
    let   downIdx  = pocIdx;
    let   vaVol    = poc.volume;

    while (vaVol < targetVA && (upIdx > 0 || downIdx < sorted.length - 1)) {
      const upVol   = upIdx   > 0                ? sorted[upIdx   - 1].volume : 0;
      const downVol = downIdx < sorted.length - 1 ? sorted[downIdx + 1].volume : 0;
      if (upVol >= downVol && upIdx > 0) {
        upIdx--;
        vaVol += upVol;
      } else if (downIdx < sorted.length - 1) {
        downIdx++;
        vaVol += downVol;
      } else break;
    }

    const vah = sorted[upIdx].price;
    const val = sorted[downIdx].price;

    // ── 7. Classify each level ────────────────────────────────────────────
    const levels = sorted.map((l) => ({
      price:  l.price,
      volume: Math.round(l.volume * 1000) / 1000,
      pct:    Math.round((l.volume / maxVolume) * 100),
      type: (
        l.price === poc.price            ? "poc" :
        Math.abs(l.price - vah) < bucketSize * 0.5 ? "vah" :
        Math.abs(l.price - val) < bucketSize * 0.5 ? "val" :
        l.volume > avgVolume * 1.5       ? "hvn" :
        l.volume < avgVolume * 0.5       ? "lvn" : "normal"
      ) as "poc" | "vah" | "val" | "hvn" | "lvn" | "normal",
    }));

    // ── 8. Latest price for current-bar highlight ─────────────────────────
    const lastBar     = bars[bars.length - 1];
    const currentPrice = lastBar ? (lastBar.Close) : null;

    res.json({
      symbol,
      timeframe,
      bars:          bars.length,
      levels,
      poc:           { price: poc.price, volume: Math.round(poc.volume * 1000) / 1000 },
      vah:           Math.round(vah * 100) / 100,
      val:           Math.round(val * 100) / 100,
      total_volume:  Math.round(totalVolume * 1000) / 1000,
      bucket_size:   bucketSize,
      current_price: currentPrice,
      computed_at:   new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "volume_profile_failed", message: String(err) });
  }
});

// ─── GET /api/market/candle-intelligence ─────────────────────────────────────
// Returns OHLCV bars enriched with per-candle microstructure intelligence:
// imbalance, absorption, liquidity_strength, reversal_score, wick ratios.
router.get("/market/candle-intelligence", async (req, res) => {
  const symbol    = validateSymbol(String(req.query.symbol ?? "BTCUSD"));
  const timeframe = (["1Min", "5Min", "15Min", "1Hour"] as const).includes(String(req.query.timeframe) as any)
    ? (String(req.query.timeframe) as "1Min" | "5Min" | "15Min" | "1Hour")
    : "5Min";
  const barsCount = Math.min(parseInt(String(req.query.bars ?? "100"), 10), 300);

  try {
    const bars = await getBars(symbol, timeframe, barsCount);
    if (bars.length < 3) {
      res.status(400).json({ error: "insufficient_data" });
      return;
    }

    // Compute average volume for relative strength
    const avgVolume = bars.reduce((s, b) => s + b.Volume, 0) / bars.length;
    const avgRange  = bars.reduce((s, b) => s + (b.High - b.Low), 0) / bars.length;

    const annotated = bars.map((bar, i) => {
      const range      = bar.High - bar.Low || 0.0001;
      const body       = Math.abs(bar.Close - bar.Open);
      const bodyRatio  = body / range;                                             // 0=doji, 1=marubozu

      // Imbalance: +1 = full bull, -1 = full bear, 0 = doji
      const imbalance  = (bar.Close - bar.Open) / range;

      // Absorption: candle has large wicks absorbing pressure (small body, large range)
      const absorption = 1 - bodyRatio;

      // Liquidity strength: relative volume vs session average
      const liquidity_strength = bar.Volume / (avgVolume || 1);

      // Wick ratios
      const upperWick  = bar.High - Math.max(bar.Open, bar.Close);
      const lowerWick  = Math.min(bar.Open, bar.Close) - bar.Low;
      const wick_top   = upperWick / range;
      const wick_bot   = lowerWick / range;

      // Reversal score: high when conditions look like a turning point
      // Inputs: absorption, wick imbalance, relative volume, direction change
      const dojiScore    = 1 - Math.min(bodyRatio / 0.25, 1);      // 0..1
      const wickImbal    = Math.abs(wick_top - wick_bot);            // 0..1
      const relVolScore  = Math.min(liquidity_strength / 2, 1);     // 0..1
      const prevBar      = i > 0 ? bars[i - 1] : null;
      const dirChange    = prevBar ? (
        (bar.Close > bar.Open && prevBar.Close < prevBar.Open) ||
        (bar.Close < bar.Open && prevBar.Close > prevBar.Open) ? 1 : 0
      ) : 0;

      const reversal_score =
        0.35 * dojiScore +
        0.25 * absorption +
        0.20 * relVolScore +
        0.20 * dirChange;

      return {
        time:              Math.floor(new Date(bar.Timestamp).getTime() / 1000),
        open:              bar.Open,
        high:              bar.High,
        low:               bar.Low,
        close:             bar.Close,
        volume:            bar.Volume,
        vwap:              bar.VWAP ?? null,
        // Intelligence annotations
        imbalance:         Math.round(imbalance * 1000) / 1000,
        absorption:        Math.round(absorption * 1000) / 1000,
        liquidity_strength: Math.round(liquidity_strength * 1000) / 1000,
        reversal_score:    Math.round(reversal_score * 1000) / 1000,
        wick_top:          Math.round(wick_top * 1000) / 1000,
        wick_bot:          Math.round(wick_bot * 1000) / 1000,
        body_ratio:        Math.round(bodyRatio * 1000) / 1000,
        direction:         bar.Close >= bar.Open ? "bull" : "bear",
        is_doji:           bodyRatio < 0.1,
        is_high_vol:       liquidity_strength > 1.5,
        is_absorption:     absorption > 0.65 && liquidity_strength > 1.2,
        is_reversal_signal: reversal_score > 0.55,
      };
    });

    // Summary stats
    const reversalBars = annotated.filter((b) => b.is_reversal_signal);
    const absorptionBars = annotated.filter((b) => b.is_absorption);
    const highVolBars  = annotated.filter((b) => b.is_high_vol);

    res.json({
      symbol,
      timeframe,
      bars: annotated,
      summary: {
        total_bars:       annotated.length,
        avg_volume:       Math.round(avgVolume * 1000) / 1000,
        avg_range:        Math.round(avgRange * 100) / 100,
        reversal_signals: reversalBars.length,
        absorption_zones: absorptionBars.length,
        high_vol_events:  highVolBars.length,
        // Most significant candles by reversal score
        top_reversals:    annotated
          .sort((a, b) => b.reversal_score - a.reversal_score)
          .slice(0, 5)
          .map((b) => ({ time: b.time, price: b.close, score: b.reversal_score, direction: b.direction })),
      },
    });
  } catch (err) {
    res.status(500).json({ error: "candle_intelligence_failed", message: String(err) });
  }
});

// ─── GET /api/market/cvd — Cumulative Volume Delta ──────────────────────────
router.get("/market/cvd", async (req, res) => {
  const symbol    = validateSymbol(String(req.query.symbol ?? "BTCUSD"));
  const rawTf = String(req.query.timeframe ?? "5Min");
  const timeframe: "1Min" | "5Min" | "15Min" | "1Hour" =
    rawTf === "1H" ? "1Hour" :
    (["1Min", "5Min", "15Min", "1Hour"].includes(rawTf) ? (rawTf as "1Min" | "5Min" | "15Min" | "1Hour") : "5Min");
  const bars      = Math.min(Math.max(parseInt(String(req.query.bars ?? "100"), 10), 20), 300);

  try {
    const rawBars = await getBars(symbol, timeframe, bars);

    if (!rawBars?.length) {
      res.json({ symbol, timeframe, bars: [], regime: "unknown", cvd_total: 0 });
      return;
    }

    // Sort ascending (oldest → newest)
    const sorted = [...rawBars].sort(
      (a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime()
    );

    // Running stats for z-score
    const ranges  = sorted.map((b) => b.High - b.Low);
    const avgRange = ranges.reduce((s, r) => s + r, 0) / ranges.length || 1;
    const avgVol   = sorted.reduce((s, b) => s + b.Volume, 0) / sorted.length || 1;

    // Per-bar delta: signed volume based on close position within H-L range
    // More nuanced than just bull/bear — uses close position in range
    let cumDelta = 0;
    const annotated = sorted.map((bar) => {
      const range = bar.High - bar.Low || 0.001;
      // Buying pressure = proportion of range bar closed in upper half
      const closePct = (bar.Close - bar.Low) / range; // 0→1
      const delta    = bar.Volume * (closePct * 2 - 1); // -vol → +vol
      cumDelta += delta;
      const relVol   = bar.Volume / avgVol;
      const relRange = (bar.High - bar.Low) / avgRange;
      return {
        time:      Math.floor(new Date(bar.Timestamp).getTime() / 1000),
        open:      bar.Open,
        close:     bar.Close,
        high:      bar.High,
        low:       bar.Low,
        volume:    bar.Volume,
        delta:     Math.round(delta * 10000) / 10000,
        cum_delta: Math.round(cumDelta * 10000) / 10000,
        rel_vol:   Math.round(relVol * 100) / 100,
        rel_range: Math.round(relRange * 100) / 100,
        direction: bar.Close >= bar.Open ? "bull" : "bear",
      };
    });

    // Regime detection from CVD slope over last N bars
    const lookback = Math.min(20, annotated.length);
    const recent   = annotated.slice(-lookback);
    const cdStart  = recent[0].cum_delta;
    const cdEnd    = recent[recent.length - 1].cum_delta;
    const cdSlope  = cdEnd - cdStart;

    // Bull/bear proportion in recent window
    const bullBars = recent.filter((b) => b.direction === "bull").length;
    const bullPct  = bullBars / recent.length;

    let regime: string;
    const normSlope = cdSlope / (avgVol * lookback + 0.001);
    if (normSlope > 0.15 && bullPct > 0.55)        regime = "bull_trend";
    else if (normSlope < -0.15 && bullPct < 0.45)   regime = "bear_trend";
    else if (Math.abs(normSlope) < 0.05)             regime = "ranging";
    else if (normSlope > 0 && bullPct < 0.5)         regime = "bull_exhaustion";
    else if (normSlope < 0 && bullPct > 0.5)         regime = "bear_exhaustion";
    else                                             regime = "transitioning";

    // Delta divergence: price making HH/LL but CVD not confirming
    const priceUp   = annotated[annotated.length - 1].close > annotated[0].close;
    const cvdUp     = cdEnd > cdStart;
    const divergence = priceUp !== cvdUp ? (priceUp ? "bearish_divergence" : "bullish_divergence") : null;

    res.json({
      symbol,
      timeframe,
      bars:         annotated,
      regime,
      divergence,
      cvd_total:    Math.round(cumDelta * 10000) / 10000,
      cvd_slope_20: Math.round(cdSlope * 10000) / 10000,
      bull_pct_20:  Math.round(bullPct * 100),
      avg_volume:   Math.round(avgVol * 10000) / 10000,
    });
  } catch (err) {
    res.status(500).json({ error: "cvd_failed", message: String(err) });
  }
});

export default router;
