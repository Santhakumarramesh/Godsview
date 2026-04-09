import { randomUUID } from 'crypto';

// ============================================================================
// Types and Interfaces
// ============================================================================

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
export type TrendDirection = 'bullish' | 'bearish' | 'neutral';
export type SignalStrength = 'strong' | 'moderate' | 'weak';

export interface TimeframeCandle {
  symbol: string;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export interface TimeframeAnalysis {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  trend: TrendDirection;
  strength: SignalStrength;
  support_level: number;
  resistance_level: number;
  key_levels: number[];
  momentum: number;
  volatility: number;
  volume_profile: 'increasing' | 'decreasing' | 'stable';
  analyzed_at: string;
}

export interface ConfluenceSignal {
  id: string;
  symbol: string;
  direction: TrendDirection;
  timeframes_aligned: Timeframe[];
  alignment_score: number;
  strongest_timeframe: Timeframe;
  weakest_timeframe: Timeframe;
  confluence_type: 'full' | 'partial' | 'divergent';
  entry_zone: { low: number; high: number };
  created_at: string;
}

export interface MTFDivergence {
  id: string;
  symbol: string;
  short_tf: Timeframe;
  long_tf: Timeframe;
  short_trend: TrendDirection;
  long_trend: TrendDirection;
  divergence_type: 'bullish_divergence' | 'bearish_divergence' | 'trend_conflict';
  severity: 'high' | 'medium' | 'low';
  detected_at: string;
}

export interface TimeframeCorrelation {
  id: string;
  symbol: string;
  tf_a: Timeframe;
  tf_b: Timeframe;
  correlation: number;
  lag_periods: number;
  computed_at: string;
}

export interface MTFScanResult {
  id: string;
  symbol: string;
  scan_type: 'confluence' | 'divergence' | 'breakout' | 'reversal';
  timeframes_scanned: Timeframe[];
  findings: string[];
  score: number;
  scanned_at: string;
}

// ============================================================================
// MTFEngine Class
// ============================================================================

export class MTFEngine {
  private analyses: Map<string, TimeframeAnalysis> = new Map();
  private confluences: Map<string, ConfluenceSignal> = new Map();
  private divergences: Map<string, MTFDivergence> = new Map();
  private correlations: Map<string, TimeframeCorrelation> = new Map();
  private scans: Map<string, MTFScanResult> = new Map();
  private candles: Map<string, TimeframeCandle[]> = new Map();

  // ========== Candle Management ==========

  public addCandles(
    symbol: string,
    timeframe: Timeframe,
    candles: Omit<TimeframeCandle, 'symbol' | 'timeframe'>[]
  ): void {
    const key = `${symbol}_${timeframe}`;
    const formattedCandles: TimeframeCandle[] = candles.map((candle) => ({
      ...candle,
      symbol,
      timeframe,
    }));

    if (this.candles.has(key)) {
      const existing = this.candles.get(key)!;
      this.candles.set(key, [...existing, ...formattedCandles]);
    } else {
      this.candles.set(key, formattedCandles);
    }
  }

  public getCandles(symbol: string, timeframe: Timeframe, limit?: number): TimeframeCandle[] {
    const key = `${symbol}_${timeframe}`;
    const allCandles = this.candles.get(key) || [];

    if (limit) {
      return allCandles.slice(-limit);
    }

    return allCandles;
  }

  // ========== Timeframe Analysis ==========

