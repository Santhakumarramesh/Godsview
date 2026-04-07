/**
 * Phase 103 — Execution Control API
 *
 * Dashboard-facing endpoints for execution monitoring and control.
 * Complements Phase 96's production execution routes.
 *
 * Endpoints:
 *   GET  /status          — Execution mode + summary stats
 *   GET  /orders/active   — Active order book
 *   POST /orders/submit   — Submit new order
 *   POST /orders/cancel   — Cancel an order
 *   GET  /positions       — Open positions with P&L
 *   GET  /venues          — Venue health grid
 *   GET  /report          — Execution performance report
 *   GET  /fills           — Recent fills feed
 *   POST /mode            — Switch execution mode
 *   GET  /health          — Subsystem health
 */

import { Router, type Request, type Response } from "express";

const router = Router();

// ── Shared State ────────────────────────────────────────────────────────────
let executionMode: "live" | "paper" | "shadow" = "paper";

// ── Mock Orders ─────────────────────────────────────────────────────────────
const activeOrders = [
  { id: "ord_a1b2c3", symbol: "AAPL", side: "buy", type: "limit", quantity: 150, filledQty: 75, price: 189.45, status: "partial_fill", createdAt: new Date(Date.now() - 45_000).toISOString() },
  { id: "ord_d4e5f6", symbol: "MSFT", side: "buy", type: "market", quantity: 50, filledQty: 0, price: 415.20, status: "routed", createdAt: new Date(Date.now() - 12_000).toISOString() },
  { id: "ord_g7h8i9", symbol: "NVDA", side: "sell", type: "stop", quantity: 30, filledQty: 0, price: 875.00, status: "pending", createdAt: new Date(Date.now() - 5_000).toISOString() },
  { id: "ord_j0k1l2", symbol: "TSLA", side: "buy", type: "limit", quantity: 100, filledQty: 100, price: 172.30, status: "filled", createdAt: new Date(Date.now() - 120_000).toISOString() },
  { id: "ord_m3n4o5", symbol: "AMZN", side: "sell", type: "market", quantity: 25, filledQty: 25, price: 186.75, status: "filled", createdAt: new Date(Date.now() - 90_000).toISOString() },
  { id: "ord_p6q7r8", symbol: "META", side: "buy", type: "limit", quantity: 80, filledQty: 40, price: 505.10, status: "partial_fill", createdAt: new Date(Date.now() - 60_000).toISOString() },
  { id: "ord_s9t0u1", symbol: "BTC-USD", side: "buy", type: "market", quantity: 0.5, filledQty: 0, price: 68420.00, status: "validating", createdAt: new Date(Date.now() - 3_000).toISOString() },
  { id: "ord_v2w3x4", symbol: "ETH-USD", side: "sell", type: "limit", quantity: 5, filledQty: 0, price: 3845.50, status: "routed", createdAt: new Date(Date.now() - 8_000).toISOString() },
];

