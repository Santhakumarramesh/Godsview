/**
 * Autonomy gate — verifies the four hard-coded preconditions that must ALL
 * be true before any code path can flip the system into autonomous mode.
 *
 * Today every default-env machine should report disallowed. The flag has
 * to be deliberately set in production. This test guards against future
 * refactors that quietly relax the check.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAutonomyAllowed, assertAutonomyAllowed } from "../lib/autonomy_gate";

const KEYS = ["NODE_ENV", "EXECUTION_MODE", "STRATEGY_AUTONOMY_ALLOW", "PAPER_PROOF_DAYS"];

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(snap: Record<string, string | undefined>) {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe("autonomy gate", () => {
  let snap: Record<string, string | undefined>;
  beforeEach(() => { snap = snapshotEnv(); });
  afterEach(() => { restoreEnv(snap); });

  it("default env is disallowed", () => {
    delete process.env.NODE_ENV;
    delete process.env.EXECUTION_MODE;
    delete process.env.STRATEGY_AUTONOMY_ALLOW;
    delete process.env.PAPER_PROOF_DAYS;
    const r = isAutonomyAllowed();
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/NODE_ENV/);
  });

  it("dev environment is disallowed", () => {
    process.env.NODE_ENV = "development";
    expect(isAutonomyAllowed().allowed).toBe(false);
  });

  it("prod + paper mode is still disallowed", () => {
    process.env.NODE_ENV = "production";
    process.env.EXECUTION_MODE = "paper";
    expect(isAutonomyAllowed().allowed).toBe(false);
  });

  it("prod + live but no STRATEGY_AUTONOMY_ALLOW — disallowed", () => {
    process.env.NODE_ENV = "production";
    process.env.EXECUTION_MODE = "live_enabled";
    delete process.env.STRATEGY_AUTONOMY_ALLOW;
    expect(isAutonomyAllowed().allowed).toBe(false);
  });

  it("prod + live + flag but PAPER_PROOF_DAYS<90 — disallowed", () => {
    process.env.NODE_ENV = "production";
    process.env.EXECUTION_MODE = "live_enabled";
    process.env.STRATEGY_AUTONOMY_ALLOW = "on";
    process.env.PAPER_PROOF_DAYS = "30";
    expect(isAutonomyAllowed().allowed).toBe(false);
  });

  it("all four conditions met — allowed", () => {
    process.env.NODE_ENV = "production";
    process.env.EXECUTION_MODE = "live_enabled";
    process.env.STRATEGY_AUTONOMY_ALLOW = "on";
    process.env.PAPER_PROOF_DAYS = "120";
    const r = isAutonomyAllowed();
    expect(r.allowed).toBe(true);
  });

  it("assertAutonomyAllowed throws with status 423 when blocked", () => {
    delete process.env.NODE_ENV;
    let caught: any = null;
    try { assertAutonomyAllowed(); } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    expect(caught.status).toBe(423);
    expect(String(caught.message)).toMatch(/Autonomy gate refused/);
  });
});
