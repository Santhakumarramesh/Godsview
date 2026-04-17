/**
 * Phase 97 — Backtest Bridge
 *
 * Connects TradingView signals to the Phase 94 backtesting engine.
 * Replays historical TV signals through the MCP pipeline and measures
 * how much the intelligence layer improves raw signal performance.
 */
import { ReplayEngine, type ReplayBar, type ReplayOrder, type ReplayState } from "../backtesting/replay_engine.js";
import { calculateMetrics, type BacktestMetrics } from "../backtesting/metrics_calculator.js";
import { MCPProcessor, type DataProvider, type MemoryProvider } from "./mcp_processor.js";
import { SignalIngestion } from "./signal_ingestion.js";
import type { StandardSignal, MCPDecision, MCPPipelineConfig } from "./types.js";

export interface MCPBacktestConfig {
  /** Bars for the replay engine */
  bars: ReplayBar[];
  /** Signals to replay (pre-generated from TV or synthetic) */
  signals: {
    barIndex: number; // which bar this signal fires at
    symbol: string;
    direction: "long" | "short";
    signalType: string;
    timeframe: string;
    stopLoss?: number;
    takeProfit?: number;
    strategyName?: string;
  }[];
  /** Initial capital */
  initialCapital: number;
  /** MCP pipeline configuration */
  pipelineConfig: MCPPipelineConfig;
  /** Run a baseline (no MCP filtering) for comparison */
  runBaseline: boolean;
}

export interface MCPBacktestResult {
  /** Metrics with MCP filtering */
  mcpMetrics: BacktestMetrics;
  /** Metrics without MCP (raw signals, if runBaseline=true) */
  baselineMetrics: BacktestMetrics | null;
  /** Per-signal decision log */
  signalLog: SignalLogEntry[];
  /** Summary comparison */
  comparison: MCPComparison | null;
  /** Total signals processed */
  totalSignals: number;
  approvedSignals: number;
  rejectedSignals: number;
  /** Approval rate */
  approvalRate: number;
  /** Average scores */
  avgConfirmationScore: number;
  avgOverallScore: number;
}

export interface SignalLogEntry {
  barIndex: number;
  signal: StandardSignal;
  decision: MCPDecision;
  tradeOutcome: {
    pnl: number;
    pnlPercent: number;
    holdBars: number;
    mae: number;
    mfe: number;
  } | null;
}

export interface MCPComparison {
  // Raw signal performance
  baselineTotalTrades: number;
  baselineWinRate: number;
  baselineSharpe: number;
  baselineProfitFactor: number;
  baselineTotalPnl: number;
  // MCP-filtered performance
  mcpTotalTrades: number;
  mcpWinRate: number;
  mcpSharpe: number;
  mcpProfitFactor: number;
  mcpTotalPnl: number;
  // Improvements
  winRateImprovement: number;
  sharpeImprovement: number;
  profitFactorImprovement: number;
  pnlImprovement: number;
  tradesFiltered: number;
  tradesFilteredPct: number;
  /** Did MCP improve results? */
  mcpAddedValue: boolean;
  summary: string;
}

/** In-backtest data provider that reads from replay bars */
class BacktestDataProvider implements DataProvider {
  private currentBar: ReplayBar | null = null;
  private recentBars: ReplayBar[] = [];

  updateBar(bar: ReplayBar, history: ReplayBar[]): void {
    this.currentBar = bar;
    this.recentBars = history.slice(-50);
  }

  getOrderBook(_symbol: string) {
    if (!this.currentBar) return null;
    // Synthetic order book from bar data
    const spread = this.currentBar.high - this.currentBar.low;
    const midpoint = (this.currentBar.high + this.currentBar.low) / 2;
    return {
      midpoint,
      spread: spread * 0.1,
      spreadBps: midpoint > 0 ? (spread * 0.1 / midpoint) * 10000 : 0,
      imbalanceRatio: this.currentBar.close > this.currentBar.open ? 0.2 : -0.2,
      microPressure: this.currentBar.close > this.currentBar.open ? 0.3 : -0.3,
      bidDepth: this.currentBar.volume * 0.4,
      askDepth: this.currentBar.volume * 0.4,
    };
  }

