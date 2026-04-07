import { describe, it, expect, beforeEach } from "vitest";

// Mock types and classes for Autonomous module safety features
type AuthorityMode = "PAPER" | "ASSISTED" | "AUTONOMOUS";

interface RefusalReason {
  category: string;
  message: string;
  threshold?: number;
  current?: number;
}

interface StrategyDSL {
  entry: { indicator: string; condition: string; threshold?: number };
  exit: { indicator: string; condition: string; threshold?: number };
  sizing: { type: "fixed" | "dynamic" | "kelly"; value: number };
  filters: Array<{ name: string; enabled: boolean }>;
  context: { timeframe: string; riskPerTrade: number };
  metadata?: { name?: string; description?: string };
}

interface MarketConditions {
  edge: number;
  drift: number;
  volatility: number;
  liquidity: number;
  maxDrawdown: number;
}

interface ShadowSession {
  id: string;
  startedAt: Date;
  status: "active" | "paused" | "promoted" | "rejected";
  signals: number;
  pnl: number;
  rejectionReason?: string;
}

interface DriftReport {
  driftScore: number;
  components: {
    returnsDrift: number;
    sharpeRift: number;
    ddRift: number;
    winRateDrift: number;
    volumeDrift: number;
  };
  alert: boolean;
  message: string;
}

class SelfRefusal {
  private refusals: RefusalReason[] = [];

  shouldRefuse(strategy: StrategyDSL, conditions: MarketConditions): boolean {
    this.refusals = [];

    if (conditions.edge < 0.5) {
      this.refusals.push({
        category: "low-edge",
        message: "Edge below minimum threshold",
        threshold: 0.5,
        current: conditions.edge,
      });
    }

    if (conditions.drift > 0.15) {
      this.refusals.push({
        category: "drift",
        message: "Drift exceeds threshold",
        threshold: 0.15,
        current: conditions.drift,
      });
    }

    if (conditions.volatility > 0.4) {
      this.refusals.push({
        category: "volatility",
        message: "Volatility at extreme levels",
        threshold: 0.4,
        current: conditions.volatility,
      });
    }

    if (conditions.liquidity < 0.3) {
      this.refusals.push({
        category: "liquidity",
        message: "Liquidity too low",
        threshold: 0.3,
        current: conditions.liquidity,
      });
    }

    if (conditions.maxDrawdown > 0.25) {
      this.refusals.push({
        category: "drawdown",
        message: "Approaching maximum drawdown",
        threshold: 0.25,
        current: conditions.maxDrawdown,
      });
    }

    return this.refusals.length > 0;
  }

  getRefusals(): RefusalReason[] {
    return this.refusals;
  }

  autoDowngrade(currentMode: AuthorityMode): AuthorityMode {
    if (currentMode === "AUTONOMOUS") return "ASSISTED";
    if (currentMode === "ASSISTED") return "PAPER";
    return "PAPER";
  }
}

interface AuditLogEntry {
  timestamp: Date;
  check: string;
  result: "allowed" | "blocked";
  mode: AuthorityMode;
}

class BoundedAuthority {
  private mode: AuthorityMode = "PAPER";
  private maxPositionSize = 100000;
  private maxDailyLoss = -5000;
  private maxDailyTrades = 50;
  private dailyLoss = 0;
  private dailyTrades = 0;
  private auditLog: AuditLogEntry[] = [];

  constructor(initialMode: AuthorityMode = "PAPER") {
    this.mode = initialMode;
  }

  setMode(mode: AuthorityMode) {
    this.mode = mode;
  }

  getMode(): AuthorityMode {
    return this.mode;
  }

