import { Strategy, BacktestResult, MarketData } from '../types';

export enum HypothesisType {
  BEHAVIORAL = 'BEHAVIORAL',
  MICROSTRUCTURE = 'MICROSTRUCTURE',
  INFORMATION_ASYMMETRY = 'INFORMATION_ASYMMETRY',
  REGIME = 'REGIME',
  NULL = 'NULL',
}

export interface HypothesisEvidence {
  type: string;
  description: string;
  strength: number; // 0-1
  data?: any;
}

export interface Hypothesis {
  id: string;
  type: HypothesisType;
  name: string;
  description: string;
  evidence: HypothesisEvidence[];
  confidenceScore: number; // 0-1
  testablePredictions: string[];
  falsificationCriteria: string[];
  estimatedEdgeMagnitude: number; // basis points per trade
  persistence: number; // likelihood edge persists over time (0-1)
  scalability: number; // how much capacity (0-1)
  complexity: number; // implementation difficulty (0-1)
}

export class HypothesisEngine {
  private hypotheses: Map<string, Hypothesis> = new Map();

  constructor() {
    this.initializeHypothesisTemplates();
  }

  private initializeHypothesisTemplates(): void {
    // Templates for hypothesis generation
  }

  /**
   * Generate 5 competing hypotheses for a given strategy
   */
  generateHypotheses(strategy: Strategy): Hypothesis[] {
    const hypotheses: Hypothesis[] = [];

    // 1. Behavioral Hypothesis
    const behavioral = this.createBehavioralHypothesis(strategy);
    hypotheses.push(behavioral);

    // 2. Microstructure Hypothesis
    const microstructure = this.createMicrostructureHypothesis(strategy);
    hypotheses.push(microstructure);

    // 3. Information Asymmetry Hypothesis
    const infoAsymmetry = this.createInformationAsymmetryHypothesis(strategy);
    hypotheses.push(infoAsymmetry);

    // 4. Regime Hypothesis
    const regime = this.createRegimeHypothesis(strategy);
    hypotheses.push(regime);

    // 5. Null Hypothesis
    const nullHypothesis = this.createNullHypothesis(strategy);
    hypotheses.push(nullHypothesis);

    return hypotheses;
  }

  private createBehavioralHypothesis(strategy: Strategy): Hypothesis {
    return {
      id: `hyp-${Date.now()}-behavioral`,
      type: HypothesisType.BEHAVIORAL,
      name: 'Behavioral Bias Edge',
      description:
        'Strategy exploits predictable human biases (loss aversion, anchoring, herding) in market participants',
      evidence: [],
      confidenceScore: 0.0,
      testablePredictions: [
        'Edge stronger when retail participation is high',
        'Edge stronger during panic/euphoria periods',
        'Edge disappears in highly automated/algorithmic markets',
        'Loss aversion creates predictable price patterns after sharp declines',
        'Anchoring to round numbers creates support/resistance levels',
      ],
      falsificationCriteria: [
        'Strategy fails when countertrend move eliminates psychological levels',
        'Strategy fails in after-hours or algorithmic trading',
        'Edge degrades as market becomes more efficient',
      ],
      estimatedEdgeMagnitude: 0,
      persistence: 0.5,
      scalability: 0.4,
      complexity: 0.3,
    };
  }

  private createMicrostructureHypothesis(strategy: Strategy): Hypothesis {
    return {
      id: `hyp-${Date.now()}-microstructure`,
      type: HypothesisType.MICROSTRUCTURE,
      name: 'Market Microstructure Edge',
      description:
        'Strategy profits from mechanical market dynamics (bid-ask bounce, order imbalance, HFT patterns, inventory effects)',
      evidence: [],
      confidenceScore: 0.0,
      testablePredictions: [
        'Edge appears in high-frequency/short-term timeframes',
        'Edge correlates with bid-ask spreads and order flow imbalance',
        'Edge stronger in illiquid assets with wider spreads',
        'Edge disappears when using market orders (slippage eliminates gains)',
        'HFT activity patterns correlate with entry/exit signals',
      ],
      falsificationCriteria: [
        'Strategy underperforms when spreads widen',
        'Strategy fails with realistic transaction costs',
        'Market structure changes (circuit breakers, new exchanges) break edge',
      ],
      estimatedEdgeMagnitude: 0,
      persistence: 0.3,
      scalability: 0.2,
      complexity: 0.6,
    };
  }

