// ── Phase 109: Market Data Integrity Layer API ───────────────────────────────
// 7 endpoints for feed health, validation stats, stale monitoring, sessions, snapshots, store stats

import { Router, type Request, type Response } from "express";

const router = Router();

// ── Mock: Feed Health ───────────────────────────────────────────────────────

const FEEDS = [
  { source: "alpaca", status: "active", isPrimary: true, uptimePct: 99.7, avgLatencyMs: 12, ticksPerSec: 48, clockSkewMs: 1.2, lastHeartbeat: Date.now() - 800, healthScore: 97 },
  { source: "iex", status: "standby", isPrimary: false, uptimePct: 98.9, avgLatencyMs: 23, ticksPerSec: 0, clockSkewMs: 3.1, lastHeartbeat: Date.now() - 5200, healthScore: 85 },
  { source: "polygon", status: "standby", isPrimary: false, uptimePct: 97.2, avgLatencyMs: 35, ticksPerSec: 0, clockSkewMs: 5.8, lastHeartbeat: Date.now() - 12000, healthScore: 78 },
];

const overallFeedHealth = FEEDS.some(f => f.status === "active" && f.healthScore >= 90) ? "healthy" : FEEDS.some(f => f.healthScore >= 70) ? "degraded" : "critical";

// ── Mock: Validation Stats ──────────────────────────────────────────────────

const VALIDATION = {
  totalProcessed: 847293,
  accepted: 831456,
  rejected: 14218,
  corrected: 1619,
  rejectionRate: 1.68,
  breakdown: [
    { check: "timestamp_stale", count: 4812, pct: 33.8, severity: "warning" },
    { check: "duplicate_tick", count: 3291, pct: 23.1, severity: "info" },
    { check: "price_spike", count: 2156, pct: 15.2, severity: "critical" },
    { check: "sequence_gap", count: 1843, pct: 13.0, severity: "warning" },
    { check: "source_trust", count: 987, pct: 6.9, severity: "critical" },
    { check: "volume_negative", count: 542, pct: 3.8, severity: "warning" },
    { check: "timestamp_future", count: 389, pct: 2.7, severity: "info" },
    { check: "price_zero", count: 198, pct: 1.4, severity: "critical" },
  ],
};

// ── Mock: Stale Symbol Monitor ──────────────────────────────────────────────

const now = Date.now();
const STALE_SYMBOLS = [
  { symbol: "BTC/USD", lastPrice: 67432.50, lastUpdate: now - 1200, source: "alpaca", thresholdMs: 5000, stalenessPct: 24 },
  { symbol: "ETH/USD", lastPrice: 3456.78, lastUpdate: now - 2100, source: "alpaca", thresholdMs: 5000, stalenessPct: 42 },
  { symbol: "SOL/USD", lastPrice: 178.92, lastUpdate: now - 800, source: "alpaca", thresholdMs: 5000, stalenessPct: 16 },
  { symbol: "AAPL", lastPrice: 198.45, lastUpdate: now - 8500, source: "alpaca", thresholdMs: 15000, stalenessPct: 57 },
  { symbol: "MSFT", lastPrice: 425.30, lastUpdate: now - 3200, source: "alpaca", thresholdMs: 15000, stalenessPct: 21 },
  { symbol: "NVDA", lastPrice: 892.15, lastUpdate: now - 12500, source: "alpaca", thresholdMs: 15000, stalenessPct: 83 },
  { symbol: "TSLA", lastPrice: 245.67, lastUpdate: now - 6800, source: "alpaca", thresholdMs: 15000, stalenessPct: 45 },
  { symbol: "EUR/USD", lastPrice: 1.0892, lastUpdate: now - 4500, source: "alpaca", thresholdMs: 10000, stalenessPct: 45 },
  { symbol: "GBP/USD", lastPrice: 1.2734, lastUpdate: now - 7800, source: "alpaca", thresholdMs: 10000, stalenessPct: 78 },
  { symbol: "ES", lastPrice: 5432.25, lastUpdate: now - 3100, source: "alpaca", thresholdMs: 10000, stalenessPct: 31 },
  { symbol: "NQ", lastPrice: 18945.50, lastUpdate: now - 9200, source: "alpaca", thresholdMs: 10000, stalenessPct: 92 },
  { symbol: "AVAX/USD", lastPrice: 38.45, lastUpdate: now - 1800, source: "alpaca", thresholdMs: 5000, stalenessPct: 36 },
];

