/**
 * Phase 96 — Portfolio Tracker
 *
 * Real-time portfolio tracking with P&L attribution, exposure analysis,
 * and performance breakdown by strategy/regime/symbol.
 */

export interface PortfolioPosition {
  symbol: string;
  direction: "long" | "short";
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  weight: number; // portfolio weight 0-1
  strategyId: string;
  regime: string;
  entryTime: Date;
  daysSinceEntry: number;
}

export interface PortfolioSnapshot {
  ts: Date;
  totalEquity: number;
  cash: number;
  investedCapital: number;
  unrealizedPnl: number;
  realizedPnlToday: number;
  realizedPnlTotal: number;
  positions: PortfolioPosition[];
  exposure: ExposureMetrics;
  performance: PerformanceMetrics;
  risk: RiskMetrics;
}

export interface ExposureMetrics {
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  grossExposurePercent: number;
  netExposurePercent: number;
  concentrationTop3: number; // % of portfolio in top 3 positions
  sectorExposure: Record<string, number>;
  regimeExposure: Record<string, number>;
}

export interface PerformanceMetrics {
  dailyPnl: number;
  dailyPnlPercent: number;
  weeklyPnl: number;
  monthlyPnl: number;
  totalReturn: number;
  totalReturnPercent: number;
  winningPositions: number;
  losingPositions: number;
  bestPosition: { symbol: string; pnlPercent: number } | null;
  worstPosition: { symbol: string; pnlPercent: number } | null;
}

export interface RiskMetrics {
  portfolioBeta: number;
  portfolioVaR: number; // Value at Risk (95%)
  currentDrawdown: number;
  currentDrawdownPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  positionCount: number;
  maxPositionWeight: number;
  correlationRisk: number; // 0-1, how correlated positions are
}

export interface TradeRecord {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  strategyId: string;
  regime: string;
  entryTime: Date;
  exitTime: Date;
}

export class PortfolioTracker {
  private positions: Map<string, PortfolioPosition> = new Map();
  private tradeHistory: TradeRecord[] = [];
  private equityCurve: { ts: Date; equity: number }[] = [];
  private initialCapital: number;
  private cash: number;
  private peakEquity: number;
  private dailyPnlStart: number;
  private dailyRealizedPnl = 0;
  private totalRealizedPnl = 0;

  constructor(initialCapital: number) {
    this.initialCapital = initialCapital;
    this.cash = initialCapital;
    this.peakEquity = initialCapital;
    this.dailyPnlStart = initialCapital;
  }

  /** Open a new position */
  openPosition(
    symbol: string,
    direction: "long" | "short",
    quantity: number,
    entryPrice: number,
    strategyId: string,
    regime: string
  ): void {
    const cost = quantity * entryPrice;
    this.cash -= cost;

    const pos: PortfolioPosition = {
      symbol,
      direction,
      quantity,
      avgEntryPrice: entryPrice,
      currentPrice: entryPrice,
      marketValue: cost,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      weight: 0,
      strategyId,
      regime,
      entryTime: new Date(),
      daysSinceEntry: 0,
    };

    this.positions.set(symbol, pos);
    this.recalculateWeights();
  }

  /** Close a position */
  closePosition(symbol: string, exitPrice: number): TradeRecord | null {
    const pos = this.positions.get(symbol);
    if (!pos) return null;

    const pnlPerUnit = pos.direction === "long"
      ? exitPrice - pos.avgEntryPrice
      : pos.avgEntryPrice - exitPrice;

    const pnl = pnlPerUnit * pos.quantity;
    const pnlPercent = (pnlPerUnit / pos.avgEntryPrice) * 100;

    this.cash += pos.quantity * exitPrice;
    this.totalRealizedPnl += pnl;
    this.dailyRealizedPnl += pnl;

    const trade: TradeRecord = {
      symbol: pos.symbol,
      direction: pos.direction,
      entryPrice: pos.avgEntryPrice,
      exitPrice,
      quantity: pos.quantity,
      pnl,
      pnlPercent,
      strategyId: pos.strategyId,
      regime: pos.regime,
      entryTime: pos.entryTime,
      exitTime: new Date(),
    };

    this.tradeHistory.push(trade);
    this.positions.delete(symbol);
    this.recalculateWeights();

    return trade;
  }

