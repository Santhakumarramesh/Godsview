import { EventEmitter } from 'node:events';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface RiskCheck {
  name: string;
  passed: boolean;
  value: number;
  limit: number;
  detail: string;
}

interface TradeRiskAssessment {
  tradeId: string;
  symbol: string;
  side: 'long' | 'short';
  requestedSize: number;
  approvedSize: number;
  riskBudgetUsed: number;
  riskBudgetRemaining: number;
  checks: RiskCheck[];
  approved: boolean;
  rejectionReasons: string[];
  explanation: string;
}

interface PortfolioPosition {
  symbol: string;
  quantity: number;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  sector: string;
  assetClass: 'stocks' | 'crypto' | 'futures' | 'bonds';
  liquidity: {
    avgDailyVolume: number;
    currentSpread: number;
    historicalAvgSpread: number;
  };
}

interface VaRMetrics {
  historicalVaR95: number;
  historicalVaR99: number;
  parametricVaR95: number;
  parametricVaR99: number;
  expectedShortfall: number;
  monteCarloVaR95: number;
  positionContributions: Map<string, number>;
  timestamp: number;
}

interface MacroEvent {
  id: string;
  name: string;
  scheduledTime: number;
  importance: 'low' | 'medium' | 'high';
  lockoutWindowMinutes: number;
}

interface FlattenAction {
  timestamp: number;
  reason: string;
  positionsFlattened: string[];
  executionOrder: string[];
}

interface PortfolioRiskConfig {
  totalRiskBudget: number;
  sectorCap: number;
  positionCap: number;
  correlationThreshold: number;
  maxAssetClassAllocation: {
    stocks: number;
    crypto: number;
    futures: number;
    bonds: number;
  };
  maxOvernightExposure: number;
  maxLiquidityThreshold: number;
  spreadMultiplierBan: number;
  spreadMultiplierReduce: number;
  macroLockoutBefore: number;
  macroLockoutAfter: number;
  noEntryWindowMinutes: number;
}

// ============================================================================
// PORTFOLIO RISK ENGINE
// ============================================================================

export class PortfolioRiskEngine extends EventEmitter {
  private config: PortfolioRiskConfig;
  private positions: Map<string, PortfolioPosition> = new Map();
  private historicalReturns: number[] = [];
  private correlationMatrix: Map<string, Map<string, number>> = new Map();
  private macroEvents: MacroEvent[] = [];
  private flattenHistory: FlattenAction[] = [];
  private currentVaR: VaRMetrics | null = null;
  private usedRiskBudget: number = 0;
  private lockoutActive: boolean = false;
  private lastFlattenTime: number = 0;

  constructor(config?: Partial<PortfolioRiskConfig>) {
    super();

    this.config = {
      totalRiskBudget: 2.0,
      sectorCap: 30,
      positionCap: 10,
      correlationThreshold: 0.8,
      maxAssetClassAllocation: {
        stocks: 60,
        crypto: 20,
        futures: 20,
        bonds: 100,
      },
      maxOvernightExposure: 50,
      maxLiquidityThreshold: 5,
      spreadMultiplierBan: 3.0,
      spreadMultiplierReduce: 2.0,
      macroLockoutBefore: 30,
      macroLockoutAfter: 15,
      noEntryWindowMinutes: 15,
      ...config,
    };

    this.initializeMockPortfolio();
    this.initializeMockHistoricalData();
    this.initializeMacroCalendar();
    this.calculateVaR();
  }

  // ========================================================================
  // INITIALIZATION & MOCK DATA
  // ========================================================================