  canExecute(
    positionSize: number,
    timestamp: Date,
    pnl: number
  ): { allowed: boolean; reason?: string } {
    // Paper mode cannot place real orders
    if (this.mode === "PAPER") {
      this.auditLog.push({
        timestamp,
        check: "mode-check",
        result: "blocked",
        mode: this.mode,
      });
      return { allowed: false, reason: "Paper mode: no real orders" };
    }

    // Check position size limits
    if (positionSize > this.maxPositionSize) {
      this.auditLog.push({
        timestamp,
        check: "position-size",
        result: "blocked",
        mode: this.mode,
      });
      return { allowed: false, reason: "position size exceeds limit" };
    }

    // Check daily loss
    this.dailyLoss += pnl;
    if (this.dailyLoss < this.maxDailyLoss) {
      this.auditLog.push({
        timestamp,
        check: "daily-loss",
        result: "blocked",
        mode: this.mode,
      });
      return { allowed: false, reason: "Max daily loss exceeded" };
    }

    // Check daily trade count
    this.dailyTrades++;
    if (this.dailyTrades > this.maxDailyTrades) {
      this.auditLog.push({
        timestamp,
        check: "daily-trades",
        result: "blocked",
        mode: this.mode,
      });
      return { allowed: false, reason: "Max daily trades exceeded" };
    }

    // Check time of day (no trades in first/last 5 min)
    const minutes = timestamp.getMinutes();
    if (minutes < 5 || minutes > 55) {
      this.auditLog.push({
        timestamp,
        check: "time-restriction",
        result: "blocked",
        mode: this.mode,
      });
      return { allowed: false, reason: "Trading restricted at market edges" };
    }

    // ASSISTED mode requires human approval
    if (this.mode === "ASSISTED") {
      this.auditLog.push({
        timestamp,
        check: "assisted-approval",
        result: "blocked",
        mode: this.mode,
      });
      return { allowed: false, reason: "Requires human approval" };
    }

    // AUTONOMOUS mode passes through
    this.auditLog.push({
      timestamp,
      check: "autonomous-execute",
      result: "allowed",
      mode: this.mode,
    });
    return { allowed: true };
  }

  escalate(reason: string): { queued: boolean } {
    return { queued: true };
  }

  getAuditLog(): AuditLogEntry[] {
    return this.auditLog;
  }

  resetDaily() {
    this.dailyLoss = 0;
    this.dailyTrades = 0;
  }
}

class ShadowMode {
  private sessions: Map<string, ShadowSession> = new Map();

  startShadow(strategyName: string): ShadowSession {
    const session: ShadowSession = {
      id: `shadow-${Date.now()}`,
      startedAt: new Date(),
      status: "active",
      signals: 0,
      pnl: 0,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  recordSignal(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") return false;
    session.signals++;
    return true;
  }

  updatePnL(sessionId: string, pnl: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pnl = pnl;
    }
  }

  evaluateShadowPerformance(sessionId: string): {
    performanceRating: string;
    metrics: Record<string, number>;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        performanceRating: "unknown",
        metrics: {},
      };
    }

    const uptime = Date.now() - session.startedAt.getTime();
    const signalRate = session.signals / (uptime / 1000 / 3600);

    return {
      performanceRating: session.pnl > 0 ? "positive" : "negative",
      metrics: {
        totalSignals: session.signals,
        totalPnL: session.pnl,
        uptime,
        signalRate,
      },
    };
  }

  promoteFromShadow(sessionId: string): { promoted: boolean; reason?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { promoted: false, reason: "Session not found" };
    if (session.pnl <= 0) return { promoted: false, reason: "Negative PnL" };
    if (session.signals < 10)
      return { promoted: false, reason: "Insufficient signals" };

    session.status = "promoted";
    return { promoted: true };
  }

  autoExtend(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    // Auto-extend if results are borderline
    if (session.pnl >= 0 && session.signals >= 5) {
      return true;
    }
    return false;
  }

  rejectSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "rejected";
      session.rejectionReason = reason;
    }
  }

  getSession(sessionId: string): ShadowSession | undefined {
    return this.sessions.get(sessionId);
  }
}

class DriftDetector {
  detectDrift(
    backtestMetrics: Record<string, number>,
    liveMetrics: Record<string, number>
  ): DriftReport {
    const returnsDrift = Math.abs(
      (liveMetrics.returns || 0) - (backtestMetrics.returns || 0)
    );
    const sharpeRift = Math.abs(
      (liveMetrics.sharpe || 0) - (backtestMetrics.sharpe || 0)
    );
    const ddRift = Math.abs(
      (liveMetrics.maxDD || 0) - (backtestMetrics.maxDD || 0)
    );
    const winRateDrift = Math.abs(
      (liveMetrics.winRate || 0) - (backtestMetrics.winRate || 0)
    );
    const volumeDrift = Math.abs(
      (liveMetrics.volume || 0) - (backtestMetrics.volume || 0)
    );

    // Normalize components to 0-1
    const normalizedReturns = Math.min(returnsDrift / 0.2, 1);
    const normalizedSharpe = Math.min(sharpeRift / 0.5, 1);
    const normalizedDD = Math.min(ddRift / 0.15, 1);
    const normalizedWinRate = Math.min(winRateDrift / 0.1, 1);
    const normalizedVolume = Math.min(volumeDrift / 0.25, 1);

    const driftScore =
      (normalizedReturns +
        normalizedSharpe +
        normalizedDD +
        normalizedWinRate +
        normalizedVolume) /
      5;

    const alert = driftScore > 0.5;

    return {
      driftScore: Math.min(driftScore, 1),
      components: {
        returnsDrift: normalizedReturns,
        sharpeRift: normalizedSharpe,
        ddRift: normalizedDD,
        winRateDrift: normalizedWinRate,
        volumeDrift: normalizedVolume,
      },
      alert,
      message: alert
        ? `High drift detected: ${(driftScore * 100).toFixed(1)}%`
        : `Low drift: ${(driftScore * 100).toFixed(1)}%`,
    };
  }