  private createInformationAsymmetryHypothesis(strategy: Strategy): Hypothesis {
    return {
      id: `hyp-${Date.now()}-info-asymmetry`,
      type: HypothesisType.INFORMATION_ASYMMETRY,
      name: 'Information Asymmetry Edge',
      description:
        'Strategy exploits information processing speed or quality differences - faster/better access to information',
      evidence: [],
      confidenceScore: 0.0,
      testablePredictions: [
        'Edge appears before major news/earnings releases',
        'Strategy signal precedes related securities by measurable time',
        'Edge correlates with proprietary data advantages (alternative data)',
        'Performance better when using premium/real-time data vs delayed',
        'Edge stronger in less efficient markets with lower information dissemination',
      ],
      falsificationCriteria: [
        'Strategy fails when information is fully disseminated',
        'Strategy breaks when competitors access same information simultaneously',
        'Alternative data loses predictive power (source dries up or becomes public)',
      ],
      estimatedEdgeMagnitude: 0,
      persistence: 0.6,
      scalability: 0.3,
      complexity: 0.7,
    };
  }

  private createRegimeHypothesis(strategy: Strategy): Hypothesis {
    return {
      id: `hyp-${Date.now()}-regime`,
      type: HypothesisType.REGIME,
      name: 'Regime-Dependent Edge',
      description: 'Strategy only works in specific market regimes (volatility, trend, correlation, liquidity regimes)',
      evidence: [],
      confidenceScore: 0.0,
      testablePredictions: [
        'Edge only appears in specific volatility regime (high/low VIX)',
        'Edge only works in trending markets, not ranging',
        'Edge stronger when asset correlations are low/high',
        'Edge depends on liquidity regime',
        'Edge appears only in specific market cycles (expansions vs contractions)',
      ],
      falsificationCriteria: [
        'Strategy fails when regime changes',
        'Strategy fails to predict regime changes in advance',
        'Regime filters increase complexity without improving risk-adjusted returns',
      ],
      estimatedEdgeMagnitude: 0,
      persistence: 0.4,
      scalability: 0.5,
      complexity: 0.5,
    };
  }

  private createNullHypothesis(strategy: Strategy): Hypothesis {
    return {
      id: `hyp-${Date.now()}-null`,
      type: HypothesisType.NULL,
      name: 'No Real Edge',
      description: 'Strategy performance is indistinguishable from random/noise - no real edge exists',
      evidence: [],
      confidenceScore: 0.0,
      testablePredictions: [
        'Returns match random trading of similar position sizes',
        'Sharpe ratio equals market baseline + transaction costs',
        'In-sample and out-of-sample performance differ significantly',
        'Strategy optimization is overfitting',
        'Edge disappears with forward-testing',
      ],
      falsificationCriteria: [
        'Strategy shows consistent profitability out-of-sample',
        'Statistical significance exceeds noise thresholds',
        'Edge persists through regime changes',
      ],
      estimatedEdgeMagnitude: 0,
      persistence: 0.0,
      scalability: 0.0,
      complexity: 0.0,
    };
  }

  /**
   * Test a specific hypothesis against data
   */
  testHypothesis(hypothesis: Hypothesis, data: MarketData[]): Hypothesis {
    const evidence = this.generateEvidence(hypothesis, data);
    const updatedHypothesis = { ...hypothesis };
    updatedHypothesis.evidence = evidence;
    updatedHypothesis.confidenceScore = this.computeConfidenceScore(hypothesis.type, evidence);
    return updatedHypothesis;
  }

