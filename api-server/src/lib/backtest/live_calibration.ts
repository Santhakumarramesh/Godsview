/**
 * LiveCalibration - Calibrate backtest assumptions to match real execution
 * Compares backtest fills against live execution data to improve realism
 * and identify systematic discrepancies
 */

export interface FillData {
  timestamp: Date;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  expectedPrice: number;
  actualPrice: number;
  partial: boolean;
  partialQuantity?: number;
  rejected: boolean;
  latencyMs: number;
}

export interface CalibrationResult {
  fillRateAdjustment: number; // 0-1 multiplier
  slippageMultiplier: number;
  latencyAdder: number; // ms
  partialFillProbability: number; // 0-1
  rejectionRate: number; // 0-1
  overallRealism: number; // 0-1
  calibrationMetrics: {
    expectedFillRate: number;
    actualFillRate: number;
    expectedSlippage: number;
    actualSlippage: number;
    expectedLatency: number;
    actualLatency: number;
    partialFillRate: number;
    confusionMatrix?: {
      truePositive: number;
      trueNegative: number;
      falsePositive: number;
      falseNegative: number;
    };
  };
  confidence: number; // 0-1, based on sample size
  sampleSize: number;
  lastCalibrated: Date;
}

export interface AdjustedBacktestResult {
  originalTrades: number;
  adjustedTrades: number;
  adjustmentFactors: {
    fillRate: number;
    slippage: number;
    latency: number;
    partialFills: number;
    rejections: number;
  };
  adjustedMetrics: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
  originalMetrics: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
  };
  degradation: {
    returnDegradation: number;
    sharpeDegradation: number;
    ddDegradation: number;
    winRateDegradation: number;
  };
}

export interface CalibrationReport {
  summary: string;
  realismScore: number;
  fillRateGap: number;
  slippageGap: number;
  latencyGap: number;
  rejectionRateGap: number;
  recommendations: string[];
  dataQuality: {
    sampleSize: number;
    outlierCount: number;
    symbolCoverage: string[];
    timeRange: {
      startDate: Date;
      endDate: Date;
    };
  };
  calibrationHeatmap?: {
    symbol: string;
    fillRate: number;
    slippage: number;
    latency: number;
    rejectionRate: number;
  }[];
}

export class LiveCalibration {
  private calibrationCache: Map<string, CalibrationResult> = new Map();
  private minSampleSize: number = 50;

  /**
   * Calibrate backtest assumptions against live fills
   */
  public calibrate(
    backtestFills: FillData[],
    liveFills: FillData[]
  ): CalibrationResult {
    if (liveFills.length < this.minSampleSize) {
      return this.getDefaultCalibration(
        liveFills.length / this.minSampleSize
      );
    }

    const backtestMetrics = this.analyzeExecutionMetrics(backtestFills);
    const liveMetrics = this.analyzeExecutionMetrics(liveFills);

    const fillRateAdjustment = backtestMetrics.fillRate === 0
      ? 1.0
      : liveMetrics.fillRate / backtestMetrics.fillRate;

    const slippageMultiplier = backtestMetrics.avgSlippage === 0
      ? 1.0
      : liveMetrics.avgSlippage / backtestMetrics.avgSlippage;

    const latencyAdder = Math.max(0, liveMetrics.avgLatency - backtestMetrics.avgLatency);

    const rejectionRate = liveFills.filter((f) => f.rejected).length / liveFills.length;

    const overallRealism = this.calculateOverallRealism(
      fillRateAdjustment,
      slippageMultiplier,
      latencyAdder,
      rejectionRate
    );

    const calibrationResult: CalibrationResult = {
      fillRateAdjustment: Math.min(fillRateAdjustment, 1.0),
      slippageMultiplier,
      latencyAdder,
      partialFillProbability: this.calculatePartialFillProbability(liveFills),
      rejectionRate,
      overallRealism,
      calibrationMetrics: {
        expectedFillRate: backtestMetrics.fillRate,
        actualFillRate: liveMetrics.fillRate,
        expectedSlippage: backtestMetrics.avgSlippage,
        actualSlippage: liveMetrics.avgSlippage,
        expectedLatency: backtestMetrics.avgLatency,
        actualLatency: liveMetrics.avgLatency,
        partialFillRate: liveFills.filter((f) => f.partial).length / liveFills.length,
        confusionMatrix: this.buildConfusionMatrix(backtestFills, liveFills)
      },
      confidence: Math.min(liveFills.length / (this.minSampleSize * 5), 1.0),
      sampleSize: liveFills.length,
      lastCalibrated: new Date()
    };

    return calibrationResult;
  }