  /** Update market price for a position */
  updatePrice(symbol: string, price: number): void {
    const pos = this.positions.get(symbol);
    if (!pos) return;

    pos.currentPrice = price;
    pos.marketValue = pos.quantity * price;

    const pnlPerUnit = pos.direction === "long"
      ? price - pos.avgEntryPrice
      : pos.avgEntryPrice - price;

    pos.unrealizedPnl = pnlPerUnit * pos.quantity;
    pos.unrealizedPnlPercent = (pnlPerUnit / pos.avgEntryPrice) * 100;

    const now = new Date();
    pos.daysSinceEntry = Math.floor(
      (now.getTime() - pos.entryTime.getTime()) / (1000 * 60 * 60 * 24)
    );

    this.recalculateWeights();
  }

  /** Take a portfolio snapshot */
  snapshot(): PortfolioSnapshot {
    const positions = Array.from(this.positions.values());
    const totalUnrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const investedCapital = positions.reduce((s, p) => s + p.quantity * p.avgEntryPrice, 0);
    const totalEquity = this.cash + positions.reduce((s, p) => s + p.marketValue, 0);

    this.peakEquity = Math.max(this.peakEquity, totalEquity);
    const currentDrawdown = this.peakEquity - totalEquity;
    const currentDrawdownPercent = this.peakEquity > 0 ? (currentDrawdown / this.peakEquity) * 100 : 0;

    // Record equity curve
    this.equityCurve.push({ ts: new Date(), equity: totalEquity });

    const exposure = this.computeExposure(positions, totalEquity);
    const performance = this.computePerformance(positions, totalEquity);
    const risk = this.computeRisk(positions, totalEquity, currentDrawdown, currentDrawdownPercent);

    return {
      ts: new Date(),
      totalEquity,
      cash: this.cash,
      investedCapital,
      unrealizedPnl: totalUnrealized,
      realizedPnlToday: this.dailyRealizedPnl,
      realizedPnlTotal: this.totalRealizedPnl,
      positions: [...positions],
      exposure,
      performance,
      risk,
    };
  }

  private computeExposure(positions: PortfolioPosition[], totalEquity: number): ExposureMetrics {
    const longs = positions.filter((p) => p.direction === "long");
    const shorts = positions.filter((p) => p.direction === "short");

    const longExposure = longs.reduce((s, p) => s + p.marketValue, 0);
    const shortExposure = shorts.reduce((s, p) => s + p.marketValue, 0);
    const grossExposure = longExposure + shortExposure;
    const netExposure = longExposure - shortExposure;

    // Top 3 concentration
    const sorted = [...positions].sort((a, b) => b.marketValue - a.marketValue);
    const top3 = sorted.slice(0, 3).reduce((s, p) => s + p.marketValue, 0);
    const concentrationTop3 = totalEquity > 0 ? (top3 / totalEquity) * 100 : 0;

    // By regime
    const regimeExposure: Record<string, number> = {};
    for (const pos of positions) {
      regimeExposure[pos.regime] = (regimeExposure[pos.regime] ?? 0) + pos.marketValue;
    }

    return {
      grossExposure,
      netExposure,
      longExposure,
      shortExposure,
      grossExposurePercent: totalEquity > 0 ? (grossExposure / totalEquity) * 100 : 0,
      netExposurePercent: totalEquity > 0 ? (netExposure / totalEquity) * 100 : 0,
      concentrationTop3,
      sectorExposure: {},
      regimeExposure,
    };
  }

