import { EventEmitter } from 'events';

/**
 * DrawdownState represents the current drawdown metrics
 */
export interface DrawdownState {
  currentDrawdown: number;
  peakEquity: number;
  currentEquity: number;
  troughEquity: number;
  drawdownStartTime: string | null;
  durationMinutes: number;
  isInDrawdown: boolean;
  severity: 'none' | 'minor' | 'moderate' | 'severe' | 'critical';
}

/**
 * DrawdownEvent represents a historical drawdown period
 */
export interface DrawdownEvent {
  id: string;
  startTime: string;
  endTime: string | null;
  peakEquity: number;
  troughEquity: number;
  maxDrawdownPct: number;
  recoveryTime: number | null;
  recovered: boolean;
}

/**
 * RecoveryAnalysis provides statistics about recovery patterns
 */
export interface RecoveryAnalysis {
  avgRecoveryTime: number;
  medianRecoveryTime: number;
  fastestRecovery: number;
  slowestRecovery: number;
  currentStreak: number;
  longestLossStreak: number;
  recoveryRate: number;
}

/**
 * EquityCurveStats provides comprehensive equity curve metrics
 */
export interface EquityCurveStats {
  cagr: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  currentEquity: number;
  highWaterMark: number;
  equityCurve: { timestamp: string; equity: number }[];
}

/**
 * Configuration for DrawdownAnalyzer
 */
interface DrawdownAnalyzerConfig {
  maxAcceptableDrawdown?: number;
  recoveryTarget?: number;
  equityCurveWindow?: number;
}

/**
 * Helper function: calculate standard deviation
 */
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Helper function: calculate downside deviation (only negative returns)
 */
function calculateDownsideDeviation(returns: number[]): number {
  if (returns.length === 0) return 0;
  const downsideReturns = returns.filter((r) => r < 0);
  if (downsideReturns.length === 0) return 0;
  const meanDownside =
    downsideReturns.reduce((a, b) => a + b, 0) / downsideReturns.length;
  const variance =
    downsideReturns.reduce((a, b) => a + Math.pow(b - meanDownside, 2), 0) /
    downsideReturns.length;
  return Math.sqrt(variance);
}

/**
 * Helper function: calculate returns from equity curve
 */
function calculateReturns(equities: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equities.length; i++) {
    const ret = (equities[i] - equities[i - 1]) / equities[i - 1];
    returns.push(ret);
  }
  return returns;
}

/**
 * Helper function: generate unique ID
 */
