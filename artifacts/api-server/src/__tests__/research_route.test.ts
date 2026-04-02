/**
 * research_route.test.ts — Phase 56
 *
 * Tests for GET /research/openbb/latest (routes/research.ts).
 *
 * The route reads JSON files from disk via node:fs/promises.
 * We mock the fs module to control what's "on disk".
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock node:fs/promises ─────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (_path: string) => {
    throw new Error("ENOENT: no such file or directory");
  }),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import researchRouter from "../routes/research";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", researchRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

function get(path: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method: "GET" }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /research/openbb/latest
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /research/openbb/latest", () => {
  it("returns 404 when no research artifacts exist", async () => {
    const { status } = await get("/research/openbb/latest");
    expect(status).toBe(404);
  });

  it("404 response has status=not_found", async () => {
    const { data } = await get("/research/openbb/latest");
    const d = data as Record<string, unknown>;
    expect(d.status).toBe("not_found");
  });

  it("404 response includes base_dir field", async () => {
    const { data } = await get("/research/openbb/latest");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("base_dir");
    expect(typeof d.base_dir).toBe("string");
  });

  it("404 response has null artifact fields", async () => {
    const { data } = await get("/research/openbb/latest");
    const d = data as Record<string, unknown>;
    expect(d.latest_signal).toBeNull();
    expect(d.latest_decision).toBeNull();
    expect(d.backtest_summary).toBeNull();
  });

  it("returns 200 when at least one artifact exists", async () => {
    const { readFile } = await import("node:fs/promises");
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ symbol: "BTCUSD", action: "buy", confidence: 0.8 }) as any,
    );
    const { status, data } = await get("/research/openbb/latest");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.status).toBe("ok");
    expect(d.latest_signal).not.toBeNull();
  });

  it("200 response has message field", async () => {
    const { readFile } = await import("node:fs/promises");
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ signal: "mock" }) as any,
    );
    const { data } = await get("/research/openbb/latest");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("message");
    expect(typeof d.message).toBe("string");
  });
});
