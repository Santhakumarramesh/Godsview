/**
 * BoundedAuthority - Strict limits on what autonomous mode can do
 * Enforces guardrails and escalates dangerous actions for human review
 */

export type StrategyMode = 'PAPER' | 'ASSISTED' | 'AUTONOMOUS' | 'ELITE';

export interface BoundSet {
  maxPositionSizeDollars: number;
  maxPositionSizePercent: number;
  maxDailyTrades: number;
  maxDailyLoss: number;
  maxCorrelatedExposure: number;
  forbiddenInstruments: string[];
  timeRestrictions: {
    noTradesBeforeMinutes: number;
    noTradesAfterMinutes: number;
  };
  maxParameterDeviation: number;
  minConfidencePerTrade: number;
  maxLeverageRatio: number;
}

export interface AuthorityViolation {
  bound: string;
  limit: number;
  requested: number;
  exceedance: number;
  exceedancePercent: number;
}

export interface AuthorityCheck {
  authorized: boolean;
  bounds: BoundSet;
  violations: AuthorityViolation[];
  escalationRequired: boolean;
  escalationReason?: string;
  auditId: string;
  timestamp: number;
}

export interface TradeAction {
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  limitPrice?: number;
  estPositionSize: number;
  estPortfolioPercent: number;
  confidence: number;
  parameterDeviations: Record<string, number>;
}

export interface AuditLogEntry {
  auditId: string;
  timestamp: number;
  action: TradeAction;
  mode: StrategyMode;
  decision: AuthorityCheck;
  approved: boolean;
  escalatedTo?: string;
  escalationReason?: string;
}

const MODE_BOUNDS: Record<StrategyMode, BoundSet> = {
  PAPER: {
    maxPositionSizeDollars: 0,
    maxPositionSizePercent: 0,
    maxDailyTrades: 1000,
    maxDailyLoss: 0,
    maxCorrelatedExposure: 1,
    forbiddenInstruments: [],
    timeRestrictions: {
      noTradesBeforeMinutes: 0,
      noTradesAfterMinutes: 0,
    },
    maxParameterDeviation: 1,
    minConfidencePerTrade: 0.3,
    maxLeverageRatio: 0,
  },

  ASSISTED: {
    maxPositionSizeDollars: 100000,
    maxPositionSizePercent: 2,
    maxDailyTrades: 50,
    maxDailyLoss: 50000,
    maxCorrelatedExposure: 0.5,
    forbiddenInstruments: ['penny_stocks', 'microcap'],
    timeRestrictions: {
      noTradesBeforeMinutes: 930,
      noTradesAfterMinutes: 1555,
    },
    maxParameterDeviation: 0.15,
    minConfidencePerTrade: 0.55,
    maxLeverageRatio: 2,
  },

  AUTONOMOUS: {
    maxPositionSizeDollars: 500000,
    maxPositionSizePercent: 5,
    maxDailyTrades: 200,
    maxDailyLoss: 250000,
    maxCorrelatedExposure: 0.6,
    forbiddenInstruments: ['penny_stocks'],
    timeRestrictions: {
      noTradesBeforeMinutes: 930,
      noTradesAfterMinutes: 1555,
    },
    maxParameterDeviation: 0.1,
    minConfidencePerTrade: 0.6,
    maxLeverageRatio: 3,
  },

  ELITE: {
    maxPositionSizeDollars: 2000000,
    maxPositionSizePercent: 15,
    maxDailyTrades: 500,
    maxDailyLoss: 1000000,
    maxCorrelatedExposure: 0.7,
    forbiddenInstruments: [],
    timeRestrictions: {
      noTradesBeforeMinutes: 930,
      noTradesAfterMinutes: 1600,
    },
    maxParameterDeviation: 0.2,
    minConfidencePerTrade: 0.55,
    maxLeverageRatio: 4,
  },
};

export class BoundedAuthority {
  private auditLog: AuditLogEntry[] = [];
  private dailyTradeCount: Map<string, number> = new Map();
  private dailyLosses: Map<string, number> = new Map();
  private lastAuditIdCounter: number = 0;

