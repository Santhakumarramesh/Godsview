import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";

const mocked = vi.hoisted(() => {
  const snapshot = {
    generated_at: new Date().toISOString(),
    overall_status: "DEGRADED" as const,
    readiness_status: "DEGRADED" as const,
    readiness_summary: {
      failed_critical: 0,
      failed_non_critical: 2,
    },
    kill_switch_active: false,
    supervisor_health: {
      expected_services: 6,
      healthy_services: 4,
      ratio: 4 / 6,
    },
    services: [],
    issues: [],
    recommendations: [],
  };

  return {
    snapshot,
    lib: {
      parseAutonomyDebugQuery: vi.fn(() => ({ includePreflight: false, forceReadiness: false })),
      getAutonomyDebugSnapshot: vi.fn(async () => snapshot),
      runAutonomyDebugAutoFix: vi.fn(async () => ({
        fixes: [{ service: "strategy_allocator", attempted: true, success: true, detail: "started" }],
        snapshot,
      })),
    },
  };
});

vi.mock("../lib/autonomy_debugger", () => mocked.lib);

import autonomyDebuggerRouter from "../routes/autonomy_debugger";

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", autonomyDebuggerRouter);
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

beforeEach(() => {
  vi.clearAllMocks();
});

function req(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const request = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: raw });
          }
        });
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe("autonomy_debugger routes", () => {
  it("GET /brain/autonomy/debug returns snapshot", async () => {
    const { status, data } = await req("GET", "/brain/autonomy/debug");
    expect(status).toBe(200);
    expect(data).toHaveProperty("overall_status");
    expect(mocked.lib.getAutonomyDebugSnapshot).toHaveBeenCalledTimes(1);
  });

  it("GET /ops/autonomy/debug returns snapshot", async () => {
    const { status, data } = await req("GET", "/ops/autonomy/debug");
    expect(status).toBe(200);
    expect(data).toHaveProperty("readiness_status");
    expect(mocked.lib.getAutonomyDebugSnapshot).toHaveBeenCalledTimes(1);
  });

  it("POST /brain/autonomy/debug/fix runs auto-fix", async () => {
    const { status, data } = await req("POST", "/brain/autonomy/debug/fix", {
      include_preflight: true,
      force_refresh: true,
    });
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok", true);
    expect(mocked.lib.runAutonomyDebugAutoFix).toHaveBeenCalledWith({
      includePreflight: true,
      forceReadiness: true,
    });
  });
});