  private initializeMockPortfolio(): void {
    const mockPositions: PortfolioPosition[] = [
      {
        symbol: 'AAPL',
        quantity: 100,
        side: 'long',
        entryPrice: 175.5,
        currentPrice: 182.3,
        sector: 'Technology',
        assetClass: 'stocks',
        liquidity: {
          avgDailyVolume: 50000000,
          currentSpread: 0.01,
          historicalAvgSpread: 0.012,
        },
      },
      {
        symbol: 'MSFT',
        quantity: 75,
        side: 'long',
        entryPrice: 380.2,
        currentPrice: 395.1,
        sector: 'Technology',
        assetClass: 'stocks',
        liquidity: {
          avgDailyVolume: 30000000,
          currentSpread: 0.02,
          historicalAvgSpread: 0.018,
        },
      },
      {
        symbol: 'JPM',
        quantity: 200,
        side: 'long',
        entryPrice: 195.8,
        currentPrice: 201.4,
        sector: 'Financials',
        assetClass: 'stocks',
        liquidity: {
          avgDailyVolume: 8000000,
          currentSpread: 0.03,
          historicalAvgSpread: 0.025,
        },
      },
      {
        symbol: 'BTC',
        quantity: 2.5,
        side: 'long',
        entryPrice: 42500,
        currentPrice: 45800,
        sector: 'Digital Assets',
        assetClass: 'crypto',
        liquidity: {
          avgDailyVolume: 25000,
          currentSpread: 15,
          historicalAvgSpread: 20,
        },
      },
      {
        symbol: 'SPY',
        quantity: 150,
        side: 'long',
        entryPrice: 445.6,
        currentPrice: 458.9,
        sector: 'Index',
        assetClass: 'stocks',
        liquidity: {
          avgDailyVolume: 80000000,
          currentSpread: 0.01,
          historicalAvgSpread: 0.011,
        },
      },
      {
        symbol: 'ES',
        quantity: 5,
        side: 'long',
        entryPrice: 5450,
        currentPrice: 5520,
        sector: 'Index Futures',
        assetClass: 'futures',
        liquidity: {
          avgDailyVolume: 3000000,
          currentSpread: 1,
          historicalAvgSpread: 0.75,
        },
      },
    ];

    mockPositions.forEach((pos) => {
      this.positions.set(pos.symbol, pos);
    });
  }

  private initializeMockHistoricalData(): void {
    // Generate 252 days of mock returns (1 year of trading days)
    for (let i = 0; i < 252; i++) {
      const baseReturn = (Math.random() - 0.5) * 0.02; // -1% to +1%
      const volatility = Math.sin(i * 0.025) * 0.005; // Cyclic volatility
      this.historicalReturns.push(baseReturn + volatility);
    }

    // Initialize correlation matrix
    for (const symbol of this.positions.keys()) {
      const correlations = new Map<string, number>();
      for (const otherSymbol of this.positions.keys()) {
        if (symbol === otherSymbol) {
          correlations.set(otherSymbol, 1.0);
        } else {
          correlations.set(otherSymbol, 0.3 + Math.random() * 0.4);
        }
      }
      this.correlationMatrix.set(symbol, correlations);
    }
  }

  private initializeMacroCalendar(): void {
    const now = Date.now();
    const events: MacroEvent[] = [
      {
        id: 'fomc-1',
        name: 'FOMC Meeting Decision',
        scheduledTime: now + 7 * 24 * 60 * 60 * 1000, // 7 days
        importance: 'high',
        lockoutWindowMinutes: 60,
      },
      {
        id: 'nfp-1',
        name: 'Non-Farm Payroll',
        scheduledTime: now + 3 * 24 * 60 * 60 * 1000, // 3 days
        importance: 'high',
        lockoutWindowMinutes: 60,
      },
      {
        id: 'cpi-1',
        name: 'CPI Release',
        scheduledTime: now + 14 * 24 * 60 * 60 * 1000, // 14 days
        importance: 'high',
        lockoutWindowMinutes: 45,
      },
      {
        id: 'ecb-1',
        name: 'ECB Rate Decision',
        scheduledTime: now + 21 * 24 * 60 * 60 * 1000, // 21 days
        importance: 'medium',
        lockoutWindowMinutes: 45,
      },
      {
        id: 'earnings-1',
        name: 'Tech Earnings Season',
        scheduledTime: now + 4 * 24 * 60 * 60 * 1000, // 4 days
        importance: 'medium',
        lockoutWindowMinutes: 30,
      },
    ];

    this.macroEvents = events;
  }