  checkAuthority(
    action: TradeAction,
    strategy: {
      id: string;
      parameters: Record<string, number>;
      backtestParameters: Record<string, number>;
    },
    currentMode: StrategyMode,
    portfolioValue: number,
    currentDailyPnL: number,
    currentTime: number
  ): AuthorityCheck {
    const bounds = MODE_BOUNDS[currentMode];
    const auditId = `audit_${++this.lastAuditIdCounter}_${Date.now()}`;
    const violations: AuthorityViolation[] = [];

    if (currentMode === 'PAPER') {
      return {
        authorized: false,
        bounds,
        violations: [
          {
            bound: 'paper_mode',
            limit: 0,
            requested: action.estPositionSize,
            exceedance: action.estPositionSize,
            exceedancePercent: 100,
          },
        ],
        escalationRequired: true,
        escalationReason: 'Paper mode cannot place real orders',
        auditId,
        timestamp: currentTime,
      };
    }

    const dollarViolation = this.checkPositionSizeDollars(
      action,
      bounds,
      violations
    );

    const percentViolation = this.checkPositionSizePercent(
      action,
      bounds,
      portfolioValue,
      violations
    );

    const tradeCountViolation = this.checkDailyTradeCount(
      strategy.id,
      bounds,
      violations
    );

    const lossViolation = this.checkDailyLoss(
      strategy.id,
      currentDailyPnL,
      bounds,
      violations
    );

    const confidenceViolation = this.checkConfidence(
      action,
      bounds,
      violations
    );

    const instrumentViolation = this.checkForbiddenInstruments(
      action,
      bounds,
      violations
    );

    const timeViolation = this.checkTimeRestrictions(
      currentTime,
      bounds,
      violations
    );

    const parameterViolation = this.checkParameterDeviation(
      strategy,
      bounds,
      violations
    );

    const leverageViolation = this.checkLeverageRatio(
      portfolioValue,
      action,
      bounds,
      violations
    );

    const authorized =
      violations.length === 0 && currentMode !== 'PAPER';
    const escalationRequired =
      violations.length > 0 || currentMode === 'ASSISTED';

    const check: AuthorityCheck = {
      authorized,
      bounds,
      violations,
      escalationRequired,
      escalationReason: escalationRequired
        ? this.generateEscalationReason(violations, currentMode)
        : undefined,
      auditId,
      timestamp: currentTime,
    };

    this.recordAuditLog({
      auditId,
      timestamp: currentTime,
      action,
      mode: currentMode,
      decision: check,
      approved: authorized,
      escalatedTo: escalationRequired ? 'human_review' : undefined,
      escalationReason: check.escalationReason,
    });

    if (authorized) {
      this.recordTrade(strategy.id, currentTime);
    }

    return check;
  }

  private checkPositionSizeDollars(
    action: TradeAction,
    bounds: BoundSet,
    violations: AuthorityViolation[]
  ): boolean {
    if (bounds.maxPositionSizeDollars === 0) {
      return true;
    }

    if (action.estPositionSize > bounds.maxPositionSizeDollars) {
      violations.push({
        bound: 'maxPositionSizeDollars',
        limit: bounds.maxPositionSizeDollars,
        requested: action.estPositionSize,
        exceedance: action.estPositionSize - bounds.maxPositionSizeDollars,
        exceedancePercent:
          ((action.estPositionSize - bounds.maxPositionSizeDollars) /
            bounds.maxPositionSizeDollars) *
          100,
      });
      return true;
    }

    return false;
  }

  private checkPositionSizePercent(
    action: TradeAction,
    bounds: BoundSet,
    portfolioValue: number,
    violations: AuthorityViolation[]
  ): boolean {
    if (bounds.maxPositionSizePercent === 0) {
      return true;
    }

    const maxDollarAmount = portfolioValue * (bounds.maxPositionSizePercent / 100);
    if (action.estPositionSize > maxDollarAmount) {
      violations.push({
        bound: 'maxPositionSizePercent',
        limit: bounds.maxPositionSizePercent,
        requested: action.estPortfolioPercent,
        exceedance:
          action.estPortfolioPercent - bounds.maxPositionSizePercent,
        exceedancePercent:
          ((action.estPortfolioPercent - bounds.maxPositionSizePercent) /
            bounds.maxPositionSizePercent) *
          100,
      });
      return true;
    }

    return false;
  }

