/**
 * Governance Engine — Comprehensive API governance & security decision-making.
 * Phase 73 (Wave 4.2): Security & Governance
 *
 * Enforces policies: API key requirements, rate limits, IP whitelisting,
 * sensitive endpoint protection, audit logging, and violation tracking.
 */

import { logger } from "../lib/logger.js";
import { persistWrite, persistRead, persistAppend } from "../lib/persistent_store.js";

// ── Types ─────────────────────────────────────────────

export interface GovernancePolicy {
  requireApiKeyForWrites: boolean;
  requireApiKeyForReads: boolean;
  maxRequestsPerMinute: number;
  maxWriteRequestsPerMinute: number;
  allowedOrigins: string[];
  sensitiveEndpoints: string[];
  auditAllRequests: boolean;
  ipWhitelist: string[] | null;
}

export interface GovernanceDecision {
  allowed: boolean;
  reason?: string;
  requiresAuth: boolean;
}

export interface GovernanceReport {
  totalRequestsToday: number;
  blockedRequests: number;
  rateLimitedRequests: number;
  topApiKeysByUsage: Array<{ apiKey: string; count: number }>;
  suspiciousActivityFlags: string[];
  reportGeneratedAt: string;
}

export interface GovernanceViolation {
  id: string;
  timestamp: string;
  type: "ip_whitelist_blocked" | "missing_api_key" | "rate_limit_exceeded" | "sensitive_endpoint" | "invalid_api_key";
  ip?: string;
  apiKey?: string;
  endpoint?: string;
  details: Record<string, unknown>;
}

export type RequestType = "read" | "write" | "admin" | "dangerous";

interface AuditEvent {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  apiKey?: string;
  ip?: string;
  allowed: boolean;
  reason?: string;
  requestType: RequestType;
}

// ── Defaults ──────────────────────────────────────────

const DEFAULT_POLICY: GovernancePolicy = {
  requireApiKeyForWrites: true,
  requireApiKeyForReads: false,
  maxRequestsPerMinute: 120,
  maxWriteRequestsPerMinute: 30,
  allowedOrigins: ["*"],
  sensitiveEndpoints: [
    "/api/kill-switch",
    "/api/emergency-liquidate",
    "/api/governance/policy",
  ],
  auditAllRequests: false,
  ipWhitelist: null,
};

// ── Request Classifier ────────────────────────────────

export class RequestClassifier {
  static classify(method: string, path: string): RequestType {
    const normalizedPath = path.toLowerCase();

    // Dangerous endpoints
    if (
      normalizedPath.includes("kill-switch") ||
      normalizedPath.includes("emergency-liquidate")
    ) {
      return "dangerous";
    }

    // Admin endpoints
    if (
      normalizedPath.includes("/governance/") ||
      normalizedPath.includes("/admin/") ||
      normalizedPath.includes("/settings/")
    ) {
      return "admin";
    }

    // Write operations
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
      return "write";
    }

    // Everything else is read
    return "read";
  }
}

// ── Governance Engine ─────────────────────────────────

export class GovernanceEngine {
  private policy: GovernancePolicy;
  private requestCounts: Map<string, { timestamp: number; count: number }>;
  private writeCounts: Map<string, { timestamp: number; count: number }>;
  private violations: GovernanceViolation[];
  private auditTrail: AuditEvent[];

  constructor() {
    this.policy = persistRead<GovernancePolicy>("governance_policy", DEFAULT_POLICY);
    this.violations = persistRead<GovernanceViolation[]>("governance_violations", []);
    this.auditTrail = persistRead<AuditEvent[]>("governance_audit_trail", []);
    this.requestCounts = new Map();
    this.writeCounts = new Map();
  }

  /**
   * Get current governance policy
   */
  getPolicy(): GovernancePolicy {
    return { ...this.policy };
  }

  /**
   * Update governance policy (partial update)
   */
  updatePolicy(patch: Partial<GovernancePolicy>): GovernancePolicy {
    this.policy = { ...this.policy, ...patch };
    persistWrite("governance_policy", this.policy);
    logger.info({ patch }, "Governance policy updated");
    return this.getPolicy();
  }