  // ========================================================================
  // MAIN RISK ASSESSMENT
  // ========================================================================

  public assessTrade(
    tradeId: string,
    symbol: string,
    side: 'long' | 'short',
    requestedSize: number,
    currentPrice: number
  ): TradeRiskAssessment {
    const checks: RiskCheck[] = [];
    const rejectionReasons: string[] = [];
    let approvedSize = requestedSize;
    const now = Date.now();

    // Check 1: Macro lockout
    const lockoutStatus = this.checkMacroLockout();
    checks.push({
      name: 'Macro Lockout Window',
      passed: !lockoutStatus.isActive,
      value: lockoutStatus.minutesUntilLockout,
      limit: 0,
      detail: lockoutStatus.detail,
    });
    if (!checks[checks.length - 1].passed) {
      rejectionReasons.push(lockoutStatus.detail);
    }

    // Check 2: No-entry window
    const noEntryViolation = this.checkNoEntryWindow(now);
    checks.push({
      name: 'No-Entry Window (Last 15min)',
      passed: !noEntryViolation,
      value: 0,
      limit: 0,
      detail: noEntryViolation
        ? 'Trade blocked: within 15 minutes of session close'
        : 'OK',
    });
    if (noEntryViolation) {
      rejectionReasons.push('Trade blocked: within market close window');
    }

    // Check 3: Spread sensitivity
    const spreadResult = this.checkSpreadSensitivity(symbol);
    checks.push({
      name: 'Spread Sensitivity',
      passed: spreadResult.allowed,
      value: spreadResult.currentMultiplier,
      limit: this.config.spreadMultiplierBan,
      detail: spreadResult.detail,
    });
    if (!spreadResult.allowed) {
      rejectionReasons.push(spreadResult.detail);
    } else if (spreadResult.sizeReduction > 0) {
      approvedSize = Math.floor(
        requestedSize * (1 - spreadResult.sizeReduction)
      );
    }

    // Check 4: Liquidity
    const liquidityResult = this.checkLiquidity(symbol, approvedSize);
    checks.push({
      name: 'Liquidity (% of ADV)',
      passed: liquidityResult.allowed,
      value: liquidityResult.positionAsADVPercent,
      limit: this.config.maxLiquidityThreshold,
      detail: liquidityResult.detail,
    });
    if (!liquidityResult.allowed) {
      rejectionReasons.push(liquidityResult.detail);
    } else if (liquidityResult.scaledSize < approvedSize) {
      approvedSize = liquidityResult.scaledSize;
    }

    // Check 5: Position cap
    const positionValue = approvedSize * currentPrice;
    const portfolioValue = this.getPortfolioValue();
    const positionPercent = (positionValue / portfolioValue) * 100;
    const positionCapPassed = positionPercent <= this.config.positionCap;
    checks.push({
      name: 'Position Size Cap',
      passed: positionCapPassed,
      value: positionPercent,
      limit: this.config.positionCap,
      detail: `Position ${positionPercent.toFixed(2)}% of portfolio`,
    });
    if (!positionCapPassed) {
      rejectionReasons.push(
        `Position exceeds ${this.config.positionCap}% cap`
      );
      approvedSize = Math.floor(
        (this.config.positionCap / 100) * portfolioValue / currentPrice
      );
    }

    // Check 6: Sector concentration
    const sectorResult = this.checkSectorConcentration(
      symbol,
      approvedSize,
      currentPrice
    );
    checks.push({
      name: 'Sector Concentration Cap',
      passed: sectorResult.allowed,
      value: sectorResult.sectorPercent,
      limit: this.config.sectorCap,
      detail: `${sectorResult.sector}: ${sectorResult.sectorPercent.toFixed(2)}%`,
    });
    if (!sectorResult.allowed) {
      rejectionReasons.push(
        `Sector concentration would exceed ${this.config.sectorCap}%`
      );
    }

    // Check 7: Correlation check
    const correlationResult = this.checkCorrelation(symbol);
    checks.push({
      name: 'Correlation Threshold',
      passed: correlationResult.allowed,
      value: correlationResult.maxCorrelation,
      limit: this.config.correlationThreshold,
      detail: correlationResult.detail,
    });
    if (!correlationResult.allowed) {
      rejectionReasons.push(correlationResult.detail);
    }

    // Check 8: Asset class allocation
    const assetClassResult = this.checkAssetClassAllocation(symbol);
    checks.push({
      name: 'Asset Class Allocation',
      passed: assetClassResult.allowed,
      value: assetClassResult.currentPercent,
      limit: assetClassResult.limit,
      detail: assetClassResult.detail,
    });
    if (!assetClassResult.allowed) {
      rejectionReasons.push(assetClassResult.detail);
    }

    // Check 9: VaR contribution
    const varResult = this.checkVaRContribution(symbol, approvedSize);
    checks.push({
      name: 'VaR Contribution',
      passed: varResult.allowed,
      value: varResult.varImpactBps,
      limit: 50, // 50 bps
      detail: `Would increase portfolio VaR by ${varResult.varImpactBps} bps`,
    });
    if (!varResult.allowed) {
      rejectionReasons.push('VaR impact too large');
    }

    // Check 10: Overnight exposure
    const overnightResult = this.checkOvernightExposure(
      approvedSize,
      currentPrice
    );
    checks.push({
      name: 'Overnight Exposure',
      passed: overnightResult.allowed,
      value: overnightResult.exposurePercent,
      limit: this.config.maxOvernightExposure,
      detail: overnightResult.detail,
    });
    if (!overnightResult.allowed) {
      rejectionReasons.push('Overnight exposure exceeds limit');
    }

    // Calculate risk budget
    const riskBudgetNeeded = (approvedSize * currentPrice) / portfolioValue * 0.5; // Simplistic: 0.5% risk per 1% of portfolio
    const riskBudgetRemaining =
      this.config.totalRiskBudget - this.usedRiskBudget;
    const riskBudgetUsed = (riskBudgetNeeded / this.config.totalRiskBudget) * 100;

    const riskBudgetOk = riskBudgetNeeded <= riskBudgetRemaining;
    checks.push({
      name: 'Risk Budget',
      passed: riskBudgetOk,
      value: riskBudgetUsed,
      limit: 100,
      detail: `Uses ${riskBudgetUsed.toFixed(2)}% of remaining budget`,
    });
    if (!riskBudgetOk) {
      rejectionReasons.push('Insufficient risk budget remaining');
    }

    const approved =
      rejectionReasons.length === 0 && checks.every((c) => c.passed);

    if (approved) {
      this.usedRiskBudget += riskBudgetNeeded;
    }

    const assessment: TradeRiskAssessment = {
      tradeId,
      symbol,
      side,
      requestedSize,
      approvedSize: approved ? approvedSize : 0,
      riskBudgetUsed,
      riskBudgetRemaining: ((riskBudgetRemaining / this.config.totalRiskBudget) * 100),
      checks,
      approved,
      rejectionReasons,
      explanation: this.generateExplanation(
        symbol,
        approved,
        rejectionReasons,
        checks
      ),
    };

    if (approved) {
      this.emit('risk:assessed', assessment);
    } else {
      this.emit('risk:rejected', assessment);
    }

    return assessment;
  }

