#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

interface CheckResult {
  name: string;
  passed: boolean;
  critical: boolean;
  detail: string;
  durationMs: number;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

type ReadinessStatus = "NOT_READY" | "DEGRADED" | "READY";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.DEPLOY_READINESS_ROOT ?? path.resolve(SCRIPT_DIR, "..", ".."));
const API_DIST_ENTRY = path.resolve(ROOT, "artifacts/api-server/dist/index.mjs");

const BASE_URL_INPUT = String(process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const REQUIRE_HTTP = boolEnv("REQUIRE_HTTP", false);
const INCLUDE_PREFLIGHT = boolEnv("INCLUDE_PREFLIGHT", true);
const RUN_BUILD_CHECKS = boolEnv("RUN_BUILD_CHECKS", true);
const RUN_SMOKE_TESTS = boolEnv("RUN_SMOKE_TESTS", true);
const START_SERVER_LOCAL = boolEnv("START_SERVER_LOCAL", false);
const READINESS_PORT = Number(process.env.DEPLOY_READINESS_PORT ?? 3310);
const EXPECTED_SYSTEM_MODE = String(process.env.DEPLOY_READINESS_EXPECT_SYSTEM_MODE ?? "").trim().toLowerCase();
const READINESS_MIN_STATUS = parseReadinessStatus(
  process.env.DEPLOY_READINESS_MIN_STATUS,
  REQUIRE_HTTP ? "DEGRADED" : "NOT_READY",
);
const READINESS_POLL_TIMEOUT_MS = timeoutEnv("READINESS_POLL_TIMEOUT_MS", REQUIRE_HTTP ? 90_000 : 45_000);
const READINESS_POLL_INTERVAL_MS = timeoutEnv("READINESS_POLL_INTERVAL_MS", 2_500);
const READINESS_POLL_HTTP_TIMEOUT_MS = timeoutEnv("READINESS_POLL_HTTP_TIMEOUT_MS", 4_000);
const READINESS_REQUIRED_STREAK = Math.max(1, Number(process.env.READINESS_REQUIRED_STREAK ?? 1) || 1);

let localServer: ChildProcess | null = null;
let localBaseUrl: string | null = null;

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function timeoutEnv(name: string, fallbackMs: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

function parseReadinessStatus(raw: string | undefined, fallback: ReadinessStatus): ReadinessStatus {
  const normalized = String(raw ?? "").trim().toUpperCase();
  if (normalized === "READY" || normalized === "DEGRADED" || normalized === "NOT_READY") {
    return normalized;
  }
  return fallback;
}

function readinessRank(status: ReadinessStatus): number {
  switch (status) {
    case "READY":
      return 3;
    case "DEGRADED":
      return 2;
    default:
      return 1;
  }
}

function tail(text: string, lines = 6): string {
  const parts = text.split("\n").filter(Boolean);
  return parts.slice(-lines).join("\n");
}

function color(code: number, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

async function runCommand(
  name: string,
  critical: boolean,
  cmd: string,
  args: string[],
  timeoutMs = timeoutEnv("COMMAND_TIMEOUT_MS", 8 * 60_000),
): Promise<CheckResult> {
  const started = Date.now();
  try {
    const result = await execWithCapture(cmd, args, timeoutMs);
    const ok = result.code === 0;
    return {
      name,
      critical,
      passed: ok,
      detail: ok
        ? "OK"
        : `exit=${String(result.code)}\n${tail(result.stderr || result.stdout || "no output")}`,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name,
      critical,
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

function execWithCapture(cmd: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function httpJson(url: string, timeoutMs = timeoutEnv("HTTP_TIMEOUT_MS", 12_000)): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHttp(
  name: string,
  critical: boolean,
  url: string,
  predicate: (status: number, body: any) => { ok: boolean; detail: string },
): Promise<CheckResult> {
  const started = Date.now();
  try {
    const { status, body } = await httpJson(url);
    const verdict = predicate(status, body);
    return {
      name,
      critical,
      passed: verdict.ok,
      detail: verdict.detail,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name,
      critical,
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

interface DeploymentReadinessResult {
  check: CheckResult;
  statusCode: number | null;
  body: any;
}

async function checkDeploymentReadinessThreshold(runtimeBase: string): Promise<DeploymentReadinessResult> {
  const started = Date.now();
  const deadline = started + READINESS_POLL_TIMEOUT_MS;
  const readinessBase =
    `${runtimeBase}/api/system/deployment/readiness` +
    `?include_preflight=${INCLUDE_PREFLIGHT ? "1" : "0"}`;

  let attempts = 0;
  let streak = 0;
  let lastStatus: number | null = null;
  let lastReportStatus = "UNKNOWN";
  let lastBody: any = null;
  let lastError = "";

  while (Date.now() < deadline) {
    const attemptStarted = Date.now();
    const remainingMs = Math.max(0, deadline - attemptStarted);
    const requestTimeoutMs = Math.max(500, Math.min(READINESS_POLL_HTTP_TIMEOUT_MS, remainingMs));
    attempts += 1;
    const refresh = attempts === 1 ? "1" : "0";
    const url = `${readinessBase}&refresh=${refresh}`;

    try {
      const { status, body } = await httpJson(url, requestTimeoutMs);
      lastStatus = status;
      lastBody = body;

      const reportStatus = String(body?.status ?? "unknown").toUpperCase();
      lastReportStatus = reportStatus;
      const validStatus = reportStatus === "READY" || reportStatus === "DEGRADED" || reportStatus === "NOT_READY";
      const meetsThreshold =
        validStatus &&
        readinessRank(reportStatus as ReadinessStatus) >= readinessRank(READINESS_MIN_STATUS);

      if ((status === 200 || status === 503) && meetsThreshold) {
        streak += 1;
        if (streak >= READINESS_REQUIRED_STREAK) {
          const elapsedMs = Date.now() - started;
          return {
            check: {
              name: "GET /api/system/deployment/readiness",
              critical: true,
              passed: true,
              detail:
                `status=${status}, report=${reportStatus}, min=${READINESS_MIN_STATUS}, ` +
                `attempts=${attempts}, streak=${streak}, elapsed_ms=${elapsedMs}`,
              durationMs: elapsedMs,
            },
            statusCode: status,
            body,
          };
        }
      } else {
        streak = 0;
      }
      lastError = "";
    } catch (err) {
      streak = 0;
      lastError = err instanceof Error ? err.message : String(err);
    }

    const postAttemptRemainingMs = Math.max(0, deadline - Date.now());
    if (postAttemptRemainingMs <= 0) {
      break;
    }
    const sleepMs = Math.min(READINESS_POLL_INTERVAL_MS, postAttemptRemainingMs);
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  const elapsedMs = Date.now() - started;
  const baseDetail = `status=${String(lastStatus ?? "error")}, report=${lastReportStatus}, min=${READINESS_MIN_STATUS}, attempts=${attempts}, timeout_ms=${READINESS_POLL_TIMEOUT_MS}`;
  const detail = lastError ? `${baseDetail}, last_error=${lastError}` : baseDetail;

  return {
    check: {
      name: "GET /api/system/deployment/readiness",
      critical: true,
      passed: false,
      detail,
      durationMs: elapsedMs,
    },
    statusCode: lastStatus,
    body: lastBody,
  };
}

function artifactFileChecks(): CheckResult[] {
  const started = Date.now();
  const checks: Array<{ name: string; rel: string; critical: boolean }> = [
    { name: "API dist bundle exists", rel: "artifacts/api-server/dist/index.mjs", critical: true },
    { name: "Dashboard dist index exists", rel: "artifacts/godsview-dashboard/dist/public/index.html", critical: true },
    { name: "Dockerfile exists", rel: "Dockerfile", critical: false },
    { name: "Docker entrypoint exists", rel: "docker-entrypoint.sh", critical: false },
  ];

  return checks.map((check) => {
    const file = path.resolve(ROOT, check.rel);
    const exists = existsSync(file);
    return {
      name: check.name,
      passed: exists,
      critical: check.critical,
      detail: exists ? check.rel : `Missing ${check.rel}`,
      durationMs: Date.now() - started,
    };
  });
}

async function ensureRuntimeBase(): Promise<string | null> {
  try {
    const health = await httpJson(`${BASE_URL_INPUT}/healthz`, 3_000);
    if (health.status === 200) return BASE_URL_INPUT;
  } catch {
    // ignore
  }

  if (!START_SERVER_LOCAL) {
    return null;
  }

  if (!existsSync(API_DIST_ENTRY)) {
    throw new Error(`Cannot start local server: missing ${API_DIST_ENTRY}`);
  }

  const env = {
    ...process.env,
    PORT: String(READINESS_PORT),
    NODE_ENV: process.env.NODE_ENV ?? "development",
    GODSVIEW_SYSTEM_MODE: process.env.GODSVIEW_SYSTEM_MODE ?? (EXPECTED_SYSTEM_MODE || "paper"),
  };

  localServer = spawn("node", ["--enable-source-maps", API_DIST_ENTRY], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  localServer.stdout?.on("data", (d) => {
    const line = String(d).trim();
    if (line) process.stdout.write(`${color(90, `[server] ${line}`)}\n`);
  });
  localServer.stderr?.on("data", (d) => {
    const line = String(d).trim();
    if (line) process.stdout.write(`${color(90, `[server-err] ${line}`)}\n`);
  });

  const base = `http://127.0.0.1:${READINESS_PORT}`;
  const started = Date.now();
  const timeoutMs = timeoutEnv("LOCAL_SERVER_BOOT_TIMEOUT_MS", 45_000);

  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 750));
    try {
      const health = await httpJson(`${base}/healthz`, 2_500);
      if (health.status === 200) {
        localBaseUrl = base;
        return base;
      }
    } catch {
      // keep polling
    }
  }

  throw new Error(`Local server did not become healthy within ${timeoutMs}ms`);
}

async function stopLocalServer(): Promise<void> {
  if (!localServer) return;
  await new Promise<void>((resolve) => {
    localServer?.once("exit", () => resolve());
    localServer?.kill("SIGTERM");
    setTimeout(() => {
      localServer?.kill("SIGKILL");
      resolve();
    }, 3_000);
  });
  localServer = null;
  localBaseUrl = null;
}

function printResults(results: CheckResult[]): void {
  let passed = 0;
  let criticalFailed = 0;
  let warningFailed = 0;

  for (const result of results) {
    const tag = result.passed
      ? color(32, "PASS")
      : result.critical
      ? color(31, "FAIL")
      : color(33, "WARN");
    const icon = result.passed
      ? color(32, "✓")
      : result.critical
      ? color(31, "✗")
      : color(33, "⚠");

    console.log(`${icon} ${tag} ${result.name} ${color(90, `(${result.durationMs}ms)`)}`);
    if (!result.passed) {
      console.log(`    ${color(90, result.detail)}`);
    }

    if (result.passed) passed += 1;
    else if (result.critical) criticalFailed += 1;
    else warningFailed += 1;
  }

  console.log("");
  console.log(
    `${color(36, "Summary")}: ${passed}/${results.length} passed, ` +
      `${criticalFailed} critical failures, ${warningFailed} warnings`,
  );

  if (criticalFailed > 0) {
    console.log(color(31, "Deployment readiness: NOT READY"));
    process.exit(1);
  }

  if (warningFailed > 0) {
    console.log(color(33, "Deployment readiness: DEGRADED"));
    process.exit(0);
  }

  console.log(color(32, "Deployment readiness: READY"));
  process.exit(0);
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];

  console.log(color(36, "GodsView Deployment Readiness"));
  console.log(color(90, `root=${ROOT}`));

  results.push(...artifactFileChecks());

  if (RUN_BUILD_CHECKS) {
    results.push(
      await runCommand(
        "Build API server",
        true,
        "corepack",
        ["pnpm", "--filter", "@workspace/api-server", "run", "build"],
      ),
    );
    results.push(
      await runCommand(
        "Build dashboard",
        true,
        "corepack",
        ["pnpm", "--filter", "@workspace/godsview-dashboard", "run", "build"],
      ),
    );
  }

  if (RUN_SMOKE_TESTS) {
    results.push(
      await runCommand(
        "API smoke tests (vitest)",
        true,
        "corepack",
        ["pnpm", "--filter", "@workspace/api-server", "run", "test", "--", "src/__tests__/e2e_smoke.test.ts"],
      ),
    );
  }

  let runtimeBase: string | null = null;
  try {
    runtimeBase = await ensureRuntimeBase();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      name: "Runtime base URL available",
      passed: false,
      critical: REQUIRE_HTTP,
      detail: message,
      durationMs: 0,
    });
  }

  if (runtimeBase) {
    let latestReadinessStatusCode: number | null = null;
    let latestReadinessBody: any = null;

    results.push(
      await checkHttp(
        "GET /healthz",
        true,
        `${runtimeBase}/healthz`,
        (status, body) => ({
          ok: status === 200 && body?.status === "ok",
          detail: `status=${status}, body.status=${String(body?.status ?? "unknown")}`,
        }),
      ),
    );

    results.push(
      await checkHttp(
        "GET /readyz",
        true,
        `${runtimeBase}/readyz`,
        (status, body) => ({
          ok: status === 200 || status === 503,
          detail: `status=${status}, readiness=${String(body?.status ?? "unknown")}`,
        }),
      ),
    );

    const readinessResult = await checkDeploymentReadinessThreshold(runtimeBase);
    latestReadinessStatusCode = readinessResult.statusCode;
    latestReadinessBody = readinessResult.body;
    results.push(readinessResult.check);

    if (EXPECTED_SYSTEM_MODE) {
      const actualMode = String(latestReadinessBody?.config?.system_mode ?? "unknown").trim().toLowerCase();
      const status = latestReadinessStatusCode;
      results.push({
        name: "Deployment mode matches expected",
        critical: true,
        passed: (status === 200 || status === 503) && actualMode === EXPECTED_SYSTEM_MODE,
        detail: `status=${String(status ?? "unknown")}, actual_mode=${actualMode}, expected_mode=${EXPECTED_SYSTEM_MODE}`,
        durationMs: 0,
      });
    }

    results.push(
      await checkHttp(
        "GET /api/brain/autonomy/supervisor/status",
        false,
        `${runtimeBase}/api/brain/autonomy/supervisor/status`,
        (status, body) => ({
          ok: status === 200 && typeof body?.running === "boolean",
          detail: `status=${status}, running=${String(body?.running ?? "unknown")}, services=${String(body?.services?.length ?? 0)}`,
        }),
      ),
    );

    results.push(
      await checkHttp(
        "GET /api/brain/production/watchdog/status",
        false,
        `${runtimeBase}/api/brain/production/watchdog/status`,
        (status, body) => ({
          ok: status === 200 && typeof body?.running === "boolean",
          detail:
            `status=${status}, running=${String(body?.running ?? "unknown")}, ` +
            `readiness=${String(body?.last_status ?? "unknown")}, escalated=${String(body?.escalation_active ?? "unknown")}`,
        }),
      ),
    );

    results.push(
      await checkHttp(
        "GET /api/brain/strategy/governor/status",
        false,
        `${runtimeBase}/api/brain/strategy/governor/status`,
        (status, body) => ({
          ok: status === 200 && typeof body?.running === "boolean",
          detail: `status=${status}, running=${String(body?.running ?? "unknown")}, cycles=${String(body?.total_cycles ?? 0)}`,
        }),
      ),
    );

    results.push(
      await checkHttp(
        "GET /api/brain/strategy/allocator/status",
        false,
        `${runtimeBase}/api/brain/strategy/allocator/status`,
        (status, body) => ({
          ok: status === 200 && typeof body?.running === "boolean",
          detail: `status=${status}, running=${String(body?.running ?? "unknown")}, allocations=${String(body?.allocation_count ?? 0)}`,
        }),
      ),
    );

    results.push(
      await checkHttp(
        "GET /api/execution/risk-guard",
        false,
        `${runtimeBase}/api/execution/risk-guard`,
        (status, body) => ({
          ok: status === 200 || status === 401 || status === 403,
          detail: `status=${status}, risk_state=${String(body?.risk_state ?? "n/a")}`,
        }),
      ),
    );

    results.push(
      await checkHttp(
        "GET /api/execution/incident-guard",
        false,
        `${runtimeBase}/api/execution/incident-guard`,
        (status, body) => ({
          ok: status === 200 && typeof body?.halt_active === "boolean",
          detail: `status=${status}, level=${String(body?.level ?? "unknown")}, halt=${String(body?.halt_active ?? "unknown")}`,
        }),
      ),
    );

    results.push(
      await checkHttp(
        "GET /api/execution/market-guard",
        false,
        `${runtimeBase}/api/execution/market-guard`,
        (status, body) => ({
          ok: status === 200 && typeof body?.halt_active === "boolean",
          detail: `status=${status}, level=${String(body?.level ?? "unknown")}, halt=${String(body?.halt_active ?? "unknown")}`,
        }),
      ),
    );

    results.push(
      await checkHttp(
        "GET /api/execution/idempotency",
        false,
        `${runtimeBase}/api/execution/idempotency`,
        (status, body) => ({
          ok: status === 200 && typeof body?.entries === "number",
          detail: `status=${status}, entries=${String(body?.entries ?? "unknown")}, require_live_key=${String(body?.policy?.require_key_in_live_mode ?? "unknown")}`,
        }),
      ),
    );
  } else {
    results.push({
      name: "Runtime probes",
      passed: false,
      critical: REQUIRE_HTTP,
      detail: "Runtime server unavailable; skipped HTTP readiness probes",
      durationMs: 0,
    });
  }

  await stopLocalServer();
  printResults(results);
}

main().catch(async (err) => {
  await stopLocalServer();
  console.error(color(31, `deploy-readiness failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