  public analyzeTimeframe(
    symbol: string,
    timeframe: Timeframe,
    candle: TimeframeCandle
  ): TimeframeAnalysis {
    const id = `mtf_${randomUUID()}`;
    const closeDiff = candle.close - candle.open;
    const closeDiffPercent = (closeDiff / candle.open) * 100;

    // Determine trend based on close vs open
    let trend: TrendDirection = 'neutral';
    if (closeDiffPercent > 0.5) {
      trend = 'bullish';
    } else if (closeDiffPercent < -0.5) {
      trend = 'bearish';
    }

    // Determine strength
    let strength: SignalStrength = 'weak';
    const absDiff = Math.abs(closeDiffPercent);
    if (absDiff > 1) {
      strength = 'strong';
    } else if (absDiff > 0.5) {
      strength = 'moderate';
    }

    // Calculate momentum and volatility
    const momentum = closeDiffPercent;
    const volatility = ((candle.high - candle.low) / candle.open) * 100;

    // Support and resistance levels
    const support_level = candle.low;
    const resistance_level = candle.high;
    const key_levels = [support_level, candle.open, candle.close, resistance_level];

    const analysis: TimeframeAnalysis = {
      id,
      symbol,
      timeframe,
      trend,
      strength,
      support_level,
      resistance_level,
      key_levels: [...new Set(key_levels)].sort((a, b) => a - b),
      momentum,
      volatility,
      volume_profile: 'stable',
      analyzed_at: new Date().toISOString(),
    };

    this.analyses.set(id, analysis);
    return analysis;
  }

  public getAnalysis(id: string): TimeframeAnalysis | undefined {
    return this.analyses.get(id);
  }

  public getAnalysesForSymbol(symbol: string): TimeframeAnalysis[] {
    return Array.from(this.analyses.values()).filter((a) => a.symbol === symbol);
  }

  public getAllAnalyses(limit?: number): TimeframeAnalysis[] {
    const all = Array.from(this.analyses.values());
    if (limit) {
      return all.slice(-limit);
    }
    return all;
  }

  // ========== Confluence Detection ==========

  public detectConfluence(symbol: string, timeframes: Timeframe[]): ConfluenceSignal {
    const id = `conf_${randomUUID()}`;

    // Get latest analysis for each timeframe
    const analysesPerTF = timeframes
      .map((tf) => {
        const analyses = this.getAnalysesForSymbol(symbol).filter((a) => a.timeframe === tf);
        return analyses.length > 0 ? analyses[analyses.length - 1] : null;
      })
      .filter((a) => a !== null) as TimeframeAnalysis[];

    // Count aligned trends
    const bullishCount = analysesPerTF.filter((a) => a.trend === 'bullish').length;
    const bearishCount = analysesPerTF.filter((a) => a.trend === 'bearish').length;
    const total = analysesPerTF.length;

    const alignedCount = Math.max(bullishCount, bearishCount);
    const alignment_score = total > 0 ? alignedCount / total : 0;

    // Determine confluence type and overall direction
    let confluence_type: 'full' | 'partial' | 'divergent' = 'divergent';
    let direction: TrendDirection = 'neutral';

    if (alignment_score === 1) {
      confluence_type = 'full';
      direction = bullishCount > 0 ? 'bullish' : bearishCount > 0 ? 'bearish' : 'neutral';
    } else if (alignment_score > 0.5) {
      confluence_type = 'partial';
      direction = bullishCount > bearishCount ? 'bullish' : 'bearish';
    }

    // Find strongest and weakest timeframes
    const strongest = analysesPerTF.reduce((prev, current) =>
      current.strength === 'strong' ||
      (prev.strength !== 'strong' && current.momentum > Math.abs(prev.momentum))
        ? current
        : prev
    );

    const weakest = analysesPerTF.reduce((prev, current) =>
      current.strength === 'weak' ||
      (prev.strength !== 'weak' && Math.abs(current.momentum) < Math.abs(prev.momentum))
        ? current
        : prev
    );

    // Calculate entry zone
    const lowLevel = Math.min(...analysesPerTF.map((a) => a.support_level));
    const highLevel = Math.max(...analysesPerTF.map((a) => a.resistance_level));

    const signal: ConfluenceSignal = {
      id,
      symbol,
      direction,
      timeframes_aligned: analysesPerTF.map((a) => a.timeframe),
      alignment_score,
      strongest_timeframe: strongest.timeframe,
      weakest_timeframe: weakest.timeframe,
      confluence_type,
      entry_zone: { low: lowLevel, high: highLevel },
      created_at: new Date().toISOString(),
    };

    this.confluences.set(id, signal);
    return signal;
  }

