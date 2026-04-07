import { EventEmitter } from 'events';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface BacktestEvent {
  type: 'tick' | 'candle_close' | 'book_update' | 'session_open' | 'session_close' | 'halt' | 'resume';
  timestamp: number;
  symbol: string;
  data: Record<string, unknown>;
}

export interface FeeModel {
  perShare: number;      // e.g. 0.005
  perTrade: number;      // e.g. 1.00
  platformFee: number;   // e.g. 0.001 (0.1%)
  ecnRebate: number;     // e.g. -0.002
}

export interface SlippageModel {
  type: 'fixed' | 'volatility_scaled' | 'volume_impact' | 'realistic';
  fixedBps: number;      // basis points
  volMultiplier: number; // for volatility-scaled
  impactCoeff: number;   // for volume impact
}

export interface WalkForwardConfig {
  inSamplePct: number;   // e.g. 0.7
  outSamplePct: number;  // e.g. 0.3
  windows: number;       // e.g. 5 rolling windows
  anchoredStart: boolean;
  minWindowDays: number;
}

export interface BacktestConfig {
  id: string;
  strategy: string;
  symbols: string[];
  startDate: string;
  endDate: string;
  initialCapital: number;
  fees: FeeModel;
  slippage: SlippageModel;
  latencyMs: number;
  partialFills: boolean;
  sessionBoundaries: boolean;
  marketHalts: boolean;
  survivorshipBias: 'none' | 'sp500_current' | 'sp500_historical';
  walkForward: WalkForwardConfig | null;
}

export interface Trade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  quantity: number;
  fees: number;
  slippage: number;
  pnl: number;
  pnlPct: number;
  holdingPeriodMs: number;
}

export interface EquityCurvePoint {
  date: string;
  equity: number;
  drawdown: number;
}

export interface WalkForwardResult {
  inSampleMetrics: BacktestMetrics;
  outSampleMetrics: BacktestMetrics;
  overfit: boolean;
  overfitScore: number; // IS Sharpe / OOS Sharpe
}

export interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  profitFactor: number;
  winRate: number;
  expectancy: number;
  trades: number;
  avgHoldingPeriod: number;
}

export interface BenchmarkMetrics {
  buyHold: number;
  randomBaseline: number;
  riskFree: number;
  alpha: number;
}

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  metrics: BacktestMetrics;
  walkForward?: WalkForwardResult;
  assumptions: string[];
  warnings: string[];
  equityCurve: EquityCurvePoint[];
  benchmark: BenchmarkMetrics;
  trades: Trade[];
  startTime: number;
  endTime: number;
  duration: number;
}

// ============================================================================
// EVENT-DRIVEN BACKTESTER
// ============================================================================

export class EventDrivenBacktester extends EventEmitter {
  private config: BacktestConfig;
  private events: BacktestEvent[] = [];
  private equity: number;
  private cash: number;
  private positions: Map<string, number> = new Map();
  private trades: Trade[] = [];
  private equityCurve: EquityCurvePoint[] = [];
  private currentPrice: Map<string, number> = new Map();
  private currentVolume: Map<string, number> = new Map();
  private currentVolatility: Map<string, number> = new Map();
  private marketHalted: Map<string, boolean> = new Map();
  private sessionActive: Map<string, boolean> = new Map();
  private leakageDetected: boolean = false;
  private lastDrawdown: number = 0;
  private peakEquity: number;
  private executionQueue: Array<{
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    limit?: number;
    timestamp: number;
    requestId: string;
  }> = [];

  constructor(config: BacktestConfig) {
    super();
    this.config = config;
    this.equity = config.initialCapital;
    this.cash = config.initialCapital;
    this.peakEquity = config.initialCapital;
    this.initializeSymbols();
  }

  // ========================================================================
  // INITIALIZATION
  // ========================================================================

  private initializeSymbols(): void {
    for (const symbol of this.config.symbols) {
      this.positions.set(symbol, 0);
      this.currentPrice.set(symbol, 0);
      this.currentVolume.set(symbol, 0);
      this.currentVolatility.set(symbol, 0);
      this.marketHalted.set(symbol, false);
      this.sessionActive.set(symbol, true);
    }
  }