// ── Mock: Session States ────────────────────────────────────────────────────

const SESSIONS = [
  { exchange: "NYSE", timezone: "America/New_York", state: "closed", nextOpen: "2026-04-07T09:30:00-04:00", isHoliday: false, halfDay: false },
  { exchange: "NASDAQ", timezone: "America/New_York", state: "closed", nextOpen: "2026-04-07T09:30:00-04:00", isHoliday: false, halfDay: false },
  { exchange: "CME", timezone: "America/Chicago", state: "closed", nextOpen: "2026-04-06T17:00:00-05:00", isHoliday: false, halfDay: false },
  { exchange: "CRYPTO", timezone: "UTC", state: "always_on", nextOpen: null, isHoliday: false, halfDay: false },
  { exchange: "FOREX", timezone: "America/New_York", state: "closed", nextOpen: "2026-04-05T17:00:00-04:00", isHoliday: false, halfDay: false },
  { exchange: "LSE", timezone: "Europe/London", state: "closed", nextOpen: "2026-04-07T08:00:00+01:00", isHoliday: false, halfDay: false },
  { exchange: "TSE", timezone: "Asia/Tokyo", state: "closed", nextOpen: "2026-04-07T09:00:00+09:00", isHoliday: false, halfDay: false },
  { exchange: "HKEX", timezone: "Asia/Hong_Kong", state: "closed", nextOpen: "2026-04-07T09:30:00+08:00", isHoliday: false, halfDay: false },
];

const HOLIDAYS = [
  { date: "2026-01-01", name: "New Year's Day", exchange: "NYSE" },
  { date: "2026-01-19", name: "MLK Day", exchange: "NYSE" },
  { date: "2026-02-16", name: "Presidents' Day", exchange: "NYSE" },
  { date: "2026-04-03", name: "Good Friday", exchange: "NYSE" },
  { date: "2026-05-25", name: "Memorial Day", exchange: "NYSE" },
  { date: "2026-07-03", name: "Independence Day (observed)", exchange: "NYSE" },
  { date: "2026-09-07", name: "Labor Day", exchange: "NYSE" },
  { date: "2026-11-26", name: "Thanksgiving", exchange: "NYSE" },
  { date: "2026-12-25", name: "Christmas", exchange: "NYSE" },
];

// ── Mock: Snapshots ─────────────────────────────────────────────────────────

const SNAPSHOTS = Array.from({ length: 15 }, (_, i) => ({
  id: `snap_${String(i + 1).padStart(4, "0")}`,
  timestamp: now - i * 300000,
  eventCount: 2400 + Math.floor(Math.random() * 800),
  symbolCount: 12,
  symbols: [
    { symbol: "BTC/USD", lastPrice: 67432.50 - i * 12.5, bid: 67430.00 - i * 12.5, ask: 67435.00 - i * 12.5, volume24h: 24500000, source: "alpaca" },
    { symbol: "ETH/USD", lastPrice: 3456.78 - i * 3.2, bid: 3455.50 - i * 3.2, ask: 3458.00 - i * 3.2, volume24h: 12800000, source: "alpaca" },
    { symbol: "AAPL", lastPrice: 198.45 + i * 0.15, bid: 198.40 + i * 0.15, ask: 198.50 + i * 0.15, volume24h: 45200000, source: "alpaca" },
  ],
}));

// ── Mock: Store Stats ───────────────────────────────────────────────────────