// ── Mock Positions ──────────────────────────────────────────────────────────
const positions = [
  { id: "pos_001", symbol: "AAPL", side: "long", quantity: 200, entryPrice: 187.30, currentPrice: 189.45, unrealizedPnl: 430.00, unrealizedPnlPct: 1.15, realizedPnl: 0, stopLoss: 183.50, takeProfit: 195.00, entryTime: new Date(Date.now() - 3600_000 * 4).toISOString() },
  { id: "pos_002", symbol: "NVDA", side: "long", quantity: 50, entryPrice: 868.20, currentPrice: 875.40, unrealizedPnl: 360.00, unrealizedPnlPct: 0.83, realizedPnl: 1200, stopLoss: 850.00, takeProfit: 920.00, entryTime: new Date(Date.now() - 3600_000 * 12).toISOString() },
  { id: "pos_003", symbol: "TSLA", side: "short", quantity: 75, entryPrice: 178.90, currentPrice: 172.30, unrealizedPnl: 495.00, unrealizedPnlPct: 3.69, realizedPnl: 0, stopLoss: 185.00, takeProfit: 165.00, entryTime: new Date(Date.now() - 3600_000 * 2).toISOString() },
  { id: "pos_004", symbol: "META", side: "long", quantity: 40, entryPrice: 502.15, currentPrice: 505.10, unrealizedPnl: 118.00, unrealizedPnlPct: 0.59, realizedPnl: 650, stopLoss: 495.00, takeProfit: 520.00, entryTime: new Date(Date.now() - 3600_000 * 8).toISOString() },
  { id: "pos_005", symbol: "BTC-USD", side: "long", quantity: 1.5, entryPrice: 67200.00, currentPrice: 68420.00, unrealizedPnl: 1830.00, unrealizedPnlPct: 1.82, realizedPnl: 3400, stopLoss: 65000.00, takeProfit: 72000.00, entryTime: new Date(Date.now() - 3600_000 * 24).toISOString() },
];

// ── Mock Venues ─────────────────────────────────────────────────────────────
const venues = [
  { venueId: "alpaca", name: "Alpaca", type: "exchange", status: "healthy", latency: 12, fillRate: 0.967, lastCheck: new Date().toISOString(), errorCount: 0, fees: { maker: 0.0001, taker: 0.0003 }, orders: 1842 },
  { venueId: "iex", name: "IEX", type: "exchange", status: "healthy", latency: 8, fillRate: 0.981, lastCheck: new Date().toISOString(), errorCount: 0, fees: { maker: 0.0000, taker: 0.0009 }, orders: 956 },
  { venueId: "darkpool_alpha", name: "DarkPool Alpha", type: "darkpool", status: "degraded", latency: 45, fillRate: 0.742, lastCheck: new Date().toISOString(), errorCount: 3, fees: { maker: 0.0002, taker: 0.0002 }, orders: 324 },
  { venueId: "dex_uni", name: "Uniswap V3", type: "dex", status: "healthy", latency: 2100, fillRate: 0.891, lastCheck: new Date().toISOString(), errorCount: 1, fees: { maker: 0.003, taker: 0.003 }, orders: 87 },
];

// ── Mock Fills ──────────────────────────────────────────────────────────────
const recentFills = Array.from({ length: 20 }, (_, i) => {
  const symbols = ["AAPL", "MSFT", "NVDA", "TSLA", "META", "AMZN", "BTC-USD", "ETH-USD"];
  const sides = ["buy", "sell"];
  const venueNames = ["Alpaca", "IEX", "DarkPool Alpha", "Uniswap V3"];
  const sym = symbols[i % symbols.length];
  const basePrice = sym === "BTC-USD" ? 68400 : sym === "ETH-USD" ? 3840 : 100 + Math.random() * 800;
  return {
    fillId: `fill_${String(i).padStart(3, "0")}`,
    orderId: `ord_${Math.random().toString(36).slice(2, 8)}`,
    symbol: sym,
    side: sides[i % 2],
    quantity: Math.floor(Math.random() * 100) + 5,
    price: Math.round(basePrice * 100) / 100,
    fee: Math.round(Math.random() * 5 * 100) / 100,
    slippageBps: Math.round(Math.random() * 8 * 10) / 10,
    venue: venueNames[i % venueNames.length],
    timestamp: new Date(Date.now() - i * 30_000).toISOString(),
  };
});

// ── GET /status ─────────────────────────────────────────────────────────────
router.get("/status", (_req: Request, res: Response) => {
  const filled = activeOrders.filter((o) => o.status === "filled").length;
  res.json({
    mode: executionMode,
    activeOrders: activeOrders.filter((o) => !["filled", "rejected", "cancelled"].includes(o.status)).length,
    totalOrders: activeOrders.length,
    fillRate: filled / activeOrders.length,
    avgSlippageBps: 1.3,
    uptime: process.uptime(),
  });
});

