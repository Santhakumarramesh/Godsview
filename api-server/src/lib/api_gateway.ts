/**
 * Phase 59 — API Gateway + Auth
 * Rate limiting, API key authentication, request validation, audit logging.
 */

export interface ApiKey {
  key: string;
  name: string;
  role: "admin" | "trader" | "viewer" | "bot";
  permissions: string[];
  createdAt: string;
  lastUsed?: string;
  enabled: boolean;
  rateLimit: number; // requests per minute
  requestCount: number;
}

export interface RateLimitState {
  key: string;
  windowStart: number;
  requestsInWindow: number;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  apiKey: string;
  role: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  ip: string;
  blocked: boolean;
  reason?: string;
}

export interface GatewaySnapshot {
  totalKeys: number;
  activeKeys: number;
  totalRequests: number;
  blockedRequests: number;
  auditLogSize: number;
  avgLatencyMs: number;
}

/* ── state ── */
const apiKeys = new Map<string, ApiKey>();
const rateLimits = new Map<string, RateLimitState>();
const auditLog: AuditLogEntry[] = [];
let totalRequests = 0;
let blockedRequests = 0;
let nextAuditId = 1;

const WINDOW_MS = 60_000; // 1 minute
const DEFAULT_RATE_LIMIT = 120;

/* ── API key management ── */

export function createApiKey(params: {
  name: string;
  role: ApiKey["role"];
  permissions?: string[];
  rateLimit?: number;
}): ApiKey {
  const key = `gv_${params.role}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const apiKey: ApiKey = {
    key,
    name: params.name,
    role: params.role,
    permissions: params.permissions ?? getDefaultPermissions(params.role),
    createdAt: new Date().toISOString(),
    enabled: true,
    rateLimit: params.rateLimit ?? DEFAULT_RATE_LIMIT,
    requestCount: 0,
  };
  apiKeys.set(key, apiKey);
  return apiKey;
}

function getDefaultPermissions(role: ApiKey["role"]): string[] {
  switch (role) {
    case "admin": return ["read", "write", "execute", "admin"];
    case "trader": return ["read", "write", "execute"];
    case "viewer": return ["read"];
    case "bot": return ["read", "execute"];
  }
}

export function revokeApiKey(key: string): boolean {
  const ak = apiKeys.get(key);
  if (!ak) return false;
  ak.enabled = false;
  return true;
}

export function validateApiKey(key: string): { valid: boolean; reason?: string; apiKey?: ApiKey } {
  const ak = apiKeys.get(key);
  if (!ak) return { valid: false, reason: "Unknown API key" };
  if (!ak.enabled) return { valid: false, reason: "API key revoked" };
  ak.lastUsed = new Date().toISOString();
  ak.requestCount++;
  return { valid: true, apiKey: ak };
}

export function listApiKeys(): ApiKey[] {
  return [...apiKeys.values()].map((k) => ({ ...k, key: `${k.key.slice(0, 12)}...` }));
}

/* ── rate limiting ── */

export function checkRateLimit(key: string): RateLimitState {
  const ak = apiKeys.get(key);
  const limit = ak?.rateLimit ?? DEFAULT_RATE_LIMIT;
  const now = Date.now();

  let state = rateLimits.get(key);
  if (!state || now - state.windowStart > WINDOW_MS) {
    state = { key, windowStart: now, requestsInWindow: 0, limit, remaining: limit, resetAt: now + WINDOW_MS };
    rateLimits.set(key, state);
  }

  state.requestsInWindow++;
  state.remaining = Math.max(0, limit - state.requestsInWindow);
  return state;
}

/* ── audit logging ── */

export function logRequest(params: {
  apiKey: string;
  role: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  ip: string;
  blocked: boolean;
  reason?: string;
}): AuditLogEntry {
  totalRequests++;
  if (params.blocked) blockedRequests++;

  const entry: AuditLogEntry = {
    id: `audit_${nextAuditId++}`,
    timestamp: new Date().toISOString(),
    ...params,
  };
  auditLog.push(entry);
  if (auditLog.length > 1000) auditLog.splice(0, auditLog.length - 1000);
  return entry;
}

export function getAuditLog(limit = 50): AuditLogEntry[] {
  return auditLog.slice(-limit);
}

export function getGatewaySnapshot(): GatewaySnapshot {
  const latencies = auditLog.map((e) => e.latencyMs);
  return {
    totalKeys: apiKeys.size,
    activeKeys: [...apiKeys.values()].filter((k) => k.enabled).length,
    totalRequests,
    blockedRequests,
    auditLogSize: auditLog.length,
    avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
  };
}

export function resetGateway(): void {
  apiKeys.clear();
  rateLimits.clear();
  auditLog.length = 0;
  totalRequests = 0;
  blockedRequests = 0;
  nextAuditId = 1;
}
