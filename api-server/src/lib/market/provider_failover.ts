/**
 * Provider Failover — Multi-provider data feed failover.
 * Tracks provider health and routes to healthy providers.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface ProviderHealth {
  provider: string;
  healthy: boolean;
  successCount: number;
  failureCount: number;
  lastSuccess: number | null;
  lastFailure: number | null;
  avgLatencyMs: number;
}

export interface FailoverDecision {
  shouldFailover: boolean;
  from: string;
  to: string | null;
  reason: string;
}

export interface FailoverConfig {
  maxConsecutiveFailures: number;
  recoveryProbeIntervalMs: number;
  providers: string[];
}

export interface FailoverStatus {
  currentProvider: string;
  providers: ProviderHealth[];
  lastFailover: FailoverDecision | null;
  config: FailoverConfig;
}

// ── State ──────────────────────────────────────────────────────────────

const healthMap = new Map<string, ProviderHealth>();
let currentProvider = "alpaca";
let lastFailoverDecision: FailoverDecision | null = null;
let config: FailoverConfig = {
  maxConsecutiveFailures: 3,
  recoveryProbeIntervalMs: 60000,
  providers: ["alpaca", "tiingo"],
};

function getOrCreateHealth(provider: string): ProviderHealth {
  if (!healthMap.has(provider)) {
    healthMap.set(provider, {
      provider,
      healthy: true,
      successCount: 0,
      failureCount: 0,
      lastSuccess: null,
      lastFailure: null,
      avgLatencyMs: 0,
    });
  }
  return healthMap.get(provider)!;
}

// ── Functions ──────────────────────────────────────────────────────────

export function recordSuccess(provider: string, latencyMs?: number): void {
  const h = getOrCreateHealth(provider);
  h.successCount++;
  h.lastSuccess = Date.now();
  h.healthy = true;
  if (latencyMs) h.avgLatencyMs = (h.avgLatencyMs * 0.9) + (latencyMs * 0.1);
}

export function recordFailure(provider: string): void {
  const h = getOrCreateHealth(provider);
  h.failureCount++;
  h.lastFailure = Date.now();
  if (h.failureCount >= config.maxConsecutiveFailures) h.healthy = false;
}

export function getProviderHealth(provider: string): ProviderHealth {
  return getOrCreateHealth(provider);
}

export function getAllProviderHealth(): ProviderHealth[] {
  return config.providers.map(p => getOrCreateHealth(p));
}

export function getNextHealthyProvider(): string | null {
  for (const p of config.providers) {
    if (p !== currentProvider && getOrCreateHealth(p).healthy) return p;
  }
  return null;
}

export function evaluateFailover(): FailoverDecision {
  const current = getOrCreateHealth(currentProvider);
  if (current.healthy) {
    return { shouldFailover: false, from: currentProvider, to: null, reason: "Current provider healthy" };
  }
  const next = getNextHealthyProvider();
  return {
    shouldFailover: !!next,
    from: currentProvider,
    to: next,
    reason: next ? `Failing over to ${next}` : "No healthy providers available",
  };
}

export function performFailover(): FailoverDecision {
  const decision = evaluateFailover();
  if (decision.shouldFailover && decision.to) {
    currentProvider = decision.to;
    lastFailoverDecision = decision;
  }
  return decision;
}

export function getCurrentProvider(): string { return currentProvider; }
export function setCurrentProvider(p: string): void { currentProvider = p; }
export function getLastFailover(): FailoverDecision | null { return lastFailoverDecision; }

export function updateFailoverConfig(updates: Partial<FailoverConfig>): void {
  config = { ...config, ...updates };
}

export function getFailoverConfig(): FailoverConfig { return { ...config }; }

export function resetHealthMetrics(): void {
  healthMap.clear();
}

export function getFailoverStatus(): FailoverStatus {
  return {
    currentProvider,
    providers: getAllProviderHealth(),
    lastFailover: lastFailoverDecision,
    config: { ...config },
  };
}

export function probeRecovery(provider: string): boolean {
  const h = getOrCreateHealth(provider);
  if (!h.healthy && h.lastFailure) {
    const elapsed = Date.now() - h.lastFailure;
    if (elapsed > config.recoveryProbeIntervalMs) {
      h.healthy = true;
      h.failureCount = 0;
      return true;
    }
  }
  return false;
}