// ── GET /orders/active ──────────────────────────────────────────────────────
router.get("/orders/active", (_req: Request, res: Response) => {
  res.json({ orders: activeOrders });
});

// ── POST /orders/submit ─────────────────────────────────────────────────────
router.post("/orders/submit", (req: Request, res: Response) => {
  const { symbol, side, type, quantity, price } = req.body || {};
  const id = `ord_${Math.random().toString(36).slice(2, 8)}`;
  const order = {
    id,
    symbol: symbol ?? "AAPL",
    side: side ?? "buy",
    type: type ?? "market",
    quantity: quantity ?? 100,
    filledQty: 0,
    price: price ?? 0,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  activeOrders.push(order);
  res.json({ accepted: true, order });
});

// ── POST /orders/cancel ─────────────────────────────────────────────────────
router.post("/orders/cancel", (req: Request, res: Response) => {
  const { orderId } = req.body || {};
  const order = activeOrders.find((o) => o.id === orderId);
  if (order && !["filled", "cancelled"].includes(order.status)) {
    order.status = "cancelled";
    res.json({ success: true, orderId });
  } else {
    res.status(404).json({ success: false, error: "Order not found or already terminal" });
  }
});

// ── GET /positions ──────────────────────────────────────────────────────────
router.get("/positions", (_req: Request, res: Response) => {
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalRealized = positions.reduce((s, p) => s + p.realizedPnl, 0);
  const longCount = positions.filter((p) => p.side === "long").length;
  const shortCount = positions.filter((p) => p.side === "short").length;

  res.json({
    positions,
    summary: {
      totalPositions: positions.length,
      longPositions: longCount,
      shortPositions: shortCount,
      totalUnrealizedPnl: totalUnrealized,
      totalRealizedPnl: totalRealized,
      winningPositions: positions.filter((p) => p.unrealizedPnl > 0).length,
      losingPositions: positions.filter((p) => p.unrealizedPnl < 0).length,
    },
  });
});

// ── GET /venues ─────────────────────────────────────────────────────────────
router.get("/venues", (_req: Request, res: Response) => {
  res.json({ venues });
});

// ── GET /report ─────────────────────────────────────────────────────────────
router.get("/report", (_req: Request, res: Response) => {
  res.json({
    totalOrders: 3209,
    filledOrders: 3015,
    rejectedOrders: 42,
    cancelledOrders: 152,
    avgSlippageBps: 1.3,
    avgFillTimeMs: 187,
    fillRate: 0.942,
    totalFees: 4821.37,
    ordersByStatus: {
      filled: 3015,
      partial_fill: 28,
      rejected: 42,
      cancelled: 152,
      timeout: 12,
      pending: 3,
      routed: 5,
      validating: 2,
    },
  });
});

// ── GET /fills ──────────────────────────────────────────────────────────────
router.get("/fills", (_req: Request, res: Response) => {
  res.json({ fills: recentFills });
});

// ── POST /mode ──────────────────────────────────────────────────────────────
router.post("/mode", (req: Request, res: Response) => {
  const { mode } = req.body || {};
  if (mode && ["live", "paper", "shadow"].includes(mode)) {
    executionMode = mode;
    res.json({ success: true, mode: executionMode });
  } else {
    res.status(400).json({ success: false, error: "Invalid mode. Use: live, paper, shadow" });
  }
});

// ── GET /health ─────────────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    mode: executionMode,
    subsystems: {
      executionEngine: { status: "ok", mode: executionMode, activeOrders: activeOrders.filter((o) => !["filled", "rejected", "cancelled"].includes(o.status)).length },
      positionManager: { status: "ok", openPositions: positions.length },
      smartRouter: { status: "ok", venues: venues.length, healthyVenues: venues.filter((v) => v.status === "healthy").length },
    },
    uptime: process.uptime(),
  });
});

export default router;