  private checkDailyTradeCount(
    strategyId: string,
    bounds: BoundSet,
    violations: AuthorityViolation[]
  ): boolean {
    const count = this.dailyTradeCount.get(strategyId) || 0;

    if (count >= bounds.maxDailyTrades) {
      violations.push({
        bound: 'maxDailyTrades',
        limit: bounds.maxDailyTrades,
        requested: count + 1,
        exceedance: count + 1 - bounds.maxDailyTrades,
        exceedancePercent:
          (((count + 1 - bounds.maxDailyTrades) / bounds.maxDailyTrades) *
            100),
      });
      return true;
    }

    return false;
  }

  private checkDailyLoss(
    strategyId: string,
    currentDailyPnL: number,
    bounds: BoundSet,
    violations: AuthorityViolation[]
  ): boolean {
    const losses = this.dailyLosses.get(strategyId) || 0;
    const totalLoss = Math.max(0, losses + Math.min(0, currentDailyPnL));

    if (totalLoss > bounds.maxDailyLoss) {
      violations.push({
        bound: 'maxDailyLoss',
        limit: bounds.maxDailyLoss,
        requested: totalLoss,
        exceedance: totalLoss - bounds.maxDailyLoss,
        exceedancePercent:
          ((totalLoss - bounds.maxDailyLoss) / bounds.maxDailyLoss) * 100,
      });
      return true;
    }

    return false;
  }

  private checkConfidence(
    action: TradeAction,
    bounds: BoundSet,
    violations: AuthorityViolation[]
  ): boolean {
    if (action.confidence < bounds.minConfidencePerTrade) {
      violations.push({
        bound: 'minConfidencePerTrade',
        limit: bounds.minConfidencePerTrade * 100,
        requested: action.confidence * 100,
        exceedance: bounds.minConfidencePerTrade - action.confidence,
        exceedancePercent:
          (((bounds.minConfidencePerTrade - action.confidence) /
            bounds.minConfidencePerTrade) *
            100),
      });
      return true;
    }

    return false;
  }

  private checkForbiddenInstruments(
    action: TradeAction,
    bounds: BoundSet,
    violations: AuthorityViolation[]
  ): boolean {
    if (bounds.forbiddenInstruments.includes(action.symbol)) {
      violations.push({
        bound: 'forbiddenInstruments',
        limit: 0,
        requested: 1,
        exceedance: 1,
        exceedancePercent: 100,
      });
      return true;
    }

    return false;
  }

  private checkTimeRestrictions(
    currentTime: number,
    bounds: BoundSet,
    violations: AuthorityViolation[]
  ): boolean {
    const now = new Date(currentTime);
    const minuteOfDay =
      now.getHours() * 60 + now.getMinutes();

    if (
      minuteOfDay < bounds.timeRestrictions.noTradesBeforeMinutes ||
      minuteOfDay > bounds.timeRestrictions.noTradesAfterMinutes
    ) {
      violations.push({
        bound: 'timeRestrictions',
        limit: bounds.timeRestrictions.noTradesBeforeMinutes,
        requested: minuteOfDay,
        exceedance: Math.abs(
          minuteOfDay -
            bounds.timeRestrictions.noTradesBeforeMinutes
        ),
        exceedancePercent: 100,
      });
      return true;
    }

    return false;
  }

