import { describe, it, expect, beforeEach } from "vitest";
import {
  createApiKey,
  revokeApiKey,
  validateApiKey,
  listApiKeys,
  checkRateLimit,
  logRequest,
  getAuditLog,
  getGatewaySnapshot,
  resetGateway,
} from "../lib/api_gateway.js";

beforeEach(() => resetGateway());

describe("API Gateway", () => {
  it("creates an API key", () => {
    const k = createApiKey({ name: "Test", role: "trader" });
    expect(k.key).toMatch(/^gv_trader_/);
    expect(k.permissions).toContain("execute");
    expect(k.enabled).toBe(true);
  });

  it("validates key", () => {
    const k = createApiKey({ name: "T", role: "admin" });
    const r = validateApiKey(k.key);
    expect(r.valid).toBe(true);
    expect(r.apiKey?.role).toBe("admin");
  });

  it("rejects unknown key", () => {
    expect(validateApiKey("bad")).toEqual({ valid: false, reason: "Unknown API key" });
  });

  it("revokes key", () => {
    const k = createApiKey({ name: "T", role: "viewer" });
    revokeApiKey(k.key);
    expect(validateApiKey(k.key).valid).toBe(false);
  });

  it("lists keys (masked)", () => {
    createApiKey({ name: "A", role: "admin" });
    const list = listApiKeys();
    expect(list).toHaveLength(1);
    expect(list[0].key).toContain("...");
  });

  it("rate limits", () => {
    const k = createApiKey({ name: "T", role: "bot", rateLimit: 5 });
    for (let i = 0; i < 6; i++) checkRateLimit(k.key);
    const state = checkRateLimit(k.key);
    expect(state.remaining).toBe(0);
  });

  it("logs requests", () => {
    logRequest({ apiKey: "k", role: "admin", method: "GET", path: "/test", statusCode: 200, latencyMs: 5, ip: "127.0.0.1", blocked: false });
    expect(getAuditLog()).toHaveLength(1);
  });

  it("returns snapshot", () => {
    createApiKey({ name: "A", role: "admin" });
    const snap = getGatewaySnapshot();
    expect(snap.totalKeys).toBe(1);
    expect(snap.activeKeys).toBe(1);
  });
});