  public getConfluence(id: string): ConfluenceSignal | undefined {
    return this.confluences.get(id);
  }

  public getConfluencesForSymbol(symbol: string): ConfluenceSignal[] {
    return Array.from(this.confluences.values()).filter((c) => c.symbol === symbol);
  }

  public getAllConfluences(limit?: number): ConfluenceSignal[] {
    const all = Array.from(this.confluences.values());
    if (limit) {
      return all.slice(-limit);
    }
    return all;
  }

  // ========== Divergence Detection ==========

  public detectDivergence(
    symbol: string,
    short_tf: Timeframe,
    long_tf: Timeframe
  ): MTFDivergence | null {
    // Get latest analyses for both timeframes
    const shortAnalyses = this.getAnalysesForSymbol(symbol).filter((a) => a.timeframe === short_tf);
    const longAnalyses = this.getAnalysesForSymbol(symbol).filter((a) => a.timeframe === long_tf);

    if (shortAnalyses.length === 0 || longAnalyses.length === 0) {
      return null;
    }

    const shortAnalysis = shortAnalyses[shortAnalyses.length - 1];
    const longAnalysis = longAnalyses[longAnalyses.length - 1];

    // If trends match, no divergence
    if (shortAnalysis.trend === longAnalysis.trend) {
      return null;
    }

    const id = `div_${randomUUID()}`;
    let divergence_type: 'bullish_divergence' | 'bearish_divergence' | 'trend_conflict';
    let severity: 'high' | 'medium' | 'low' = 'medium';

    if (shortAnalysis.trend === 'bullish' && longAnalysis.trend === 'bearish') {
      divergence_type = 'bullish_divergence';
      severity = shortAnalysis.strength === 'strong' ? 'high' : 'medium';
    } else if (shortAnalysis.trend === 'bearish' && longAnalysis.trend === 'bullish') {
      divergence_type = 'bearish_divergence';
      severity = shortAnalysis.strength === 'strong' ? 'high' : 'medium';
    } else {
      divergence_type = 'trend_conflict';
    }

    const divergence: MTFDivergence = {
      id,
      symbol,
      short_tf,
      long_tf,
      short_trend: shortAnalysis.trend,
      long_trend: longAnalysis.trend,
      divergence_type,
      severity,
      detected_at: new Date().toISOString(),
    };

    this.divergences.set(id, divergence);
    return divergence;
  }

  public getDivergence(id: string): MTFDivergence | undefined {
    return this.divergences.get(id);
  }

  public getDivergencesForSymbol(symbol: string): MTFDivergence[] {
    return Array.from(this.divergences.values()).filter((d) => d.symbol === symbol);
  }

  public getAllDivergences(limit?: number): MTFDivergence[] {
    const all = Array.from(this.divergences.values());
    if (limit) {
      return all.slice(-limit);
    }
    return all;
  }

  // ========== Correlation Computation ==========

  public computeCorrelation(symbol: string, tf_a: Timeframe, tf_b: Timeframe): TimeframeCorrelation {
    const id = `tfcor_${randomUUID()}`;

    // Get latest analyses for both timeframes
    const analysesA = this.getAnalysesForSymbol(symbol).filter((a) => a.timeframe === tf_a);
    const analysesB = this.getAnalysesForSymbol(symbol).filter((a) => a.timeframe === tf_b);

    let correlation = 0.0;

    if (analysesA.length > 0 && analysesB.length > 0) {
      const latestA = analysesA[analysesA.length - 1];
      const latestB = analysesB[analysesB.length - 1];

      if (latestA.trend === latestB.trend && latestA.trend !== 'neutral') {
        correlation = 1.0;
      } else if (
        (latestA.trend === 'bullish' && latestB.trend === 'bearish') ||
        (latestA.trend === 'bearish' && latestB.trend === 'bullish')
      ) {
        correlation = -1.0;
      } else {
        correlation = 0.0;
      }
    }

    const timeframeCorr: TimeframeCorrelation = {
      id,
      symbol,
      tf_a,
      tf_b,
      correlation,
      lag_periods: 0,
      computed_at: new Date().toISOString(),
    };

    this.correlations.set(id, timeframeCorr);
    return timeframeCorr;
  }

