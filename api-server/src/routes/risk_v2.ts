// ── Phase 112: Risk Engine v2 API ────────────────────────────────────────────
// 7 endpoints for portfolio VaR, positions, limits, macro events, exposure, overnight, health

import { Router, type Request, type Response } from "express";

const router = Router();
const now = Date.now();

// ── Mock: Portfolio VaR & Exposure ──────────────────────────────────────────

const PORTFOLIO = {
  equity: 250000,
  cash: 62500,
  marginUsed: 45000,
  leverage: 1.32,
  var: {
    historical95: -2.8, historical99: -4.1,
    parametric95: -2.5, parametric99: -3.8,
    monteCarlo95: -2.9, monteCarlo99: -4.3,
    expectedShortfall: -5.2,
  },
  exposure: {
    totalGross: 330000, totalNet: 215000,
    longExposure: 272500, shortExposure: 57500,
    bySector: {
      Technology: { gross: 125000, net: 95000, positionCount: 3, pctOfPortfolio: 38.0, limit: 30, utilization: 126 },
      Financial: { gross: 52000, net: 52000, positionCount: 1, pctOfPortfolio: 15.8, limit: 30, utilization: 53 },
      Energy: { gross: 35000, net: -35000, positionCount: 1, pctOfPortfolio: 10.6, limit: 30, utilization: 35 },
      Crypto: { gross: 42000, net: 42000, positionCount: 1, pctOfPortfolio: 12.7, limit: 20, utilization: 64 },
      Index: { gross: 76000, net: 61000, positionCount: 2, pctOfPortfolio: 23.0, limit: 40, utilization: 58 },
    },
    byAssetClass: { stocks: 56, crypto: 13, futures: 23, options: 0, forex: 0, other: 8 },
    concentrationHHI: 0.19,
  },
  riskBudget: { total: 5.0, used: 3.2, remaining: 1.8, utilizationPct: 64 },
};

// ── Mock: Positions ─────────────────────────────────────────────────────────

const POSITIONS = [
  { symbol: "AAPL", side: "long", value: 59700, sector: "Technology", assetClass: "stocks", varContribution: -0.42, marginReq: 8955, riskPct: 1.8, advPct: 0.8, spreadBps: 2 },
  { symbol: "MSFT", side: "long", value: 42530, sector: "Technology", assetClass: "stocks", varContribution: -0.38, marginReq: 6380, riskPct: 1.5, advPct: 0.6, spreadBps: 2 },
  { symbol: "NVDA", side: "long", value: 22370, sector: "Technology", assetClass: "stocks", varContribution: -0.55, marginReq: 4474, riskPct: 2.1, advPct: 0.3, spreadBps: 3 },
  { symbol: "JPM", side: "long", value: 52000, sector: "Financial", assetClass: "stocks", varContribution: -0.28, marginReq: 7800, riskPct: 1.2, advPct: 0.5, spreadBps: 2 },
  { symbol: "XOM", side: "short", value: 35000, sector: "Energy", assetClass: "stocks", varContribution: -0.22, marginReq: 7000, riskPct: 0.9, advPct: 0.4, spreadBps: 3 },
  { symbol: "BTC/USD", side: "long", value: 42000, sector: "Crypto", assetClass: "crypto", varContribution: -0.65, marginReq: 6300, riskPct: 2.8, advPct: 0.1, spreadBps: 8 },
  { symbol: "SPY", side: "long", value: 54000, sector: "Index", assetClass: "stocks", varContribution: -0.18, marginReq: 2700, riskPct: 0.8, advPct: 0.01, spreadBps: 1 },
  { symbol: "ES", side: "long", value: 22000, sector: "Index", assetClass: "futures", varContribution: -0.15, marginReq: 1650, riskPct: 0.6, advPct: 0.02, spreadBps: 1 },
];

// ── Mock: Limits ────────────────────────────────────────────────────────────

const LIMITS = [
  { name: "Max Gross Leverage", current: 1.32, limit: 2.0, utilization: 66, unit: "x" },
  { name: "Max Net Exposure", current: 0.86, limit: 1.5, utilization: 57, unit: "x" },
  { name: "Max Long Exposure", current: 109, limit: 120, utilization: 91, unit: "%" },
  { name: "Max Short Exposure", current: 23, limit: 50, utilization: 46, unit: "%" },
  { name: "Technology Sector", current: 38, limit: 30, utilization: 127, unit: "%", breached: true },
  { name: "Financial Sector", current: 15.8, limit: 30, utilization: 53, unit: "%" },
  { name: "Energy Sector", current: 10.6, limit: 30, utilization: 35, unit: "%" },
  { name: "Crypto Allocation", current: 12.7, limit: 20, utilization: 64, unit: "%" },
  { name: "Single Position Max", current: 7.2, limit: 10, utilization: 72, unit: "%" },
  { name: "Concentration HHI", current: 0.19, limit: 0.25, utilization: 76, unit: "" },
  { name: "Overnight Exposure", current: 65, limit: 80, utilization: 81, unit: "%" },
  { name: "Daily Loss Limit", current: -0.8, limit: -2.0, utilization: 40, unit: "%" },
];

// ── Mock: Macro Events ──────────────────────────────────────────────────────

