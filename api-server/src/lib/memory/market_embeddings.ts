/**
 * market_embeddings.ts — Market State Embedding System
 *
 * Converts market snapshots into feature vectors for similarity search.
 *
 * Features:
 *   - Z-score normalization of market features
 *   - Cosine similarity for vector comparison
 *   - K-NN retrieval with outcome weighting
 *   - Regime shift detection via embedding drift
 *   - Clustering of similar market states
 */

import { logger } from "../logger";

/**
 * Market state snapshot for embedding
 */
export interface MarketState {
  timestamp: number;
  symbol: string;
  // Price features
  price: number;
  returns1m: number;
  returns5m: number;
  returns15m: number;
  returns1h: number;
  atr14: number;
  atrPercentile: number;
  // Volume features
  volume: number;
  volumeRatio: number; // vs 20-bar avg
  cvd: number;
  delta: number;
  // Structure features
  distanceFromVwap: number;
  distanceFromEma20: number;
  distanceFromEma50: number;
  rsi14: number;
  macdHistogram: number;
  bbPercentB: number; // Bollinger %B
  // Regime features
  regime: string;
  regimeStrength: number;
  trendStrength: number;
  volatilityPercentile: number;
  // Session
  session: string;
  minutesSinceOpen: number;
}

/**
 * Trade outcome for learning
 */
export interface TradeOutcome {
  entry: number;
  exit: number;
  maxProfit: number;
  maxLoss: number;
  pnl: number;
  pnlPercent: number;
  holdTime: number; // ms
  win: boolean;
}

/**
 * Similar state with outcome
 */
export interface SimilarState {
  state: MarketState;
  similarity: number; // 0-1
  outcome?: TradeOutcome;
  timeSince: number; // ms since this state
}
/**
 * Market cluster
 */
export interface MarketCluster {
  centroid: Float64Array;
  members: MarketState[];
  avgOutcome: {
    winRate: number;
    avgPnl: number;
    avgPnlPercent: number;
    sampleSize: number;
  };
}

/**
 * Regime shift signal
 */
export interface RegimeShiftSignal {
  detected: boolean;
  embeddingDrift: number; // 0-1, how much has changed
  confidence: number; // 0-1
  oldCentroid: Float64Array;
  newCentroid: Float64Array;
  affectedFeatures: string[];
}

class MarketEmbeddings {
  private stateIndex: Map<string, MarketState> = new Map();
  private outcomeIndex: Map<string, TradeOutcome> = new Map();
  private featureStats: FeatureStatistics = {};

  private readonly FEATURE_KEYS: (keyof MarketState)[] = [
    "price",
    "returns1m",
    "returns5m",
    "returns15m",
    "returns1h",
    "atr14",
    "atrPercentile",
    "volume",
    "volumeRatio",
    "cvd",
    "delta",
    "distanceFromVwap",
    "distanceFromEma20",
    "distanceFromEma50",
    "rsi14",
    "macdHistogram",
    "bbPercentB",
    "regimeStrength",
    "trendStrength",
    "volatilityPercentile",
    "minutesSinceOpen",
  ];

  /**
   * Encode market state into normalized feature vector
   */
  encode(state: MarketState): Float64Array {
    const vector = new Float64Array(this.FEATURE_KEYS.length);

    for (let i = 0; i < this.FEATURE_KEYS.length; i++) {
      const key = this.FEATURE_KEYS[i];
      const value = (state[key] as number) || 0;

      // Z-score normalization
      const stats = this.featureStats[key] || { mean: 0, stddev: 1 };
      vector[i] = stats.stddev > 0 ? (value - stats.mean) / stats.stddev : 0;
    }

    return vector;
  }
  /**
   * Find N most similar historical states
   */
  findSimilar(current: MarketState, n: number = 10): SimilarState[] {
    const currentVec = this.encode(current);
    const candidates: SimilarState[] = [];

    for (const [stateId, state] of this.stateIndex.entries()) {
      // Same symbol only
      if (state.symbol !== current.symbol) continue;

      const stateVec = this.encode(state);
      const similarity = this.cosineSimilarity(currentVec, stateVec);

      if (similarity > 0.3) {
        const outcome = this.outcomeIndex.get(stateId);
        candidates.push({
          state,
          similarity,
          outcome,
          timeSince: current.timestamp - state.timestamp,
        });
      }
    }

    // Sort by similarity, distance-weight outcomes
    candidates.sort((a, b) => {
      const scoreA = a.similarity * (a.outcome ? (a.outcome.win ? 1.2 : 0.8) : 1);
      const scoreB = b.similarity * (b.outcome ? (b.outcome.win ? 1.2 : 0.8) : 1);
      return scoreB - scoreA;
    });

    return candidates.slice(0, n);
  }

  /**
   * Add state and outcome to index
   */
  addToIndex(state: MarketState, outcome?: TradeOutcome): void {
    const stateId = `${state.symbol}-${state.timestamp}`;
    this.stateIndex.set(stateId, state);

    if (outcome) {
      this.outcomeIndex.set(stateId, outcome);
    }

    // Update feature statistics
    this.updateFeatureStats(state);
  }

