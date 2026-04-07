/**
 * Phase 95 — Feature Importance Analyzer
 *
 * Analyzes which features (brain layer scores, market conditions, etc.)
 * are most predictive of trade outcomes. Uses permutation importance
 * and correlation analysis.
 */

export interface FeatureVector {
  tradeId: string;
  outcome: number; // 1 = win, 0 = loss
  pnlR: number;
  features: Record<string, number>;
}

export interface FeatureImportanceResult {
  feature: string;
  importance: number; // 0-1 normalized
  correlation: number; // correlation with outcome
  direction: "positive" | "negative" | "neutral";
  winRateWhenHigh: number; // win rate when feature > median
  winRateWhenLow: number; // win rate when feature <= median
  pnlContribution: number;
  sampleSize: number;
  significance: "high" | "medium" | "low";
}

export interface FeatureInteraction {
  feature1: string;
  feature2: string;
  interactionStrength: number;
  combinedWinRate: number;
  description: string;
}

export interface FeatureAnalysis {
  features: FeatureImportanceResult[];
  topFeatures: string[];
  weakFeatures: string[];
  interactions: FeatureInteraction[];
  recommendations: string[];
}

export class FeatureImportanceAnalyzer {
  private vectors: FeatureVector[] = [];

  /** Add a feature vector from a completed trade */
  addVector(vector: FeatureVector): void {
    this.vectors.push(vector);
  }

  /** Add multiple vectors */
  addVectors(vectors: FeatureVector[]): void {
    this.vectors.push(...vectors);
  }

  /** Run full feature importance analysis */
  analyze(): FeatureAnalysis {
    if (this.vectors.length < 10) {
      return { features: [], topFeatures: [], weakFeatures: [], interactions: [], recommendations: ["Need at least 10 trades for analysis"] };
    }

    const featureNames = Object.keys(this.vectors[0].features);
    const results: FeatureImportanceResult[] = [];

    for (const feature of featureNames) {
      const result = this.analyzeFeature(feature);
      results.push(result);
    }

    // Sort by importance
    results.sort((a, b) => b.importance - a.importance);

    // Identify top and weak features
    const topFeatures = results.filter((f) => f.importance > 0.6).map((f) => f.feature);
    const weakFeatures = results.filter((f) => f.importance < 0.2).map((f) => f.feature);

    // Find interactions
    const interactions = this.findInteractions(results.slice(0, 5));

    // Generate recommendations
    const recommendations = this.generateRecommendations(results, interactions);

    return { features: results, topFeatures, weakFeatures, interactions, recommendations };
  }

  /** Analyze a single feature */
  private analyzeFeature(feature: string): FeatureImportanceResult {
    const values = this.vectors.map((v) => v.features[feature] ?? 0);
    const outcomes = this.vectors.map((v) => v.outcome);
    const pnlRs = this.vectors.map((v) => v.pnlR);

    // Correlation with outcome
    const correlation = this.pearsonCorrelation(values, outcomes);

    // Split by median
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    const highGroup = this.vectors.filter((v) => (v.features[feature] ?? 0) > median);
    const lowGroup = this.vectors.filter((v) => (v.features[feature] ?? 0) <= median);

    const winRateWhenHigh = highGroup.length > 0
      ? highGroup.filter((v) => v.outcome === 1).length / highGroup.length
      : 0;
    const winRateWhenLow = lowGroup.length > 0
      ? lowGroup.filter((v) => v.outcome === 1).length / lowGroup.length
      : 0;

    // P&L contribution via correlation
    const pnlCorrelation = this.pearsonCorrelation(values, pnlRs);

    // Importance = combination of correlation strength and predictive power
    const winRateDiff = Math.abs(winRateWhenHigh - winRateWhenLow);
    const importance = (Math.abs(correlation) * 0.4 + winRateDiff * 0.4 + Math.abs(pnlCorrelation) * 0.2);

    // Significance based on sample size and consistency
    const significance = this.vectors.length >= 50 && Math.abs(correlation) > 0.2
      ? "high"
      : this.vectors.length >= 20 && Math.abs(correlation) > 0.1
      ? "medium"
      : "low";

    return {
      feature,
      importance: Math.min(1, importance),
      correlation,
      direction: correlation > 0.05 ? "positive" : correlation < -0.05 ? "negative" : "neutral",
      winRateWhenHigh,
      winRateWhenLow,
      pnlContribution: pnlCorrelation,
      sampleSize: this.vectors.length,
      significance,
    };
  }

  /** Find feature interactions */
  private findInteractions(topFeatures: FeatureImportanceResult[]): FeatureInteraction[] {
    const interactions: FeatureInteraction[] = [];

    for (let i = 0; i < topFeatures.length; i++) {
      for (let j = i + 1; j < topFeatures.length; j++) {
        const f1 = topFeatures[i].feature;
        const f2 = topFeatures[j].feature;

        const vals1 = this.vectors.map((v) => v.features[f1] ?? 0);
        const vals2 = this.vectors.map((v) => v.features[f2] ?? 0);
        const med1 = this.getMedian(vals1);
        const med2 = this.getMedian(vals2);

        // Both high
        const bothHigh = this.vectors.filter(
          (v) => (v.features[f1] ?? 0) > med1 && (v.features[f2] ?? 0) > med2
        );
        const bothHighWinRate = bothHigh.length > 0
          ? bothHigh.filter((v) => v.outcome === 1).length / bothHigh.length
          : 0;

        // Overall win rate
        const overallWinRate = this.vectors.filter((v) => v.outcome === 1).length / this.vectors.length;
        const lift = bothHighWinRate - overallWinRate;

        if (Math.abs(lift) > 0.1 && bothHigh.length >= 5) {
          interactions.push({
            feature1: f1,
            feature2: f2,
            interactionStrength: Math.abs(lift),
            combinedWinRate: bothHighWinRate,
            description: `When both ${f1} and ${f2} are high, win rate is ${(bothHighWinRate * 100).toFixed(0)}% (${lift > 0 ? "+" : ""}${(lift * 100).toFixed(0)}% vs baseline)`,
          });
        }
      }
    }

    return interactions.sort((a, b) => b.interactionStrength - a.interactionStrength);
  }

  /** Generate actionable recommendations */
  private generateRecommendations(results: FeatureImportanceResult[], interactions: FeatureInteraction[]): string[] {
    const recs: string[] = [];

    const topPositive = results.find((r) => r.direction === "positive" && r.significance !== "low");
    if (topPositive) {
      recs.push(`Increase weight on "${topPositive.feature}" — it has ${(topPositive.correlation * 100).toFixed(0)}% correlation with wins.`);
    }

    const topNegative = results.find((r) => r.direction === "negative" && r.significance !== "low");
    if (topNegative) {
      recs.push(`Consider filtering on "${topNegative.feature}" — high values correlate with losses.`);
    }

    if (interactions.length > 0) {
      const best = interactions[0];
      recs.push(`Strong interaction: ${best.description}. Consider requiring both conditions.`);
    }

    const weak = results.filter((r) => r.importance < 0.1);
    if (weak.length > 0) {
      recs.push(`Features with minimal predictive power: ${weak.map((w) => w.feature).join(", ")}. Consider removing or replacing.`);
    }

    return recs;
  }

  /** Pearson correlation */
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 3) return 0;

    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;

    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    return den > 0 ? num / den : 0;
  }

  private getMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /** Get current sample count */
  getSampleCount(): number {
    return this.vectors.length;
  }

  /** Clear all data */
  reset(): void {
    this.vectors = [];
  }
}