  // ========================================================================
  // EVENT INGESTION
  // ========================================================================

  public ingestEvents(events: BacktestEvent[]): void {
    this.events = events.sort((a, b) => a.timestamp - b.timestamp);
  }

  // ========================================================================
  // EXECUTION SIMULATION
  // ========================================================================

  public executeOrder(
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    limit?: number
  ): { success: boolean; price: number; fees: number; slippage: number; message: string } {
    const currentPrice = this.currentPrice.get(symbol) || 0;

    // Session boundary check
    if (this.config.sessionBoundaries && !this.sessionActive.get(symbol)) {
      return { success: false, price: 0, fees: 0, slippage: 0, message: 'Market closed' };
    }

    // Market halt check
    if (this.config.marketHalts && this.marketHalted.get(symbol)) {
      return { success: false, price: 0, fees: 0, slippage: 0, message: 'Trading halted' };
    }

    // Partial fill simulation
    let fillQuantity = quantity;
    if (this.config.partialFills) {
      const volume = this.currentVolume.get(symbol) || 0;
      const maxFillable = Math.floor(volume * 0.1); // Can fill up to 10% of volume
      fillQuantity = Math.min(quantity, maxFillable);
      if (fillQuantity < quantity) {
        this.emit('backtest:partial_fill', { symbol, requested: quantity, filled: fillQuantity });
      }
    }

    // Calculate execution price with slippage and spread
    const { executionPrice, slippageCost } = this.calculateExecutionPrice(
      symbol,
      currentPrice,
      side,
      fillQuantity
    );

    // Check if limit price is violated
    if (limit && ((side === 'buy' && executionPrice > limit) || (side === 'sell' && executionPrice < limit))) {
      return { success: false, price: 0, fees: 0, slippage: 0, message: 'Limit price exceeded' };
    }

    // Calculate fees
    const { totalFees, breakdown } = this.calculateFees(executionPrice, fillQuantity, side);

    // Check cash availability
    const requiredCash = side === 'buy' ? executionPrice * fillQuantity + totalFees : 0;
    if (side === 'buy' && requiredCash > this.cash) {
      return { success: false, price: 0, fees: 0, slippage: 0, message: 'Insufficient cash' };
    }

    // Execute trade
    if (side === 'buy') {
      this.cash -= requiredCash;
      const pos = this.positions.get(symbol) || 0;
      this.positions.set(symbol, pos + fillQuantity);
    } else {
      this.cash += executionPrice * fillQuantity - totalFees;
      const pos = this.positions.get(symbol) || 0;
      this.positions.set(symbol, Math.max(0, pos - fillQuantity));
    }

    this.emit('backtest:trade', { symbol, side, quantity: fillQuantity, price: executionPrice, fees: totalFees });

    return { success: true, price: executionPrice, fees: totalFees, slippage: slippageCost, message: 'Filled' };
  }

  private calculateExecutionPrice(
    symbol: string,
    midPrice: number,
    side: 'buy' | 'sell',
    quantity: number
  ): { executionPrice: number; slippageCost: number } {
    const vol = this.currentVolatility.get(symbol) || 0.01;
    const volume = this.currentVolume.get(symbol) || 1000000;

    let slippageBps = 0;

    if (this.config.slippage.type === 'fixed') {
      slippageBps = this.config.slippage.fixedBps;
    } else if (this.config.slippage.type === 'volatility_scaled') {
      slippageBps = vol * 10000 * this.config.slippage.volMultiplier; // vol in decimal
    } else if (this.config.slippage.type === 'volume_impact') {
      const tradeSize = (quantity * midPrice) / volume;
      slippageBps = Math.pow(tradeSize, 2) * this.config.slippage.impactCoeff * 10000;
    } else if (this.config.slippage.type === 'realistic') {
      // Realistic: base + vol-scaled + impact
      const baseSlippage = 2; // 2 bps
      const volComponent = vol * 10000 * 0.5;
      const tradeSize = (quantity * midPrice) / volume;
      const impactComponent = Math.pow(tradeSize, 2) * 0.01 * 10000;
      slippageBps = baseSlippage + volComponent + impactComponent;
    }

    // Add spread (assume bid-ask 1 bp for liquid symbols)
    const spreadBps = side === 'buy' ? 0.5 : 0.5;
    const totalSlippageBps = slippageBps + spreadBps;
    const slippageMultiplier = 1 + totalSlippageBps / 10000;

    const executionPrice = side === 'buy' ? midPrice * slippageMultiplier : midPrice / slippageMultiplier;
    const slippageCost = Math.abs(executionPrice - midPrice) * quantity;

    return { executionPrice, slippageCost };
  }

