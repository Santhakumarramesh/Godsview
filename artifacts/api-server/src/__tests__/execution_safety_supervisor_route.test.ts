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
    consecutive_warn: 0,
    consecutive_blocked: 0,
    last_summary: null,
    policy: {
      auto_enforce: true,
      interval_ms: 45_000,
      heartbeat_symbol: "BTCUSD",
      include_market_guard: true,
      include_portfolio_risk: true,
      auto_heal_autonomy: true,
      warn_alert_threshold: 3,
      block_alert_threshold: 2,
      auto_kill_switch_on_block: true,
    },
    recent_actions: [],
  };

  return {
    snapshot,
    lib: {
      getExecutionSafetySupervisorSnapshot: vi.fn(() => snapshot),
      resetExecutionSafetySupervisorState: vi.fn(() => snapshot),
      runExecutionSafetySupervisorCycle: vi.fn(async () => snapshot),
      startExecutionSafetySupervisor: vi.fn(async () => ({
        success: true,
        message: "Execution safety supervisor started",
        interval_ms: 30_000,
        heartbeat_symbol: "BTCUSD",
      })),
      stopExecutionSafetySupervisor: vi.fn(() => ({
        success: true,
        message: "Execution safety supervisor stopped",
      })),
    },
  };
});

vi.mock("../lib/execution_safety_supervisor", () => mocked.lib);

import executionSafetySupervisorRouter from "../routes/execution_safety_supervisor";

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/", executionSafetySupervisorRouter);

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

describe("execution_safety_supervisor routes", () => {
  it("GET /brain/execution/safety-supervisor/status returns snapshot", async () => {
    const { status, data } = await req("GET", "/brain/execution/safety-supervisor/status");
    expect(status).toBe(200);
    expect(data).toHaveProperty("running");
    expect(mocked.lib.getExecutionSafetySupervisorSnapshot).toHaveBeenCalledTimes(1);
  });

  it("GET /ops/execution/safety-supervisor/status returns snapshot", async () => {
    const { status, data } = await req("GET", "/ops/execution/safety-supervisor/status");
    expect(status).toBe(200);
    expect(data).toHaveProperty("policy");
    expect(mocked.lib.getExecutionSafetySupervisorSnapshot).toHaveBeenCalledTimes(1);
  });

  it("POST /brain/execution/safety-supervisor/start parses payload", async () => {
    const { status } = await req("POST", "/brain/execution/safety-supervisor/start", {
      interval_ms: 24000,
      run_immediate: false,
      heartbeat_symbol: "spy",
    });
    expect(status).toBe(200);
    expect(mocked.lib.startExecutionSafetySupervisor).toHaveBeenCalledWith({
      intervalMs: 24000,
      runImmediate: false,
      heartbeatSymbol: "spy",
    });
  });

  it("POST /brain/execution/safety-supervisor/stop returns success", async () => {
    const { status, data } = await req("POST", "/brain/execution/safety-supervisor/stop");
    expect(status).toBe(200);
    expect(data).toHaveProperty("success", true);
    expect(mocked.lib.stopExecutionSafetySupervisor).toHaveBeenCalledTimes(1);
  });

  it("POST /brain/execution/safety-supervisor/run-once triggers cycle", async () => {
    const { status, data } = await req("POST", "/brain/execution/safety-supervisor/run-once");
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok", true);
    expect(mocked.lib.runExecutionSafetySupervisorCycle).toHaveBeenCalledWith("manual_route");
  });

  it("POST /brain/execution/safety-supervisor/reset resets state", async () => {
    const { status, data } = await req("POST", "/brain/execution/safety-supervisor/reset");
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok", true);
    expect(mocked.lib.resetExecutionSafetySupervisorState).toHaveBeenCalledTimes(1);
  });
});