  /**
   * Classify and evaluate a request against governance rules
   */
  evaluateRequest(req: {
    method: string;
    path: string;
    apiKey?: string;
    ip?: string;
  }): GovernanceDecision {
    const requestType = RequestClassifier.classify(req.method, req.path);
    const now = Date.now();

    // 1. Check IP whitelist
    if (this.policy.ipWhitelist && req.ip) {
      const isWhitelisted = this.policy.ipWhitelist.some(
        (ip) => ip === req.ip || ip === "*"
      );
      if (!isWhitelisted) {
        this.recordViolation("ip_whitelist_blocked", {
          ip: req.ip,
          path: req.path,
        });
        return {
          allowed: false,
          reason: "IP not whitelisted",
          requiresAuth: true,
        };
      }
    }

    // 2. Check API key requirement
    const requiresApiKey =
      requestType === "dangerous" ||
      requestType === "admin" ||
      (this.policy.requireApiKeyForWrites && requestType === "write") ||
      (this.policy.requireApiKeyForReads && requestType === "read");

    if (requiresApiKey && !req.apiKey) {
      this.recordViolation("missing_api_key", {
        path: req.path,
        requestType,
        ip: req.ip,
      });
      return {
        allowed: false,
        reason: `API key required for ${requestType} requests`,
        requiresAuth: true,
      };
    }

    // 3. Check rate limits
    const key = req.apiKey || req.ip || "unknown";
    const limit =
      requestType === "write"
        ? this.policy.maxWriteRequestsPerMinute
        : this.policy.maxRequestsPerMinute;

    if (requestType === "write") {
      const writeState = this.writeCounts.get(key) || { timestamp: now, count: 0 };
      if (now - writeState.timestamp > 60000) {
        writeState.timestamp = now;
        writeState.count = 0;
      }
      writeState.count++;
      this.writeCounts.set(key, writeState);

      if (writeState.count > limit) {
        this.recordViolation("rate_limit_exceeded", {
          ip: req.ip,
          apiKey: req.apiKey,
          path: req.path,
          requestType: "write",
          limit,
          count: writeState.count,
        });
        return {
          allowed: false,
          reason: `Write rate limit exceeded (${limit} per minute)`,
          requiresAuth: false,
        };
      }
    } else {
      const readState = this.requestCounts.get(key) || { timestamp: now, count: 0 };
      if (now - readState.timestamp > 60000) {
        readState.timestamp = now;
        readState.count = 0;
      }
      readState.count++;
      this.requestCounts.set(key, readState);

      if (readState.count > limit) {
        this.recordViolation("rate_limit_exceeded", {
          ip: req.ip,
          apiKey: req.apiKey,
          path: req.path,
          requestType,
          limit,
          count: readState.count,
        });
        return {
          allowed: false,
          reason: `Rate limit exceeded (${limit} per minute)`,
          requiresAuth: false,
        };
      }
    }

    // 4. Check sensitive endpoints
    const isSensitive = this.policy.sensitiveEndpoints.some((endpoint) =>
      req.path.includes(endpoint)
    );
    if (isSensitive && !req.apiKey) {
      this.recordViolation("sensitive_endpoint", {
        path: req.path,
        ip: req.ip,
      });
      return {
        allowed: false,
        reason: "Sensitive endpoint requires elevated authentication",
        requiresAuth: true,
      };
    }

    // All checks passed
    this.logAuditEvent({
      method: req.method,
      path: req.path,
      apiKey: req.apiKey,
      ip: req.ip,
      allowed: true,
      requestType,
    });

    return { allowed: true, requiresAuth: requiresApiKey };
  }