  public getCorrelation(id: string): TimeframeCorrelation | undefined {
    return this.correlations.get(id);
  }

  public getAllCorrelations(limit?: number): TimeframeCorrelation[] {
    const all = Array.from(this.correlations.values());
    if (limit) {
      return all.slice(-limit);
    }
    return all;
  }

  // ========== Scan Operations ==========

  public runScan(
    symbol: string,
    timeframes: Timeframe[],
    scan_type: 'confluence' | 'divergence' | 'breakout' | 'reversal'
  ): MTFScanResult {
    const id = `scan_${randomUUID()}`;
    const findings: string[] = [];
    let score = 0;

    // Get all analyses for the symbol in the specified timeframes
    const analyses = this.getAnalysesForSymbol(symbol).filter((a) =>
      timeframes.includes(a.timeframe)
    );

    if (scan_type === 'confluence') {
      const bullishCount = analyses.filter((a) => a.trend === 'bullish').length;
      const bearishCount = analyses.filter((a) => a.trend === 'bearish').length;
      const total = analyses.length;

      if (total > 0) {
        if (bullishCount === total) {
          findings.push('All timeframes showing bullish confluence');
          score = 95;
        } else if (bearishCount === total) {
          findings.push('All timeframes showing bearish confluence');
          score = 95;
        } else if (bullishCount > total / 2) {
          findings.push(`Partial bullish confluence (${bullishCount}/${total} timeframes)`);
          score = 60;
        } else if (bearishCount > total / 2) {
          findings.push(`Partial bearish confluence (${bearishCount}/${total} timeframes)`);
          score = 60;
        } else {
          findings.push('Divergent signals across timeframes');
          score = 30;
        }
      }
    } else if (scan_type === 'divergence') {
      const divergences = this.getDivergencesForSymbol(symbol);
      if (divergences.length > 0) {
        const highSev = divergences.filter((d) => d.severity === 'high');
        findings.push(`Found ${divergences.length} divergences`);
        if (highSev.length > 0) {
          findings.push(`${highSev.length} high-severity divergences detected`);
          score = 80;
        } else {
          score = 50;
        }
      } else {
        findings.push('No divergences detected');
        score = 10;
      }
    } else if (scan_type === 'breakout') {
      const breakoutCandidates = analyses.filter(
        (a) => a.strength === 'strong' && Math.abs(a.momentum) > 1.5
      );
      if (breakoutCandidates.length > 0) {
        findings.push(`${breakoutCandidates.length} timeframes showing breakout potential`);
        score = 75;
      } else {
        findings.push('No breakout patterns detected');
        score = 20;
      }
    } else if (scan_type === 'reversal') {
      const reversalCandidates = analyses.filter(
        (a) => a.strength === 'strong' && a.volatility > 2
      );
      if (reversalCandidates.length > 0) {
        findings.push(`${reversalCandidates.length} timeframes showing reversal potential`);
        score = 70;
      } else {
        findings.push('No reversal patterns detected');
        score = 15;
      }
    }

    const scan: MTFScanResult = {
      id,
      symbol,
      scan_type,
      timeframes_scanned: timeframes,
      findings,
      score,
      scanned_at: new Date().toISOString(),
    };

    this.scans.set(id, scan);
    return scan;
  }

  public getScan(id: string): MTFScanResult | undefined {
    return this.scans.get(id);
  }

