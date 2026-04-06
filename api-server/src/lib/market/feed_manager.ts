/**
 * feed_manager.ts — Multi-provider feed management with automatic failover
 *
 * Manages multiple data providers (Alpaca, Binance, etc.) with:
 * - Automatic failover when primary feed degrades
 * - Health monitoring and latency tracking
 * - Priority-based provider selection
 * - Degradation handling and recovery probing
 * - Symbol/timeframe coverage tracking
 */

import { NormalizedBar } from "./normalized_schema";
import { DataNormalizer } from "./data_normalizer";

export enum ProviderStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  DOWN = "down",
}

export interface ProviderHealth {
  provider: string;
  status: ProviderStatus;
  lastCheck: number;
  latencyMs: number;
  errorRate: number;
  uptime: number;
  lastError?: string;
  consecutiveErrors: number;
  successCount: number;
}

export interface DataProvider {
  name: string;
  type: "rest" | "websocket" | "fix";
  symbols: string[];
  timeframes: string[];
  priority: number;
  fetchBars(symbol: string, timeframe: string, limit: number): Promise<any>;
  getPrice?(symbol: string): Promise<any>;
  isHealthy(): boolean;
}

export interface PriceSnapshot {
  symbol: string;
  price: number;
  timestamp: number;
  provider: string;
  bid?: number;
  ask?: number;
  volume?: number;
}

export interface FeedHealthReport {
  overall: ProviderStatus;
  providers: ProviderHealth[];
  coveredSymbols: string[];
  uncoveredSymbols: string[];
  recommendations: string[];
  timestamp: number;
}

export interface LatencyReport {
  averageLatencyMs: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  slowestProvider: string;
  fastestProvider: string;
  providerStats: Record<string, { avg: number; min: number; max: number }>;
}

export interface DegradationAction {
  action: "failover" | "degrade" | "recover" | "none";
  fromProvider: string;
  toProvider?: string;
  reason: string;
  severity: "low" | "medium" | "high";
}

export class FeedManager {
  private providers = new Map<string, DataProvider>();
  private healthStatus = new Map<string, ProviderHealth>();
  private normalizer = new DataNormalizer();
  private latencyHistory = new Map<string, number[]>(); // provider -> latencies
  private currentProvider = new Map<string, string>(); // symbol -> provider
  private failoverLog: DegradationAction[] = [];
  private readonly maxLatencyHistorySize = 1000;
  private readonly unhealthyThreshold = 5; // consecutive errors
  private readonly recoveryProbeInterval = 30000; // 30s

  /**
   * Register a data provider
   */
  registerProvider(name: string, provider: DataProvider): void {
    this.providers.set(name, provider);
    this.healthStatus.set(name, {
      provider: name,
      status: ProviderStatus.HEALTHY,
      lastCheck: Date.now(),
      latencyMs: 0,
      errorRate: 0,
      uptime: 100,
      consecutiveErrors: 0,
      successCount: 0,
    });
    this.latencyHistory.set(name, []);

    console.log(
      `FeedManager: Registered provider "${name}" (${provider.type})`
    );
  }