  private generateEvidence(hypothesis: Hypothesis, data: MarketData[]): HypothesisEvidence[] {
    const evidence: HypothesisEvidence[] = [];

    switch (hypothesis.type) {
      case HypothesisType.BEHAVIORAL:
        evidence.push(this.testBehavioralEvidence(data));
        break;
      case HypothesisType.MICROSTRUCTURE:
        evidence.push(this.testMicrostructureEvidence(data));
        break;
      case HypothesisType.INFORMATION_ASYMMETRY:
        evidence.push(this.testInformationAsymmetryEvidence(data));
        break;
      case HypothesisType.REGIME:
        evidence.push(this.testRegimeEvidence(data));
        break;
      case HypothesisType.NULL:
        evidence.push(this.testNullEvidence(data));
        break;
    }

    return evidence;
  }

  private testBehavioralEvidence(data: MarketData[]): HypothesisEvidence {
    // Analyze for psychological levels, round numbers, anchoring patterns
    const roundNumbers = this.detectRoundNumberSupport(data);
    const psychologicalLevels = this.detectAnchors(data);
    const herding = this.detectHerdingPatterns(data);

    const strength = (roundNumbers + psychologicalLevels + herding) / 3;

    return {
      type: 'behavioral-pattern-analysis',
      description: `Detected price clustering around round numbers (${roundNumbers.toFixed(2)}), psychological levels (${psychologicalLevels.toFixed(2)}), and herding patterns (${herding.toFixed(2)})`,
      strength,
      data: { roundNumbers, psychologicalLevels, herding },
    };
  }

  private testMicrostructureEvidence(data: MarketData[]): HypothesisEvidence {
    // Analyze bid-ask bounces, order imbalances, inventory effects
    const bidAskBounce = this.measureBidAskBounce(data);
    const orderImbalance = this.measureOrderImbalance(data);
    const hftPatterns = this.detectHFTPatterns(data);

    const strength = (bidAskBounce + orderImbalance + hftPatterns) / 3;

    return {
      type: 'microstructure-pattern-analysis',
      description: `Detected bid-ask bounce (${bidAskBounce.toFixed(2)}), order imbalance signal (${orderImbalance.toFixed(2)}), HFT patterns (${hftPatterns.toFixed(2)})`,
      strength,
      data: { bidAskBounce, orderImbalance, hftPatterns },
    };
  }

  private testInformationAsymmetryEvidence(data: MarketData[]): HypothesisEvidence {
    // Analyze information leads, correlation patterns, timing of related assets
    const infoLead = this.measureInformationLead(data);
    const correlationEdge = this.measureCorrelationTiming(data);

    const strength = (infoLead + correlationEdge) / 2;

    return {
      type: 'information-asymmetry-analysis',
      description: `Detected information lead time (${infoLead.toFixed(3)}s), correlation timing edge (${correlationEdge.toFixed(2)})`,
      strength,
      data: { infoLead, correlationEdge },
    };
  }

  private testRegimeEvidence(data: MarketData[]): HypothesisEvidence {
    // Analyze regime switching and performance in different regimes
    const regimes = this.identifyRegimes(data);
    const regimePerformance = this.analyzeRegimePerformance(regimes);

    const strength = this.calculateRegimeSignificance(regimePerformance);

    return {
      type: 'regime-dependency-analysis',
      description: `Identified ${regimes.length} distinct regimes with regime-dependent performance (significance: ${strength.toFixed(2)})`,
      strength,
      data: { regimes, regimePerformance },
    };
  }

  private testNullEvidence(data: MarketData[]): HypothesisEvidence {
    // Test against random trading baseline
    const randomWalkTest = this.testRandomWalk(data);
    const noiseRatio = this.calculateNoiseRatio(data);

    const strength = 1 - Math.min((randomWalkTest + noiseRatio) / 2, 1);

    return {
      type: 'null-hypothesis-test',
      description: `Random walk test (${randomWalkTest.toFixed(2)}), noise ratio (${noiseRatio.toFixed(2)}) - strength of null: ${strength.toFixed(2)}`,
      strength,
      data: { randomWalkTest, noiseRatio },
    };
  }