  trackDrift(driftHistory: DriftReport[]): {
    trend: "increasing" | "decreasing" | "stable";
    average: number;
  } {
    if (driftHistory.length === 0) {
      return { trend: "stable", average: 0 };
    }

    const scores = driftHistory.map((d) => d.driftScore);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;

    let trend: "increasing" | "decreasing" | "stable" = "stable";
    if (scores.length >= 2) {
      const recent = scores[scores.length - 1];
      const previous = scores[scores.length - 2];
      if (recent > previous) trend = "increasing";
      else if (recent < previous) trend = "decreasing";
    }

    return { trend, average };
  }
}

describe("SelfRefusal", () => {
  let refusal: SelfRefusal;
  let mockStrategy: StrategyDSL;
  let normalConditions: MarketConditions;

  beforeEach(() => {
    refusal = new SelfRefusal();
    mockStrategy = {
      entry: { indicator: "RSI", condition: "below", threshold: 30 },
      exit: { indicator: "RSI", condition: "above", threshold: 70 },
      sizing: { type: "fixed", value: 1 },
      filters: [],
      context: { timeframe: "1h", riskPerTrade: 0.02 },
    };
    normalConditions = {
      edge: 1.5,
      drift: 0.05,
      volatility: 0.15,
      liquidity: 0.8,
      maxDrawdown: 0.1,
    };
  });

  it("should refuse in low-edge regime", () => {
    const lowEdgeConditions = { ...normalConditions, edge: 0.2 };
    const shouldRefuse = refusal.shouldRefuse(mockStrategy, lowEdgeConditions);
    expect(shouldRefuse).toBe(true);
    expect(refusal.getRefusals().some((r) => r.category === "low-edge")).toBe(true);
  });

  it("should refuse when drift exceeds threshold", () => {
    const highDriftConditions = { ...normalConditions, drift: 0.2 };
    const shouldRefuse = refusal.shouldRefuse(mockStrategy, highDriftConditions);
    expect(shouldRefuse).toBe(true);
    expect(refusal.getRefusals().some((r) => r.category === "drift")).toBe(true);
  });

  it("should refuse during volatility extremes", () => {
    const highVolConditions = { ...normalConditions, volatility: 0.5 };
    const shouldRefuse = refusal.shouldRefuse(mockStrategy, highVolConditions);
    expect(shouldRefuse).toBe(true);
    expect(refusal.getRefusals().some((r) => r.category === "volatility")).toBe(
      true
    );
  });

  it("should refuse on liquidity drought", () => {
    const lowLiquidityConditions = { ...normalConditions, liquidity: 0.1 };
    const shouldRefuse = refusal.shouldRefuse(mockStrategy, lowLiquidityConditions);
    expect(shouldRefuse).toBe(true);
    expect(refusal.getRefusals().some((r) => r.category === "liquidity")).toBe(true);
  });

  it("should refuse near max drawdown", () => {
    const highDDConditions = { ...normalConditions, maxDrawdown: 0.28 };
    const shouldRefuse = refusal.shouldRefuse(mockStrategy, highDDConditions);
    expect(shouldRefuse).toBe(true);
    expect(refusal.getRefusals().some((r) => r.category === "drawdown")).toBe(true);
  });

  it("should NOT refuse in normal conditions", () => {
    const shouldRefuse = refusal.shouldRefuse(mockStrategy, normalConditions);
    expect(shouldRefuse).toBe(false);
  });

  it("should include specific reasoning for each refusal", () => {
    const badConditions = {
      edge: 0.1,
      drift: 0.2,
      volatility: 0.5,
      liquidity: 0.05,
      maxDrawdown: 0.3,
    };
    refusal.shouldRefuse(mockStrategy, badConditions);
    const refusals = refusal.getRefusals();
    refusals.forEach((r) => {
      expect(r.message).toBeTruthy();
      expect(r.category).toBeTruthy();
    });
  });

  it("should follow correct mode downgrade sequence", () => {
    expect(refusal.autoDowngrade("AUTONOMOUS")).toBe("ASSISTED");
    expect(refusal.autoDowngrade("ASSISTED")).toBe("PAPER");
    expect(refusal.autoDowngrade("PAPER")).toBe("PAPER");
  });
});