  /**
   * Get bars with automatic failover
   */
  async getBars(
    symbol: string,
    timeframe: string,
    limit: number
  ): Promise<NormalizedBar[]> {
    const providers = this.getProvidersForSymbol(symbol, timeframe);

    if (providers.length === 0) {
      throw new Error(
        `No providers available for ${symbol}/${timeframe}`
      );
    }

    // Try each provider in priority order
    for (const providerName of providers) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      try {
        const startMs = Date.now();
        const raw = await provider.fetchBars(symbol, timeframe, limit);
        const latencyMs = Date.now() - startMs;

        // Record success
        this.recordSuccess(providerName, latencyMs);
        this.currentProvider.set(symbol, providerName);

        // Normalize the response
        const normalized = this.normalizer.normalizeBars(raw, provider.name);
        return normalized;
      } catch (error) {
        this.recordFailure(
          providerName,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    throw new Error(
      `All providers failed for ${symbol}/${timeframe}`
    );
  }

  /**
   * Get real-time price with best available source
   */
  async getPrice(symbol: string): Promise<PriceSnapshot> {
    const providers = this.getProvidersForSymbol(symbol, "1m");

    if (providers.length === 0) {
      throw new Error(`No price providers for ${symbol}`);
    }

    // Try primary first, then fallback
    for (const providerName of providers) {
      const provider = this.providers.get(providerName);
      if (!provider || !provider.getPrice) continue;

      try {
        const startMs = Date.now();
        const raw = await provider.getPrice(symbol);
        const latencyMs = Date.now() - startMs;

        this.recordSuccess(providerName, latencyMs);

        return {
          symbol,
          price: Number(raw.price || raw.close || raw.c || 0),
          timestamp: Date.now(),
          provider: providerName,
          bid: raw.bid || raw.b,
          ask: raw.ask || raw.a,
          volume: raw.volume || raw.v,
        };
      } catch (error) {
        this.recordFailure(
          providerName,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    throw new Error(`All providers failed to get price for ${symbol}`);
  }

  /**
   * Monitor feed health
   */
  checkHealth(): FeedHealthReport {
    const allSymbols = new Set<string>();
    const healthyProviders: ProviderHealth[] = [];
    const allProviders: ProviderHealth[] = [];

    for (const [name, provider] of this.providers) {
      const health = this.healthStatus.get(name);
      if (health) {
        allProviders.push(health);
        provider.symbols.forEach((s) => allSymbols.add(s));

        // Update status based on consecutive errors
        if (health.consecutiveErrors >= this.unhealthyThreshold) {
          health.status = ProviderStatus.DOWN;
        } else if (health.errorRate > 0.1 || health.latencyMs > 5000) {
          health.status = ProviderStatus.DEGRADED;
        } else {
          health.status = ProviderStatus.HEALTHY;
        }

        if (health.status === ProviderStatus.HEALTHY) {
          healthyProviders.push(health);
        }
      }
    }

    const coveredSymbols = Array.from(allSymbols);
    const uncoveredSymbols: string[] = []; // Would need external symbol list

    // Determine overall status
    const overallStatus =
      healthyProviders.length === 0
        ? ProviderStatus.DOWN
        : healthyProviders.length === allProviders.length
          ? ProviderStatus.HEALTHY
          : ProviderStatus.DEGRADED;

    // Generate recommendations
    const recommendations: string[] = [];
    for (const health of allProviders) {
      if (health.status === ProviderStatus.DOWN) {
        recommendations.push(
          `Provider "${health.provider}" is down - investigate and restart`
        );
      } else if (health.status === ProviderStatus.DEGRADED) {
        recommendations.push(
          `Provider "${health.provider}" is degraded (${(health.errorRate * 100).toFixed(1)}% errors) - consider failover`
        );
      }
    }

    if (
      uncoveredSymbols.length > 0 &&
      healthyProviders.length < allProviders.length
    ) {
      recommendations.push(
        `Consider enabling backup provider to cover ${uncoveredSymbols.length} uncovered symbols`
      );
    }

    return {
      overall: overallStatus,
      providers: allProviders,
      coveredSymbols,
      uncoveredSymbols,
      recommendations,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle degraded feeds
   */
  handleDegradation(provider: string, issue: string): DegradationAction {
    const health = this.healthStatus.get(provider);
    if (!health) {
      return {
        action: "none",
        fromProvider: provider,
        reason: "Provider not found",
        severity: "low",
      };
    }

    // Find a healthy backup
    const backup = this.findBackupProvider(provider);

    if (!backup) {
      const action: DegradationAction = {
        action: "degrade",
        fromProvider: provider,
        reason: issue,
        severity: "high",
      };
      this.failoverLog.push(action);
      return action;
    }

    const action: DegradationAction = {
      action: "failover",
      fromProvider: provider,
      toProvider: backup,
      reason: issue,
      severity: "medium",
    };
    this.failoverLog.push(action);

    // Switch to backup for symbols that were on failed provider
    for (const [symbol, current] of this.currentProvider) {
      if (current === provider) {
        this.currentProvider.set(symbol, backup);
      }
    }

    return action;
  }

  /**
   * Get feed latency stats
   */
  getLatencyStats(): LatencyReport {
    const allLatencies: number[] = [];
    const providerStats: Record<string, { avg: number; min: number; max: number }> = {};

    for (const [provider, latencies] of this.latencyHistory) {
      if (latencies.length === 0) continue;

      const sorted = [...latencies].sort((a, b) => a - b);
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const min = Math.min(...sorted);
      const max = Math.max(...sorted);

      providerStats[provider] = { avg, min, max };
      allLatencies.push(...latencies);
    }

    const sorted = [...allLatencies].sort((a, b) => a - b);
    const avg =
      allLatencies.length > 0
        ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
        : 0;
    const median =
      allLatencies.length > 0
        ? sorted[Math.floor(sorted.length / 2)]
        : 0;
    const p95 =
      allLatencies.length > 0
        ? sorted[Math.floor(sorted.length * 0.95)]
        : 0;
    const p99 =
      allLatencies.length > 0
        ? sorted[Math.floor(sorted.length * 0.99)]
        : 0;

    const providerLatencies = Object.entries(providerStats).map(
      ([p, { avg: a }]) => ({ provider: p, latency: a })
    );

    const slowest = providerLatencies.length > 0
      ? providerLatencies.reduce((max, cur) =>
          cur.latency > max.latency ? cur : max
        )
      : { provider: "N/A", latency: 0 };

    const fastest = providerLatencies.length > 0
      ? providerLatencies.reduce((min, cur) =>
          cur.latency < min.latency ? cur : min
        )
      : { provider: "N/A", latency: 0 };

    return {
      averageLatencyMs: avg,
      medianLatencyMs: median,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      slowestProvider: slowest.provider,
      fastestProvider: fastest.provider,
      providerStats,
    };
  }

  /**
   * Get current provider for a symbol
   */
  getCurrentProvider(symbol: string): string | undefined {
    return this.currentProvider.get(symbol);
  }

  /**
   * Get failover history
   */
  getFailoverLog(): DegradationAction[] {
    return [...this.failoverLog].slice(-100); // Last 100 events
  }

  // ──────────────────────────────────────────────────────────────────────────

  private recordSuccess(provider: string, latencyMs: number): void {
    const health = this.healthStatus.get(provider);
    if (!health) return;

    health.lastCheck = Date.now();
    health.consecutiveErrors = 0;
    health.successCount++;
    health.latencyMs = latencyMs;

    // Update error rate (exponential moving average)
    health.errorRate = health.errorRate * 0.9 + 0 * 0.1;

    // Track latency history
    const history = this.latencyHistory.get(provider) || [];
    history.push(latencyMs);
    if (history.length > this.maxLatencyHistorySize) {
      history.shift();
    }
    this.latencyHistory.set(provider, history);
  }

  private recordFailure(provider: string, error: string): void {
    const health = this.healthStatus.get(provider);
    if (!health) return;

    health.lastCheck = Date.now();
    health.consecutiveErrors++;
    health.lastError = error;

    // Update error rate (exponential moving average)
    health.errorRate = health.errorRate * 0.9 + 1 * 0.1;

    // Update uptime
    if (health.successCount > 0) {
      const total = health.successCount + health.consecutiveErrors;
      health.uptime =
        ((health.successCount) / total) * 100;
    }
  }

  private getProvidersForSymbol(
    symbol: string,
    timeframe: string
  ): string[] {
    const candidates: { name: string; priority: number }[] = [];

    for (const [name, provider] of this.providers) {
      if (
        provider.symbols.includes(symbol) &&
        provider.timeframes.includes(timeframe)
      ) {
        candidates.push({ name, priority: provider.priority });
      }
    }

    // Sort by priority (lower = higher priority)
    candidates.sort((a, b) => a.priority - b.priority);

    // Prefer current provider if healthy
    const current = this.currentProvider.get(symbol);
    if (current) {
      const currentIdx = candidates.findIndex((c) => c.name === current);
      if (currentIdx > 0) {
        const currentCandidate = candidates.splice(currentIdx, 1)[0];
        candidates.unshift(currentCandidate);
      }
    }

    return candidates.map((c) => c.name);
  }

  private findBackupProvider(failedProvider: string): string | undefined {
    const candidates: { name: string; priority: number; healthScore: number }[] = [];

    for (const [name, provider] of this.providers) {
      if (name === failedProvider) continue;

      const health = this.healthStatus.get(name);
      if (!health || health.status === ProviderStatus.DOWN) continue;

      const score = health.uptime - health.errorRate * 100;
      candidates.push({ name, priority: provider.priority, healthScore: score });
    }

    if (candidates.length === 0) return undefined;

    // Prefer healthy providers with lower priority (higher performance)
    candidates.sort((a, b) => {
      if (a.healthScore !== b.healthScore) {
        return b.healthScore - a.healthScore;
      }
      return a.priority - b.priority;
    });

    return candidates[0].name;
  }
}

// Export singleton
export const feedManager = new FeedManager();