  private computePerformance(positions: PortfolioPosition[], totalEquity: number): PerformanceMetrics {
    const dailyPnl = totalEquity - this.dailyPnlStart;
    const dailyPnlPercent = this.dailyPnlStart > 0 ? (dailyPnl / this.dailyPnlStart) * 100 : 0;
    const totalReturn = totalEquity - this.initialCapital;
    const totalReturnPercent = this.initialCapital > 0 ? (totalReturn / this.initialCapital) * 100 : 0;

    const winning = positions.filter((p) => p.unrealizedPnl > 0);
    const losing = positions.filter((p) => p.unrealizedPnl < 0);

    let bestPos: { symbol: string; pnlPercent: number } | null = null;
    let worstPos: { symbol: string; pnlPercent: number } | null = null;

    for (const pos of positions) {
      if (!bestPos || pos.unrealizedPnlPercent > bestPos.pnlPercent) {
        bestPos = { symbol: pos.symbol, pnlPercent: pos.unrealizedPnlPercent };
      }
      if (!worstPos || pos.unrealizedPnlPercent < worstPos.pnlPercent) {
        worstPos = { symbol: pos.symbol, pnlPercent: pos.unrealizedPnlPercent };
      }
    }

    // Weekly/monthly P&L from trade history
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const weeklyPnl = this.tradeHistory
      .filter((t) => t.exitTime >= weekAgo)
      .reduce((s, t) => s + t.pnl, 0);
    const monthlyPnl = this.tradeHistory
      .filter((t) => t.exitTime >= monthAgo)
      .reduce((s, t) => s + t.pnl, 0);

    return {
      dailyPnl,
      dailyPnlPercent,
      weeklyPnl,
      monthlyPnl,
      totalReturn,
      totalReturnPercent,
      winningPositions: winning.length,
      losingPositions: losing.length,
      bestPosition: bestPos,
      worstPosition: worstPos,
    };
  }

  private computeRisk(
    positions: PortfolioPosition[],
    totalEquity: number,
    currentDrawdown: number,
    currentDrawdownPercent: number
  ): RiskMetrics {
    const maxWeight = positions.length > 0
      ? Math.max(...positions.map((p) => p.weight)) * 100
      : 0;

    // Simplified VaR (2% of equity at 95% confidence)
    const portfolioVaR = totalEquity * 0.02;

    // Sharpe from equity curve
    const returns: number[] = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prev = this.equityCurve[i - 1].equity;
      const curr = this.equityCurve[i].equity;
      if (prev > 0) returns.push((curr - prev) / prev);
    }

    let sharpeRatio = 0;
    if (returns.length > 1) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const std = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1));
      sharpeRatio = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    }

    // Max drawdown from equity curve
    let peak = this.initialCapital;
    let maxDD = 0;
    let maxDDPct = 0;
    for (const point of this.equityCurve) {
      peak = Math.max(peak, point.equity);
      const dd = peak - point.equity;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDPct = ddPct;
      }
    }

    return {
      portfolioBeta: 1.0, // placeholder — needs market correlation
      portfolioVaR,
      currentDrawdown,
      currentDrawdownPercent,
      maxDrawdown: maxDD,
      maxDrawdownPercent: maxDDPct,
      sharpeRatio,
      positionCount: positions.length,
      maxPositionWeight: maxWeight,
      correlationRisk: 0, // placeholder
    };
  }

  /** Recalculate portfolio weights */
  private recalculateWeights(): void {
    const positions = Array.from(this.positions.values());
    const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
    for (const pos of positions) {
      pos.weight = totalValue > 0 ? pos.marketValue / totalValue : 0;
    }
  }

  /** Reset daily P&L tracking */
  resetDailyPnl(): void {
    const positions = Array.from(this.positions.values());
    const totalEquity = this.cash + positions.reduce((s, p) => s + p.marketValue, 0);
    this.dailyPnlStart = totalEquity;
    this.dailyRealizedPnl = 0;
  }

  /** Get trade history */
  getTradeHistory(limit?: number): TradeRecord[] {
    return limit ? this.tradeHistory.slice(-limit) : [...this.tradeHistory];
  }

  /** Get equity curve */
  getEquityCurve(): { ts: Date; equity: number }[] {
    return [...this.equityCurve];
  }

  /** Get position count */
  getPositionCount(): number {
    return this.positions.size;
  }

  /** Check if symbol has open position */
  hasPosition(symbol: string): boolean {
    return this.positions.has(symbol);
  }
}
