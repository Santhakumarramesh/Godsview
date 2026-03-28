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
import { computeLiquidityZones, computeMicrostructure } from "../lib/market/liquidityMap";

const router = Router();

const VALID_SYMBOLS = ["BTCUSD", "ETHUSD"];

function validateSymbol(sym: string): string {
  const upper = String(sym).toUpperCase();
  return VALID_SYMBOLS.includes(upper) ? upper : "BTCUSD";
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
    const payload = {
      type:       "orderbook",
      symbol:     snap.symbol,
      timestamp:  snap.timestamp,
      receivedAt: snap.receivedAt,
      source:     snap.source,
      asks:       snap.asks.slice(0, depth),
      bids:       snap.bids.slice(0, depth),
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

export default router;
