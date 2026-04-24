/**
 * Trading Safety Engine — Pre-trade checks, kill switch, daily loss caps,
 * position limits, and cooldown enforcement.
 */

interface TradeCandidate {
  symbol: string;
  side: "long" | "short";
  quantity: number;
  price: number;
  strategy: string;
}

interface SafetyCheckResult {
  allowed: boolean;
  reason: string;
  checks: Record<string, { passed: boolean; detail: string }>;
}

interface DailyStats {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  maxDrawdown: number;
  lastTradeAt: number;
}

class TradingSafety {
  private killSwitchActive = false;
  private killSwitchReason = "";
  private killSwitchAt: Date | null = null;
  private dailyStats: DailyStats = {
    trades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
    maxDrawdown: 0,
    lastTradeAt: 0,
  };
  private openPositions = new Map<string, { quantity: number; side: string }>();
  private consecutiveLosses = 0;
  private cooldownUntil = 0;

  // Configurable limits from env or defaults
  private readonly maxDailyLoss: number;
  private readonly maxDailyTrades: number;
  private readonly maxPositionSize: number;
  private readonly maxOpenPositions: number;
  private readonly maxConsecutiveLosses: number;
  private readonly cooldownMinutes: number;
  private readonly paperOnly: boolean;

  constructor() {
    this.maxDailyLoss = parseFloat(process.env.GODSVIEW_MAX_DAILY_LOSS || "500");
    this.maxDailyTrades = parseInt(process.env.GODSVIEW_MAX_DAILY_TRADES || "20", 10);
    this.maxPositionSize = parseFloat(process.env.GODSVIEW_MAX_POSITION_SIZE || "10000");
    this.maxOpenPositions = parseInt(process.env.GODSVIEW_MAX_OPEN_POSITIONS || "5", 10);
    this.maxConsecutiveLosses = parseInt(process.env.GODSVIEW_MAX_CONSECUTIVE_LOSSES || "3", 10);
    this.cooldownMinutes = parseInt(process.env.GODSVIEW_COOLDOWN_MINUTES || "15", 10);
    this.paperOnly = (process.env.GODSVIEW_PAPER_ONLY || "true") === "true";
  }

  /** Pre-trade safety check — must pass ALL gates */
  preTradeCheck(candidate: TradeCandidate): SafetyCheckResult {
    const checks: Record<string, { passed: boolean; detail: string }> = {};

    // 1. Kill switch
    checks.killSwitch = {
      passed: !this.killSwitchActive,
      detail: this.killSwitchActive
        ? `Kill switch active: ${this.killSwitchReason}`
        : "Kill switch off",
    };

    // 2. Daily loss cap
    const projectedLoss = this.dailyStats.pnl;
    checks.dailyLoss = {
      passed: Math.abs(projectedLoss) < this.maxDailyLoss,
      detail: `Daily P&L: $${projectedLoss.toFixed(2)} / max loss: -$${this.maxDailyLoss}`,
    };

    // 3. Daily trade count
    checks.tradeCount = {
      passed: this.dailyStats.trades < this.maxDailyTrades,
      detail: `Trades today: ${this.dailyStats.trades} / max: ${this.maxDailyTrades}`,
    };

    // 4. Position size
    const notional = candidate.quantity * candidate.price;
    checks.positionSize = {
      passed: notional <= this.maxPositionSize,
      detail: `Notional: $${notional.toFixed(2)} / max: $${this.maxPositionSize}`,
    };

    // 5. Open position count
    checks.openPositions = {
      passed: this.openPositions.size < this.maxOpenPositions,
      detail: `Open: ${this.openPositions.size} / max: ${this.maxOpenPositions}`,
    };

    // 6. Consecutive loss cooldown
    const now = Date.now();
    const inCooldown = now < this.cooldownUntil;
    checks.cooldown = {
      passed: !inCooldown,
      detail: inCooldown
        ? `Cooldown until ${new Date(this.cooldownUntil).toISOString()}`
        : "No cooldown active",
    };

    // 7. Consecutive losses
    checks.consecutiveLosses = {
      passed: this.consecutiveLosses < this.maxConsecutiveLosses,
      detail: `Consecutive losses: ${this.consecutiveLosses} / max: ${this.maxConsecutiveLosses}`,
    };

    const allPassed = Object.values(checks).every((c) => c.passed);
    const failedChecks = Object.entries(checks)
      .filter(([, c]) => !c.passed)
      .map(([name, c]) => `${name}: ${c.detail}`);

    return {
      allowed: allPassed,
      reason: allPassed ? "All safety checks passed" : failedChecks.join("; "),
      checks,
    };
  }