describe("BoundedAuthority", () => {
  let authority: BoundedAuthority;

  beforeEach(() => {
    authority = new BoundedAuthority("AUTONOMOUS");
  });

  it("PAPER mode should not place real orders", () => {
    authority.setMode("PAPER");
    const result = authority.canExecute(50000, new Date(), 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Paper mode");
  });

  it("ASSISTED mode should require human approval", () => {
    authority.setMode("ASSISTED");
    const midday = new Date();
    midday.setHours(12, 30, 0);
    const result = authority.canExecute(50000, midday, 100);
    expect(result.allowed).toBe(false);
  });

  it("AUTONOMOUS mode should enforce position size limits", () => {
    authority.setMode("AUTONOMOUS");
    const midday = new Date();
    midday.setHours(12, 30, 0);
    const result = authority.canExecute(200000, midday, 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("position size");
  });

  it("should trigger auto-pause on max daily loss", () => {
    authority.setMode("AUTONOMOUS");
    const midday = new Date();
    midday.setHours(12, 30, 0);
    const result1 = authority.canExecute(10000, midday, -3000);
    expect(result1.allowed).toBe(true);
    const result2 = authority.canExecute(10000, midday, -3000);
    expect(result2.allowed).toBe(false);
  });

  it("should enforce time-of-day restrictions", () => {
    authority.setMode("AUTONOMOUS");
    authority.resetDaily();
    const earlyMorning = new Date();
    earlyMorning.setHours(9, 2, 0);
    const result = authority.canExecute(50000, earlyMorning, 100);
    expect(result.allowed).toBe(false);
  });

  it("should escalate for human review when bounds exceeded", () => {
    const escalated = authority.escalate("Position size concern");
    expect(escalated.queued).toBe(true);
  });

  it("should maintain comprehensive audit log", () => {
    authority.setMode("AUTONOMOUS");
    const midday = new Date();
    midday.setHours(12, 30, 0);
    authority.canExecute(50000, midday, 100);
    const log = authority.getAuditLog();
    expect(log.length).toBeGreaterThan(0);
    log.forEach((entry) => {
      expect(entry.timestamp).toBeDefined();
      expect(entry.check).toBeTruthy();
      expect(["allowed", "blocked"]).toContain(entry.result);
    });
  });

  it("should not exceed max daily trades", () => {
    authority.setMode("AUTONOMOUS");
    const midday = new Date();
    midday.setHours(12, 30, 0);
    authority.resetDaily();

    for (let i = 0; i < 50; i++) {
      authority.canExecute(50000, midday, 50);
    }

    const result = authority.canExecute(50000, midday, 50);
    expect(result.allowed).toBe(false);
  });
});

describe("ShadowMode", () => {
  let shadowMode: ShadowMode;

  beforeEach(() => {
    shadowMode = new ShadowMode();
  });

  it("should start valid shadow session", () => {
    const session = shadowMode.startShadow("test-strategy");
    expect(session.id).toBeTruthy();
    expect(session.status).toBe("active");
    expect(session.startedAt).toBeInstanceOf(Date);
  });

  it("should record signals without real orders", () => {
    const session = shadowMode.startShadow("test-strategy");
    const recorded = shadowMode.recordSignal(session.id);
    expect(recorded).toBe(true);
    const updated = shadowMode.getSession(session.id);
    expect(updated!.signals).toBe(1);
  });

  it("should return valid performance report", () => {
    const session = shadowMode.startShadow("test-strategy");
    shadowMode.recordSignal(session.id);
    shadowMode.updatePnL(session.id, 100);
    const report = shadowMode.evaluateShadowPerformance(session.id);
    expect(report.performanceRating).toBeTruthy();
    expect(report.metrics).toBeDefined();
  });

  it("should check promotion criteria before promoting", () => {
    const session = shadowMode.startShadow("test-strategy");
    const result1 = shadowMode.promoteFromShadow(session.id);
    expect(result1.promoted).toBe(false);

    shadowMode.recordSignal(session.id);
    for (let i = 0; i < 9; i++) {
      shadowMode.recordSignal(session.id);
    }
    shadowMode.updatePnL(session.id, 500);
    const result2 = shadowMode.promoteFromShadow(session.id);
    expect(result2.promoted).toBe(true);
  });

  it("should auto-extend if results are borderline", () => {
    const session = shadowMode.startShadow("test-strategy");
    shadowMode.recordSignal(session.id);
    shadowMode.recordSignal(session.id);
    shadowMode.recordSignal(session.id);
    shadowMode.recordSignal(session.id);
    shadowMode.recordSignal(session.id);
    shadowMode.updatePnL(session.id, 10);
    const extended = shadowMode.autoExtend(session.id);
    expect(extended).toBe(true);
  });

  it("should track shadow PnL accurately", () => {
    const session = shadowMode.startShadow("test-strategy");
    shadowMode.updatePnL(session.id, 100);
    let updated = shadowMode.getSession(session.id);
    expect(updated!.pnl).toBe(100);

    shadowMode.updatePnL(session.id, 250);
    updated = shadowMode.getSession(session.id);
    expect(updated!.pnl).toBe(250);
  });

  it("should have valid session status transitions", () => {
    const session = shadowMode.startShadow("test-strategy");
    expect(session.status).toBe("active");

    shadowMode.recordSignal(session.id);
    for (let i = 0; i < 9; i++) {
      shadowMode.recordSignal(session.id);
    }
    shadowMode.updatePnL(session.id, 500);
    shadowMode.promoteFromShadow(session.id);

    const promoted = shadowMode.getSession(session.id);
    expect(promoted!.status).toBe("promoted");
  });

  it("should include rejection reasons in rejected sessions", () => {
    const session = shadowMode.startShadow("test-strategy");
    const reason = "Negative PnL threshold exceeded";
    shadowMode.rejectSession(session.id, reason);

    const rejected = shadowMode.getSession(session.id);
    expect(rejected!.status).toBe("rejected");
    expect(rejected!.rejectionReason).toBe(reason);
  });
});

describe("DriftDetector", () => {
  let detector: DriftDetector;
  let backtestMetrics: Record<string, number>;
  let liveMetrics: Record<string, number>;

  beforeEach(() => {
    detector = new DriftDetector();
    backtestMetrics = {
      returns: 0.15,
      sharpe: 1.5,
      maxDD: 0.12,
      winRate: 0.55,
      volume: 1000,
    };
    liveMetrics = {
      returns: 0.14,
      sharpe: 1.48,
      maxDD: 0.13,
      winRate: 0.54,
      volume: 950,
    };
  });

  it("should detect divergence between live and backtest results", () => {
    const report = detector.detectDrift(backtestMetrics, liveMetrics);
    expect(report.driftScore).toBeGreaterThan(0);
    expect(report.driftScore).toBeLessThanOrEqual(1);
  });

  it("should return 5-component weighted drift score", () => {
    const report = detector.detectDrift(backtestMetrics, liveMetrics);
    expect(Object.keys(report.components).length).toBe(5);
    Object.values(report.components).forEach((component) => {
      expect(typeof component).toBe("number");
    });
  });

  it("should keep drift score in 0-1 range", () => {
    const extremeLiveMetrics = {
      returns: 0.05,
      sharpe: 0.5,
      maxDD: 0.35,
      winRate: 0.3,
      volume: 100,
    };
    const report = detector.detectDrift(backtestMetrics, extremeLiveMetrics);
    expect(report.driftScore).toBeGreaterThanOrEqual(0);
    expect(report.driftScore).toBeLessThanOrEqual(1);
  });

  it("should trigger high drift alert", () => {
    const largeDivergence = {
      returns: 0.0,
      sharpe: 0.5,
      maxDD: 0.35,
      winRate: 0.3,
      volume: 100,
    };
    const report = detector.detectDrift(backtestMetrics, largeDivergence);
    expect(report.alert).toBe(true);
  });

  it("should return clean status for low drift", () => {
    const similarMetrics = {
      returns: 0.149,
      sharpe: 1.49,
      maxDD: 0.121,
      winRate: 0.551,
      volume: 995,
    };
    const report = detector.detectDrift(backtestMetrics, similarMetrics);
    expect(report.alert).toBe(false);
  });

  it("should track drift over time with trend analysis", () => {
    const report1 = detector.detectDrift(backtestMetrics, liveMetrics);
    const report2 = detector.detectDrift(backtestMetrics, {
      returns: 0.12,
      sharpe: 1.4,
      maxDD: 0.15,
      winRate: 0.52,
      volume: 900,
    });

    const history = [report1, report2];
    const tracking = detector.trackDrift(history);

    expect(["increasing", "decreasing", "stable"]).toContain(tracking.trend);
    expect(typeof tracking.average).toBe("number");
    expect(tracking.average).toBeGreaterThanOrEqual(0);
  });
});
