/**
 * brain_state.test.ts — Brain Console v1 aggregator
 *
 * Covers:
 *  1. Endpoint returns JSON 200 with all required keys.
 *  2. SectionResult shape ({status, value}) on every aggregated section.
 *  3. Verdict is a non-empty string and contains no Math.random fingerprints.
 *  4. MCP layer is reported as `not_connected` (not silently omitted).
 *  5. Graceful degradation: when upstream sources are unreachable, the
 *     aggregator still emits a 200 with each section flagged
 *     `not_connected`. The verdict still generates from real null values.
 *
 * The test mounts ONLY the brain_state router on a local Express app and
 * points the aggregator's loopback at the same test app via
 * GODSVIEW_SELF_BASE_URL. Because the test app does not mount the upstream
 * routes (/api/health/phase6, /api/proof/*, etc.), every internal fetch
 * returns 404 — exercising the `not_connected` branch end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import brainStateRouter from "../routes/brain_state";

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", brainStateRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Force the aggregator's internal fan-out fetches to hit THIS test app
  // (which only knows /api/brain-state, so all upstream fetches 404).
  process.env.GODSVIEW_SELF_BASE_URL = baseUrl;
});

afterAll(async () => {
  delete process.env.GODSVIEW_SELF_BASE_URL;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

async function getBrainState(): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/brain-state`);
  const body = await res.json();
  return { status: res.status, body };
}

describe("GET /api/brain-state — Brain Console v1", () => {
  it("returns 200 JSON with all required top-level keys", async () => {
    const { status, body } = await getBrainState();

    expect(status).toBe(200);
    expect(body).toBeTypeOf("object");

    expect(body).toHaveProperty("generated_at");
    expect(body).toHaveProperty("mode");
    expect(body).toHaveProperty("health");
    expect(body).toHaveProperty("ready");
    expect(body).toHaveProperty("account");
    expect(body).toHaveProperty("scanner");
    expect(body.scanner).toHaveProperty("status");
    expect(body.scanner).toHaveProperty("history");
    expect(body).toHaveProperty("proof");
    expect(body.proof).toHaveProperty("trades");
    expect(body.proof).toHaveProperty("metrics");
    expect(body.proof).toHaveProperty("equity");
    expect(body.proof).toHaveProperty("integrity");
    expect(body.proof).toHaveProperty("reconciliation");
    expect(body).toHaveProperty("signals");
    expect(body.signals).toHaveProperty("active");
    expect(body.signals).toHaveProperty("rejected");
    expect(body).toHaveProperty("risk");
    expect(body.risk).toHaveProperty("summary");
    expect(body).toHaveProperty("macro");
    expect(body).toHaveProperty("mcp");
    expect(body).toHaveProperty("verdict");

    // Milestone 2: pipeline section is present and exposes strategy meta.
    expect(body).toHaveProperty("pipeline");
    expect(body.pipeline).toHaveProperty("status");
    expect(body.pipeline).toHaveProperty("value");
    if (body.pipeline.status === "ok" && body.pipeline.value) {
      expect(body.pipeline.value).toHaveProperty("strategy_name");
      expect(body.pipeline.value).toHaveProperty("strategy_version");
      expect(body.pipeline.value).toHaveProperty("totals");
      expect(body.pipeline.value).toHaveProperty("not_connected_layers");
      expect(Array.isArray(body.pipeline.value.not_connected_layers)).toBe(true);
    }
  });

  it("each aggregated section follows the SectionResult shape", async () => {
    const { body } = await getBrainState();
    const sections = [
      body.health,
      body.ready,
      body.account,
      body.scanner.status,
      body.scanner.history,
      body.proof.trades,
      body.proof.metrics,
      body.proof.equity,
      body.proof.integrity,
      body.proof.reconciliation,
      body.signals.active,
      body.signals.rejected,
      body.risk.summary,
      body.macro,
    ];
    for (const s of sections) {
      expect(s).toHaveProperty("status");
      expect(["ok", "not_connected"]).toContain(s.status);
      expect(s).toHaveProperty("value");
    }
  });

  it("MCP layer is honestly reported as not_connected", async () => {
    const { body } = await getBrainState();
    expect(body.mcp.status).toBe("not_connected");
    expect(typeof body.mcp.reason).toBe("string");
    expect(Array.isArray(body.mcp.servers)).toBe(true);
    expect(body.mcp.servers).toContain("tradingview");
  });

  it("mode block is derived from env, not random", async () => {
    const { body } = await getBrainState();
    expect(typeof body.mode.system_mode).toBe("string");
    expect(body.mode.system_mode.length).toBeGreaterThan(0);
    expect(typeof body.mode.live_writes_enabled).toBe("boolean");
    expect(typeof body.mode.kill_switch_active).toBe("boolean");
    expect(typeof body.mode.starting_equity_usd).toBe("number");
  });

  it("verdict is a non-empty string with no Math.random fingerprints", async () => {
    const { body } = await getBrainState();
    expect(typeof body.verdict).toBe("string");
    expect(body.verdict.length).toBeGreaterThan(0);

    // Math.random() floats almost always have 15+ trailing digits when
    // serialized. The aggregator should never produce one.
    const fullJson = JSON.stringify(body);
    expect(fullJson).not.toMatch(/0\.\d{15,}/);
  });

  it("degrades gracefully when upstream sources are unreachable", async () => {
    // The test app only mounts /api/brain-state, so every internal
    // fetch (e.g. /api/health/phase6, /api/proof/*) returns 404 in this
    // sandbox. Confirm the aggregator surfaces them as `not_connected`
    // instead of crashing or fabricating values.
    const { status, body } = await getBrainState();
    expect(status).toBe(200);
    expect(body.health.status).toBe("not_connected");
    expect(body.health.value).toBeNull();
    expect(body.proof.metrics.status).toBe("not_connected");
    expect(body.proof.metrics.value).toBeNull();
    expect(body.scanner.status.status).toBe("not_connected");
    expect(body.scanner.status.value).toBeNull();
  });

  it("generated_at is a valid ISO timestamp", async () => {
    const { body } = await getBrainState();
    expect(typeof body.generated_at).toBe("string");
    const parsed = Date.parse(body.generated_at);
    expect(Number.isNaN(parsed)).toBe(false);
  });
});