  getVolumeDelta(_symbol: string) {
    if (!this.currentBar) return null;
    const isBullish = this.currentBar.close > this.currentBar.open;
    const delta = isBullish ? this.currentBar.volume * 0.3 : -this.currentBar.volume * 0.3;
    return {
      delta,
      cumulativeDelta: delta,
      deltaPercent: isBullish ? 30 : -30,
      aggressiveBuyPct: isBullish ? 0.6 : 0.4,
      aggressiveSellPct: isBullish ? 0.4 : 0.6,
    };
  }

  getMacro() {
    return { vix: 18, dxy: null, us10y: null, spyChange: 0.5 };
  }

  getSentiment(_symbol: string) {
    return { newsScore: 0, socialScore: 0, overallSentiment: "neutral" as const };
  }

  getRegime(): "risk_on" | "risk_off" | "neutral" | "high_vol" | "low_vol" {
    if (this.recentBars.length < 10) return "neutral";
    // Simple regime detection from recent volatility
    const returns = this.recentBars.slice(-20).map((b, i, arr) =>
      i > 0 ? Math.abs((b.close - arr[i - 1].close) / arr[i - 1].close) : 0
    );
    const avgVol = returns.reduce((a, b) => a + b, 0) / returns.length;
    if (avgVol > 0.02) return "high_vol";
    if (avgVol < 0.005) return "low_vol";
    const trend = this.recentBars[this.recentBars.length - 1].close - this.recentBars[0].close;
    return trend > 0 ? "risk_on" : "risk_off";
  }

  getSession() {
    return "open" as const;
  }

  getDataQuality(_symbol: string) {
    return { sourcesActive: 3, sourcesTotal: 5, overallScore: 0.6 };
  }
}

class BacktestMemoryProvider implements MemoryProvider {
  private outcomes: { signalType: string; regime: string; win: boolean }[] = [];

  recordOutcome(signalType: string, regime: string, win: boolean): void {
    this.outcomes.push({ signalType, regime, win });
  }

  recallSimilarSetups(_symbol: string, signalType: string, regime: string) {
    const similar = this.outcomes.filter(
      (o) => o.signalType === signalType && o.regime === regime
    );
    if (similar.length < 3) {
      return { winRate: null, profitFactor: null, sampleSize: similar.length, lastOutcome: null, avgHoldBars: null };
    }
    const wins = similar.filter((o) => o.win).length;
    return {
      winRate: wins / similar.length,
      profitFactor: null,
      sampleSize: similar.length,
      lastOutcome: similar[similar.length - 1].win ? "win" as const : "loss" as const,
      avgHoldBars: null,
    };
  }
}

/**
 * MCPBacktester — runs TradingView signals through MCP pipeline
 * on historical data, then compares filtered vs unfiltered results.
 */
export class MCPBacktester {
  private config: MCPBacktestConfig;

  constructor(config: MCPBacktestConfig) {
    this.config = config;
  }