  private generateExplanation(
    symbol: string,
    approved: boolean,
    reasons: string[],
    checks: RiskCheck[]
  ): string {
    if (approved) {
      const passedCount = checks.filter((c) => c.passed).length;
      return `Trade approved: ${symbol} passed all ${passedCount} risk checks. Position fits within portfolio constraints, meets liquidity requirements, and VaR impact is acceptable.`;
    } else {
      const failedChecks = checks.filter((c) => !c.passed);
      return `Trade rejected: ${symbol} failed ${failedChecks.length} risk check(s). ${reasons.join('; ')}.`;
    }
  }

  // ========================================================================
  // INDIVIDUAL CHECK METHODS
  // ========================================================================

  private checkMacroLockout(): {
    isActive: boolean;
    minutesUntilLockout: number;
    detail: string;
  } {
    const now = Date.now();
    const beforeMs = this.config.macroLockoutBefore * 60 * 1000;
    const afterMs = this.config.macroLockoutAfter * 60 * 1000;

    for (const event of this.macroEvents) {
      const windowStart = event.scheduledTime - beforeMs;
      const windowEnd = event.scheduledTime + afterMs;

      if (now >= windowStart && now <= windowEnd) {
        this.lockoutActive = true;
        this.emit('lockout:active', { event: event.name, endTime: windowEnd });
        return {
          isActive: true,
          minutesUntilLockout: 0,
          detail: `Lockout active: ${event.name} (${new Date(event.scheduledTime).toLocaleString()})`,
        };
      }

      if (now < windowStart) {
        const minutesUntil = Math.floor((windowStart - now) / 60000);
        return {
          isActive: false,
          minutesUntilLockout: minutesUntil,
          detail: `Upcoming lockout: ${event.name} in ${minutesUntil} minutes`,
        };
      }
    }

    this.lockoutActive = false;
    return {
      isActive: false,
      minutesUntilLockout: -1,
      detail: 'No lockout active',
    };
  }

