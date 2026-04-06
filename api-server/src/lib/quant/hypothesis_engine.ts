/**
 * hypothesis_engine.ts — GodsView Quant Reasoning: Multi-Hypothesis Strategy Analysis
 *
 * Generate, test, and rank multiple hypotheses about why a strategy should work.
 * Real quant reasoning: analyze whether returns come from structural market edges vs noise.
 *
 * Key responsibilities:
 * - Generate testable hypotheses about edge sources (behavioral, microstructure, info asymmetry)
 * - Test each hypothesis against historical evidence
 * - Assess edge durability and crowding risk
 * - Distinguish real edges from random walks
 */

export interface Hypothesis {
  id: string;
  description: string;
  edgeSource: string; // market inefficiency exploited
  expectedBehavior: {
    bestRegimes: string[];
    worstRegimes: string[];
    expectedWinRate: [number, number]; // [low, high]
    expectedSharpe: [number, number];
    expectedDrawdown: [number, number]; // [typical, worst-case]
  };
  assumptions: string[];
  falsificationCriteria: string[]; // what disproves this
  marketStructureFit: number; // 0-1: how well does this exploit current market structure
  crowdingRisk: number; // 0-1: how likely is this already arbed away
  decayRisk: number; // 0-1: risk of edge eroding
}

export interface HypothesisResult {
  hypothesis: Hypothesis;
  testScore: number; // 0-1: how well evidence supports this
  evidenceStrength: number; // statistical significance
  contradictions: string[]; // what evidence contradicts this
  supportingEvidence: string[];
  rank: number;
}

export interface RankedHypothesis extends HypothesisResult {
  confidence: number; // 0-1
  expectedDurabilityMonths: number;
}

export interface EdgeAssessment {
  hasRealEdge: boolean;
  confidence: number;
  edgeSources: {
    source: string;
    contribution: number; // % of edge from this source
    durability: number; // 0-1 how long it lasts
  }[];
  noiseRisk: number; // 0-1 risk returns are just luck
  overfitProbability: number; // based on parameter count + sample size
  expectedEdgeDecayMonths: number;
  verdict: string;
  reasoning: string[];
}

export interface HistoricalEvidence {
  winRate: number;
  sharpe: number;
  maxDrawdown: number;
  totalTrades: number;
  profitFactor: number; // gross profit / gross loss
  recoveryFactor: number; // net profit / max drawdown
  regimePerformance: Record<string, { winRate: number; sharpe: number }>;
  tradeLength: { avg: number; median: number };
  monthlyConsistency: number; // % of positive months
  parameterCount: number;
  inSampleTests: number; // how many parameter combos tested
  outOfSampleDecay: number; // in-sample Sharpe vs out-sample
}

class HypothesisEngine {
  /**
   * Generate multiple hypotheses about why a strategy should work
   */
  generateHypotheses(strategy: any): Hypothesis[] {
    const hypotheses: Hypothesis[] = [];

    // Extract strategy components
    const entry = strategy.entry || {};
    const exit = strategy.exit || {};
    const filters = strategy.filters || {};
    const regime = strategy.regime || null;

    // HYPOTHESIS 1: Behavioral Bias Exploitation (mean reversion)
    if (this.hasRelativeStrengthComponent(entry)) {
      hypotheses.push({
        id: "h_behavioral_exhaustion",
        description:
          "Strategy exploits mean reversion by buying/selling after exhaustion signals. Assumes retail traders overextend.",
        edgeSource: "Behavioral bias: exhaustion patterns",
        expectedBehavior: {
          bestRegimes: ["ranging", "mean_reverting"],
          worstRegimes: ["strong_trend"],
          expectedWinRate: [0.55, 0.65],
          expectedSharpe: [0.8, 1.5],
          expectedDrawdown: [0.10, 0.25],
        },
        assumptions: [
          "Retail traders cause predictable overextensions",
          "Exhaustion signals precede reversals by 1-5 bars",
          "Effect persists across market cap tiers",
        ],
        falsificationCriteria: [
          "Win rate < 48% in any major regime",
          "Sharpe < 0.3 out-of-sample",
          "Drawdown exceeds 35%",
          "Edge disappears in 2023+",
        ],
        marketStructureFit: 0.7,
        crowdingRisk: 0.6,
        decayRisk: 0.5,
      });
    }

    // HYPOTHESIS 2: Microstructure Edge (order flow)
    if (this.hasMicrostructureComponent(entry)) {
      hypotheses.push({
        id: "h_microstructure",
        description:
          "Strategy reads market microstructure: volume imbalances, order clustering, spread pressure indicate direction.",
        edgeSource: "Market microstructure: imbalances in intrabar order flow",
        expectedBehavior: {
          bestRegimes: ["volatile", "high_volume"],
          worstRegimes: ["low_liquidity"],
          expectedWinRate: [0.52, 0.60],
          expectedSharpe: [0.5, 1.2],
          expectedDrawdown: [0.15, 0.30],
        },
        assumptions: [
          "Order flow imbalances predict short-term direction",
          "Effect size > market impact costs",
          "Predictive window is 5-20 bars",
          "Works on 5-min+ timeframes",
        ],
        falsificationCriteria: [
          "Stops working on venues with better filling (low latency impact)",
          "Sharpe < 0.5 out-of-sample",
          "Win rate deteriorates in low-volume regimes",
          "Edge erodes with increased retail participation",
        ],
        marketStructureFit: 0.6,
        crowdingRisk: 0.7, // microstructure edges get crowded fast
        decayRisk: 0.7,
      });
    }

    // HYPOTHESIS 3: Information Asymmetry (insider/smart money behavior)
    if (this.hasInformationComponent(entry)) {
      hypotheses.push({
        id: "h_info_asymmetry",
        description:
          "Strategy reads smart money footprints: large block trades, options activity, insider patterns.",
        edgeSource: "Information asymmetry: delayed price discovery",
        expectedBehavior: {
          bestRegimes: ["earnings_season", "high_volatility"],
          worstRegimes: ["low_information"],
          expectedWinRate: [0.50, 0.58],
          expectedSharpe: [0.4, 1.0],
          expectedDrawdown: [0.20, 0.40],
        },
        assumptions: [
          "Smart money leaves detectable footprints",
          "Retail crowd follows smart money with lag",
          "Information diffuses over 5-60 minute window",
        ],
        falsificationCriteria: [
          "Works equally well on randomized data",
          "No better than 50% win rate",
          "Edge exists on same-day signals (too obvious)",
          "Breaks when news arrives before signals",
        ],
        marketStructureFit: 0.5,
        crowdingRisk: 0.8, // these edges get arbed away
        decayRisk: 0.8,
      });
    }

    // HYPOTHESIS 4: Regime-Dependent Structural Edge
    if (regime) {
      hypotheses.push({
        id: "h_regime_structure",
        description:
          `Strategy works because it's perfectly matched to ${regime} regime. Edge depends on market staying in this regime.`,
        edgeSource: `Regime-dependent structural edge (${regime} only)`,
        expectedBehavior: {
          bestRegimes: [regime],
          worstRegimes: Object.keys(this.getOppositeRegimes(regime)),
          expectedWinRate: [0.54, 0.62],
          expectedSharpe: [0.7, 1.3],
          expectedDrawdown: [0.10, 0.25],
        },
        assumptions: [
          `Current regime (${regime}) persists for trading horizon`,
          "Strategy breaks if regime shifts",