  private checkParameterDeviation(
    strategy: {
      id: string;
      parameters: Record<string, number>;
      backtestParameters: Record<string, number>;
    },
    bounds: BoundSet,
    violations: AuthorityViolation[]
  ): boolean {
    let maxDeviation = 0;

    for (const key of Object.keys(strategy.parameters)) {
      if (!(key in strategy.backtestParameters)) continue;

      const live = strategy.parameters[key];
      const backtest = strategy.backtestParameters[key];

      if (backtest === 0) continue;

      const deviation = Math.abs((live - backtest) / backtest);
      maxDeviation = Math.max(maxDeviation, deviation);
    }

    if (maxDeviation > bounds.maxParameterDeviation) {
      violations.push({
        bound: 'maxParameterDeviation',
        limit: bounds.maxParameterDeviation * 100,
        requested: maxDeviation * 100,
        exceedance: (maxDeviation - bounds.maxParameterDeviation) * 100,
        exceedancePercent:
          (((maxDeviation - bounds.maxParameterDeviation) /
            bounds.maxParameterDeviation) *
            100),
      });
      return true;
    }

    return false;
  }

  private checkLeverageRatio(
    portfolioValue: number,
    action: TradeAction,
    bounds: BoundSet,
    violations: AuthorityViolation[]
  ): boolean {
    const leverage = action.estPositionSize / portfolioValue;

    if (leverage > bounds.maxLeverageRatio) {
      violations.push({
        bound: 'maxLeverageRatio',
        limit: bounds.maxLeverageRatio,
        requested: leverage,
        exceedance: leverage - bounds.maxLeverageRatio,
        exceedancePercent:
          (((leverage - bounds.maxLeverageRatio) /
            bounds.maxLeverageRatio) *
            100),
      });
      return true;
    }

    return false;
  }

  private generateEscalationReason(
    violations: AuthorityViolation[],
    mode: StrategyMode
  ): string {
    if (mode === 'ASSISTED') {
      return 'Assisted mode requires human approval for all trades';
    }

    if (violations.length === 0) {
      return 'Unknown escalation reason';
    }

    const primaryViolation = violations[0];
    const exceedancePercent = Math.round(primaryViolation.exceedancePercent);

    return `Exceeds ${primaryViolation.bound} by ${exceedancePercent}%`;
  }

  escalate(
    action: TradeAction,
    check: AuthorityCheck
  ): {
    escalationId: string;
    action: TradeAction;
    violations: AuthorityViolation[];
    recommendedApprover: string;
  } {
    const escalationId = `escalation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const recommendedApprover =
      check.violations.length > 2
        ? 'portfolio_manager'
        : check.violations.some((v) => v.exceedancePercent > 50)
          ? 'risk_manager'
          : 'senior_trader';

    return {
      escalationId,
      action,
      violations: check.violations,
      recommendedApprover,
    };
  }

  private recordAuditLog(entry: AuditLogEntry): void {
    this.auditLog.push(entry);

    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }
  }

  private recordTrade(strategyId: string, timestamp: number): void {
    const dayKey = new Date(timestamp).toISOString().split('T')[0];
    const key = `${strategyId}_${dayKey}`;

    this.dailyTradeCount.set(key, (this.dailyTradeCount.get(key) || 0) + 1);
  }

  getAuditLog(limit: number = 100): AuditLogEntry[] {
    return this.auditLog.slice(-limit);
  }

  getAuditLogForStrategy(
    strategyId: string,
    limit: number = 50
  ): AuditLogEntry[] {
    return this.auditLog
      .filter((entry) => entry.action.symbol.includes(strategyId))
      .slice(-limit);
  }

  clearDailyCounters(strategyId: string): void {
    const today = new Date().toISOString().split('T')[0];
    const keysToDelete: string[] = [];

    for (const key of this.dailyTradeCount.keys()) {
      if (key.startsWith(strategyId) && !key.includes(today)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.dailyTradeCount.delete(key);
      this.dailyLosses.delete(key);
    }
  }

  getBounds(mode: StrategyMode): BoundSet {
    return MODE_BOUNDS[mode];
  }

  updateBounds(mode: StrategyMode, updates: Partial<BoundSet>): void {
    const currentBounds = MODE_BOUNDS[mode];
    MODE_BOUNDS[mode] = { ...currentBounds, ...updates };
  }
}