  /**
   * Cluster similar market states
   */
  clusterStates(states: MarketState[]): MarketCluster[] {
    if (states.length === 0) return [];

    const vectors = states.map((s) => this.encode(s));
    const k = Math.min(3, Math.ceil(Math.sqrt(states.length)));

    return this.kMeansClustering(vectors, states, k);
  }
  /**
   * Detect regime transitions via embedding drift
   */
  detectRegimeShift(
    recent: MarketState[],
    historical: MarketState[],
    threshold: number = 0.4,
  ): RegimeShiftSignal {
    if (recent.length === 0 || historical.length === 0) {
      return {
        detected: false,
        embeddingDrift: 0,
        confidence: 0,
        oldCentroid: new Float64Array(this.FEATURE_KEYS.length),
        newCentroid: new Float64Array(this.FEATURE_KEYS.length),
        affectedFeatures: [],
      };
    }

    const recentVecs = recent.map((s) => this.encode(s));
    const historicalVecs = historical.map((s) => this.encode(s));

    const recentCentroid = this.centroid(recentVecs);
    const historicalCentroid = this.centroid(historicalVecs);

    const drift = this.cosineSimilarity(recentCentroid, historicalCentroid);
    const embeddingDrift = 1 - drift;

    // Find affected features
    const affectedFeatures: string[] = [];
    for (let i = 0; i < this.FEATURE_KEYS.length; i++) {
      const diff = Math.abs(recentCentroid[i] - historicalCentroid[i]);
      if (diff > 0.3) {
        affectedFeatures.push(this.FEATURE_KEYS[i]);
      }
    }

    return {
      detected: embeddingDrift > threshold,
      embeddingDrift,
      confidence: Math.min(1, embeddingDrift / threshold),
      oldCentroid: historicalCentroid,
      newCentroid: recentCentroid,
      affectedFeatures,
    };
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float64Array, b: Float64Array): number {
    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magA * magB);
    if (magnitude === 0) return 0;

    const sim = dotProduct / magnitude;
    // Scale from [-1, 1] to [0, 1]
    return (sim + 1) / 2;
  }
  /**
   * Compute centroid of multiple vectors
   */
  private centroid(vectors: Float64Array[]): Float64Array {
    if (vectors.length === 0) {
      return new Float64Array(this.FEATURE_KEYS.length);
    }

    const result = new Float64Array(vectors[0].length);

    for (const vec of vectors) {
      for (let i = 0; i < vec.length; i++) {
        result[i] += vec[i];
      }
    }

    for (let i = 0; i < result.length; i++) {
      result[i] /= vectors.length;
    }

    return result;
  }

  /**
   * Simple K-means clustering
   */
  private kMeansClustering(
    vectors: Float64Array[],
    states: MarketState[],
    k: number,
    maxIter: number = 10,
  ): MarketCluster[] {
    // Initialize random centroids
    let centroids: Float64Array[] = [];
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(Math.random() * vectors.length);
      centroids.push(new Float64Array(vectors[idx]));
    }

    let assignments: number[] = new Array(vectors.length).fill(0);

    // Iterate
    for (let iter = 0; iter < maxIter; iter++) {
      // Assign points to nearest centroid
      for (let i = 0; i < vectors.length; i++) {
        let bestDist = Infinity;
        let bestCluster = 0;

        for (let j = 0; j < centroids.length; j++) {
          const dist = 1 - this.cosineSimilarity(vectors[i], centroids[j]);
          if (dist < bestDist) {
            bestDist = dist;
            bestCluster = j;
          }
        }

        assignments[i] = bestCluster;
      }

      // Update centroids
      const newCentroids: Float64Array[] = [];
      for (let j = 0; j < k; j++) {
        const cluster = vectors.filter((_, i) => assignments[i] === j);
        newCentroids.push(cluster.length > 0 ? this.centroid(cluster) : centroids[j]);
      }

      centroids = newCentroids;
    }

    // Build result clusters
    const clusters: MarketCluster[] = [];

    for (let j = 0; j < k; j++) {
      const memberIndices = assignments
        .map((a, i) => (a === j ? i : -1))
        .filter((i) => i !== -1);

      const members = memberIndices.map((i) => states[i]);
      const outcomes = memberIndices
        .map((i) => this.outcomeIndex.get(`${states[i].symbol}-${states[i].timestamp}`))
        .filter((o) => o !== undefined) as TradeOutcome[];

      const winRate = outcomes.length > 0 ? outcomes.filter((o) => o.win).length / outcomes.length : 0;
      const avgPnl = outcomes.length > 0 ? outcomes.reduce((a, o) => a + o.pnl, 0) / outcomes.length : 0;
      const avgPnlPercent =
        outcomes.length > 0 ? outcomes.reduce((a, o) => a + o.pnlPercent, 0) / outcomes.length : 0;

      clusters.push({
        centroid: centroids[j],
        members,
        avgOutcome: {
          winRate,
          avgPnl,
          avgPnlPercent,
          sampleSize: outcomes.length,
        },
      });
    }

    return clusters;
  }
  /**
   * Update running statistics for z-score normalization
   */
  private updateFeatureStats(state: MarketState): void {
    for (const key of this.FEATURE_KEYS) {
      const value = (state[key] as number) || 0;

      if (!this.featureStats[key]) {
        this.featureStats[key] = {
          mean: value,
          stddev: 0,
          count: 1,
          m2: 0, // Welford's M2
        };
      } else {
        const stats = this.featureStats[key];
        const delta = value - stats.mean;
        stats.count += 1;
        stats.mean += delta / stats.count;
        stats.m2 += delta * (value - stats.mean);
        stats.stddev = Math.sqrt(stats.m2 / (stats.count - 1));
      }
    }
  }

  /**
   * Get current statistics
   */
  getStats(): {
    indexSize: number;
    outcomesCaptured: number;
    featuresTracked: number;
  } {
    return {
      indexSize: this.stateIndex.size,
      outcomesCaptured: this.outcomeIndex.size,
      featuresTracked: this.FEATURE_KEYS.length,
    };
  }
}

interface FeatureStatistics {
  [key: string]: {
    mean: number;
    stddev: number;
    count: number;
    m2: number;
  };
}

export const marketEmbeddings = new MarketEmbeddings();
