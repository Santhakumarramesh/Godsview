import { describe, expect, it } from "vitest";
import { validatePhase6Env, assertPhase6EnvOrExit } from "../lib/ops/phase6_env";

describe("validatePhase6Env", () => {
  const happy = {
    DATABASE_URL: "postgres://x",
    GODSVIEW_OPERATOR_TOKEN: "tok",
    ALPACA_API_KEY: "PK_x",
    ALPACA_SECRET_KEY: "SK_x",
    REDIS_URL: "redis://x",
    GODSVIEW_SYSTEM_MODE: "paper",
  };

  it("ok=true when all required vars present", () => {
    expect(validatePhase6Env(happy as any).ok).toBe(true);
  });

  it("ok=false and lists missing vars by name", () => {
    const r = validatePhase6Env({ ...happy, ALPACA_API_KEY: "" } as any);
    expect(r.ok).toBe(false);
    expect(r.missing.map((m) => m.name)).toContain("ALPACA_API_KEY");
  });

  it("demo mode permits broker keys + redis to be empty", () => {
    const r = validatePhase6Env({
      DATABASE_URL: "postgres://x",
      GODSVIEW_OPERATOR_TOKEN: "tok",
      GODSVIEW_SYSTEM_MODE: "demo",
    } as any);
    expect(r.ok).toBe(true);
  });

  it("demo mode still requires DATABASE_URL", () => {
    const r = validatePhase6Env({ GODSVIEW_OPERATOR_TOKEN: "tok", GODSVIEW_SYSTEM_MODE: "demo" } as any);
    expect(r.ok).toBe(false);
    expect(r.missing.map((m) => m.name)).toContain("DATABASE_URL");
  });

  it("assertPhase6EnvOrExit throws when exit:false and vars missing", () => {
    const orig = { ...process.env };
    try {
      delete process.env.ALPACA_API_KEY;
      delete process.env.ALPACA_SECRET_KEY;
      delete process.env.DATABASE_URL;
      delete process.env.REDIS_URL;
      delete process.env.GODSVIEW_OPERATOR_TOKEN;
      expect(() => assertPhase6EnvOrExit({ exit: false })).toThrow(/phase6_env_missing/);
    } finally {
      Object.assign(process.env, orig);
    }
  });
});
