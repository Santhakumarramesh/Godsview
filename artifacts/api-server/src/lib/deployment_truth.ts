/**
 * Phase 17: Deployment Truth Layer
 *
 * Structured boot validation, deploy smoke tests, and startup resilience tracking
 * for AI-native trading platform (GodsView).
 */

import os from "os";
import { performance } from "perf_hooks";

/**
 * Environment variable metadata with required/optional classification
 */
export interface EnvVarSpec {
  name: string;
  required: boolean;
  secret: boolean;
  description?: string;
}

/**
 * Boot validation report generated at startup
 */
export interface BootReport {
  timestamp: string;
  bootId: string;
  duration: number; // milliseconds
  success: boolean;
  checks: {
    database: { pass: boolean; message: string; duration: number };
    routes: { pass: boolean; message: string; routes: string[] };
    environment: { pass: boolean; message: string; missing: string[] };
    memory: { pass: boolean; baseline: MemoryBaseline };
    eventLoop: { pass: boolean; message: string; duration: number };
    dependencies: { pass: boolean; results: Record<string, DepCheckResult> };
  };
  errors: string[];
}

/**
 * Memory baseline captured at boot
 */
export interface MemoryBaseline {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
  timestamp: string;
}

/**
 * External dependency check result (Alpaca, Anthropic, etc.)
 */
export interface DepCheckResult {
  name: string;
  healthy: boolean;
  latency: number; // milliseconds
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Smoke test result from post-deploy validation
 */
export interface SmokeTestResult {
  timestamp: string;
  success: boolean;
  duration: number; // milliseconds
  tests: {
    healthz: SmokeTestCheck;
    readyz: SmokeTestCheck;
    keyRoutes: SmokeTestCheck[];
    latency: { p50: number; p95: number; p99: number };
  };
  errors: string[];
}

/**
 * Individual smoke test check result
 */
export interface SmokeTestCheck {
  name: string;
  path: string;
  pass: boolean;
  statusCode?: number;
  latency: number;
  message: string;
  response?: Record<string, unknown>;
}

/**
 * Startup event for tracking boot timeline
 */
export interface StartupEvent {
  timestamp: string;
  phase: string; // "boot_start", "db_ready", "routes_ready", "healthy", "failed", etc.
  duration?: number; // ms since phase started
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Boot attempt history entry
 */
export interface BootAttempt {
  bootId: string;
  timestamp: string;
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * BootValidator: Structured startup checks
 */
export class BootValidator {
  private envVarSpecs: Map<string, EnvVarSpec> = new Map();
  private bootId: string;
  private bootStartTime: number;

  constructor() {
    this.bootId = this.generateBootId();
    this.bootStartTime = performance.now();
    this.initializeEnvSpecs();
  }

  /**
   * Define required and optional environment variables
   */
  private initializeEnvSpecs(): void {
    const specs: EnvVarSpec[] = [
      {
        name: "NODE_ENV",
        required: true,
        secret: false,
        description: "Runtime environment (development, production, test)",
      },
      {
        name: "DATABASE_URL",
        required: true,
        secret: true,
        description: "PostgreSQL/PGlite connection string",
      },
      {
        name: "PORT",
        required: false,
        secret: false,
        description: "Server port (default: 3000)",
      },
      {
        name: "ALPACA_API_KEY",
        required: false,
        secret: true,
        description: "Alpaca market data API key",
      },
      {
        name: "ALPACA_BASE_URL",
        required: false,
        secret: false,
        description: "Alpaca API base URL",
      },
      {
        name: "ANTHROPIC_API_KEY",
        required: false,
        secret: true,
        description: "Anthropic Claude API key",
      },
      {
        name: "LOG_LEVEL",
        required: false,
        secret: false,
        description: "Logging level (debug, info, warn, error)",
      },
    ];

    specs.forEach((spec) => {
      this.envVarSpecs.set(spec.name, spec);
    });
  }

  /**
   * Register additional environment variable specifications
   */
  registerEnvVar(spec: EnvVarSpec): void {
    this.envVarSpecs.set(spec.name, spec);
  }