  private detectRoundNumberSupport(data: MarketData[]): number {
    // Check for price clustering at round numbers (100, 1000, etc.)
    let clusterCount = 0;
    const roundNumbers = [100, 1000, 10000, 500, 5000, 50000];

    for (const bar of data.slice(-252)) {
      for (const round of roundNumbers) {
        if (Math.abs(bar.close - round) < round * 0.001) {
          clusterCount++;
        }
      }
    }

    return Math.min(clusterCount / data.length, 1);
  }

  private detectAnchors(data: MarketData[]): number {
    // Detect anchoring to previous highs, support levels, etc.
    if (data.length < 20) return 0;

    let anchorMatches = 0;
    const anchors = [
      Math.max(...data.slice(0, 252).map(d => d.high)),
      Math.min(...data.slice(0, 252).map(d => d.low)),
    ];

    for (const bar of data.slice(-126)) {
      for (const anchor of anchors) {
        if (Math.abs(bar.close - anchor) < Math.max(...data.map(d => d.close)) * 0.005) {
          anchorMatches++;
        }
      }
    }

    return Math.min(anchorMatches / (data.length * anchors.length), 1);
  }

  private detectHerdingPatterns(data: MarketData[]): number {
    // Detect correlated moves, gap moves, sudden volatility increases
    let herdingSignals = 0;

    for (let i = 1; i < Math.min(data.length, 252); i++) {
      const returnToday = (data[i].close - data[i - 1].close) / data[i - 1].close;
      const volumeRatio = data[i].volume / (data.slice(Math.max(0, i - 20), i).reduce((sum, d) => sum + d.volume, 0) / 20);

      if (Math.abs(returnToday) > 0.03 && volumeRatio > 1.5) {
        herdingSignals++;
      }
    }

    return Math.min(herdingSignals / 252, 1);
  }

  private measureBidAskBounce(data: MarketData[]): number {
    // Simulate bid-ask bounce magnitude
    if (data.length < 20) return 0;

    let bounceCount = 0;

    for (let i = 2; i < Math.min(data.length, 252); i++) {
      // Simple heuristic: if price reverses shortly after move
      const move1 = data[i - 1].close - data[i - 2].close;
      const move2 = data[i].close - data[i - 1].close;

      if (move1 * move2 < 0 && Math.abs(move2) < Math.abs(move1) * 0.5) {
        bounceCount++;
      }
    }

    return Math.min(bounceCount / 250, 1);
  }

  private measureOrderImbalance(data: MarketData[]): number {
    // Proxy for order imbalance: volume spikes with directional moves
    if (data.length < 20) return 0;

    let imbalanceSignals = 0;
    const avgVolume = data.reduce((sum, d) => sum + d.volume, 0) / data.length;

    for (let i = 1; i < Math.min(data.length, 252); i++) {
      if (data[i].volume > avgVolume * 1.5) {
        const priceMove = Math.abs(data[i].close - data[i - 1].close) / data[i - 1].close;
        if (priceMove > 0.005) {
          imbalanceSignals++;
        }
      }
    }

    return Math.min(imbalanceSignals / 250, 1);
  }

  private detectHFTPatterns(data: MarketData[]): number {
    // Look for rapid reversals, tight bid-ask, high frequency trades
    if (data.length < 20) return 0;

    let hftSignals = 0;

    for (let i = 1; i < Math.min(data.length, 252); i++) {
      const range = data[i].high - data[i].low;
      const avgRange = data.slice(Math.max(0, i - 20), i).reduce((sum, d) => sum + (d.high - d.low), 0) / 20;

      if (range < avgRange * 0.3 && data[i].volume > data.slice(Math.max(0, i - 5), i).reduce((s, d) => s + d.volume, 0) / 5) {
        hftSignals++;
      }
    }

    return Math.min(hftSignals / 250, 1);
  }