  /**
   * Analyze execution metrics from fills
   */
  private analyzeExecutionMetrics(fills: FillData[]): {
    fillRate: number;
    avgSlippage: number;
    avgLatency: number;
    rejectionRate: number;
  } {
    if (fills.length === 0) {
      return {
        fillRate: 0,
        avgSlippage: 0,
        avgLatency: 0,
        rejectionRate: 0
      };
    }

    const notRejected = fills.filter((f) => !f.rejected);
    const fillRate = notRejected.length / fills.length;

    const slippages = notRejected.map((f) =>
      Math.abs(f.actualPrice - f.expectedPrice)
    );
    const avgSlippage = slippages.length === 0
      ? 0
      : slippages.reduce((a, b) => a + b, 0) / slippages.length;

    const avgLatency = notRejected.length === 0
      ? 0
      : notRejected.reduce((sum, f) => sum + f.latencyMs, 0) / notRejected.length;

    const rejectionRate = fills.filter((f) => f.rejected).length / fills.length;

    return {
      fillRate,
      avgSlippage,
      avgLatency,
      rejectionRate
    };
  }

  /**
   * Compute adjustment factors for future backtests
   */
  public computeAdjustmentFactors(
    calibration: CalibrationResult
  ): {
    fillRate: number;
    slippage: number;
    latency: number;
    partialFills: number;
    rejections: number;
  } {
    return {
      fillRate: calibration.fillRateAdjustment,
      slippage: calibration.slippageMultiplier,
      latency: calibration.latencyAdder,
      partialFills: calibration.partialFillProbability,
      rejections: calibration.rejectionRate
    };
  }

  /**
   * Apply calibration corrections to backtest results
   */
  public adjustBacktestResults(
    originalMetrics: {
      totalReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      winRate: number;
      tradeCount: number;
    },
    calibration: CalibrationResult
  ): AdjustedBacktestResult {
    const adjustedTradeCount = Math.floor(
      originalMetrics.tradeCount * calibration.fillRateAdjustment *
        (1 - calibration.rejectionRate)
    );

    const returnDegradation = 1 - (calibration.slippageMultiplier * 0.1 +
      calibration.rejectionRate * 0.3);
    const adjustedReturn = originalMetrics.totalReturn * returnDegradation;

    const sharpeDegradation = 1 - (calibration.slippageMultiplier * 0.05 +
      calibration.partialFillProbability * 0.15);
    const adjustedSharpe = originalMetrics.sharpeRatio * sharpeDegradation;

    const ddDegradation = 1 - calibration.rejectionRate * 0.5;
    const adjustedDD = originalMetrics.maxDrawdown / ddDegradation;

    const winRateDegradation = 1 - (calibration.partialFillProbability * 0.1);
    const adjustedWinRate = originalMetrics.winRate * winRateDegradation;

    return {
      originalTrades: originalMetrics.tradeCount,
      adjustedTrades: adjustedTradeCount,
      adjustmentFactors: this.computeAdjustmentFactors(calibration),
      adjustedMetrics: {
        totalReturn: adjustedReturn,
        sharpeRatio: adjustedSharpe,
        maxDrawdown: adjustedDD,
        winRate: adjustedWinRate
      },
      originalMetrics: {
        totalReturn: originalMetrics.totalReturn,
        sharpeRatio: originalMetrics.sharpeRatio,
        maxDrawdown: originalMetrics.maxDrawdown,
        winRate: originalMetrics.winRate
      },
      degradation: {
        returnDegradation: 1 - returnDegradation,
        sharpeDegradation: 1 - sharpeDegradation,
        ddDegradation: 1 - ddDegradation,
        winRateDegradation: 1 - winRateDegradation
      }
    };
  }