  public getScansForSymbol(symbol: string): MTFScanResult[] {
    return Array.from(this.scans.values()).filter((s) => s.symbol === symbol);
  }

  public getAllScans(limit?: number): MTFScanResult[] {
    const all = Array.from(this.scans.values());
    if (limit) {
      return all.slice(-limit);
    }
    return all;
  }

  // ========== Utilities ==========

  public _clearMtf(): void {
    this.analyses.clear();
    this.confluences.clear();
    this.divergences.clear();
    this.correlations.clear();
    this.scans.clear();
    this.candles.clear();
  }
}

// ============================================================================
// Singleton Instance and Delegate Functions
// ============================================================================

const engine = new MTFEngine();

export function addCandles(
  symbol: string,
  timeframe: Timeframe,
  candles: Omit<TimeframeCandle, 'symbol' | 'timeframe'>[]
): void {
  return engine.addCandles(symbol, timeframe, candles);
}

export function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit?: number
): TimeframeCandle[] {
  return engine.getCandles(symbol, timeframe, limit);
}

export function analyzeTimeframe(
  symbol: string,
  timeframe: Timeframe,
  candle: TimeframeCandle
): TimeframeAnalysis {
  return engine.analyzeTimeframe(symbol, timeframe, candle);
}

export function getAnalysis(id: string): TimeframeAnalysis | undefined {
  return engine.getAnalysis(id);
}

export function getAnalysesForSymbol(symbol: string): TimeframeAnalysis[] {
  return engine.getAnalysesForSymbol(symbol);
}

export function getAllAnalyses(limit?: number): TimeframeAnalysis[] {
  return engine.getAllAnalyses(limit);
}

export function detectConfluence(symbol: string, timeframes: Timeframe[]): ConfluenceSignal {
  return engine.detectConfluence(symbol, timeframes);
}

export function getConfluence(id: string): ConfluenceSignal | undefined {
  return engine.getConfluence(id);
}

export function getConfluencesForSymbol(symbol: string): ConfluenceSignal[] {
  return engine.getConfluencesForSymbol(symbol);
}

export function getAllConfluences(limit?: number): ConfluenceSignal[] {
  return engine.getAllConfluences(limit);
}

export function detectDivergence(
  symbol: string,
  short_tf: Timeframe,
  long_tf: Timeframe
): MTFDivergence | null {
  return engine.detectDivergence(symbol, short_tf, long_tf);
}

export function getDivergence(id: string): MTFDivergence | undefined {
  return engine.getDivergence(id);
}

export function getDivergencesForSymbol(symbol: string): MTFDivergence[] {
  return engine.getDivergencesForSymbol(symbol);
}

export function getAllDivergences(limit?: number): MTFDivergence[] {
  return engine.getAllDivergences(limit);
}

export function computeCorrelation(
  symbol: string,
  tf_a: Timeframe,
  tf_b: Timeframe
): TimeframeCorrelation {
  return engine.computeCorrelation(symbol, tf_a, tf_b);
}

export function getCorrelation(id: string): TimeframeCorrelation | undefined {
  return engine.getCorrelation(id);
}

export function getAllCorrelations(limit?: number): TimeframeCorrelation[] {
  return engine.getAllCorrelations(limit);
}

export function runScan(
  symbol: string,
  timeframes: Timeframe[],
  scan_type: 'confluence' | 'divergence' | 'breakout' | 'reversal'
): MTFScanResult {
  return engine.runScan(symbol, timeframes, scan_type);
}

export function getScan(id: string): MTFScanResult | undefined {
  return engine.getScan(id);
}

export function getScansForSymbol(symbol: string): MTFScanResult[] {
  return engine.getScansForSymbol(symbol);
}

export function getAllScans(limit?: number): MTFScanResult[] {
  return engine.getAllScans(limit);
}

export function _clearMtf(): void {
  engine._clearMtf();
}

export default engine;