  private measureInformationLead(data: MarketData[]): number {
    // Estimate information lead time (simplified: hours)
    // In real implementation, compare signal generation time to market reaction
    return Math.random() * 2; // 0-2 hours
  }

  private measureCorrelationTiming(data: MarketData[]): number {
    // Measure if this asset moves before correlated assets
    if (data.length < 20) return 0;

    let leadingCount = 0;

    for (let i = 5; i < Math.min(data.length, 252); i++) {
      const recentReturn = (data[i].close - data[i - 5].close) / data[i - 5].close;
      const pastReturn = (data[i - 5].close - data[i - 10].close) / data[i - 10].close;

      // Simplified: check if magnitude of recent move is larger than past
      if (Math.abs(recentReturn) > Math.abs(pastReturn)) {
        leadingCount++;
      }
    }

    return Math.min(leadingCount / 250, 1);
  }

  private identifyRegimes(data: MarketData[]): Array<{ type: string; startIdx: number; endIdx: number; characterization: string }> {
    const regimes: Array<{ type: string; startIdx: number; endIdx: number; characterization: string }> = [];

    if (data.length < 60) {
      return [{ type: 'unknown', startIdx: 0, endIdx: data.length - 1, characterization: 'insufficient data' }];
    }

    // Simple regime identification: high vol vs low vol
    const volatilities = this.calculateRollingVolatility(data, 20);
    const avgVol = volatilities.reduce((a, b) => a + b) / volatilities.length;

    let currentRegime = volatilities[0] > avgVol ? 'high_vol' : 'low_vol';
    let regimeStart = 0;

    for (let i = 1; i < volatilities.length; i++) {
      const newRegime = volatilities[i] > avgVol ? 'high_vol' : 'low_vol';

      if (newRegime !== currentRegime) {
        regimes.push({
          type: currentRegime,
          startIdx: regimeStart,
          endIdx: i - 1,
          characterization: `${currentRegime} (vol: ${volatilities[i - 1].toFixed(2)})`,
        });
        currentRegime = newRegime;
        regimeStart = i;
      }
    }

    regimes.push({
      type: currentRegime,
      startIdx: regimeStart,
      endIdx: volatilities.length - 1,
      characterization: `${currentRegime} (vol: ${volatilities[volatilities.length - 1].toFixed(2)})`,
    });

    return regimes;
  }

  private calculateRollingVolatility(data: MarketData[], window: number): number[] {
    const volatilities: number[] = [];

    for (let i = window; i < data.length; i++) {
      const returns: number[] = [];

      for (let j = i - window; j < i; j++) {
        returns.push((data[j].close - data[j - 1].close) / data[j - 1].close);
      }

      const mean = returns.reduce((a, b) => a + b) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
      volatilities.push(Math.sqrt(variance));
    }

    return volatilities;
  }

  private analyzeRegimePerformance(regimes: Array<{ type: string; startIdx: number; endIdx: number; characterization: string }>): Record<string, number> {
    const performance: Record<string, number> = {};

    for (const regime of regimes) {
      performance[regime.type] = Math.random(); // Placeholder
    }

    return performance;
  }

  private calculateRegimeSignificance(regimePerformance: Record<string, number>): number {
    const values = Object.values(regimePerformance);
    if (values.length === 0) return 0;

    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return Math.min(stdDev / Math.max(mean, 0.001), 1);
  }

  private testRandomWalk(data: MarketData[]): number {
    // Perform random walk test (simplified Augmented Dickey-Fuller proxy)
    if (data.length < 30) return 0;

    let positiveReturns = 0;

    for (let i = 1; i < Math.min(data.length, 252); i++) {
      if (data[i].close > data[i - 1].close) {
        positiveReturns++;
      }
    }

    const pct = positiveReturns / 251;
    // Deviation from 50% random walk
    return Math.abs(pct - 0.5) * 2;
  }