  private calculateFees(price: number, quantity: number, side: 'buy' | 'sell'): { totalFees: number; breakdown: Record<string, number> } {
    const perShare = this.config.fees.perShare * quantity;
    const perTrade = this.config.fees.perTrade;
    const platformFee = price * quantity * this.config.fees.platformFee;
    const ecnRebate = side === 'sell' ? price * quantity * Math.abs(this.config.fees.ecnRebate) : 0;

    const totalFees = Math.max(0, perShare + perTrade + platformFee - ecnRebate);
    return {
      totalFees,
      breakdown: { perShare, perTrade, platformFee, ecnRebate }
    };
  }

  // ========================================================================
  // EVENT PROCESSING
  // ========================================================================

  public async runBacktest(): Promise<BacktestResult> {
    const startTime = Date.now();
    this.emit('backtest:start', { config: this.config });

    for (const event of this.events) {
      this.processEvent(event);
    }

    const endTime = Date.now();

    // Calculate metrics
    const metrics = this.calculateMetrics();
    const benchmark = this.calculateBenchmark();
    const assumptions = this.generateAssumptions();
    const warnings = this.detectWarnings();

    const result: BacktestResult = {
      id: this.config.id,
      config: this.config,
      metrics,
      assumptions,
      warnings,
      equityCurve: this.equityCurve,
      benchmark,
      trades: this.trades,
      startTime,
      endTime,
      duration: endTime - startTime
    };

    this.emit('backtest:complete', result);
    return result;
  }

  private processEvent(event: BacktestEvent): void {
    const { type, timestamp, symbol, data } = event;

    switch (type) {
      case 'tick':
        this.handleTick(timestamp, symbol, data);
        break;
      case 'candle_close':
        this.handleCandleClose(timestamp, symbol, data);
        break;
      case 'book_update':
        this.handleBookUpdate(timestamp, symbol, data);
        break;
      case 'session_open':
        this.sessionActive.set(symbol, true);
        break;
      case 'session_close':
        this.sessionActive.set(symbol, false);
        break;
      case 'halt':
        this.marketHalted.set(symbol, true);
        break;
      case 'resume':
        this.marketHalted.set(symbol, false);
        break;
    }

    this.emit('backtest:tick', event);
  }

  private handleTick(timestamp: number, symbol: string, data: Record<string, unknown>): void {
    const price = (data.price as number) || 0;
    const volume = (data.volume as number) || 0;

    this.currentPrice.set(symbol, price);
    this.currentVolume.set(symbol, volume);

    // Update equity
    this.updateEquity();
  }

  private handleCandleClose(timestamp: number, symbol: string, data: Record<string, unknown>): void {
    const close = (data.close as number) || 0;
    const high = (data.high as number) || close;
    const low = (data.low as number) || close;

    this.currentPrice.set(symbol, close);
    this.currentVolatility.set(symbol, (high - low) / close);
  }

  private handleBookUpdate(timestamp: number, symbol: string, data: Record<string, unknown>): void {
    const bid = (data.bid as number) || 0;
    const ask = (data.ask as number) || 0;
    const mid = (bid + ask) / 2;

    this.currentPrice.set(symbol, mid);
  }

  // ========================================================================
  // EQUITY TRACKING
  // ========================================================================

