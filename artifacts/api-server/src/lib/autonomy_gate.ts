/**
 * Hard-coded autonomy ceiling.
 *
 * Any code path that wants to flip a strategy or the system into autonomous
 * mode MUST go through this gate. The gate is intentionally strict:
 *
 *   1. NODE_ENV must be 'production'                        — no autonomous in dev
 *   2. EXECUTION_MODE must be 'live_enabled' or 'auto'      — operator opt-in
 *   3. STRATEGY_AUTONOMY_ALLOW must be 'on'                 — explicit flag
 *   4. PAPER_PROOF_DAYS env (≥90) must be present + numeric — soak proof
 *
 * If ANY of these is missing, `assertAutonomyAllowed()` throws and
 * `isAutonomyAllowed()` returns `{allowed:false, reason:'...'}`. The reason
 * is intentionally specific so the operator can see which gate blocked.
 */

export type AutonomyDecision = { allowed: boolean; reason?: string };

export function isAutonomyAllowed(): AutonomyDecision {
  const env = (process.env.NODE_ENV ?? "").toLowerCase();
  if (env !== "production") {
    return { allowed: false, reason: `NODE_ENV is '${env}', not 'production'` };
  }

  const mode = (process.env.EXECUTION_MODE ?? "paper").toLowerCase();
  if (mode !== "live_enabled" && mode !== "auto") {
    return { allowed: false, reason: `EXECUTION_MODE is '${mode}'; need 'live_enabled' or 'auto'` };
  }

  const allow = (process.env.STRATEGY_AUTONOMY_ALLOW ?? "").toLowerCase();
  if (allow !== "on") {
    return { allowed: false, reason: "STRATEGY_AUTONOMY_ALLOW != 'on'" };
  }

  const days = Number(process.env.PAPER_PROOF_DAYS ?? "0");
  if (!Number.isFinite(days) || days < 90) {
    return { allowed: false, reason: `PAPER_PROOF_DAYS=${process.env.PAPER_PROOF_DAYS} < 90` };
  }

  return { allowed: true };
}

export function assertAutonomyAllowed(): void {
  const r = isAutonomyAllowed();
  if (!r.allowed) {
    const err: any = new Error(`Autonomy gate refused: ${r.reason}`);
    err.status = 423; // Locked
    throw err;
  }
}
