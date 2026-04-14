/**
 * service_mesh/index.ts — Phase 76: Service Mesh Integration
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. ServiceRegistry      — service registration + discovery.
 *   2. HealthAggregator     — multi-service health rollup.
 *   3. CircuitBreakerMesh   — per-service circuit breakers.
 *   4. RetryBudgetTracker   — retry budgets to prevent retry storms.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Service Registry ──────────────────────────────────────────────────────

export interface ServiceInstance {
  id: string;
  serviceName: string;
  host: string;
  port: number;
  version: string;
  tags: string[];
  registeredAt: number;
  lastHeartbeatAt: number;
  status: "healthy" | "draining" | "unhealthy";
}

export class ServiceRegistry {
  private readonly instances = new Map<string, ServiceInstance>();
  private readonly heartbeatTimeoutMs = 60_000;

  register(params: { serviceName: string; host: string; port: number; version: string; tags?: string[] }): ServiceInstance {
    const id = `svc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const instance: ServiceInstance = {
      id,
      serviceName: params.serviceName,
      host: params.host,
      port: params.port,
      version: params.version,
      tags: params.tags ?? [],
      registeredAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      status: "healthy",
    };
    this.instances.set(id, instance);
    return instance;
  }

  heartbeat(id: string): ServiceInstance | null {
    const inst = this.instances.get(id);
    if (!inst) return null;
    inst.lastHeartbeatAt = Date.now();
    if (inst.status === "unhealthy") inst.status = "healthy";
    return inst;
  }

  drain(id: string): ServiceInstance | null {
    const inst = this.instances.get(id);
    if (!inst) return null;
    inst.status = "draining";
    return inst;
  }

  deregister(id: string): boolean {
    return this.instances.delete(id);
  }

  discover(serviceName: string, opts?: { tag?: string; healthyOnly?: boolean }): ServiceInstance[] {
    this._sweepStale();
    let out = Array.from(this.instances.values()).filter((i) => i.serviceName === serviceName);
    if (opts?.tag) out = out.filter((i) => i.tags.includes(opts.tag!));
    if (opts?.healthyOnly !== false) out = out.filter((i) => i.status === "healthy");
    return out;
  }

  list(): ServiceInstance[] {
    this._sweepStale();
    return Array.from(this.instances.values());
  }

  private _sweepStale(): void {
    const cutoff = Date.now() - this.heartbeatTimeoutMs;
    for (const inst of this.instances.values()) {
      if (inst.lastHeartbeatAt < cutoff && inst.status !== "draining") {
        inst.status = "unhealthy";
      }
    }
  }
}

// ── Health Aggregator ──────────────────────────────────────────────────────

export type HealthSeverity = "ok" | "degraded" | "down";

export interface HealthCheck {
  serviceName: string;
  instanceId: string;
  severity: HealthSeverity;
  message: string;
  at: number;
}

export class HealthAggregator {
  private readonly checks: HealthCheck[] = [];

  record(check: Omit<HealthCheck, "at">): HealthCheck {
    const c: HealthCheck = { ...check, at: Date.now() };
    this.checks.push(c);
    if (this.checks.length > 50_000) this.checks.shift();
    return c;
  }

  serviceHealth(serviceName: string, sinceMs = 5 * 60 * 1000): {
    serviceName: string;
    overall: HealthSeverity;
    instanceCount: number;
    okCount: number;
    degradedCount: number;
    downCount: number;
  } {
    const since = Date.now() - sinceMs;
    const recent = this.checks.filter((c) => c.serviceName === serviceName && c.at >= since);
    const latestPerInstance = new Map<string, HealthCheck>();
    for (const c of recent) {
      const existing = latestPerInstance.get(c.instanceId);
      if (!existing || c.at > existing.at) latestPerInstance.set(c.instanceId, c);
    }
    const arr = Array.from(latestPerInstance.values());
    const okCount = arr.filter((c) => c.severity === "ok").length;
    const degradedCount = arr.filter((c) => c.severity === "degraded").length;
    const downCount = arr.filter((c) => c.severity === "down").length;
    let overall: HealthSeverity = "ok";
    if (downCount > 0 && downCount === arr.length) overall = "down";
    else if (downCount > 0 || degradedCount > 0) overall = "degraded";
    return { serviceName, overall, instanceCount: arr.length, okCount, degradedCount, downCount };
  }

  recent(serviceName?: string, limit = 100): HealthCheck[] {
    let out = this.checks;
    if (serviceName) out = out.filter((c) => c.serviceName === serviceName);
    return out.slice(-limit).reverse();
  }
}

// ── Circuit Breaker Mesh ──────────────────────────────────────────────────

export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerStatus {
  serviceName: string;
  state: BreakerState;
  failureCount: number;
  successCount: number;
  lastFailureAt?: number;
  openedAt?: number;
  halfOpenAttempts: number;
}

export interface BreakerConfig {
  failureThreshold: number;     // number of consecutive failures to open
  cooldownMs: number;            // how long to stay open before half-open
  halfOpenMaxAttempts: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  halfOpenMaxAttempts: 3,
};

export class CircuitBreakerMesh {
  private readonly breakers = new Map<string, CircuitBreakerStatus>();
  private readonly configs = new Map<string, BreakerConfig>();

  configure(serviceName: string, config: Partial<BreakerConfig>): void {
    const existing = this.configs.get(serviceName) ?? DEFAULT_BREAKER_CONFIG;
    this.configs.set(serviceName, { ...existing, ...config });
  }

  recordSuccess(serviceName: string): CircuitBreakerStatus {
    const b = this._ensure(serviceName);
    if (b.state === "half_open") {
      b.successCount++;
      const config = this._config(serviceName);
      if (b.successCount >= config.halfOpenMaxAttempts) {
        b.state = "closed";
        b.failureCount = 0;
        b.successCount = 0;
        b.halfOpenAttempts = 0;
        logger.info({ serviceName }, "[Mesh] Breaker closed");
      }
    } else if (b.state === "closed") {
      b.failureCount = 0;
    }
    return b;
  }

  recordFailure(serviceName: string): CircuitBreakerStatus {
    const b = this._ensure(serviceName);
    const config = this._config(serviceName);
    b.failureCount++;
    b.lastFailureAt = Date.now();
    if (b.state === "closed" && b.failureCount >= config.failureThreshold) {
      b.state = "open";
      b.openedAt = Date.now();
      logger.warn({ serviceName, failures: b.failureCount }, "[Mesh] Breaker opened");
    } else if (b.state === "half_open") {
      b.state = "open";
      b.openedAt = Date.now();
      b.successCount = 0;
    }
    return b;
  }

  allow(serviceName: string): { allowed: boolean; state: BreakerState; reason: string } {
    const b = this._ensure(serviceName);
    const config = this._config(serviceName);
    if (b.state === "closed") return { allowed: true, state: b.state, reason: "closed" };
    if (b.state === "open") {
      if (b.openedAt && Date.now() - b.openedAt > config.cooldownMs) {
        b.state = "half_open";
        b.halfOpenAttempts = 0;
        return { allowed: true, state: b.state, reason: "cooldown_elapsed" };
      }
      return { allowed: false, state: b.state, reason: "open" };
    }
    // half_open
    if (b.halfOpenAttempts < config.halfOpenMaxAttempts) {
      b.halfOpenAttempts++;
      return { allowed: true, state: b.state, reason: "half_open_attempt" };
    }
    return { allowed: false, state: b.state, reason: "half_open_exhausted" };
  }

  status(serviceName: string): CircuitBreakerStatus {
    return this._ensure(serviceName);
  }

  list(): CircuitBreakerStatus[] {
    return Array.from(this.breakers.values());
  }

  private _ensure(serviceName: string): CircuitBreakerStatus {
    let b = this.breakers.get(serviceName);
    if (!b) {
      b = { serviceName, state: "closed", failureCount: 0, successCount: 0, halfOpenAttempts: 0 };
      this.breakers.set(serviceName, b);
    }
    return b;
  }

  private _config(serviceName: string): BreakerConfig {
    return this.configs.get(serviceName) ?? DEFAULT_BREAKER_CONFIG;
  }
}

// ── Retry Budget ───────────────────────────────────────────────────────────

export interface RetryBudgetState {
  serviceName: string;
  windowMs: number;
  maxRatio: number;       // max retries / total requests
  totalRequests: number;
  totalRetries: number;
  exhausted: boolean;
}

export class RetryBudgetTracker {
  private readonly budgets = new Map<string, RetryBudgetState>();
  private readonly events: Array<{ serviceName: string; isRetry: boolean; at: number }> = [];

  configure(serviceName: string, params: { windowMs?: number; maxRatio?: number }): void {
    let b = this.budgets.get(serviceName);
    if (!b) {
      b = {
        serviceName,
        windowMs: params.windowMs ?? 60_000,
        maxRatio: params.maxRatio ?? 0.2,
        totalRequests: 0,
        totalRetries: 0,
        exhausted: false,
      };
    } else {
      if (params.windowMs !== undefined) b.windowMs = params.windowMs;
      if (params.maxRatio !== undefined) b.maxRatio = params.maxRatio;
    }
    this.budgets.set(serviceName, b);
  }

  recordRequest(serviceName: string, isRetry: boolean): { allowed: boolean; budget: RetryBudgetState } {
    let b = this.budgets.get(serviceName);
    if (!b) {
      this.configure(serviceName, {});
      b = this.budgets.get(serviceName)!;
    }
    this.events.push({ serviceName, isRetry, at: Date.now() });
    if (this.events.length > 50_000) this.events.shift();
    this._recompute(serviceName);
    if (isRetry && b.exhausted) return { allowed: false, budget: b };
    return { allowed: true, budget: b };
  }

  budget(serviceName: string): RetryBudgetState | null {
    this._recompute(serviceName);
    return this.budgets.get(serviceName) ?? null;
  }

  list(): RetryBudgetState[] {
    for (const name of this.budgets.keys()) this._recompute(name);
    return Array.from(this.budgets.values());
  }

  private _recompute(serviceName: string): void {
    const b = this.budgets.get(serviceName);
    if (!b) return;
    const since = Date.now() - b.windowMs;
    const recent = this.events.filter((e) => e.serviceName === serviceName && e.at >= since);
    b.totalRequests = recent.length;
    b.totalRetries = recent.filter((e) => e.isRetry).length;
    const ratio = b.totalRequests > 0 ? b.totalRetries / b.totalRequests : 0;
    b.exhausted = ratio >= b.maxRatio;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const serviceRegistry = new ServiceRegistry();
export const healthAggregator = new HealthAggregator();
export const circuitBreakerMesh = new CircuitBreakerMesh();
export const retryBudgetTracker = new RetryBudgetTracker();
