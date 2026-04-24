/**
 * MCP Backtest API Routes
 *
 * Endpoints for running MCP backtests on REAL historical data:
 *   - POST /mcp-backtest/run - Run a complete MCP backtest
 *   - GET /mcp-backtest/compare/:runId - Get detailed comparison for a backtest run
 *   - GET /mcp-backtest/signal-log/:runId - Get paginated signal decision log
 *   - GET /mcp-backtest/history - List all past backtest runs with summaries
 *
 * Signals are detected by pattern recognition on real Alpaca historical bars
 * (breakouts, pullbacks, reversals, squeezes). Crypto data is free (no API key needed).
 */

import { Router, type Request, type Response } from "express";
import { MCPBacktester, type MCPBacktestConfig, type MCPBacktestResult } from "../lib/tradingview_mcp/backtest_bridge.js";
import { MCPPipelineConfigSchema, type MCPPipelineConfig } from "../lib/tradingview_mcp/types.js";
import type { ReplayBar } from "../lib/backtesting/replay_engine.js";

const router = Router();

// In-memory storage for completed backtest runs
const backtestRuns = new Map<
  string,
  {
    runId: string;
    symbol: string;
    timeframe: string;
    startDate: Date;
    endDate: Date;
    signalType: string;
    initialCapital: number;
    result: MCPBacktestResult;
    createdAt: Date;
  }
>();