  /**
   * Generate human-readable calibration report
   */
  public generateCalibrationReport(
    calibration: CalibrationResult,
    liveFills: FillData[]
  ): CalibrationReport {
    const fillRateGap = Math.abs(
      calibration.calibrationMetrics.expectedFillRate -
        calibration.calibrationMetrics.actualFillRate
    );
    const slippageGap = Math.abs(
      calibration.calibrationMetrics.expectedSlippage -
        calibration.calibrationMetrics.actualSlippage
    );
    const latencyGap = Math.abs(
      calibration.calibrationMetrics.expectedLatency -
        calibration.calibrationMetrics.actualLatency
    );
    const rejectionRateGap = calibration.rejectionRate;

    const recommendations = this.generateCalibrationRecommendations(
      fillRateGap,
      slippageGap,
      latencyGap,
      rejectionRateGap
    );

    const symbols = [...new Set(liveFills.map((f) => f.symbol))];
    const timeRange = {
      startDate: new Date(Math.min(...liveFills.map((f) => f.timestamp.getTime()))),
      endDate: new Date(Math.max(...liveFills.map((f) => f.timestamp.getTime())))
    };

    const calibrationHeatmap = this.buildCalibrationHeatmap(liveFills);

    const summary = this.buildSummaryText(calibration, fillRateGap, slippageGap);

    return {
      summary,
      realismScore: calibration.overallRealism,
      fillRateGap,
      slippageGap,
      latencyGap,
      rejectionRateGap,
      recommendations,
      dataQuality: {
        sampleSize: calibration.sampleSize,
        outlierCount: this.countOutliers(liveFills),
        symbolCoverage: symbols,
        timeRange
      },
      calibrationHeatmap
    };
  }

  /**
   * Calculate overall realism score (0-1)
   */
  private calculateOverallRealism(
    fillRateAdj: number,
    slippageMultiplier: number,
    latencyAdder: number,
    rejectionRate: number
  ): number {
    const fillRateRealism = Math.min(fillRateAdj, 1.0);
    const slippageRealism = 1 / Math.max(slippageMultiplier, 1.0);
    const latencyRealism = 1 / (1 + latencyAdder / 100);
    const rejectionRealism = 1 - Math.min(rejectionRate, 0.5);

    return (fillRateRealism + slippageRealism + latencyRealism + rejectionRealism) / 4;
  }

  /**
   * Calculate partial fill probability
   */
  private calculatePartialFillProbability(fills: FillData[]): number {
    if (fills.length === 0) return 0;
    const partialFills = fills.filter((f) => f.partial && f.partialQuantity).length;
    return partialFills / fills.length;
  }

  /**
   * Build confusion matrix for fill predictions
   */
  private buildConfusionMatrix(
    backtestFills: FillData[],
    liveFills: FillData[]
  ): {
    truePositive: number;
    trueNegative: number;
    falsePositive: number;
    falseNegative: number;
  } {
    let tp = 0, tn = 0, fp = 0, fn = 0;

    const minLength = Math.min(backtestFills.length, liveFills.length);

    for (let i = 0; i < minLength; i++) {
      const backtest = backtestFills[i];
      const live = liveFills[i];

      const predictedFilled = !backtest.rejected;
      const actuallyFilled = !live.rejected;

      if (predictedFilled && actuallyFilled) tp++;
      else if (!predictedFilled && !actuallyFilled) tn++;
      else if (predictedFilled && !actuallyFilled) fp++;
      else fn++;
    }

    return { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn };
  }

