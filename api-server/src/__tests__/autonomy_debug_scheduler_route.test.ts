import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";

const mocked = vi.hoisted(() => {
  const snapshot = {
    running: false,
    cycle_in_flight: false,
    started_at: null,
    last_cycle_at: null,
    last_cycle_duration_ms: null,
    last_error: null,
    total_cycles: 0,
    total_actions: 0,
    total_fix_actions: 0,
    interval_ms: 60_000,
    consecutive_critical: 0,
    last_status: "HEALTHY" as const,
    last_issue_count: 0,
    last_critical_issues: 0,
    last_warn_issues: 0,
    kill_switch_active: false,
    kill_switch_engaged_by_scheduler: false,
    policy: {
      auto_enforce: true,
      interval_ms: 60_000,
      include_preflight: false,
      auto_fix_on_degraded: true,
      auto_fix_on_critical: true,
      critical_alert_threshold: 2,
      auto_kill_switch_on_critical_streak: false,
      kill_switch_threshold: 4,
    },
    recent_actions: [],
  };

  return {
    snapshot,
    lib: {
      getAutonomyDebugSchedulerSnapshot: vi.fn(() => snapshot),
      resetAutonomyDebugSchedulerState: vi.fn(() => snapshot),
      runAutonomyDebugSchedulerCycle: vi.fn(async () => snapshot),
      startAutonomyDebugScheduler: vi.fn(async () => ({
        success: true,
        message: "Autonomy debug scheduler started",
        interval_ms: 30_000,
      })),
      stopAutonomyDebugScheduler: vi.fn(() => ({
        success: true,
        message: "Autonomy debug scheduler stopped",
      })),
    },
  };
});

vi.mock("../lib/autonomy_debug_scheduler", () => mocked.lib);

import autonomyDebugSchedulerRouter from "../routes/autonomy_debug_scheduler";

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", autonomyDebugSchedulerRouter);
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

describe("autonomy_debug_scheduler routes", () => {
  it("GET /brain/autonomy/debug/scheduler/status returns snapshot", async () => {
    const { status, data } = await req("GET", "/brain/autonomy/debug/scheduler/status");
    expect(status).toBe(200);
    expect(data).toHaveProperty("running");
    expect(mocked.lib.getAutonomyDebugSchedulerSnapshot).toHaveBeenCalledTimes(1);
  });

  it("GET /ops/autonomy/debug/scheduler/status returns snapshot", async () => {
    const { status, data } = await req("GET", "/ops/autonomy/debug/scheduler/status");
    expect(status).toBe(200);
    expect(data).toHaveProperty("last_status");
    expect(mocked.lib.getAutonomyDebugSchedulerSnapshot).toHaveBeenCalledTimes(1);
  });

  it("POST /brain/autonomy/debug/scheduler/start parses payload", async () => {
    const { status } = await req("POST", "/brain/autonomy/debug/scheduler/start", {
      interval_ms: 24000,
      run_immediate: false,
    });
    expect(status).toBe(200);
    expect(mocked.lib.startAutonomyDebugScheduler).toHaveBeenCalledWith({
      intervalMs: 24000,
      runImmediate: false,
    });
  });

  it("POST /brain/autonomy/debug/scheduler/stop returns success", async () => {
    const { status, data } = await req("POST", "/brain/autonomy/debug/scheduler/stop");
    expect(status).toBe(200);
    expect(data).toHaveProperty("success", true);
    expect(mocked.lib.stopAutonomyDebugScheduler).toHaveBeenCalledTimes(1);
  });

  it("POST /brain/autonomy/debug/scheduler/run-once triggers cycle", async () => {
    const { status, data } = await req("POST", "/brain/autonomy/debug/scheduler/run-once");
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok", true);
    expect(mocked.lib.runAutonomyDebugSchedulerCycle).toHaveBeenCalledWith("manual_route");
  });

  it("POST /brain/autonomy/debug/scheduler/reset resets state", async () => {
    const { status, data } = await req("POST", "/brain/autonomy/debug/scheduler/reset");
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok", true);
    expect(mocked.lib.resetAutonomyDebugSchedulerState).toHaveBeenCalledTimes(1);
  });
});
