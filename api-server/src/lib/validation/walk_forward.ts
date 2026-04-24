/**
 * Walk-Forward Validation — tests strategy on rolling out-of-sample windows.
 *
 * Splits data into train/test windows and validates that strategy performance
 * holds on unseen data. This prevents overfitting.
 */
import type { CandleEvent } from "@workspace/common-types";
import { runReplay, gradeStrategy, type ReplayConfig, type ReplayResult, type ReplaySignal } from "./replay_engine";
import { logger } from "../logger";

export interface WalkForwardConfig {
  trainWindowBars: number;  // e.g. 500 bars for training
  testWindowBars: number;   // e.g. 100 bars for testing
  stepSize: number;         // how many bars to advance between windows
  minWindows: number;       // minimum windows required
}

export interface WalkForwardWindow {
  windowIndex: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainResult: ReplayResult;
  testResult: ReplayResult;
  oosDegrade: number;      // how much OOS degrades vs IS (0 = no degrade, 1 = total degrade)
}

export interface WalkForwardResult {
  symbol: string;
  windows: WalkForwardWindow[];
  avgInSampleWinRate: number;
  avgOutOfSampleWinRate: number;
  avgOOSDegrade: number;
  passesValidation: boolean;
  totalOOSTrades: number;
  combinedOOSPnl: number;
  combinedOOSSharpe: number;
  runAt: string;
}

/**
 * Run walk-forward validation.
 */
export async function runWalkForward(
  candles: CandleEvent[],
  signalFn: (visibleCandles: CandleEvent[], index: number) => ReplaySignal | null,
  replayConfig: ReplayConfig,
  wfConfig: WalkForwardConfig = {
    trainWindowBars: 500,
    testWindowBars: 100,
    stepSize: 100,
    minWindows: 3,
  },
): Promise<WalkForwardResult> {
  const totalBars = candles.length;
  const windowSize = wfConfig.trainWindowBars + wfConfig.testWindowBars;

  if (totalBars < windowSize + wfConfig.stepSize) {
    throw new Error(
      `Insufficient data for walk-forward: ${totalBars} bars, need ${windowSize + wfConfig.stepSize}+`,
    );
  }

  const windows: WalkForwardWindow[] = [];
  let windowIdx = 0;

  for (let start = 0; start + windowSize <= totalBars; start += wfConfig.stepSize) {
    const trainStart = start;
    const trainEnd = start + wfConfig.trainWindowBars;
    const testStart = trainEnd;
    const testEnd = Math.min(testStart + wfConfig.testWindowBars, totalBars);

    if (testEnd - testStart < 20) break; // need minimum test window

    const trainCandles = candles.slice(trainStart, trainEnd);
    const testCandles = candles.slice(testStart, testEnd);

    // Run replay on train window (in-sample)
    const trainResult = await runReplay(
      trainCandles,
      signalFn,
      { ...replayConfig, symbol: `${replayConfig.symbol}_IS_${windowIdx}` },
    );

    // Run replay on test window (out-of-sample)
    const testResult = await runReplay(
      testCandles,
      signalFn,
      { ...replayConfig, symbol: `${replayConfig.symbol}_OOS_${windowIdx}` },
    );

    // Calculate OOS degradation
    const oosDegrade = trainResult.winRate > 0
      ? Math.max(0, 1 - testResult.winRate / trainResult.winRate)
      : 0;

    windows.push({
      windowIndex: windowIdx,
      trainStart,
      trainEnd,
      testStart,
      testEnd,
      trainResult,
      testResult,
      oosDegrade,
    });

    windowIdx++;
  }

  if (windows.length < wfConfig.minWindows) {
    logger.warn({
      windows: windows.length,
      required: wfConfig.minWindows,
    }, "Insufficient walk-forward windows");
  }

  // Aggregate OOS metrics
  const avgISWinRate = windows.length > 0
    ? windows.reduce((sum, w) => sum + w.trainResult.winRate, 0) / windows.length
    : 0;
  const avgOOSWinRate = windows.length > 0
    ? windows.reduce((sum, w) => sum + w.testResult.winRate, 0) / windows.length
    : 0;
  const avgOOSDegrade = windows.length > 0
    ? windows.reduce((sum, w) => sum + w.oosDegrade, 0) / windows.length
    : 1;
  const totalOOSTrades = windows.reduce((sum, w) => sum + w.testResult.totalTrades, 0);
  const combinedOOSPnl = windows.reduce((sum, w) => sum + w.testResult.totalPnl, 0);

  // Combined OOS Sharpe
  const oosReturns = windows.flatMap(w => w.testResult.trades.map(t => t.pnlPct));
  const avgReturn = oosReturns.length > 0 ? oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length : 0;
  const variance = oosReturns.length > 0
    ? oosReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / oosReturns.length
    : 0;
  const combinedOOSSharpe = Math.sqrt(variance) > 0
    ? (avgReturn / Math.sqrt(variance)) * Math.sqrt(252)
    : 0;

  // Pass if: OOS win rate > 50%, degradation < 25%, sufficient trades
  const passesValidation =
    avgOOSWinRate >= 0.5 &&
    avgOOSDegrade < 0.25 &&
    totalOOSTrades >= 20 &&
    windows.length >= wfConfig.minWindows;

  const result: WalkForwardResult = {
    symbol: replayConfig.symbol,
    windows,
    avgInSampleWinRate: avgISWinRate,
    avgOutOfSampleWinRate: avgOOSWinRate,
    avgOOSDegrade: avgOOSDegrade,
    passesValidation,
    totalOOSTrades,
    combinedOOSPnl,
    combinedOOSSharpe,
    runAt: new Date().toISOString(),
  };

  logger.info({
    symbol: replayConfig.symbol,
    windows: windows.length,
    avgISWinRate: `${(avgISWinRate * 100).toFixed(1)}%`,
    avgOOSWinRate: `${(avgOOSWinRate * 100).toFixed(1)}%`,
    degrade: `${(avgOOSDegrade * 100).toFixed(1)}%`,
    passes: passesValidation,
  }, "Walk-forward complete");

  return result;
}
