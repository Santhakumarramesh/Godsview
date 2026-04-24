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
    interval_ms: 45_000,
    consecutive_not_ready: 0,
    consecutive_degraded: 0,
    escalation_active: false,
    last_status: null,
    last_report_at: null,
    last_report_summary: {
      failed_critical: 0,
      failed_non_critical: 0,
    },
    policy: {
      auto_enforce: true,
      interval_ms: 45_000,
      include_preflight: false,
      not_ready_trip_count: 3,
      degraded_warn_count: 4,
      auto_pause_autonomy: true,
      auto_kill_switch: true,
    },
    recent_actions: [],
  };

  return {
    snapshot,
    lib: {
      getProductionWatchdogSnapshot: vi.fn(() => snapshot),
      resetProductionWatchdogState: vi.fn(() => snapshot),
      runProductionWatchdogCycle: vi.fn(async () => snapshot),
      startProductionWatchdog: vi.fn(async () => ({
        success: true,
        message: "Production watchdog started",
        interval_ms: 30_000,
      })),
      stopProductionWatchdog: vi.fn(() => ({
        success: true,
        message: "Production watchdog stopped",
      })),
    },
  };
});

vi.mock("../lib/production_watchdog", () => mocked.lib);

import productionWatchdogRouter from "../routes/production_watchdog";

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", productionWatchdogRouter);

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

describe("production_watchdog routes", () => {
  it("GET /brain/production/watchdog/status returns snapshot", async () => {
    const { status, data } = await req("GET", "/brain/production/watchdog/status");
    expect(status).toBe(200);
    expect(data).toHaveProperty("running");
    expect(mocked.lib.getProductionWatchdogSnapshot).toHaveBeenCalledTimes(1);
  });

  it("POST /brain/production/watchdog/start parses payload", async () => {
    const { status } = await req("POST", "/brain/production/watchdog/start", {
      interval_ms: 12000,
      run_immediate: false,
    });
    expect(status).toBe(200);
    expect(mocked.lib.startProductionWatchdog).toHaveBeenCalledWith({
      intervalMs: 12000,
      runImmediate: false,
    });
  });

  it("POST /brain/production/watchdog/stop returns success", async () => {
    const { status, data } = await req("POST", "/brain/production/watchdog/stop");
    expect(status).toBe(200);
    expect(data).toHaveProperty("success", true);
    expect(mocked.lib.stopProductionWatchdog).toHaveBeenCalledTimes(1);
  });

  it("POST /brain/production/watchdog/run-once triggers cycle", async () => {
    const { status, data } = await req("POST", "/brain/production/watchdog/run-once");
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok", true);
    expect(mocked.lib.runProductionWatchdogCycle).toHaveBeenCalledWith("manual_route");
  });

  it("POST /brain/production/watchdog/reset resets state", async () => {
    const { status, data } = await req("POST", "/brain/production/watchdog/reset");
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok", true);
    expect(mocked.lib.resetProductionWatchdogState).toHaveBeenCalledTimes(1);
  });
});