  private updateEquity(): void {
    let totalValue = this.cash;

    for (const [symbol, quantity] of this.positions.entries()) {
      const price = this.currentPrice.get(symbol) || 0;
      totalValue += quantity * price;
    }

    this.equity = totalValue;

    // Track drawdown
    if (this.equity > this.peakEquity) {
      this.peakEquity = this.equity;
    }
    this.lastDrawdown = (this.peakEquity - this.equity) / this.peakEquity;

    // Record equity curve point
    const now = new Date().toISOString().split('T')[0];
    this.equityCurve.push({ date: now, equity: this.equity, drawdown: this.lastDrawdown });
  }

  // ========================================================================
  // LEAKAGE DETECTION
  // ========================================================================

  public checkLeakage(strategy: Record<string, unknown>): void {
    const suspiciousPatterns = ['future_data', 'forward_fill', 'look_ahead', 'tomorrow', 'next_candle'];

    for (const key in strategy) {
      const value = strategy[key];
      for (const pattern of suspiciousPatterns) {
        if (String(value).toLowerCase().includes(pattern)) {
          this.leakageDetected = true;
          this.emit('leakage:detected', { key, value, pattern });
        }
      }
    }
  }

  // ========================================================================
  // SURVIVORSHIP BIAS
  // ========================================================================

  public checkSurvivorshipBias(): string[] {
    const warnings: string[] = [];

    if (this.config.survivorshipBias === 'sp500_current') {
      warnings.push(
        'Strategy uses current S&P 500 constituents. Historical data includes symbols that may have been delisted. Results may overstate historical returns.'
      );
    }

    return warnings;
  }

  // ========================================================================
  // METRICS CALCULATION
  // ========================================================================

  private calculateMetrics(): BacktestMetrics {
    const returns = this.calculateReturns();
    const numTrades = this.trades.length;
    const winningTrades = this.trades.filter(t => t.pnl > 0).length;
    const winRate = numTrades > 0 ? winningTrades / numTrades : 0;

    const profitFactor = this.calculateProfitFactor();
    const expectancy = numTrades > 0 ? (this.equity - this.config.initialCapital) / numTrades : 0;
    const avgHoldingPeriod = numTrades > 0 ? this.trades.reduce((sum, t) => sum + t.holdingPeriodMs, 0) / numTrades : 0;

    const sharpe = this.calculateSharpe(returns);
    const sortino = this.calculateSortino(returns);

    const totalReturn = (this.equity - this.config.initialCapital) / this.config.initialCapital;
    const days = 252; // Annualization factor
    const annualizedReturn = Math.pow(1 + totalReturn, 365 / (this.events.length || 1)) - 1;

    return {
      totalReturn,
      annualizedReturn,
      sharpe,
      sortino,
      maxDrawdown: this.lastDrawdown,
      profitFactor,
      winRate,
      expectancy,
      trades: numTrades,
      avgHoldingPeriod
    };
  }

  private calculateReturns(): number[] {
    return this.equityCurve.map((point, i) => {
      if (i === 0) return 0;
      return (point.equity - this.equityCurve[i - 1].equity) / this.equityCurve[i - 1].equity;
    });
  }

  private calculateSharpe(returns: number[]): number {
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const std = Math.sqrt(variance);
    const riskFreeRate = 0.02 / 252; // 2% annual
    return std > 0 ? (mean - riskFreeRate) / std * Math.sqrt(252) : 0;
  }

  private calculateSortino(returns: number[]): number {
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const downside = returns.filter(r => r < 0).reduce((sum, r) => sum + Math.pow(r, 2), 0) / returns.length;
    const downsideStd = Math.sqrt(downside);
    const riskFreeRate = 0.02 / 252;
    return downsideStd > 0 ? (mean - riskFreeRate) / downsideStd * Math.sqrt(252) : 0;
  }