  /**
   * Generate recommendations based on gaps
   */
  private generateCalibrationRecommendations(
    fillRateGap: number,
    slippageGap: number,
    latencyGap: number,
    rejectionRateGap: number
  ): string[] {
    const recommendations: string[] = [];

    if (fillRateGap > 0.2) {
      recommendations.push(
        `High fill rate gap (${(fillRateGap * 100).toFixed(1)}%). Adjust order sizing or use market orders more.`
      );
    }

    if (slippageGap > 0.01) {
      recommendations.push(
        `Significant slippage gap ($${slippageGap.toFixed(4)}). Backtest may be overly optimistic. Increase slippage factor by ${(slippageGap / 0.001).toFixed(0)}%.`
      );
    }

    if (latencyGap > 50) {
      recommendations.push(
        `Latency higher than expected (${latencyGap.toFixed(0)}ms). Network or broker delays present. Add ${latencyGap.toFixed(0)}ms buffer.`
      );
    }

    if (rejectionRateGap > 0.1) {
      recommendations.push(
        `Orders rejected ${(rejectionRateGap * 100).toFixed(1)}% of the time. Check position limits, margin, or risk filters.`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('Backtest assumptions closely match live execution. Minor tweaks may improve realism.');
    }

    return recommendations;
  }

  /**
   * Build per-symbol calibration heatmap
   */
  private buildCalibrationHeatmap(
    fills: FillData[]
  ): {
    symbol: string;
    fillRate: number;
    slippage: number;
    latency: number;
    rejectionRate: number;
  }[] {
    const symbolMetrics = new Map<string, FillData[]>();

    for (const fill of fills) {
      if (!symbolMetrics.has(fill.symbol)) {
        symbolMetrics.set(fill.symbol, []);
      }
      symbolMetrics.get(fill.symbol)!.push(fill);
    }

    const heatmap = [];

    for (const [symbol, symbolFills] of symbolMetrics) {
      const notRejected = symbolFills.filter((f) => !f.rejected);
      const fillRate = notRejected.length / symbolFills.length;
      const slippage = notRejected.length === 0
        ? 0
        : notRejected.reduce((sum, f) => sum + Math.abs(f.actualPrice - f.expectedPrice), 0) / notRejected.length;
      const latency = notRejected.length === 0
        ? 0
        : notRejected.reduce((sum, f) => sum + f.latencyMs, 0) / notRejected.length;
      const rejectionRate = symbolFills.filter((f) => f.rejected).length / symbolFills.length;

      heatmap.push({
        symbol,
        fillRate,
        slippage,
        latency,
        rejectionRate
      });
    }

    return heatmap;
  }

  /**
   * Build summary text for report
   */
  private buildSummaryText(
    calibration: CalibrationResult,
    fillRateGap: number,
    slippageGap: number
  ): string {
    const realismPercent = (calibration.overallRealism * 100).toFixed(1);
    const confidence = (calibration.confidence * 100).toFixed(0);

    return `Backtest realism: ${realismPercent}% based on ${calibration.sampleSize} live fills ` +
      `(${confidence}% confidence). Fill rate gap: ${(fillRateGap * 100).toFixed(1)}%. ` +
      `Slippage gap: $${slippageGap.toFixed(4)}.`;
  }

  private countOutliers(fills: FillData[]): number {
    const slippages = fills.map((f) => Math.abs(f.actualPrice - f.expectedPrice));
    if (slippages.length < 10) return 0;

    const mean = slippages.reduce((a, b) => a + b, 0) / slippages.length;
    const variance = slippages.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / slippages.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + stdDev * 3;

    return slippages.filter((s) => s > threshold).length;
  }

  private getDefaultCalibration(confidenceScale: number): CalibrationResult {
    return {
      fillRateAdjustment: 0.95,
      slippageMultiplier: 1.5,
      latencyAdder: 50,
      partialFillProbability: 0.05,
      rejectionRate: 0.02,
      overallRealism: 0.6,
      calibrationMetrics: {
        expectedFillRate: 0.98,
        actualFillRate: 0.93,
        expectedSlippage: 0.001,
        actualSlippage: 0.0015,
        expectedLatency: 100,
        actualLatency: 150,
        partialFillRate: 0.05
      },
      confidence: confidenceScale * 0.3,
      sampleSize: 0,
      lastCalibrated: new Date()
    };
  }
}