  /** Activate emergency kill switch */
  activateKillSwitch(reason: string): void {
    this.killSwitchActive = true;
    this.killSwitchReason = reason;
    this.killSwitchAt = new Date();
  }

  /** Deactivate kill switch */
  deactivateKillSwitch(): void {
    this.killSwitchActive = false;
    this.killSwitchReason = "";
    this.killSwitchAt = null;
  }

  /** Record a completed trade for daily stats */
  recordTrade(pnl: number): void {
    this.dailyStats.trades++;
    this.dailyStats.pnl += pnl;
    this.dailyStats.lastTradeAt = Date.now();

    if (pnl >= 0) {
      this.dailyStats.wins++;
      this.consecutiveLosses = 0;
    } else {
      this.dailyStats.losses++;
      this.consecutiveLosses++;
      if (Math.abs(this.dailyStats.pnl) > this.dailyStats.maxDrawdown) {
        this.dailyStats.maxDrawdown = Math.abs(this.dailyStats.pnl);
      }
      // Trigger cooldown if consecutive losses hit limit
      if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
        this.cooldownUntil = Date.now() + this.cooldownMinutes * 60 * 1000;
      }
    }

    // Auto kill switch if daily loss exceeded
    if (this.dailyStats.pnl <= -this.maxDailyLoss) {
      this.activateKillSwitch(`Daily loss limit hit: $${this.dailyStats.pnl.toFixed(2)}`);
    }
  }

  /** Record a loss event (used by external callers) */
  recordLoss(amount: number): void {
    this.recordTrade(-Math.abs(amount));
  }

  /** Update open position tracking */
  updatePosition(symbol: string, quantity: number, side: string): void {
    if (quantity === 0) {
      this.openPositions.delete(symbol);
    } else {
      this.openPositions.set(symbol, { quantity, side });
    }
  }

  /** Whether live trading is allowed */
  isLiveAllowed(): boolean {
    return !this.paperOnly && !this.killSwitchActive;
  }

  /** Get full safety status */
  getStatus() {
    return {
      killSwitch: {
        active: this.killSwitchActive,
        reason: this.killSwitchReason,
        activatedAt: this.killSwitchAt?.toISOString() ?? null,
      },
      dailyStats: { ...this.dailyStats },
      openPositions: this.openPositions.size,
      consecutiveLosses: this.consecutiveLosses,
      cooldownUntil: this.cooldownUntil > Date.now()
        ? new Date(this.cooldownUntil).toISOString()
        : null,
      limits: {
        maxDailyLoss: this.maxDailyLoss,
        maxDailyTrades: this.maxDailyTrades,
        maxPositionSize: this.maxPositionSize,
        maxOpenPositions: this.maxOpenPositions,
        maxConsecutiveLosses: this.maxConsecutiveLosses,
        cooldownMinutes: this.cooldownMinutes,
      },
      paperOnly: this.paperOnly,
      liveAllowed: this.isLiveAllowed(),
    };
  }

  /** Reset daily stats (call at market open) */
  resetDaily(): void {
    this.dailyStats = {
      trades: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
      maxDrawdown: 0,
      lastTradeAt: 0,
    };
    this.consecutiveLosses = 0;
    this.cooldownUntil = 0;
  }
}

export const tradingSafety = new TradingSafety();
export type { TradeCandidate, SafetyCheckResult };