  private calculateProfitFactor(): number {
    const grossProfit = this.trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(this.trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  }

  // ========================================================================
  // BENCHMARK COMPARISON
  // ========================================================================

  private calculateBenchmark(): BenchmarkMetrics {
    const buyHoldReturn = this.currentPrice.get(this.config.symbols[0]) || 1;
    const riskFreeReturn = Math.pow(1 + 0.02, this.events.length / 252 / 365) - 1; // 2% annual

    const alpha = ((this.equity - this.config.initialCapital) / this.config.initialCapital) - buyHoldReturn;

    return {
      buyHold: buyHoldReturn,
      randomBaseline: 0.01, // Mock 1% random returns
      riskFree: riskFreeReturn,
      alpha
    };
  }

  // ========================================================================
  // ASSUMPTIONS & WARNINGS
  // ========================================================================

  private generateAssumptions(): string[] {
    return [
      `Initial capital: ${this.config.initialCapital}`,
      `Symbols: ${this.config.symbols.join(', ')}`,
      `Latency: ${this.config.latencyMs}ms`,
      `Slippage model: ${this.config.slippage.type}`,
      `Partial fills: ${this.config.partialFills}`,
      `Session boundaries enforced: ${this.config.sessionBoundaries}`,
      `Market halts simulated: ${this.config.marketHalts}`,
      `Survivorship bias control: ${this.config.survivorshipBias}`
    ];
  }

  private detectWarnings(): string[] {
    const warnings = this.checkSurvivorshipBias();

    if (this.leakageDetected) {
      warnings.push('Leakage detected: strategy may use future data');
    }

    if (this.trades.length === 0) {
      warnings.push('No trades generated during backtest');
    }

    return warnings;
  }

  // ========================================================================
  // WALK-FORWARD VALIDATION
  // ========================================================================

  public runWalkForward(): WalkForwardResult {
    if (!this.config.walkForward) {
      throw new Error('Walk-forward configuration not provided');
    }

    const cfg = this.config.walkForward;
    const totalDays = 252; // Mock 1 year = 252 trading days
    const windowSize = Math.ceil(totalDays / cfg.windows);

    let totalInSampleSharpe = 0;
    let totalOutSampleSharpe = 0;
    let windowCount = 0;

    for (let i = 0; i < cfg.windows; i++) {
      const inSampleSize = Math.ceil(windowSize * cfg.inSamplePct);
      const outSampleSize = Math.ceil(windowSize * cfg.outSamplePct);

      // Mock IS/OOS metrics
      const isReturn = 0.12 + Math.random() * 0.08;
      const isSharpe = 1.5 + Math.random() * 0.5;
      const oosReturn = 0.08 + Math.random() * 0.1;
      const oosSharpe = 1.0 + Math.random() * 0.4;

      totalInSampleSharpe += isSharpe;
      totalOutSampleSharpe += oosSharpe;
      windowCount++;
    }

    const avgInSampleSharpe = totalInSampleSharpe / windowCount;
    const avgOutSampleSharpe = totalOutSampleSharpe / windowCount;
    const overfitScore = avgInSampleSharpe / avgOutSampleSharpe;
    const overfit = overfitScore > 1.3; // Flag if IS > OOS by 30%+

    return {
      inSampleMetrics: {
        totalReturn: 0.15,
        annualizedReturn: 0.15,
        sharpe: avgInSampleSharpe,
        sortino: avgInSampleSharpe * 1.2,
        maxDrawdown: 0.12,
        profitFactor: 2.1,
        winRate: 0.55,
        expectancy: 150,
        trades: 45,
        avgHoldingPeriod: 5 * 24 * 3600 * 1000
      },
      outSampleMetrics: {
        totalReturn: 0.09,
        annualizedReturn: 0.09,
        sharpe: avgOutSampleSharpe,
        sortino: avgOutSampleSharpe * 1.2,
        maxDrawdown: 0.18,
        profitFactor: 1.6,
        winRate: 0.52,
        expectancy: 85,
        trades: 42,
        avgHoldingPeriod: 5.5 * 24 * 3600 * 1000
      },
      overfit,
      overfitScore
    };
  }

  // ========================================================================
  // GETTERS
  // ========================================================================

  public getEquity(): number {
    return this.equity;
  }

  public getCash(): number {
    return this.cash;
  }

  public getPositions(): Map<string, number> {
    return this.positions;
  }

  public getTrades(): Trade[] {
    return this.trades;
  }

  public getEquityCurve(): EquityCurvePoint[] {
    return this.equityCurve;
  }
}

// ============================================================================
// MOCK COMPLETED BACKTESTS
// ============================================================================

export const mockBacktests: BacktestResult[] = [
  {
    id: 'backtest_001',
    config: {
      id: 'backtest_001',
      strategy: 'Mean Reversion (5-period)',
      symbols: ['AAPL', 'MSFT', 'GOOGL'],
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      initialCapital: 100000,
      fees: { perShare: 0.005, perTrade: 1.0, platformFee: 0.001, ecnRebate: 0.002 },
      slippage: { type: 'volatility_scaled', fixedBps: 2, volMultiplier: 0.8, impactCoeff: 0.01 },
      latencyMs: 50,
      partialFills: true,
      sessionBoundaries: true,
      marketHalts: true,
      survivorshipBias: 'none',
      walkForward: null
    },
    metrics: {
      totalReturn: 0.28,
      annualizedReturn: 0.28,
      sharpe: 1.85,
      sortino: 2.12,
      maxDrawdown: 0.095,
      profitFactor: 2.45,
      winRate: 0.58,
      expectancy: 1250,
      trades: 156,
      avgHoldingPeriod: 5.2 * 24 * 3600 * 1000
    },
    assumptions: [
      'Initial capital: 100000',
      'Symbols: AAPL, MSFT, GOOGL',
      'Latency: 50ms',
      'Slippage model: volatility_scaled',
      'Partial fills: true',
      'Session boundaries enforced: true',
      'Market halts simulated: true',
      'Survivorship bias control: none'
    ],
    warnings: [],
    equityCurve: [
      { date: '2023-01-01', equity: 100000, drawdown: 0 },
      { date: '2023-06-01', equity: 112500, drawdown: 0.02 },
      { date: '2024-01-01', equity: 128000, drawdown: 0.01 }
    ],
    benchmark: { buyHold: 0.18, randomBaseline: 0.01, riskFree: 0.05, alpha: 0.10 },
    trades: [
      {
        id: 'trade_001',
        symbol: 'AAPL',
        side: 'long',
        entryPrice: 150.25,
        exitPrice: 156.80,
        entryTime: 1672531200000,
        exitTime: 1672617600000,
        quantity: 50,
        fees: 45.5,
        slippage: 12.3,
        pnl: 323.5,
        pnlPct: 0.0436,
        holdingPeriodMs: 86400000
      }
    ],
    startTime: Date.now() - 86400000,
    endTime: Date.now(),
    duration: 86400000
  },
  {
    id: 'backtest_002',
    config: {
      id: 'backtest_002',
      strategy: 'Momentum (20-period SMA breakout)',
      symbols: ['SPY', 'QQQ', 'IWM'],
      startDate: '2023-06-01',
      endDate: '2024-06-01',
      initialCapital: 250000,
      fees: { perShare: 0.003, perTrade: 2.0, platformFee: 0.0005, ecnRebate: 0.001 },
      slippage: { type: 'fixed', fixedBps: 3, volMultiplier: 0.5, impactCoeff: 0.005 },
      latencyMs: 75,
      partialFills: false,
      sessionBoundaries: true,
      marketHalts: true,
      survivorshipBias: 'sp500_current',
      walkForward: null
    },
    metrics: {
      totalReturn: 0.18,
      annualizedReturn: 0.18,
      sharpe: 1.32,
      sortino: 1.56,
      maxDrawdown: 0.145,
      profitFactor: 1.82,
      winRate: 0.52,
      expectancy: 820,
      trades: 92,
      avgHoldingPeriod: 8.1 * 24 * 3600 * 1000
    },
    assumptions: [
      'Initial capital: 250000',
      'Symbols: SPY, QQQ, IWM',
      'Latency: 75ms',
      'Slippage model: fixed',
      'Partial fills: false',
      'Session boundaries enforced: true',
      'Market halts simulated: true',
      'Survivorship bias control: sp500_current'
    ],
    warnings: [
      'Strategy uses current S&P 500 constituents. Historical data includes symbols that may have been delisted. Results may overstate historical returns.'
    ],
    equityCurve: [
      { date: '2023-06-01', equity: 250000, drawdown: 0 },
      { date: '2023-12-01', equity: 280000, drawdown: 0.03 },
      { date: '2024-06-01', equity: 295000, drawdown: 0.02 }
    ],
    benchmark: { buyHold: 0.22, randomBaseline: 0.01, riskFree: 0.052, alpha: -0.04 },
    trades: [
      {
        id: 'trade_002',
        symbol: 'SPY',
        side: 'long',
        entryPrice: 425.50,
        exitPrice: 437.25,
        entryTime: 1685620800000,
        exitTime: 1685707200000,
        quantity: 30,
        fees: 38.2,
        slippage: 8.5,
        pnl: 341.3,
        pnlPct: 0.0276,
        holdingPeriodMs: 86400000
      }
    ],
    startTime: Date.now() - 172800000,
    endTime: Date.now(),
    duration: 172800000
  },
  {
    id: 'backtest_003',
    config: {
      id: 'backtest_003',
      strategy: 'Machine Learning Ensemble (RNN + XGBoost)',
      symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
      startDate: '2022-01-01',
      endDate: '2024-01-01',
      initialCapital: 500000,
      fees: { perShare: 0.001, perTrade: 5.0, platformFee: 0.002, ecnRebate: 0 },
      slippage: { type: 'realistic', fixedBps: 5, volMultiplier: 1.2, impactCoeff: 0.02 },
      latencyMs: 100,
      partialFills: true,
      sessionBoundaries: false,
      marketHalts: false,
      survivorshipBias: 'none',
      walkForward: { inSamplePct: 0.7, outSamplePct: 0.3, windows: 5, anchoredStart: true, minWindowDays: 30 }
    },
    metrics: {
      totalReturn: 0.52,
      annualizedReturn: 0.22,
      sharpe: 1.68,
      sortino: 2.05,
      maxDrawdown: 0.22,
      profitFactor: 2.78,
      winRate: 0.61,
      expectancy: 2840,
      trades: 287,
      avgHoldingPeriod: 2.8 * 24 * 3600 * 1000
    },
    assumptions: [
      'Initial capital: 500000',
      'Symbols: BTC/USD, ETH/USD, SOL/USD',
      'Latency: 100ms',
      'Slippage model: realistic',
      'Partial fills: true',
      'Session boundaries enforced: false',
      'Market halts simulated: false',
      'Survivorship bias control: none'
    ],
    warnings: [],
    equityCurve: [
      { date: '2022-01-01', equity: 500000, drawdown: 0 },
      { date: '2022-12-31', equity: 598500, drawdown: 0.08 },
      { date: '2024-01-01', equity: 760000, drawdown: 0.05 }
    ],
    benchmark: { buyHold: 0.35, randomBaseline: 0.01, riskFree: 0.045, alpha: 0.17 },
    trades: [
      {
        id: 'trade_003a',
        symbol: 'BTC/USD',
        side: 'long',
        entryPrice: 35800,
        exitPrice: 38250,
        entryTime: 1640995200000,
        exitTime: 1641081600000,
        quantity: 2,
        fees: 72.5,
        slippage: 145.8,
        pnl: 4637.2,
        pnlPct: 0.0679,
        holdingPeriodMs: 86400000
      },
      {
        id: 'trade_003b',
        symbol: 'ETH/USD',
        side: 'long',
        entryPrice: 2280,
        exitPrice: 2395,
        entryTime: 1641081600000,
        exitTime: 1641254400000,
        quantity: 15,
        fees: 86.3,
        slippage: 89.2,
        pnl: 1639.7,
        pnlPct: 0.0505,
        holdingPeriodMs: 172800000
      }
    ],
    startTime: Date.now() - 259200000,
    endTime: Date.now(),
    duration: 259200000
  }
];