const STORE_STATS = {
  totalEvents: 387450,
  maxCapacity: 500000,
  utilizationPct: 77.5,
  eventsPerSymbol: {
    "BTC/USD": 42300, "ETH/USD": 38900, "SOL/USD": 35200, "AAPL": 31800,
    "MSFT": 29400, "NVDA": 28100, "TSLA": 26700, "EUR/USD": 24500,
    "ES": 22800, "NQ": 21300, "GBP/USD": 19200, "AVAX/USD": 17250,
  },
  oldestEvent: now - 3600000 * 24,
  newestEvent: now - 1200,
  throughputPerSec: 48.3,
  integrityChecks: { passed: 11, failed: 1, lastCheck: now - 120000 },
  memoryEstimateMb: 245.8,
};

// ── Mock: Candle Integrity ──────────────────────────────────────────────────

const CANDLE_ISSUES = [
  { symbol: "SOL/USD", timeframe: "5m", time: now - 600000, issue: "high_lt_low", detail: "High 179.20 < Low 179.45", severity: "critical" },
  { symbol: "NVDA", timeframe: "1m", time: now - 180000, issue: "zero_volume", detail: "Volume=0 during regular session", severity: "warning" },
  { symbol: "EUR/USD", timeframe: "15m", time: now - 900000, issue: "close_outside", detail: "Close 1.0901 > High 1.0898", severity: "critical" },
  { symbol: "BTC/USD", timeframe: "1m", time: now - 420000, issue: "missing_candle", detail: "Gap: expected candle at 14:23 missing", severity: "warning" },
  { symbol: "ES", timeframe: "5m", time: now - 1500000, issue: "zero_volume", detail: "Volume=0 during globex session", severity: "info" },
];

// ── Routes ──────────────────────────────────────────────────────────────────

// GET /feeds — feed health
router.get("/feeds", (_req: Request, res: Response) => {
  res.json({
    feeds: FEEDS,
    overallHealth: overallFeedHealth,
    activeFeed: FEEDS.find(f => f.status === "active")?.source ?? "none",
    failoverAvailable: FEEDS.filter(f => f.status === "standby").length > 0,
  });
});

// GET /validation — tick validation stats + rejection breakdown
router.get("/validation", (_req: Request, res: Response) => {
  res.json(VALIDATION);
});

// GET /stale — stale symbol monitor
router.get("/stale", (_req: Request, res: Response) => {
  const staleCount = STALE_SYMBOLS.filter(s => s.stalenessPct >= 100).length;
  const warningCount = STALE_SYMBOLS.filter(s => s.stalenessPct >= 50 && s.stalenessPct < 100).length;
  res.json({
    symbols: STALE_SYMBOLS,
    staleCount,
    warningCount,
    healthyCount: STALE_SYMBOLS.length - staleCount - warningCount,
  });
});

// GET /sessions — exchange session states
router.get("/sessions", (_req: Request, res: Response) => {
  res.json({
    sessions: SESSIONS,
    holidays: HOLIDAYS,
    serverTime: Date.now(),
  });
});

// GET /snapshots — recent snapshots
router.get("/snapshots", (_req: Request, res: Response) => {
  res.json({
    snapshots: SNAPSHOTS,
    total: SNAPSHOTS.length,
  });
});

// GET /store-stats — event store statistics
router.get("/store-stats", (_req: Request, res: Response) => {
  res.json({
    ...STORE_STATS,
    candle_issues: CANDLE_ISSUES,
    candle_issue_count: CANDLE_ISSUES.length,
  });
});

// GET /health — overall health
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    module: "data-integrity",
    phase: 109,
    feedHealth: overallFeedHealth,
    rejectionRate: VALIDATION.rejectionRate,
    staleSymbols: STALE_SYMBOLS.filter(s => s.stalenessPct >= 100).length,
    bufferUtil: STORE_STATS.utilizationPct,
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

export default router;
