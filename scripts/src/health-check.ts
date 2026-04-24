#!/usr/bin/env tsx
/**
 * health-check.ts — Production Deployment Verification CLI
 *
 * Smoke-tests a running GodsView server to confirm the deployment is healthy.
 * Exits 0 on full pass, exits 1 if any critical check fails.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 pnpm run health-check
 */

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_KEY  = process.env.GODSVIEW_OPERATOR_TOKEN ?? "";
const TIMEOUT  = 10_000; // ms per request

// ── Colours ──────────────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";

// ── Types ────────────────────────────────────────────────────────────────────
interface CheckResult {
  name: string;
  passed: boolean;
  critical: boolean;
  detail: string;
  durationMs: number;
}

// ── HTTP helper with timeout ──────────────────────────────────────────────────
async function get(path: string): Promise<{ status: number; body: unknown; durationMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    const res = await fetch(`${BASE_URL}${path}`, { signal: controller.signal, headers });
    let body: unknown;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body, durationMs: Date.now() - start };
  } catch (err: any) {
    throw new Error(err?.name === "AbortError" ? `Timeout after ${TIMEOUT}ms` : (err?.message ?? "Network error"));
  } finally {
    clearTimeout(timer);
  }
}

// ── Individual checks ─────────────────────────────────────────────────────────
async function check(
  name: string,
  critical: boolean,
  fn: () => Promise<string>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { name, passed: true, critical, detail, durationMs: Date.now() - start };
  } catch (err: any) {
    return { name, passed: false, critical, detail: err?.message ?? "unknown error", durationMs: Date.now() - start };
  }
}

async function runChecks(): Promise<CheckResult[]> {
  return Promise.all([

    // ── Liveness ─────────────────────────────────────────────────────────────
    check("GET /healthz — liveness", true, async () => {
      const { status, body } = await get("/healthz");
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const b = body as Record<string, unknown>;
      if (b.status !== "ok") throw new Error(`status=${b.status}`);
      return `uptime=${b.uptimeSeconds}s`;
    }),

    // ── Readiness ────────────────────────────────────────────────────────────
    check("GET /readyz — readiness", true, async () => {
      const { status, body } = await get("/readyz");
      if (status !== 200 && status !== 503) throw new Error(`HTTP ${status}`);
      const b = body as Record<string, unknown>;
      const ready = b.ready ?? b.status;
      return `ready=${ready}`;
    }),

    // ── Prometheus metrics ────────────────────────────────────────────────────
    check("GET /metrics — prometheus", false, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      const start = Date.now();
      try {
        const headers: Record<string, string> = {};
        if (API_KEY) headers["X-API-Key"] = API_KEY;
        const res = await fetch(`${BASE_URL}/metrics`, { signal: controller.signal, headers });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const lineCount = text.split("\n").length;
        return `${lineCount} lines in ${Date.now() - start}ms`;
      } finally {
        clearTimeout(timer);
      }
    }),

    // ── System status ─────────────────────────────────────────────────────────
    check("GET /api/system/status", true, async () => {
      const { status, body } = await get("/api/system/status");
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const b = body as Record<string, unknown>;
      return `mode=${b.system_mode ?? b.mode ?? "unknown"}`;
    }),

    // ── Signals endpoint ──────────────────────────────────────────────────────
    check("GET /api/signals", false, async () => {
      const { status, body } = await get("/api/signals?limit=1");
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const b = body as Record<string, unknown>;
      const count = Array.isArray(b.signals) ? b.signals.length : Array.isArray(b) ? (b as unknown[]).length : "?";
      return `returned ${count} signal(s)`;
    }),

    // ── Trades endpoint ───────────────────────────────────────────────────────
    check("GET /api/trades", false, async () => {
      const { status } = await get("/api/trades?limit=1");
      if (status !== 200) throw new Error(`HTTP ${status}`);
      return "OK";
    }),

    // ── War room ──────────────────────────────────────────────────────────────
    check("GET /api/war-room/BTCUSD", false, async () => {
      const { status } = await get("/api/war-room/BTCUSD");
      if (status !== 200 && status !== 404) throw new Error(`HTTP ${status}`);
      return status === 404 ? "no data yet (expected)" : "OK";
    }),

    // ── Checklist ─────────────────────────────────────────────────────────────
    check("GET /api/checklist/BTCUSD", false, async () => {
      const { status } = await get("/api/checklist/BTCUSD");
      if (status !== 200 && status !== 404) throw new Error(`HTTP ${status}`);
      return status === 404 ? "no data yet (expected)" : "OK";
    }),

    // ── SSE stream status ─────────────────────────────────────────────────────
    check("GET /api/stream/status", false, async () => {
      const { status, body } = await get("/api/stream/status");
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const b = body as Record<string, unknown>;
      return `clients=${b.clientCount ?? 0}`;
    }),

    // ── Dashboard HTML ────────────────────────────────────────────────────────
    check("GET / — dashboard HTML", true, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      try {
        const res = await fetch(`${BASE_URL}/`, { signal: controller.signal });
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.includes("<html") && !text.includes("<!DOCTYPE")) throw new Error("Response is not HTML");
        return `${text.length} bytes`;
      } finally {
        clearTimeout(timer);
      }
    }),
  ]);
}

// ── Report + exit ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}GodsView Health Check${RESET}`);
  console.log(`${CYAN}Target: ${BASE_URL}${RESET}\n`);

  const results = await runChecks();

  let criticalFailed = 0;
  let warnFailed = 0;
  let passed = 0;

  for (const r of results) {
    const icon   = r.passed ? `${GREEN}✓${RESET}` : r.critical ? `${RED}✗${RESET}` : `${YELLOW}⚠${RESET}`;
    const label  = r.passed ? `${GREEN}PASS${RESET}` : r.critical ? `${RED}FAIL${RESET}` : `${YELLOW}WARN${RESET}`;
    const timing = `${CYAN}${r.durationMs}ms${RESET}`;
    console.log(`  ${icon} ${label}  ${r.name.padEnd(42)} ${timing}`);
    if (!r.passed) {
      console.log(`       ${YELLOW}↳ ${r.detail}${RESET}`);
    }
    if (r.passed)             passed++;
    else if (r.critical)      criticalFailed++;
    else                      warnFailed++;
  }

  const total = results.length;
  console.log(`\n${BOLD}Results: ${GREEN}${passed} passed${RESET}` +
    (warnFailed  ? `, ${YELLOW}${warnFailed} warnings${RESET}` : "") +
    (criticalFailed ? `, ${RED}${criticalFailed} critical failures${RESET}` : "") +
    ` / ${total} checks${RESET}`);

  if (criticalFailed > 0) {
    console.log(`\n${RED}${BOLD}DEPLOYMENT UNHEALTHY — ${criticalFailed} critical check(s) failed${RESET}\n`);
    process.exit(1);
  } else if (warnFailed > 0) {
    console.log(`\n${YELLOW}${BOLD}DEPLOYMENT DEGRADED — ${warnFailed} non-critical check(s) failed${RESET}\n`);
    process.exit(0); // non-critical — exit 0 so CI doesn't block
  } else {
    console.log(`\n${GREEN}${BOLD}DEPLOYMENT HEALTHY ✓${RESET}\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${RED}Health check crashed: ${err?.message ?? err}${RESET}`);
  process.exit(1);
});