  /** Run the full MCP backtest */
  async run(): Promise<MCPBacktestResult> {
    const signalLog: SignalLogEntry[] = [];
    const ingestion = new SignalIngestion(this.config.pipelineConfig);
    const processor = new MCPProcessor(this.config.pipelineConfig);
    const dataProvider = new BacktestDataProvider();
    const memoryProvider = new BacktestMemoryProvider();

    processor.setDataProvider(dataProvider);
    processor.setMemoryProvider(memoryProvider);

    // Index signals by bar
    const signalsByBar = new Map<number, typeof this.config.signals[number][]>();
    for (const sig of this.config.signals) {
      const existing = signalsByBar.get(sig.barIndex) ?? [];
      existing.push(sig);
      signalsByBar.set(sig.barIndex, existing);
    }

    // ── MCP-filtered run ──
    const mcpEngine = new ReplayEngine({
      initialCapital: this.config.initialCapital,
      slippageModel: "percent",
      slippageValue: 0.01,
      maxPositions: 5,
    });
    mcpEngine.loadBars(this.config.bars);

    let orderIdCounter = 0;
    let totalScoreSum = 0;
    let confirmationScoreSum = 0;
    let approvedCount = 0;
    let rejectedCount = 0;

    mcpEngine.setStrategy((bar, engine) => {
      const barIdx = engine.getBarIndex();
      const history = engine.getBarsUpToNow(bar.symbol, bar.timeframe, 50);
      dataProvider.updateBar(bar, history);

      const barSignals = signalsByBar.get(barIdx);
      if (!barSignals) return null;

      for (const sig of barSignals) {
        const stdSignal = ingestion.ingestBacktest(
          sig.symbol, sig.direction, sig.signalType, sig.timeframe,
          bar.close, bar.ts, sig.stopLoss, sig.takeProfit, sig.strategyName,
        );

        // Run through MCP
        // Note: processSignal is async but we call it synchronously for backtest
        // In production, this would be awaited
        const enrichment = (processor as any).enrich(stdSignal);
        const score = (processor as any).score(stdSignal, enrichment);
        const decision = (processor as any).decide(stdSignal, enrichment, score);

        totalScoreSum += score.overallScore;
        confirmationScoreSum += score.confirmationScore;

        const logEntry: SignalLogEntry = {
          barIndex: barIdx,
          signal: stdSignal,
          decision,
          tradeOutcome: null,
        };
        signalLog.push(logEntry);

        if (decision.action === "approve" || decision.action === "modify") {
          approvedCount++;
          orderIdCounter++;

          const stop = decision.stopLoss ?? (sig.direction === "long"
            ? bar.close * 0.98
            : bar.close * 1.02);

          const target = decision.takeProfit ?? (sig.direction === "long"
            ? bar.close * 1.04
            : bar.close * 0.96);

          return {
            id: `mcp_order_${orderIdCounter}`,
            symbol: sig.symbol,
            direction: sig.direction,
            type: "market" as const,
            price: bar.close,
            quantity: decision.positionSize ?? 100,
            stopLoss: stop,
            takeProfit: target,
            placedAt: bar.ts,
            status: "pending" as const,
          };
        } else {
          rejectedCount++;
        }
      }
      return null;
    });

    const mcpState = mcpEngine.run();
    const mcpMetrics = calculateMetrics(mcpState);

    // Update memory with outcomes
    for (const pos of mcpState.closedPositions) {
      const matchedLog = signalLog.find((l) =>
        l.decision.action !== "reject" && l.signal.symbol === pos.symbol
      );
      if (matchedLog) {
        memoryProvider.recordOutcome(
          matchedLog.signal.signalType,
          matchedLog.decision.enrichment.regime,
          (pos.pnl ?? 0) > 0,
        );
        matchedLog.tradeOutcome = {
          pnl: pos.pnl ?? 0,
          pnlPercent: pos.pnlPercent ?? 0,
          holdBars: pos.holdBars,
          mae: pos.mae,
          mfe: pos.mfe,
        };
      }
    }

    // ── Baseline run (no MCP filtering) ──
    let baselineMetrics: BacktestMetrics | null = null;
    let comparison: MCPComparison | null = null;

    if (this.config.runBaseline) {
      const baseEngine = new ReplayEngine({
        initialCapital: this.config.initialCapital,
        slippageModel: "percent",
        slippageValue: 0.01,
        maxPositions: 5,
      });
      baseEngine.loadBars(this.config.bars);

      let baseOrderId = 0;
      baseEngine.setStrategy((bar, engine) => {
        const barIdx = engine.getBarIndex();
        const barSignals = signalsByBar.get(barIdx);
        if (!barSignals) return null;

        for (const sig of barSignals) {
          baseOrderId++;
          const stop = sig.stopLoss ?? (sig.direction === "long"
            ? bar.close * 0.98
            : bar.close * 1.02);

          const target = sig.takeProfit ?? (sig.direction === "long"
            ? bar.close * 1.04
            : bar.close * 0.96);

          return {
            id: `base_order_${baseOrderId}`,
            symbol: sig.symbol,
            direction: sig.direction,
            type: "market" as const,
            price: bar.close,
            quantity: 100,
            stopLoss: stop,
            takeProfit: target,
            placedAt: bar.ts,
            status: "pending" as const,
          };
        }
        return null;
      });

      const baseState = baseEngine.run();
      baselineMetrics = calculateMetrics(baseState);

      // Build comparison
      comparison = {
        baselineTotalTrades: baselineMetrics.totalTrades,
        baselineWinRate: baselineMetrics.winRate,
        baselineSharpe: baselineMetrics.sharpeRatio,
        baselineProfitFactor: baselineMetrics.profitFactor,
        baselineTotalPnl: baselineMetrics.totalPnl,
        mcpTotalTrades: mcpMetrics.totalTrades,
        mcpWinRate: mcpMetrics.winRate,
        mcpSharpe: mcpMetrics.sharpeRatio,
        mcpProfitFactor: mcpMetrics.profitFactor,
        mcpTotalPnl: mcpMetrics.totalPnl,
        winRateImprovement: mcpMetrics.winRate - baselineMetrics.winRate,
        sharpeImprovement: mcpMetrics.sharpeRatio - baselineMetrics.sharpeRatio,
        profitFactorImprovement: mcpMetrics.profitFactor - baselineMetrics.profitFactor,
        pnlImprovement: mcpMetrics.totalPnl - baselineMetrics.totalPnl,
        tradesFiltered: baselineMetrics.totalTrades - mcpMetrics.totalTrades,
        tradesFilteredPct: baselineMetrics.totalTrades > 0
          ? ((baselineMetrics.totalTrades - mcpMetrics.totalTrades) / baselineMetrics.totalTrades) * 100
          : 0,
        mcpAddedValue: mcpMetrics.sharpeRatio > baselineMetrics.sharpeRatio ||
          mcpMetrics.profitFactor > baselineMetrics.profitFactor,
        summary: "",
      };

      comparison.summary = this.buildComparisonSummary(comparison);
    }

    const totalSignals = approvedCount + rejectedCount;

    return {
      mcpMetrics,
      baselineMetrics,
      signalLog,
      comparison,
      totalSignals,
      approvedSignals: approvedCount,
      rejectedSignals: rejectedCount,
      approvalRate: totalSignals > 0 ? approvedCount / totalSignals : 0,
      avgConfirmationScore: totalSignals > 0 ? confirmationScoreSum / totalSignals : 0,
      avgOverallScore: totalSignals > 0 ? totalScoreSum / totalSignals : 0,
    };
  }

  private buildComparisonSummary(c: MCPComparison): string {
    const parts: string[] = [];

    parts.push(`Baseline: ${c.baselineTotalTrades} trades, ${(c.baselineWinRate * 100).toFixed(1)}% win rate, Sharpe ${c.baselineSharpe.toFixed(2)}`);
    parts.push(`MCP: ${c.mcpTotalTrades} trades, ${(c.mcpWinRate * 100).toFixed(1)}% win rate, Sharpe ${c.mcpSharpe.toFixed(2)}`);
    parts.push(`Filtered: ${c.tradesFiltered} trades (${c.tradesFilteredPct.toFixed(0)}%)`);

    if (c.mcpAddedValue) {
      parts.push(`Added value: Win rate ${c.winRateImprovement > 0 ? "+" : ""}${(c.winRateImprovement * 100).toFixed(1)}%, Sharpe ${c.sharpeImprovement > 0 ? "+" : ""}${c.sharpeImprovement.toFixed(2)}`);
    } else {
      parts.push(`No improvement — consider tuning pipeline config`);
    }

    return parts.join(" | ");
  }
}