  /**
   * Run all boot validation checks
   */
  async validate(context: {
    dbCheck?: () => Promise<boolean>;
    routeCheck?: () => Promise<string[]>;
    dependencyChecks?: Record<string, () => Promise<DepCheckResult>>;
  }): Promise<BootReport> {
    const bootStartTime = performance.now();
    const errors: string[] = [];

    // Check 1: Database connectivity
    const dbCheck = await this.checkDatabase(context.dbCheck);
    if (!dbCheck.pass) {
      errors.push(`Database check failed: ${dbCheck.message}`);
    }

    // Check 2: Route registration
    const routesCheck = await this.checkRoutes(context.routeCheck);
    if (!routesCheck.pass) {
      errors.push(`Routes check failed: ${routesCheck.message}`);
    }

    // Check 3: Environment variables
    const envCheck = this.checkEnvironment();
    if (!envCheck.pass) {
      errors.push(`Environment check failed: ${envCheck.message}`);
    }

    // Check 4: Memory baseline
    const memCheck = this.captureMemory();

    // Check 5: Event loop responsiveness
    const eventLoopCheck = await this.checkEventLoop();
    if (!eventLoopCheck.pass) {
      errors.push(`Event loop check failed: ${eventLoopCheck.message}`);
    }

    // Check 6: External dependencies
    const depsCheck = await this.checkDependencies(context.dependencyChecks);
    if (!depsCheck.pass) {
      errors.push(`Dependencies check failed: ${depsCheck.message}`);
    }

    const totalDuration = performance.now() - bootStartTime;
    const success =
      dbCheck.pass &&
      routesCheck.pass &&
      envCheck.pass &&
      eventLoopCheck.pass &&
      errors.length === 0;

    return {
      timestamp: new Date().toISOString(),
      bootId: this.bootId,
      duration: totalDuration,
      success,
      checks: {
        database: dbCheck,
        routes: routesCheck,
        environment: envCheck,
        memory: memCheck,
        eventLoop: eventLoopCheck,
        dependencies: depsCheck,
      },
      errors,
    };
  }

  /**
   * Check database connectivity and migration status
   */
  private async checkDatabase(
    dbCheck?: () => Promise<boolean>
  ): Promise<{
    pass: boolean;
    message: string;
    duration: number;
  }> {
    const startTime = performance.now();

    try {
      if (!dbCheck) {
        return {
          pass: false,
          message: "No database check function provided",
          duration: performance.now() - startTime,
        };
      }

      const healthy = await Promise.race([
        dbCheck(),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 5000); // 5s timeout
        }),
      ]);

      return {
        pass: healthy,
        message: healthy
          ? "Database connected and migrations applied"
          : "Database health check failed",
        duration: performance.now() - startTime,
      };
    } catch (error) {
      return {
        pass: false,
        message: `Database check error: ${error instanceof Error ? error.message : String(error)}`,
        duration: performance.now() - startTime,
      };
    }
  }

  /**
   * Validate that key API routes are mounted
   */
  private async checkRoutes(
    routeCheck?: () => Promise<string[]>
  ): Promise<{
    pass: boolean;
    message: string;
    routes: string[];
  }> {
    const requiredRoutes = [
      "/healthz",
      "/readyz",
      "/api/deployment/boot-report",
      "/api/deployment/smoke-test",
    ];

    try {
      if (!routeCheck) {
        return {
          pass: false,
          message: "No route check function provided",
          routes: [],
        };
      }

      const registeredRoutes = await routeCheck();
      const missing = requiredRoutes.filter(
        (route) => !registeredRoutes.some((r) => r.includes(route))
      );

      if (missing.length > 0) {
        return {
          pass: false,
          message: `Missing required routes: ${missing.join(", ")}`,
          routes: registeredRoutes,
        };
      }

      return {
        pass: true,
        message: `All ${requiredRoutes.length} required routes registered`,
        routes: registeredRoutes,
      };
    } catch (error) {
      return {
        pass: false,
        message: `Routes check error: ${error instanceof Error ? error.message : String(error)}`,
        routes: [],
      };
    }
  }

  /**
   * Check environment variable completeness
   */
  private checkEnvironment(): {
    pass: boolean;
    message: string;
    missing: string[];
  } {
    const missing: string[] = [];

    for (const [name, spec] of this.envVarSpecs) {
      if (spec.required && !process.env[name]) {
        missing.push(name);
      }
    }

    if (missing.length > 0) {
      return {
        pass: false,
        message: `Missing required environment variables: ${missing.join(", ")}`,
        missing,
      };
    }

    return {
      pass: true,
      message: `All required environment variables present`,
      missing: [],
    };
  }

