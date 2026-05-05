/**
 * Phase 6 — fail-fast environment validator.
 *
 * Asserts that the variables required to run safely in paper or live
 * production are PRESENT and non-empty. If any is missing, calls
 * process.exit(1) with a single descriptive log line.
 *
 * This is in addition to the existing validateEnv() in lib/env.ts; that
 * one validates the runtimeConfig shape. This one enforces the explicit
 * Phase 6 contract: broker keys, DB url, redis url, operator token.
 *
 * Intended to be called from index.ts BEFORE app.listen().
 */
import { logger } from "../logger.js";

const REQUIRED: ReadonlyArray<{
  name: string;
  reason: string;
  /** Allow this var to be empty when GODSVIEW_SYSTEM_MODE === "demo". */
  demoOk?: boolean;
}> = [
  { name: "DATABASE_URL", reason: "needed for persistent trade journal" },
  { name: "GODSVIEW_OPERATOR_TOKEN", reason: "required to gate critical actions (kill switch, reconciliation)" },
  { name: "ALPACA_API_KEY", reason: "broker key — required for paper or live mode", demoOk: true },
  { name: "ALPACA_SECRET_KEY", reason: "broker secret — required for paper or live mode", demoOk: true },
  { name: "REDIS_URL", reason: "required for distributed cache (Phase 6 readiness probe)", demoOk: true },
];

export interface ValidationResult {
  ok: boolean;
  missing: ReadonlyArray<{ name: string; reason: string }>;
}

export function validatePhase6Env(env: NodeJS.ProcessEnv = process.env): ValidationResult {
  const mode = String(env.GODSVIEW_SYSTEM_MODE ?? "").trim().toLowerCase();
  const isDemo = mode === "demo";
  const missing: Array<{ name: string; reason: string }> = [];
  for (const v of REQUIRED) {
    if (isDemo && v.demoOk) continue;
    const value = (env[v.name] ?? "").trim();
    if (value.length === 0) missing.push({ name: v.name, reason: v.reason });
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Crash-on-missing variant. Call from server entrypoint.
 *
 * Behavior:
 *   - logs each missing var with a one-line reason
 *   - calls process.exit(1)
 *
 * Pass `{ exit: false }` to throw instead (used by tests).
 */
export function assertPhase6EnvOrExit(opts: { exit?: boolean } = {}): void {
  const result = validatePhase6Env();
  if (result.ok) return;
  for (const m of result.missing) {
    logger.fatal({ var: m.name, reason: m.reason }, "[phase6] required env missing");
  }
  if (opts.exit === false) {
    throw new Error(`phase6_env_missing: ${result.missing.map((m) => m.name).join(",")}`);
  }
  process.exit(1);
}