  private checkNoEntryWindow(now: number): boolean {
    // Assume market closes at 16:00 ET / 4 PM
    const today = new Date(now);
    const marketCloseTime = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      16,
      0,
      0
    );
    const noEntryStart = new Date(
      marketCloseTime.getTime() - this.config.noEntryWindowMinutes * 60 * 1000
    );

    return now >= noEntryStart.getTime() && now < marketCloseTime.getTime();
  }

  private checkSpreadSensitivity(symbol: string): {
    allowed: boolean;
    currentMultiplier: number;
    sizeReduction: number;
    detail: string;
  } {
    const position = this.positions.get(symbol);
    if (!position) {
      return {
        allowed: true,
        currentMultiplier: 1.0,
        sizeReduction: 0,
        detail: 'No existing spread data',
      };
    }

    const { currentSpread, historicalAvgSpread } = position.liquidity;
    const multiplier = currentSpread / historicalAvgSpread;

    if (multiplier > this.config.spreadMultiplierBan) {
      return {
        allowed: false,
        currentMultiplier: multiplier,
        sizeReduction: 0,
        detail: `Spread ${(multiplier * 100).toFixed(0)}% above average (BAN threshold: ${this.config.spreadMultiplierBan}x)`,
      };
    }

    const sizeReduction =
      multiplier > this.config.spreadMultiplierReduce
        ? (multiplier - this.config.spreadMultiplierReduce) * 0.2
        : 0;

    return {
      allowed: true,
      currentMultiplier: multiplier,
      sizeReduction,
      detail:
        sizeReduction > 0
          ? `Spread ${(multiplier * 100).toFixed(0)}% above average (REDUCED size by ${(sizeReduction * 100).toFixed(1)}%)`
          : 'Spread within normal range',
    };
  }

  private checkLiquidity(
    symbol: string,
    size: number
  ): {
    allowed: boolean;
    positionAsADVPercent: number;
    scaledSize: number;
    detail: string;
  } {
    const position = this.positions.get(symbol);
    if (!position) {
      return {
        allowed: true,
        positionAsADVPercent: 0,
        scaledSize: size,
        detail: 'No liquidity data available',
      };
    }

    const positionAsADVPercent = (size / position.liquidity.avgDailyVolume) * 100;

    if (positionAsADVPercent > this.config.maxLiquidityThreshold) {
      const scaledSize = Math.floor(
        (this.config.maxLiquidityThreshold / 100) *
          position.liquidity.avgDailyVolume
      );
      return {
        allowed: false,
        positionAsADVPercent,
        scaledSize,
        detail: `Position ${positionAsADVPercent.toFixed(2)}% of ADV (max: ${this.config.maxLiquidityThreshold}%)`,
      };
    }

    return {
      allowed: true,
      positionAsADVPercent,
      scaledSize: size,
      detail: `Position ${positionAsADVPercent.toFixed(3)}% of ADV`,
    };
  }

  private checkSectorConcentration(
    symbol: string,
    size: number,
    price: number
  ): { allowed: boolean; sectorPercent: number; sector: string } {
    const position = this.positions.get(symbol);
    if (!position) {
      return { allowed: true, sectorPercent: 0, sector: 'Unknown' };
    }

    const newPositionValue = size * price;
    const portfolioValue = this.getPortfolioValue();
    let sectorValue = newPositionValue;

    for (const [sym, pos] of this.positions) {
      if (pos.sector === position.sector) {
        sectorValue +=
          pos.quantity * pos.currentPrice;
      }
    }

    const sectorPercent = (sectorValue / portfolioValue) * 100;

    return {
      allowed: sectorPercent <= this.config.sectorCap,
      sectorPercent,
      sector: position.sector,
    };
  }

  private checkCorrelation(symbol: string): {
    allowed: boolean;
    maxCorrelation: number;
    detail: string;
  } {
    const correlations = this.correlationMatrix.get(symbol);
    if (!correlations) {
      return {
        allowed: true,
        maxCorrelation: 0,
        detail: 'No correlation data',
      };
    }

    let maxCorr = 0;
    let highCorrSymbol = '';

    for (const [otherSymbol, corr] of correlations) {
      if (
        otherSymbol !== symbol &&
        this.positions.has(otherSymbol) &&
        corr > maxCorr
      ) {
        maxCorr = corr;
        highCorrSymbol = otherSymbol;
      }
    }

    const allowed = maxCorr <= this.config.correlationThreshold;

    return {
      allowed,
      maxCorrelation: maxCorr,
      detail: allowed
        ? `Max correlation with ${highCorrSymbol}: ${maxCorr.toFixed(3)}`
        : `High correlation with ${highCorrSymbol}: ${maxCorr.toFixed(3)} (threshold: ${this.config.correlationThreshold})`,
    };
  }

  private checkAssetClassAllocation(symbol: string): {
    allowed: boolean;
    currentPercent: number;
    limit: number;
    detail: string;
  } {
    const position = this.positions.get(symbol);
    if (!position) {
      return {
        allowed: true,
        currentPercent: 0,
        limit: 100,
        detail: 'No position data',
      };
    }

    const assetClass = position.assetClass;
    const portfolioValue = this.getPortfolioValue();
    let classValue = 0;

    for (const [, pos] of this.positions) {
      if (pos.assetClass === assetClass) {
        classValue += pos.quantity * pos.currentPrice;
      }
    }

    const classPercent = (classValue / portfolioValue) * 100;
    const limit =
      this.config.maxAssetClassAllocation[assetClass] || 100;
    const allowed = classPercent <= limit;

    return {
      allowed,
      currentPercent: classPercent,
      limit,
      detail: `${assetClass}: ${classPercent.toFixed(2)}% (limit: ${limit}%)`,
    };
  }

  private checkVaRContribution(symbol: string, size: number): {
    allowed: boolean;
    varImpactBps: number;
  } {
    // Simplified: impact = size * volatility / portfolio value
    const portfolioValue = this.getPortfolioValue();
    const volatility = this.calculateVolatility();
    const impact = (size * volatility) / portfolioValue;
    const impactBps = impact * 10000;

    return {
      allowed: impactBps <= 50,
      varImpactBps: Math.round(impactBps),
    };
  }

  private checkOvernightExposure(
    size: number,
    price: number
  ): { allowed: boolean; exposurePercent: number; detail: string } {
    const positionValue = size * price;
    const portfolioValue = this.getPortfolioValue();
    const exposurePercent = (positionValue / portfolioValue) * 100;

    return {
      allowed: exposurePercent <= this.config.maxOvernightExposure,
      exposurePercent,
      detail: `Overnight exposure: ${exposurePercent.toFixed(2)}% (max: ${this.config.maxOvernightExposure}%)`,
    };
  }

  // ========================================================================
  // VAR CALCULATION
  // ========================================================================

  public calculateVaR(): void {
    const portfolioValue = this.getPortfolioValue();
    const returns = this.historicalReturns;

    // Historical VaR (95%, 99%)
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const var95Idx = Math.floor(returns.length * 0.05);
    const var99Idx = Math.floor(returns.length * 0.01);
    const historicalVaR95 = sortedReturns[var95Idx] * portfolioValue;
    const historicalVaR99 = sortedReturns[var99Idx] * portfolioValue;

    // Parametric VaR (normal distribution)
    const mean = returns.reduce((a, b) => a + b) / returns.length;
    const variance =
      returns.reduce((a, b) => a + (b - mean) ** 2) / returns.length;
    const stdDev = Math.sqrt(variance);
    const z95 = 1.645;
    const z99 = 2.326;
    const parametricVaR95 = -z95 * stdDev * portfolioValue;
    const parametricVaR99 = -z99 * stdDev * portfolioValue;

    // Expected Shortfall (CVaR)
    const lossesBeyondVar = sortedReturns.slice(0, var95Idx);
    const expectedShortfall =
      (lossesBeyondVar.reduce((a, b) => a + b) / lossesBeyondVar.length) *
      portfolioValue;

    // Monte Carlo VaR
    const simulations = 10000;
    const mcReturns: number[] = [];
    for (let i = 0; i < simulations; i++) {
      let simReturn = 0;
      for (let j = 0; j < 20; j++) {
        // 20-day simulation
        const rand = Math.random();
        simReturn += mean + stdDev * this.inverseCumulativeNormal(rand);
      }
      mcReturns.push(simReturn);
    }
    const sortedMC = [...mcReturns].sort((a, b) => a - b);
    const mcVar95Idx = Math.floor(simulations * 0.05);
    const monteCarloVaR95 = sortedMC[mcVar95Idx] * portfolioValue;

    // Per-position contributions
    const positionContributions = new Map<string, number>();
    for (const [symbol, position] of this.positions) {
      const posValue = position.quantity * position.currentPrice;
      const weight = posValue / portfolioValue;
      const contrib = historicalVaR95 * weight;
      positionContributions.set(symbol, contrib);
    }

    this.currentVaR = {
      historicalVaR95,
      historicalVaR99,
      parametricVaR95,
      parametricVaR99,
      expectedShortfall,
      monteCarloVaR95,
      positionContributions,
      timestamp: Date.now(),
    };

    // Check for VaR breach
    if (historicalVaR95 < -this.config.totalRiskBudget * portfolioValue) {
      this.emit('var:breach', {
        var95: historicalVaR95,
        limit: -this.config.totalRiskBudget * portfolioValue,
      });
    }
  }

  public getPortfolioVaR(): VaRMetrics | null {
    return this.currentVaR;
  }

  // ========================================================================
  // EMERGENCY FLATTEN
  // ========================================================================

  public emergencyFlatten(reason: string): FlattenAction {
    const now = Date.now();
    this.lastFlattenTime = now;

    // Priority queue: largest risk first
    const sortedPositions = Array.from(this.positions.entries())
      .map(([symbol, pos]) => ({
        symbol,
        risk: Math.abs(pos.quantity * pos.currentPrice),
      }))
      .sort((a, b) => b.risk - a.risk);

    const executionOrder = sortedPositions.map((p) => p.symbol);
    const flattenAction: FlattenAction = {
      timestamp: now,
      reason,
      positionsFlattened: executionOrder,
      executionOrder,
    };

    this.flattenHistory.push(flattenAction);

    // Clear all positions
    this.positions.clear();
    this.usedRiskBudget = 0;

    this.emit('flatten:executed', flattenAction);

    return flattenAction;
  }

  // ========================================================================
  // PORTFOLIO METRICS
  // ========================================================================

  private getPortfolioValue(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total += position.quantity * position.currentPrice;
    }
    return total || 1; // Prevent division by zero
  }

  private calculateVolatility(): number {
    if (this.historicalReturns.length === 0) return 0.01;
    const mean =
      this.historicalReturns.reduce((a, b) => a + b) /
      this.historicalReturns.length;
    const variance =
      this.historicalReturns.reduce((a, b) => a + (b - mean) ** 2) /
      this.historicalReturns.length;
    return Math.sqrt(variance);
  }

  private inverseCumulativeNormal(p: number): number {
    // Approximate inverse normal CDF (Box-Muller transform)
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z;
  }

  public getConcentrationMetrics(): {
    topSectors: Array<{ sector: string; percent: number }>;
    hhiIndex: number;
    maxPositionPercent: number;
  } {
    const portfolioValue = this.getPortfolioValue();
    const sectorValues = new Map<string, number>();
    let maxPositionPercent = 0;

    for (const position of this.positions.values()) {
      const posValue = position.quantity * position.currentPrice;
      const percent = (posValue / portfolioValue) * 100;
      maxPositionPercent = Math.max(maxPositionPercent, percent);

      sectorValues.set(
        position.sector,
        (sectorValues.get(position.sector) || 0) + posValue
      );
    }

    const topSectors = Array.from(sectorValues.entries())
      .map(([sector, value]) => ({
        sector,
        percent: (value / portfolioValue) * 100,
      }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 5);

    // HHI Index (Herfindahl-Hirschman Index)
    let hhiIndex = 0;
    for (const sector of sectorValues.values()) {
      const percent = sector / portfolioValue;
      hhiIndex += percent * percent;
    }

    return { topSectors, hhiIndex, maxPositionPercent };
  }

  public getUpcomingLockouts(): Array<{
    eventName: string;
    time: number;
    lockoutStart: number;
    lockoutEnd: number;
  }> {
    const now = Date.now();
    const lockouts = [];

    for (const event of this.macroEvents) {
      if (event.scheduledTime > now) {
        lockouts.push({
          eventName: event.name,
          time: event.scheduledTime,
          lockoutStart: event.scheduledTime - this.config.macroLockoutBefore * 60 * 1000,
          lockoutEnd: event.scheduledTime + this.config.macroLockoutAfter * 60 * 1000,
        });
      }
    }

    return lockouts.sort((a, b) => a.time - b.time);
  }

  public getPositions(): Map<string, PortfolioPosition> {
    return new Map(this.positions);
  }

  public addPosition(position: PortfolioPosition): void {
    this.positions.set(position.symbol, position);
    this.calculateVaR();
  }

  public removePosition(symbol: string): void {
    this.positions.delete(symbol);
    this.calculateVaR();
  }

  public getRiskBudgetStatus(): {
    total: number;
    used: number;
    remaining: number;
    utilizationPercent: number;
  } {
    return {
      total: this.config.totalRiskBudget,
      used: this.usedRiskBudget,
      remaining: this.config.totalRiskBudget - this.usedRiskBudget,
      utilizationPercent:
        (this.usedRiskBudget / this.config.totalRiskBudget) * 100,
    };
  }

  public getFlattenHistory(): FlattenAction[] {
    return [...this.flattenHistory];
  }

  public updateConfig(updates: Partial<PortfolioRiskConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  RiskCheck,
  TradeRiskAssessment,
  PortfolioPosition,
  VaRMetrics,
  MacroEvent,
  FlattenAction,
  PortfolioRiskConfig,
};