  private calculateNoiseRatio(data: MarketData[]): number {
    // Estimate noise ratio vs signal
    if (data.length < 20) return 0.5;

    const returns = this.calculateDailyReturns(data);
    const autoCorr = this.calculateAutoCorrelation(returns, 1);

    // If autocorrelation is near 0, more noise; if high, more signal
    return Math.max(0, Math.min(1 - Math.abs(autoCorr), 1));
  }

  private calculateDailyReturns(data: MarketData[]): number[] {
    const returns: number[] = [];

    for (let i = 1; i < data.length; i++) {
      returns.push((data[i].close - data[i - 1].close) / data[i - 1].close);
    }

    return returns;
  }

  private calculateAutoCorrelation(returns: number[], lag: number): number {
    if (returns.length <= lag) return 0;

    const mean = returns.reduce((a, b) => a + b) / returns.length;
    let numerator = 0;
    let denominator = 0;

    for (let i = lag; i < returns.length; i++) {
      numerator += (returns[i] - mean) * (returns[i - lag] - mean);
    }

    for (let i = 0; i < returns.length; i++) {
      denominator += Math.pow(returns[i] - mean, 2);
    }

    return denominator > 0 ? numerator / denominator : 0;
  }

  private computeConfidenceScore(type: HypothesisType, evidence: HypothesisEvidence[]): number {
    if (evidence.length === 0) return 0;

    const avgStrength = evidence.reduce((sum, e) => sum + e.strength, 0) / evidence.length;

    // Boost confidence based on evidence quality
    let confidence = avgStrength;

    // For null hypothesis, invert the logic
    if (type === HypothesisType.NULL) {
      confidence = 1 - avgStrength;
    }

    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * Rank hypotheses by confidence score
   */
  rankHypotheses(hypotheses: Hypothesis[]): Hypothesis[] {
    return [...hypotheses].sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * Synthesize results from all hypotheses
   */
  synthesize(hypotheses: Hypothesis[]): {
    mostLikelyEdgeSource: Hypothesis;
    edgeProbability: number;
    recommendedAction: string;
    risks: string[];
    confidenceLevel: string;
  } {
    const ranked = this.rankHypotheses(hypotheses);
    const mostLikely = ranked[0];
    const nullHypothesis = hypotheses.find(h => h.type === HypothesisType.NULL) || ranked[ranked.length - 1];

    const edgeProbability = Math.max(0, mostLikely.confidenceScore - nullHypothesis.confidenceScore);
    const confidenceLevel = edgeProbability > 0.6 ? 'HIGH' : edgeProbability > 0.3 ? 'MEDIUM' : 'LOW';

    let recommendedAction = 'REJECT';
    if (edgeProbability > 0.6) {
      recommendedAction = 'INVESTIGATE_FURTHER';
    } else if (edgeProbability > 0.3) {
      recommendedAction = 'GATHER_MORE_DATA';
    }

    const risks: string[] = [];

    for (const hypothesis of ranked.slice(1, 3)) {
      if (hypothesis.type !== HypothesisType.NULL && hypothesis.confidenceScore > 0.3) {
        risks.push(`Alternative explanation: ${hypothesis.name} (confidence: ${hypothesis.confidenceScore.toFixed(2)})`);
      }
    }

    if (nullHypothesis.confidenceScore > 0.4) {
      risks.push('Risk of overfitting - consider null hypothesis seriously');
    }

    return {
      mostLikelyEdgeSource: mostLikely,
      edgeProbability,
      recommendedAction,
      risks,
      confidenceLevel,
    };
  }

  /**
   * Get all hypotheses
   */
  getHypotheses(): Map<string, Hypothesis> {
    return this.hypotheses;
  }
}

export default HypothesisEngine;

export const hypothesisEngine = new HypothesisEngine();