const EVENTS = [
  { id: "evt_01", name: "CPI Release", type: "cpi", scheduledAt: now + 8 * 3600000, impact: "critical", lockoutBeforeMin: 30, lockoutAfterMin: 15, affectedAssets: ["stocks", "futures", "forex"], description: "April CPI YoY consensus 2.4%" },
  { id: "evt_02", name: "FOMC Minutes", type: "fomc", scheduledAt: now + 32 * 3600000, impact: "high", lockoutBeforeMin: 15, lockoutAfterMin: 10, affectedAssets: ["stocks", "futures", "forex", "crypto"], description: "March FOMC meeting minutes" },
  { id: "evt_03", name: "Jobless Claims", type: "jobless_claims", scheduledAt: now + 56 * 3600000, impact: "medium", lockoutBeforeMin: 5, lockoutAfterMin: 5, affectedAssets: ["stocks", "futures"], description: "Weekly initial claims" },
  { id: "evt_04", name: "PPI Release", type: "ppi", scheduledAt: now + 80 * 3600000, impact: "high", lockoutBeforeMin: 15, lockoutAfterMin: 10, affectedAssets: ["stocks", "futures"], description: "April PPI MoM" },
  { id: "evt_05", name: "ECB Meeting", type: "ecb", scheduledAt: now + 11 * 86400000, impact: "high", lockoutBeforeMin: 15, lockoutAfterMin: 10, affectedAssets: ["forex", "stocks"], description: "ECB rate decision" },
  { id: "evt_06", name: "AAPL Earnings", type: "earnings", scheduledAt: now + 22 * 86400000, impact: "high", lockoutBeforeMin: 15, lockoutAfterMin: 10, affectedAssets: ["AAPL"], description: "Q2 FY2026 earnings" },
  { id: "evt_07", name: "NVDA Earnings", type: "earnings", scheduledAt: now + 45 * 86400000, impact: "critical", lockoutBeforeMin: 30, lockoutAfterMin: 15, affectedAssets: ["NVDA", "stocks"], description: "Q1 FY2027 earnings" },
];

const activeLockouts: Array<{ eventId: string; eventName: string; restriction: string; expiresAt: number }> = [];

// ── Mock: Overnight/Weekend ─────────────────────────────────────────────────

const OVERNIGHT = {
  currentSession: "closed",
  isWeekend: true,
  overnightExposurePct: 65,
  overnightLimit: 80,
  weekendReduction: { required: true, targetPct: 50, currentPct: 65, compliant: false },
  noEntryWindow: { active: false, startsAt: "15:45 ET", endsAt: "16:00 ET" },
  sessionRules: [
    { session: "pre_market", maxLeverage: 1.0, newPositions: true, sizeMultiplier: 0.5 },
    { session: "regular", maxLeverage: 2.0, newPositions: true, sizeMultiplier: 1.0 },
    { session: "after_hours", maxLeverage: 0.5, newPositions: false, sizeMultiplier: 0.25 },
    { session: "closed", maxLeverage: 0, newPositions: false, sizeMultiplier: 0 },
  ],
};

// ── Mock: Trade Gate ────────────────────────────────────────────────────────

const TRADE_GATE_EXAMPLE = {
  symbol: "AMZN", side: "long", requestedSize: 15000,
  checks: [
    { name: "Position Size Cap", passed: true, value: 6.0, limit: 10, detail: "6% of portfolio" },
    { name: "Sector Concentration", passed: false, value: 44, limit: 30, detail: "Technology sector already at 38%, adding 6% = 44%" },
    { name: "Liquidity (ADV%)", passed: true, value: 0.2, limit: 5, detail: "0.2% of ADV" },
    { name: "Spread Check", passed: true, value: 2, limit: 9, detail: "2bps vs 3bps avg (0.7x)" },
    { name: "Macro Lockout", passed: true, value: 0, limit: 1, detail: "No active lockout" },
    { name: "Overnight Limit", passed: true, value: 71, limit: 80, detail: "71% overnight after trade" },
    { name: "Daily Loss Budget", passed: true, value: 0.8, limit: 2.0, detail: "0.8% used of 2% limit" },
  ],
  approved: false, suggestedSize: 8200,
  explanation: "Rejected: Technology sector would exceed 30% cap. Suggested size $8,200 to stay within limits.",
};

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/portfolio", (_req: Request, res: Response) => { res.json(PORTFOLIO); });
router.get("/positions", (_req: Request, res: Response) => { res.json({ positions: POSITIONS, total: POSITIONS.length }); });
router.get("/limits", (_req: Request, res: Response) => {
  const breached = LIMITS.filter(l => (l as any).breached || l.utilization > 100);
  const warnings = LIMITS.filter(l => l.utilization >= 80 && l.utilization <= 100);
  res.json({ limits: LIMITS, breached: breached.length, warnings: warnings.length });
});
router.get("/events", (_req: Request, res: Response) => {
  res.json({ events: EVENTS, activeLockouts, nextEvent: EVENTS[0] });
});
router.get("/exposure", (_req: Request, res: Response) => { res.json(PORTFOLIO.exposure); });
router.get("/overnight", (_req: Request, res: Response) => { res.json(OVERNIGHT); });
router.get("/trade-gate", (_req: Request, res: Response) => { res.json(TRADE_GATE_EXAMPLE); });
router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "operational", module: "risk-v2", phase: 112, leverage: PORTFOLIO.leverage, varPct: PORTFOLIO.var.historical95, breachedLimits: LIMITS.filter(l => (l as any).breached).length, uptime: process.uptime(), timestamp: Date.now() });
});

export default router;
