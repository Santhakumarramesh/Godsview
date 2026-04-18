// ── Phase 112: Risk Engine v2 API ────────────────────────────────────────────
// Phase 2 hardening: routes now read from real engine singletons (state.ts)
// instead of inline mock fixtures. In production, returns real positions
// from the broker; in dev, returns demo data stamped with `_demo: true`.

import { Router, type Request, type Response } from "express";
import { getRiskV2State } from "../lib/risk_v2/state";
import {
  hasLiveBroker,
  markDemoResponse,
  require503IfNoBroker,
} from "../lib/demo_mode";

const router = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

function stampDemoIfNeeded(res: Response): void {
  if (!hasLiveBroker()) markDemoResponse(res);
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/portfolio", (_req: Request, res: Response) => {
  if (require503IfNoBroker(res, "risk-v2/portfolio")) return;
  const { exposure, risk } = getRiskV2State();
  const snapshot = exposure.getSnapshot();
  const concentration = risk.getConcentrationMetrics();
  const budget = risk.getRiskBudgetStatus();
  stampDemoIfNeeded(res);
  res.json({
    equity: snapshot.cashAvailable + snapshot.totalGross,
    cash: snapshot.cashAvailable,
    marginUsed: snapshot.marginUsed,
    leverage: snapshot.leverage,
    var: risk.getPortfolioVaR(),
    exposure: {
      totalGross: snapshot.totalGross,
      totalNet: snapshot.totalNet,
      longExposure: snapshot.longExposure,
      shortExposure: snapshot.shortExposure,
      bySector: snapshot.bySector,
      byAssetClass: snapshot.byAssetClass,
      concentrationHHI: concentration.hhi,
    },
    riskBudget: budget,
    _demo: !hasLiveBroker(),
  });
});

router.get("/positions", (_req: Request, res: Response) => {
  if (require503IfNoBroker(res, "risk-v2/positions")) return;
  const { exposure } = getRiskV2State();
  const positions = [...exposure.getPositions().values()].map((p) => ({
    symbol: p.symbol,
    side: p.direction,
    value: Math.abs(p.quantity * p.currentPrice),
    sector: p.sector,
    assetClass: p.assetClass,
  }));
  stampDemoIfNeeded(res);
  res.json({
    positions,
    total: positions.length,
    _demo: !hasLiveBroker(),
  });
});

router.get("/limits", (_req: Request, res: Response) => {
  if (require503IfNoBroker(res, "risk-v2/limits")) return;
  const { exposure } = getRiskV2State();
  const snapshot = exposure.getSnapshot();
  const limits = exposure.getLimits();
  const rows = [
    {
      name: "Max Gross Leverage",
      current: snapshot.leverage,
      limit: limits.maxGrossLeverage,
      utilization: (snapshot.leverage / limits.maxGrossLeverage) * 100,
      unit: "x",
    },
    {
      name: "Max Long Exposure",
      current: snapshot.longExposure,
      limit: limits.maxLongExposure * snapshot.totalGross,
      utilization:
        snapshot.totalGross > 0
          ? (snapshot.longExposure / (limits.maxLongExposure * snapshot.totalGross)) * 100
          : 0,
      unit: "$",
    },
    {
      name: "Concentration HHI",
      current: snapshot.concentrationHHI,
      limit: limits.maxConcentrationHHI,
      utilization: (snapshot.concentrationHHI / limits.maxConcentrationHHI) * 100,
      unit: "",
    },
  ];
  const breached = rows.filter((l) => l.utilization > 100);
  const warnings = rows.filter((l) => l.utilization >= 80 && l.utilization <= 100);
  stampDemoIfNeeded(res);
  res.json({
    limits: rows,
    breached: breached.length,
    warnings: warnings.length,
    _demo: !hasLiveBroker(),
  });
});

router.get("/events", (_req: Request, res: Response) => {
  if (require503IfNoBroker(res, "risk-v2/events")) return;
  const { risk } = getRiskV2State();
  const upcoming = risk.getUpcomingLockouts();
  stampDemoIfNeeded(res);
  res.json({
    events: upcoming,
    activeLockouts: [],
    nextEvent: upcoming[0] ?? null,
    _demo: !hasLiveBroker(),
  });
});

router.get("/exposure", (_req: Request, res: Response) => {
  if (require503IfNoBroker(res, "risk-v2/exposure")) return;
  const { exposure } = getRiskV2State();
  stampDemoIfNeeded(res);
  res.json({ ...exposure.getSnapshot(), _demo: !hasLiveBroker() });
});

router.get("/overnight", (_req: Request, res: Response) => {
  if (require503IfNoBroker(res, "risk-v2/overnight")) return;
  // Live overnight stats come from session_manager — stub until wired.
  stampDemoIfNeeded(res);
  res.json({
    currentSession: "closed",
    isWeekend: false,
    overnightExposurePct: 0,
    overnightLimit: 80,
    weekendReduction: { required: false, targetPct: 50, currentPct: 0, compliant: true },
    noEntryWindow: { active: false, startsAt: "15:45 ET", endsAt: "16:00 ET" },
    sessionRules: [
      { session: "pre_market", maxLeverage: 1.0, newPositions: true, sizeMultiplier: 0.5 },
      { session: "regular", maxLeverage: 2.0, newPositions: true, sizeMultiplier: 1.0 },
      { session: "after_hours", maxLeverage: 0.5, newPositions: false, sizeMultiplier: 0.25 },
      { session: "closed", maxLeverage: 0, newPositions: false, sizeMultiplier: 0 },
    ],
    _demo: !hasLiveBroker(),
  });
});

router.get("/trade-gate", (_req: Request, res: Response) => {
  if (require503IfNoBroker(res, "risk-v2/trade-gate")) return;
  // Trade gate is computed per-trade. The legacy mock example is gone;
  // callers should POST a proposed trade to /api/risk-v2/check (future).
  stampDemoIfNeeded(res);
  res.json({
    note: "Use POST /api/risk-v2/check with a proposed trade to evaluate.",
    _demo: !hasLiveBroker(),
  });
});

router.get("/health", (_req: Request, res: Response) => {
  const { exposure, risk } = getRiskV2State();
  const snapshot = exposure.getSnapshot();
  res.json({
    status: "operational",
    module: "risk-v2",
    phase: 112,
    leverage: snapshot.leverage,
    positionCount: snapshot.bySector
      ? Object.values(snapshot.bySector).reduce((s, v) => s + v.positionCount, 0)
      : 0,
    breachedLimits: 0,
    hasLiveBroker: hasLiveBroker(),
    riskBudget: risk.getRiskBudgetStatus(),
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

export default router;