function generateId(): string {
  return `dd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * DrawdownAnalyzer - Real-time drawdown tracking and recovery analysis
 * Extends EventEmitter to emit drawdown state changes
 */
export class DrawdownAnalyzer extends EventEmitter {
  private maxAcceptableDrawdown: number;
  private recoveryTarget: number;
  private equityCurveWindow: number;

  private equityCurve: { timestamp: string; equity: number }[] = [];
  private peakEquity: number = 0;
  private troughEquity: number = 0;
  private currentEquity: number = 0;
  private highWaterMark: number = 0;

  private drawdownEvents: DrawdownEvent[] = [];
  private currentDrawdownEvent: DrawdownEvent | null = null;
  private circuitBreakerTriggered: boolean = false;
  private lastEmittedDrawdown: number = 0;

  constructor(config: DrawdownAnalyzerConfig = {}) {
    super();
    this.maxAcceptableDrawdown = config.maxAcceptableDrawdown ?? 0.1;
    this.recoveryTarget = config.recoveryTarget ?? 0.02;
    this.equityCurveWindow = config.equityCurveWindow ?? 200;
  }

  /**
   * Update equity snapshot - main feed function
   */
  updateEquity(timestamp: string, equity: number): void {
    this.currentEquity = equity;

    // Initialize peak on first update
    if (this.peakEquity === 0) {
      this.peakEquity = equity;
      this.highWaterMark = equity;
    }

    // Update high water mark
    if (equity > this.highWaterMark) {
      this.highWaterMark = equity;
      this.peakEquity = equity;
    }

    // Add to equity curve (maintain window size)
    this.equityCurve.push({ timestamp, equity });
    if (this.equityCurve.length > this.equityCurveWindow) {
      this.equityCurve.shift();
    }

    // Calculate current drawdown
    const currentDrawdown = (this.peakEquity - equity) / this.peakEquity;

    // Update trough if in drawdown
    if (currentDrawdown > 0 && equity < this.troughEquity) {
      this.troughEquity = equity;
    } else if (currentDrawdown <= 0) {
      this.troughEquity = equity;
    }

    // Handle drawdown state transitions
    const isInDrawdown = currentDrawdown > 0.001; // Small threshold to avoid noise

    if (isInDrawdown && !this.currentDrawdownEvent) {
      // Drawdown just started
      this.currentDrawdownEvent = {
        id: generateId(),
        startTime: timestamp,
        endTime: null,
        peakEquity: this.peakEquity,
        troughEquity: equity,
        maxDrawdownPct: currentDrawdown,
        recoveryTime: null,
        recovered: false,
      };
      this.emit('drawdown:started', {
        timestamp,
        drawdown: currentDrawdown,
        peakEquity: this.peakEquity,
        currentEquity: equity,
      });
    } else if (isInDrawdown && this.currentDrawdownEvent) {
      // Update trough and max drawdown
      if (equity < this.currentDrawdownEvent.troughEquity) {
        this.currentDrawdownEvent.troughEquity = equity;
      }
      if (currentDrawdown > this.currentDrawdownEvent.maxDrawdownPct) {
        this.currentDrawdownEvent.maxDrawdownPct = currentDrawdown;
        this.emit('drawdown:deepening', {
          timestamp,
          drawdown: currentDrawdown,
          peakEquity: this.peakEquity,
          currentEquity: equity,
        });
      }
    } else if (!isInDrawdown && this.currentDrawdownEvent) {
      // Drawdown recovered
      const recoveryStartTime = new Date(
        this.currentDrawdownEvent.startTime
      ).getTime();
      const recoveryEndTime = new Date(timestamp).getTime();
      const recoveryTimeMinutes =
        (recoveryEndTime - recoveryStartTime) / (1000 * 60);

      this.currentDrawdownEvent.endTime = timestamp;
      this.currentDrawdownEvent.recoveryTime = recoveryTimeMinutes;
      this.currentDrawdownEvent.recovered = true;

      this.drawdownEvents.push(this.currentDrawdownEvent);
      this.emit('drawdown:recovered', {
        timestamp,
        event: this.currentDrawdownEvent,
      });

      this.currentDrawdownEvent = null;
    }

    // Check circuit breaker
    if (currentDrawdown > this.maxAcceptableDrawdown) {
      if (!this.circuitBreakerTriggered) {
        this.circuitBreakerTriggered = true;
        this.emit('circuit-breaker:triggered', {
          timestamp,
          drawdown: currentDrawdown,
          maxAcceptable: this.maxAcceptableDrawdown,
        });
      }
    } else {
      this.circuitBreakerTriggered = false;
    }

    this.lastEmittedDrawdown = currentDrawdown;
  }

  /**
   * Get current drawdown state
   */
  getCurrentDrawdown(): DrawdownState {
    const currentDrawdown =
      this.peakEquity > 0 ? (this.peakEquity - this.currentEquity) / this.peakEquity : 0;

    let severity: 'none' | 'minor' | 'moderate' | 'severe' | 'critical' =
      'none';
    if (currentDrawdown > 0.3) severity = 'critical';
    else if (currentDrawdown > 0.2) severity = 'severe';
    else if (currentDrawdown > 0.1) severity = 'moderate';
    else if (currentDrawdown > 0.05) severity = 'minor';

    let durationMinutes = 0;
    if (this.currentDrawdownEvent && this.currentDrawdownEvent.startTime) {
      const startTime = new Date(this.currentDrawdownEvent.startTime).getTime();
      const now = Date.now();
      durationMinutes = (now - startTime) / (1000 * 60);
    }

    return {
      currentDrawdown,
      peakEquity: this.peakEquity,
      currentEquity: this.currentEquity,
      troughEquity: this.troughEquity,
      drawdownStartTime:
        this.currentDrawdownEvent?.startTime || null,
      durationMinutes,
      isInDrawdown: currentDrawdown > 0.001,
      severity,
    };
  }

  /**
   * Get all historical drawdown events
   */
  getDrawdownHistory(): DrawdownEvent[] {
    return [...this.drawdownEvents];
  }

  /**
   * Get recovery analysis statistics
   */
  getRecoveryAnalysis(): RecoveryAnalysis {
    const recoveredEvents = this.drawdownEvents.filter((e) => e.recovered);
    const recoveryTimes = recoveredEvents
      .map((e) => e.recoveryTime || 0)
      .filter((t) => t > 0);

    const sortedTimes = [...recoveryTimes].sort((a, b) => a - b);
    const medianRecoveryTime =
      sortedTimes.length > 0
        ? sortedTimes[Math.floor(sortedTimes.length / 2)]
        : 0;

    const avgRecoveryTime =
      recoveryTimes.length > 0
        ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
        : 0;

    const fastestRecovery =
      recoveryTimes.length > 0 ? Math.min(...recoveryTimes) : 0;
    const slowestRecovery =
      recoveryTimes.length > 0 ? Math.max(...recoveryTimes) : 0;

    // Calculate loss streaks
    let currentStreak = 0;
    let longestLossStreak = 0;

    if (this.equityCurve.length > 1) {
      for (let i = 1; i < this.equityCurve.length; i++) {
        if (this.equityCurve[i].equity < this.equityCurve[i - 1].equity) {
          currentStreak++;
          longestLossStreak = Math.max(longestLossStreak, currentStreak);
        } else {
          currentStreak = 0;
        }
      }
    }

    // Recovery rate: average gain after drawdown recovery
    let recoveryRate = 0;
    if (recoveredEvents.length > 0) {
      const recoveryGains = recoveredEvents.map((e) => {
        const lossAmount = e.peakEquity - e.troughEquity;
        const gain = this.currentEquity - e.troughEquity;
        return e.peakEquity > 0 ? gain / lossAmount : 0;
      });
      recoveryRate =
        recoveryGains.reduce((a, b) => a + b, 0) / recoveryGains.length;
    }

    return {
      avgRecoveryTime,
      medianRecoveryTime,
      fastestRecovery,
      slowestRecovery,
      currentStreak,
      longestLossStreak,
      recoveryRate,
    };
  }

  /**
   * Get equity curve statistics (CAGR, Sharpe, Sortino, Calmar, etc.)
   */
  getEquityCurveStats(): EquityCurveStats {
    const cagr = this.calculateCAGR();
    const returns = calculateReturns(
      this.equityCurve.map((e) => e.equity)
    );
    const volatility = calculateStdDev(returns);
    const downsideDeviation = calculateDownsideDeviation(returns);

    const riskFreeRate = 0.02 / 252; // Annual risk-free rate / trading days
    const avgDailyReturn = returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;

    const sharpe =
      volatility > 0 ? (avgDailyReturn - riskFreeRate) / volatility : 0;
    const sortino =
      downsideDeviation > 0
        ? (avgDailyReturn - riskFreeRate) / downsideDeviation
        : 0;

    const maxDD = this.calculateMaxDrawdown();
    const calmar = maxDD > 0 ? cagr / Math.abs(maxDD) : 0;

    return {
      cagr,
      volatility,
      sharpe,
      sortino,
      calmar,
      maxDrawdown: maxDD,
      currentEquity: this.currentEquity,
      highWaterMark: this.highWaterMark,
      equityCurve: [...this.equityCurve],
    };
  }

  /**
   * Check if circuit breaker is triggered
   */
  isCircuitBreakerTriggered(): boolean {
    return this.circuitBreakerTriggered;
  }

  /**
   * Private helper: Calculate CAGR (Compound Annual Growth Rate)
   */
  private calculateCAGR(): number {
    if (this.equityCurve.length < 2) return 0;

    const startEquity = this.equityCurve[0].equity;
    const endEquity = this.equityCurve[this.equityCurve.length - 1].equity;

    if (startEquity <= 0) return 0;

    const startTime = new Date(this.equityCurve[0].timestamp).getTime();
    const endTime = new Date(
      this.equityCurve[this.equityCurve.length - 1].timestamp
    ).getTime();
    const yearsDiff = (endTime - startTime) / (1000 * 60 * 60 * 24 * 365.25);

    if (yearsDiff <= 0) return 0;

    const cagr = Math.pow(endEquity / startEquity, 1 / yearsDiff) - 1;
    return cagr;
  }

  /**
   * Private helper: Calculate maximum drawdown from equity curve
   */
  private calculateMaxDrawdown(): number {
    if (this.equityCurve.length === 0) return 0;

    let maxDD = 0;
    let peak = this.equityCurve[0].equity;

    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const dd = (peak - point.equity) / peak;
      maxDD = Math.max(maxDD, dd);
    }

    return -maxDD; // Return as negative
  }
}