  /**
   * Generate a governance report for today
   */
  getGovernanceReport(): GovernanceReport {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const todayStart = now - oneDayMs;

    const todayViolations = this.violations.filter(
      (v) => new Date(v.timestamp).getTime() > todayStart
    );

    const todayAudit = this.auditTrail.filter(
      (a) => new Date(a.timestamp).getTime() > todayStart
    );

    // Count API key usage
    const apiKeyUsage = new Map<string, number>();
    todayAudit.forEach((event) => {
      if (event.apiKey) {
        apiKeyUsage.set(event.apiKey, (apiKeyUsage.get(event.apiKey) || 0) + 1);
      }
    });

    const topApiKeys = Array.from(apiKeyUsage.entries())
      .map(([apiKey, count]) => ({ apiKey, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Detect suspicious activity
    const suspiciousFlags: string[] = [];

    const failedAuths = todayViolations.filter(
      (v) => v.type === "missing_api_key" || v.type === "invalid_api_key"
    );
    if (failedAuths.length > 20) {
      suspiciousFlags.push(`${failedAuths.length} failed authentication attempts`);
    }

    const rateLimitViolations = todayViolations.filter(
      (v) => v.type === "rate_limit_exceeded"
    );
    if (rateLimitViolations.length > 10) {
      suspiciousFlags.push(`${rateLimitViolations.length} rate limit violations`);
    }

    // Check for concentrated rate limit hits from single IP
    const ipsWithViolations = new Map<string, number>();
    rateLimitViolations.forEach((v) => {
      if (v.ip) {
        ipsWithViolations.set(v.ip, (ipsWithViolations.get(v.ip) || 0) + 1);
      }
    });
    ipsWithViolations.forEach((count, ip) => {
      if (count > 5) {
        suspiciousFlags.push(`IP ${ip} triggered ${count} rate limit violations`);
      }
    });

    return {
      totalRequestsToday: todayAudit.length,
      blockedRequests: todayViolations.length,
      rateLimitedRequests: rateLimitViolations.length,
      topApiKeysByUsage: topApiKeys,
      suspiciousActivityFlags: suspiciousFlags,
      reportGeneratedAt: new Date().toISOString(),
    };
  }

  /**
   * Record a governance violation
   */
  recordViolation(
    type: GovernanceViolation["type"],
    details: Record<string, unknown>
  ): void {
    const violation: GovernanceViolation = {
      id: `vio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      type,
      ip: (details.ip as string) || undefined,
      apiKey: (details.apiKey as string) || undefined,
      endpoint: (details.path as string) || undefined,
      details,
    };

    this.violations.push(violation);
    persistAppend("governance_violations", violation, 10000);
    logger.warn({ violation }, `Governance violation recorded: ${type}`);
  }

  /**
   * Get violations within a time window
   */
  getViolations(hours: number): GovernanceViolation[] {
    const now = Date.now();
    const windowMs = hours * 60 * 60 * 1000;
    const cutoff = now - windowMs;

    return this.violations.filter(
      (v) => new Date(v.timestamp).getTime() > cutoff
    );
  }

  /**
   * Log an audit event
   */
  private logAuditEvent(event: Omit<AuditEvent, "id" | "timestamp">): void {
    const auditEvent: AuditEvent = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...event,
    };

    if (this.policy.auditAllRequests) {
      this.auditTrail.push(auditEvent);
      persistAppend("governance_audit_trail", auditEvent, 10000);
    }
  }

  /**
   * Get audit trail with optional filters
   */
  getAuditTrail(filters?: {
    hours?: number;
    apiKey?: string;
    path?: string;
    status?: "allowed" | "blocked";
  }): AuditEvent[] {
    let results = [...this.auditTrail];

    if (filters?.hours) {
      const now = Date.now();
      const windowMs = filters.hours * 60 * 60 * 1000;
      const cutoff = now - windowMs;
      results = results.filter((a) => new Date(a.timestamp).getTime() > cutoff);
    }

    if (filters?.apiKey) {
      results = results.filter((a) => a.apiKey === filters.apiKey);
    }

    if (filters?.path) {
      results = results.filter((a) => a.path.includes(filters.path!));
    }

    if (filters?.status) {
      const allowed = filters.status === "allowed";
      results = results.filter((a) => a.allowed === allowed);
    }

    return results.slice(-1000); // Return last 1000
  }

  /**
   * Reset all governance state (for testing)
   */
  reset(): void {
    this.policy = { ...DEFAULT_POLICY };
    this.violations = [];
    this.auditTrail = [];
    this.requestCounts.clear();
    this.writeCounts.clear();
    persistWrite("governance_policy", this.policy);
    persistWrite("governance_violations", []);
    persistWrite("governance_audit_trail", []);
    logger.info("Governance engine reset");
  }
}

// ── Singleton Instance ────────────────────────────────

let governanceInstance: GovernanceEngine | null = null;

export function getGovernanceEngine(): GovernanceEngine {
  if (!governanceInstance) {
    governanceInstance = new GovernanceEngine();
  }
  return governanceInstance;
}

export function resetGovernanceEngine(): void {
  if (governanceInstance) {
    governanceInstance.reset();
  }
}