  /**
   * Capture memory baseline at boot
   */
  private captureMemory(): {
    pass: boolean;
    baseline: MemoryBaseline;
  } {
    const memUsage = process.memoryUsage();
    const baseline: MemoryBaseline = {
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
      externalMb: Math.round(memUsage.external / 1024 / 1024),
      timestamp: new Date().toISOString(),
    };

    // Pass if heap usage is reasonable (< 500MB at boot)
    const pass = baseline.heapUsedMb < 500;

    return { pass, baseline };
  }

  /**
   * Check event loop responsiveness
   */
  private async checkEventLoop(): Promise<{
    pass: boolean;
    message: string;
    duration: number;
  }> {
    const startTime = performance.now();
    const threshold = 100; // milliseconds

    return new Promise((resolve) => {
      const marker = performance.now();
      setImmediate(() => {
        const duration = performance.now() - marker;
        resolve({
          pass: duration < threshold,
          message: `Event loop latency: ${duration.toFixed(2)}ms`,
          duration,
        });
      });
    });
  }

  /**
   * Check external dependencies (Alpaca, Anthropic, etc.)
   */
  private async checkDependencies(
    checks?: Record<string, () => Promise<DepCheckResult>>
  ): Promise<{
    pass: boolean;
    message: string;
    results: Record<string, DepCheckResult>;
  }> {
    const results: Record<string, DepCheckResult> = {};

    if (!checks) {
      return {
        pass: true,
        message: "No external dependencies configured",
        results,
      };
    }

    const checkResults = await Promise.allSettled(
      Object.entries(checks).map(async ([name, checkFn]) => {
        try {
          const result = await Promise.race([
            checkFn(),
            new Promise<DepCheckResult>((resolve) => {
              setTimeout(() => {
                resolve({
                  name,
                  healthy: false,
                  latency: 5000,
                  error: "Check timeout",
                });
              }, 5000);
            }),
          ]);
          return { name, result };
        } catch (error) {
          return {
            name,
            result: {
              name,
              healthy: false,
              latency: 0,
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      })
    );

    for (const outcome of checkResults) {
      if (outcome.status === "fulfilled") {
        const { name, result } = outcome.value;
        results[name] = result;
      }
    }

    const allHealthy = Object.values(results).every((r) => r.healthy);
    return {
      pass: true, // Don't fail boot for dependency issues
      message: `Dependency checks completed (${Object.values(results).filter((r) => r.healthy).length}/${Object.keys(results).length} healthy)`,
      results,
    };
  }

  /**
   * Generate unique boot ID
   */
  private generateBootId(): string {
    return `boot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get boot ID
   */
  getBootId(): string {
    return this.bootId;
  }
}

/**
 * DeploySmokeTest: Post-deployment validation
 */
export class DeploySmokeTest {
  constructor(private baseUrl: string = "http://localhost:3000") {}

  /**
   * Run full smoke test suite
   */
  async run(): Promise<SmokeTestResult> {
    const testStartTime = performance.now();
    const errors: string[] = [];
    const latencies: number[] = [];

    // Test 1: Health check
    const healthzTest = await this.testEndpoint("/healthz");
    if (!healthzTest.pass) {
      errors.push(`Health check failed: ${healthzTest.message}`);
    }
    latencies.push(healthzTest.latency);

    // Test 2: Readiness check
    const readyzTest = await this.testEndpoint("/readyz");
    if (!readyzTest.pass) {
      errors.push(`Readiness check failed: ${readyzTest.message}`);
    }
    latencies.push(readyzTest.latency);

    // Test 3: Key API routes
    const keyRoutes = [
      "/api/deployment/boot-report",
      "/api/deployment/smoke-test",
      "/api/deployment/startup-history",
      "/api/deployment/env-audit",
      "/api/deployment/readiness-timeline",
    ];
    const routeTests = await Promise.all(
      keyRoutes.map((route) => this.testEndpoint(route))
    );
    routeTests.forEach((test) => {
      latencies.push(test.latency);
    });

    // Calculate latency percentiles
    latencies.sort((a, b) => a - b);
    const latencyStats = {
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      p99: latencies[Math.floor(latencies.length * 0.99)],
    };

    const totalDuration = performance.now() - testStartTime;
    const success = errors.length === 0 && healthzTest.pass && readyzTest.pass;

    return {
      timestamp: new Date().toISOString(),
      success,
      duration: totalDuration,
      tests: {
        healthz: healthzTest,
        readyz: readyzTest,
        keyRoutes: routeTests,
        latency: latencyStats,
      },
      errors,
    };
  }

  /**
   * Test a single endpoint
   */
  private async testEndpoint(path: string): Promise<SmokeTestCheck> {
    const startTime = performance.now();
    const name = path.split("/").pop() || path;

    try {
      // Standard `fetch` (Node 20+) doesn't accept `timeout`; use AbortSignal.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method: "GET",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const latency = performance.now() - startTime;
      const pass = response.ok || response.status === 200;

      let responseBody: Record<string, unknown> | undefined;
      try {
        responseBody = (await response.json()) as Record<string, unknown>;
      } catch {
        // Response was not JSON, which is OK
      }

      return {
        name,
        path,
        pass,
        statusCode: response.status,
        latency,
        message: pass
          ? `OK (${response.status})`
          : `Failed with status ${response.status}`,
        response: responseBody,
      };
    } catch (error) {
      const latency = performance.now() - startTime;
      return {
        name,
        path,
        pass: false,
        latency,
        message: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * StartupResilience: Track boot attempts and detect boot loops
 */
export class StartupResilience {
  private bootAttempts: BootAttempt[] = [];
  private startupEvents: StartupEvent[] = [];
  private maxBootAttemptsToKeep = 50;

  /**
   * Record a boot attempt
   */
  recordBootAttempt(
    bootId: string,
    success: boolean,
    duration: number,
    error?: string
  ): void {
    this.bootAttempts.push({
      bootId,
      timestamp: new Date().toISOString(),
      success,
      duration,
      error,
    });

    // Keep only recent attempts
    if (this.bootAttempts.length > this.maxBootAttemptsToKeep) {
      this.bootAttempts = this.bootAttempts.slice(-this.maxBootAttemptsToKeep);
    }
  }

  /**
   * Record a startup phase event
   */
  recordStartupEvent(
    phase: string,
    duration?: number,
    error?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.startupEvents.push({
      timestamp: new Date().toISOString(),
      phase,
      duration,
      error,
      metadata,
    });
  }

  /**
   * Detect boot loop: 3+ failures in last 10 minutes
   */
  detectBootLoop(): { detected: boolean; failureCount: number } {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentFailures = this.bootAttempts.filter((attempt) => {
      return (
        !attempt.success &&
        new Date(attempt.timestamp) > tenMinutesAgo
      );
    });

    return {
      detected: recentFailures.length >= 3,
      failureCount: recentFailures.length,
    };
  }

  /**
   * Get boot history (last N attempts)
   */
  getBootHistory(limit: number = 10): BootAttempt[] {
    return this.bootAttempts.slice(-limit);
  }

  /**
   * Get startup timeline
   */
  getStartupTimeline(bootId?: string): StartupEvent[] {
    if (!bootId) {
      return this.startupEvents.slice(-20); // Last 20 events
    }

    return this.startupEvents.filter(
      (event) => event.metadata?.bootId === bootId
    );
  }

  /**
   * Get current resilience metrics
   */
  getMetrics(): {
    totalAttempts: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    bootLoop: { detected: boolean; failureCount: number };
    averageBootTime: number;
    lastBootResult: BootAttempt | null;
  } {
    const successCount = this.bootAttempts.filter((a) => a.success).length;
    const failureCount = this.bootAttempts.length - successCount;
    const successRate =
      this.bootAttempts.length > 0
        ? (successCount / this.bootAttempts.length) * 100
        : 0;

    const avgBootTime =
      this.bootAttempts.length > 0
        ? this.bootAttempts.reduce((sum, a) => sum + a.duration, 0) /
          this.bootAttempts.length
        : 0;

    return {
      totalAttempts: this.bootAttempts.length,
      successCount,
      failureCount,
      successRate: parseFloat(successRate.toFixed(2)),
      bootLoop: this.detectBootLoop(),
      averageBootTime: parseFloat(avgBootTime.toFixed(2)),
      lastBootResult: this.bootAttempts[this.bootAttempts.length - 1] || null,
    };
  }
}

/**
 * Utility: Mask sensitive environment variables
 */
export function maskSecrets(envVars: Record<string, string>): Record<
  string,
  string | undefined
> {
  const secretPatterns = ["KEY", "SECRET", "PASSWORD", "TOKEN", "URL"];
  const masked: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(envVars)) {
    const isSecret = secretPatterns.some((pattern) =>
      key.toUpperCase().includes(pattern)
    );
    masked[key] = isSecret && value ? "***REDACTED***" : value;
  }

  return masked;
}
