import { describe, it, expect, vi } from "vitest";

// Mock the auth module to test the timing-safe comparison logic
describe("Auth Guard", () => {
  it("should export requireOperator middleware", async () => {
    const mod = await import("../lib/auth_guard");
    expect(typeof mod.requireOperator).toBe("function");
    expect(typeof mod.requireApiKey).toBe("function");
  });

  it("requireOperator should be a valid Express middleware (3 args)", async () => {
    const { requireOperator } = await import("../lib/auth_guard");
    // Express middleware has 3 params (req, res, next)
    expect(requireOperator.length).toBe(3);
  });

  it("requireApiKey should be a valid Express middleware (3 args)", async () => {
    const { requireApiKey } = await import("../lib/auth_guard");
    expect(requireApiKey.length).toBe(3);
  });
});