// Generate unique run ID
function generateRunId(): string {
  return `backtest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Fetch REAL historical bars from Alpaca for backtesting.
 * Crypto data is FREE (no API key needed). Stock data needs Alpaca keys.
 */
async function fetchRealBarsForBacktest(
  symbol: string,
  startDate: Date,
  endDate: Date,
  timeframeStr: string,
): Promise<ReplayBar[]> {
  const { getBars } = await import("../lib/alpaca.js");

  const tfMap: Record<string, string> = {
    "1m": "1Min", "5m": "5Min", "15m": "15Min",
    "1h": "1Hour", "4h": "1Hour", "1d": "1Day",
  };
  const alpacaTf = tfMap[timeframeStr] || "1Day";

  // Calculate bar count from date range
  const msPerBar: Record<string, number> = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000,
    "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
  };
  const rangeMs = endDate.getTime() - startDate.getTime();
  const estimatedBars = Math.min(Math.ceil(rangeMs / (msPerBar[timeframeStr] || 86_400_000)), 10000);

  const raw = await getBars(symbol, alpacaTf as any, estimatedBars, startDate.toISOString());
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    throw new Error(`No real bars available for ${symbol} (${timeframeStr}) from Alpaca`);
  }

  const bars: ReplayBar[] = raw
    .filter((b: any) => {
      const ts = new Date(b.t ?? b.Timestamp ?? "");
      return ts >= startDate && ts <= endDate;
    })
    .map((b: any) => ({
      symbol,
      timeframe: timeframeStr,
      ts: new Date(b.t ?? b.Timestamp ?? ""),
      open: Number(b.o ?? b.Open ?? 0),
      high: Number(b.h ?? b.High ?? 0),
      low: Number(b.l ?? b.Low ?? 0),
      close: Number(b.c ?? b.Close ?? 0),
      volume: Number(b.v ?? b.Volume ?? 0),
      vwap: Number(b.vw ?? b.VWAP ?? 0),
    }));

  // Aggregate for 4h if needed
  if (timeframeStr === "4h") {
    const aggregated: ReplayBar[] = [];
    for (let i = 0; i < bars.length; i += 4) {
      const chunk = bars.slice(i, i + 4);
      if (chunk.length === 0) continue;
      aggregated.push({
        symbol,
        timeframe: timeframeStr,
        ts: chunk[0]!.ts,
        open: chunk[0]!.open,
        high: Math.max(...chunk.map(b => b.high)),
        low: Math.min(...chunk.map(b => b.low)),
        close: chunk[chunk.length - 1]!.close,
        volume: chunk.reduce((s, b) => s + b.volume, 0),
        vwap: chunk.reduce((s, b) => s + b.vwap, 0) / chunk.length,
      });
    }
    return aggregated;
  }

  return bars;
}

/**
 * Detect patterns in REAL historical bars to generate backtest signals.
 * Includes: breakouts, pullbacks, reversals, squeeze patterns.
 */
function detectPatternSignals(
  bars: ReplayBar[],
  signalType: string
): {
  barIndex: number;
  symbol: string;
  direction: "long" | "short";
  signalType: string;
  timeframe: string;
  stopLoss?: number;
  takeProfit?: number;
  strategyName?: string;
}[] {
  const signals: Array<{
    barIndex: number;
    symbol: string;
    direction: "long" | "short";
    signalType: string;
    timeframe: string;
    stopLoss?: number;
    takeProfit?: number;
    strategyName?: string;
  }> = [];

  const symbol = bars[0].symbol;
  const timeframe = bars[0].timeframe;

  for (let i = 20; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar = bars[i - 1];

    // Simple pattern detection based on requested signal type
    switch (signalType) {
      case "breakout": {
        // Detect breakout above N-bar high
        const nBars = 20;
        const recentBars = bars.slice(Math.max(0, i - nBars), i);
        const high = Math.max(...recentBars.map((b) => b.high));
        if (bar.close > high * 1.001 && bar.close > bar.open) {
          signals.push({
            barIndex: i,
            symbol,
            direction: "long",
            signalType: "breakout",
            timeframe,
            stopLoss: bar.low * 0.97,
            takeProfit: bar.close * 1.06,
            strategyName: "pattern_breakout",
          });
        }
        break;
      }

      case "breakdown": {
        // Detect breakdown below N-bar low
        const nBars = 20;
        const recentBars = bars.slice(Math.max(0, i - nBars), i);
        const low = Math.min(...recentBars.map((b) => b.low));
        if (bar.close < low * 0.999 && bar.close < bar.open) {
          signals.push({
            barIndex: i,
            symbol,
            direction: "short",
            signalType: "breakdown",
            timeframe,
            stopLoss: bar.high * 1.03,
            takeProfit: bar.close * 0.94,
            strategyName: "pattern_breakdown",
          });
        }
        break;
      }

      case "pullback_long": {
        // Detect pullback to moving average in uptrend
        const maPeriod = 20;
        if (i >= maPeriod) {
          const recentBars = bars.slice(i - maPeriod, i);
          const ma = recentBars.reduce((sum, b) => sum + b.close, 0) / maPeriod;

          // Uptrend: price above MA
          const above = recentBars.filter((b) => b.close > ma).length > maPeriod * 0.7;
          // Pullback: bar closes near/below MA after uptrend
          if (above && bar.close <= ma * 1.002 && bar.close > ma * 0.99 && bar.close > bar.open) {
            signals.push({
              barIndex: i,
              symbol,
              direction: "long",
              signalType: "pullback_long",
              timeframe,
              stopLoss: bar.low * 0.97,
              takeProfit: bar.close * 1.05,
              strategyName: "pattern_pullback",
            });
          }
        }
        break;
      }

      case "pullback_short": {
        // Detect pullback to moving average in downtrend
        const maPeriod = 20;
        if (i >= maPeriod) {
          const recentBars = bars.slice(i - maPeriod, i);
          const ma = recentBars.reduce((sum, b) => sum + b.close, 0) / maPeriod;

          // Downtrend: price below MA
          const below = recentBars.filter((b) => b.close < ma).length > maPeriod * 0.7;
          // Pullback: bar closes near/above MA after downtrend
          if (below && bar.close >= ma * 0.998 && bar.close < ma * 1.01 && bar.close < bar.open) {
            signals.push({
              barIndex: i,
              symbol,
              direction: "short",
              signalType: "pullback_short",
              timeframe,
              stopLoss: bar.high * 1.03,
              takeProfit: bar.close * 0.95,
              strategyName: "pattern_pullback",
            });
          }
        }
        break;
      }

      case "reversal_long": {
        // Detect reversal from downtrend: lower low followed by higher close
        if (i >= 5) {
          const downtrend = bars
            .slice(i - 5, i)
            .slice(0, -1)
            .every((b, idx, arr) => idx === 0 || b.low <= arr[idx - 1].low);
          if (downtrend && bar.close > prevBar.close && bar.close > bar.open) {
            signals.push({
              barIndex: i,
              symbol,
              direction: "long",
              signalType: "reversal_long",
              timeframe,
              stopLoss: bar.low * 0.96,
              takeProfit: bar.close * 1.08,
              strategyName: "pattern_reversal",
            });
          }
        }
        break;
      }

      case "reversal_short": {
        // Detect reversal from uptrend: higher high followed by lower close
        if (i >= 5) {
          const uptrend = bars
            .slice(i - 5, i)
            .slice(0, -1)
            .every((b, idx, arr) => idx === 0 || b.high >= arr[idx - 1].high);
          if (uptrend && bar.close < prevBar.close && bar.close < bar.open) {
            signals.push({
              barIndex: i,
              symbol,
              direction: "short",
              signalType: "reversal_short",
              timeframe,
              stopLoss: bar.high * 1.04,
              takeProfit: bar.close * 0.92,
              strategyName: "pattern_reversal",
            });
          }
        }
        break;
      }

      case "squeeze_fire": {
        // Detect squeeze: low volatility followed by breakout
        const sqPeriod = 15;
        if (i >= sqPeriod) {
          const rangeHistory = bars.slice(i - sqPeriod, i).map((b) => b.high - b.low);
          const avgRange = rangeHistory.reduce((a, b) => a + b, 0) / rangeHistory.length;
          const squeezed = rangeHistory[rangeHistory.length - 1] < avgRange * 0.4;
          const breakout = bar.high - bar.low > avgRange * 1.5;

          if (squeezed && breakout) {
            const direction = bar.close > prevBar.close ? "long" : "short";
            signals.push({
              barIndex: i,
              symbol,
              direction,
              signalType: "squeeze_fire",
              timeframe,
              stopLoss: direction === "long" ? bar.low * 0.96 : bar.high * 1.04,
              takeProfit: direction === "long" ? bar.close * 1.08 : bar.close * 0.92,
              strategyName: "pattern_squeeze",
            });
          }
        }
        break;
      }

      default: {
        // Generic pattern: any significant move
        const priceChange = Math.abs((bar.close - prevBar.close) / prevBar.close);
        if (priceChange > 0.015) {
          // 1.5% move
          const direction = bar.close > prevBar.close ? "long" : "short";
          signals.push({
            barIndex: i,
            symbol,
            direction,
            signalType: "generic_move",
            timeframe,
            stopLoss: direction === "long" ? bar.low * 0.97 : bar.high * 1.03,
            takeProfit: direction === "long" ? bar.close * 1.06 : bar.close * 0.94,
            strategyName: "pattern_generic",
          });
        }
      }
    }
  }

  return signals;
}

// ── POST /mcp-backtest/run ──────────────────────────────────────────────────────
/**
 * Run an MCP backtest on historical data with synthetic signals
 *
 * Body parameters:
 *   symbol: string (e.g., "SPY")
 *   timeframe: string (e.g., "1h", "1d")
 *   startDate: string (ISO date)
 *   endDate: string (ISO date)
 *   signalType: string (breakout, breakdown, pullback_long, pullback_short, reversal_long, reversal_short, squeeze_fire)
 *   pipelineConfig?: MCPPipelineConfig (optional, uses defaults if not provided)
 *   initialCapital?: number (default: 10000)
 *   runBaseline?: boolean (default: true)
 */
router.post("/mcp-backtest/run", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      symbol,
      timeframe,
      startDate,
      endDate,
      signalType,
      pipelineConfig,
      initialCapital = 10000,
      runBaseline = true,
    } = req.body;

    // Validate inputs
    if (!symbol || typeof symbol !== "string") {
      res.status(400).json({ error: "Missing or invalid symbol" });
      return;
    }

    if (!timeframe || typeof timeframe !== "string") {
      res.status(400).json({ error: "Missing or invalid timeframe" });
      return;
    }

    if (!startDate || !endDate) {
      res.status(400).json({ error: "Missing startDate or endDate" });
      return;
    }

    if (!signalType || typeof signalType !== "string") {
      res.status(400).json({ error: "Missing or invalid signalType" });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({ error: "Invalid date format" });
      return;
    }

    if (start >= end) {
      res.status(400).json({ error: "startDate must be before endDate" });
      return;
    }

    // Use provided pipeline config or create default
    let config: MCPPipelineConfig = {
      enableEnrichment: true,
      enableScoring: true,
      enableDecision: true,
      scoringWeights: {
        confirmationScore: 0.4,
        regimeScore: 0.2,
        recallScore: 0.2,
        microstructureScore: 0.2,
      },
      decisionThresholds: {
        approvalThreshold: 0.6,
        modificationThreshold: 0.5,
        rejectionThreshold: 0.4,
      },
      riskLimits: {
        maxPositionSize: 100,
        maxDrawdown: 0.3,
        maxRiskPerTrade: 0.02,
      },
    };

    if (pipelineConfig) {
      config = { ...config, ...pipelineConfig };
    }

    // Fetch REAL historical bars from Alpaca
    let bars: ReplayBar[];
    try {
      bars = await fetchRealBarsForBacktest(symbol, start, end, timeframe);
    } catch (fetchErr: any) {
      res.status(503).json({
        error: "Failed to fetch real market data for backtest",
        detail: fetchErr?.message,
        suggestion: "Ensure Alpaca API keys are set for stock symbols, or use crypto symbols (BTC/USD, ETH/USD) which are free",
      });
      return;
    }

    if (bars.length < 20) {
      res.status(400).json({
        error: "Insufficient data: need at least 20 bars",
        barsGenerated: bars.length,
      });
      return;
    }

    // Detect patterns in real historical bars
    const signals = detectPatternSignals(bars, signalType);

    if (signals.length === 0) {
      res.status(400).json({
        error: "No signals generated for the given pattern and date range",
        suggestion: "Try a different date range or signal type",
      });
      return;
    }

    // Run backtest
    const backtestConfig: MCPBacktestConfig = {
      bars,
      signals,
      initialCapital,
      pipelineConfig: config,
      runBaseline,
    };

    const backtest = new MCPBacktester(backtestConfig);
    const result = await backtest.run();

    // Store result
    const runId = generateRunId();
    backtestRuns.set(runId, {
      runId,
      symbol,
      timeframe,
      startDate: start,
      endDate: end,
      signalType,
      initialCapital,
      result,
      createdAt: new Date(),
    });

    res.json({
      success: true,
      runId,
      summary: {
        symbol,
        timeframe,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
        signalType,
        initialCapital,
        barsProcessed: bars.length,
        signalsGenerated: signals.length,
        mcpApprovalRate: result.approvalRate,
        mcpMetrics: {
          totalTrades: result.mcpMetrics.totalTrades,
          winRate: result.mcpMetrics.winRate,
          sharpeRatio: result.mcpMetrics.sharpeRatio,
          profitFactor: result.mcpMetrics.profitFactor,
          totalPnl: result.mcpMetrics.totalPnl,
        },
        baselineMetrics: result.baselineMetrics
          ? {
              totalTrades: result.baselineMetrics.totalTrades,
              winRate: result.baselineMetrics.winRate,
              sharpeRatio: result.baselineMetrics.sharpeRatio,
              profitFactor: result.baselineMetrics.profitFactor,
              totalPnl: result.baselineMetrics.totalPnl,
            }
          : null,
        comparison: result.comparison,
      },
    });
  } catch (err) {
    (req as any).log?.error?.({ err }, "MCP backtest failed");
    res.status(503).json({
      error: "backtest_failed",
      message: String(err instanceof Error ? err.message : err),
    });
  }
});

// ── GET /mcp-backtest/compare/:runId ───────────────────────────────────────────
/**
 * Get detailed comparison for a completed backtest run
 * Returns the full MCPComparison object with baseline vs MCP metrics
 */
router.get("/mcp-backtest/compare/:runId", (req: Request, res: Response): void => {
  try {
    const { runId } = req.params;

    const run = backtestRuns.get(runId);
    if (!run) {
      res.status(404).json({ error: "Backtest run not found", runId });
      return;
    }

    const { result } = run;

    if (!result.comparison) {
      res.status(400).json({
        error: "No baseline comparison available",
        message: "This backtest was run without baseline (runBaseline=false)",
      });
      return;
    }

    res.json({
      success: true,
      runId,
      comparison: result.comparison,
      detailed: {
        baseline: {
          totalTrades: result.baselineMetrics?.totalTrades ?? 0,
          winRate: result.baselineMetrics?.winRate ?? 0,
          sharpeRatio: result.baselineMetrics?.sharpeRatio ?? 0,
          profitFactor: result.baselineMetrics?.profitFactor ?? 0,
          totalPnl: result.baselineMetrics?.totalPnl ?? 0,
          avgWin: result.baselineMetrics?.avgWin ?? 0,
          avgLoss: result.baselineMetrics?.avgLoss ?? 0,
          maxDrawdown: result.baselineMetrics?.maxDrawdown ?? 0,
        },
        mcp: {
          totalTrades: result.mcpMetrics.totalTrades,
          winRate: result.mcpMetrics.winRate,
          sharpeRatio: result.mcpMetrics.sharpeRatio,
          profitFactor: result.mcpMetrics.profitFactor,
          totalPnl: result.mcpMetrics.totalPnl,
          avgWin: result.mcpMetrics.avgWin,
          avgLoss: result.mcpMetrics.avgLoss,
          maxDrawdown: result.mcpMetrics.maxDrawdown,
        },
        improvements: {
          winRateImprovement: result.comparison.winRateImprovement,
          sharpeImprovement: result.comparison.sharpeImprovement,
          profitFactorImprovement: result.comparison.profitFactorImprovement,
          pnlImprovement: result.comparison.pnlImprovement,
          tradesFiltered: result.comparison.tradesFiltered,
          tradesFilteredPct: result.comparison.tradesFilteredPct,
          mcpAddedValue: result.comparison.mcpAddedValue,
        },
      },
    });
  } catch (err) {
    (req as any).log?.error?.({ err }, "Compare retrieval failed");
    res.status(503).json({
      error: "compare_failed",
      message: String(err instanceof Error ? err.message : err),
    });
  }
});

// ── GET /mcp-backtest/signal-log/:runId ────────────────────────────────────────
/**
 * Get paginated signal decision log for a backtest run
 *
 * Query parameters:
 *   limit: number (default: 100, max: 1000)
 *   offset: number (default: 0)
 */
router.get("/mcp-backtest/signal-log/:runId", (req: Request, res: Response): void => {
  try {
    const { runId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;

    const run = backtestRuns.get(runId);
    if (!run) {
      res.status(404).json({ error: "Backtest run not found", runId });
      return;
    }

    const { signalLog } = run.result;

    if (offset >= signalLog.length) {
      res.json({
        success: true,
        runId,
        pagination: {
          offset,
          limit,
          total: signalLog.length,
          hasMore: false,
        },
        signalLog: [],
      });
      return;
    }

    const paginated = signalLog.slice(offset, offset + limit);

    res.json({
      success: true,
      runId,
      pagination: {
        offset,
        limit,
        total: signalLog.length,
        hasMore: offset + limit < signalLog.length,
      },
      signalLog: paginated.map((entry) => ({
        barIndex: entry.barIndex,
        signal: {
          symbol: entry.signal.symbol,
          direction: entry.signal.direction,
          signalType: entry.signal.signalType,
          timeframe: entry.signal.timeframe,
          price: entry.signal.price,
          timestamp: entry.signal.timestamp.toISOString(),
        },
        decision: {
          action: entry.decision.action,
          confidence: entry.decision.confidence,
          reason: entry.decision.reason,
          positionSize: entry.decision.positionSize,
          stopLoss: entry.decision.stopLoss,
          takeProfit: entry.decision.takeProfit,
          regime: entry.decision.enrichment?.regime,
        },
        tradeOutcome: entry.tradeOutcome
          ? {
              pnl: entry.tradeOutcome.pnl,
              pnlPercent: entry.tradeOutcome.pnlPercent,
              holdBars: entry.tradeOutcome.holdBars,
              mae: entry.tradeOutcome.mae,
              mfe: entry.tradeOutcome.mfe,
            }
          : null,
      })),
    });
  } catch (err) {
    (req as any).log?.error?.({ err }, "Signal log retrieval failed");
    res.status(503).json({
      error: "signal_log_failed",
      message: String(err instanceof Error ? err.message : err),
    });
  }
});

// ── GET /mcp-backtest/history ──────────────────────────────────────────────────
/**
 * List all past backtest runs with summaries
 * Returns array of recent runs in reverse chronological order
 */
router.get("/mcp-backtest/history", (req: Request, res: Response): void => {
  try {
    const runs = Array.from(backtestRuns.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((run) => ({
        runId: run.runId,
        symbol: run.symbol,
        timeframe: run.timeframe,
        signalType: run.signalType,
        initialCapital: run.initialCapital,
        dateRange: {
          start: run.startDate.toISOString(),
          end: run.endDate.toISOString(),
        },
        createdAt: run.createdAt.toISOString(),
        summary: {
          signalsGenerated: run.result.totalSignals,
          signalsApproved: run.result.approvedSignals,
          signalsRejected: run.result.rejectedSignals,
          approvalRate: run.result.approvalRate,
          mcpMetrics: {
            totalTrades: run.result.mcpMetrics.totalTrades,
            winRate: run.result.mcpMetrics.winRate,
            sharpeRatio: run.result.mcpMetrics.sharpeRatio,
            totalPnl: run.result.mcpMetrics.totalPnl,
          },
          comparisonSummary: run.result.comparison?.summary || null,
        },
      }));

    res.json({
      success: true,
      count: runs.length,
      runs,
    });
  } catch (err) {
    (req as any).log?.error?.({ err }, "History retrieval failed");
    res.status(503).json({
      error: "history_failed",
      message: String(err instanceof Error ? err.message : err),
    });
  }
});

export default router;
