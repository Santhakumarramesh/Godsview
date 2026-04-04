import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = {
  alpacaRunning: false,
  reconcilerRunning: false,
  scannerRunning: false,
  macroRunning: false,
  paperRunning: false,
  retrainRunning: false,
};

function resetRuntime(): void {
  runtime.alpacaRunning = false;
  runtime.reconcilerRunning = false;
  runtime.scannerRunning = false;
  runtime.macroRunning = false;
  runtime.paperRunning = false;
  runtime.retrainRunning = false;
}

vi.mock("../lib/alpaca_stream", () => ({
  alpacaStream: {
    start: vi.fn(() => {
      runtime.alpacaRunning = true;
    }),
    status: vi.fn(() => ({
      authenticated: runtime.alpacaRunning,
      pollingMode: runtime.alpacaRunning,
      wsState: runtime.alpacaRunning ? 1 : 3,
      ticksReceived: runtime.alpacaRunning ? 10 : 0,
      quotesReceived: runtime.alpacaRunning ? 6 : 0,
    })),
  },
}));

vi.mock("../lib/fill_reconciler", () => ({
  startReconciler: vi.fn(() => {
    runtime.reconcilerRunning = true;
  }),
  getReconciliationSnapshot: vi.fn(() => ({
    is_running: runtime.reconcilerRunning,
    fills_today: runtime.reconcilerRunning ? 3 : 0,
    realized_pnl_today: runtime.reconcilerRunning ? 12.5 : 0,
  })),
}));

vi.mock("../lib/scanner_scheduler", () => ({
  ScannerScheduler: {
    getInstance: () => ({
      isRunning: () => runtime.scannerRunning,
      start: () => {
        runtime.scannerRunning = true;
      },
      getScanCount: () => (runtime.scannerRunning ? 2 : 0),
      getCurrentRun: () => (runtime.scannerRunning ? { status: "idle" } : null),
    }),
  },
}));

vi.mock("../lib/macro_context_service", () => ({
  MacroContextService: {
    getInstance: () => ({
      isStarted: () => runtime.macroRunning,
      start: () => {
        runtime.macroRunning = true;
      },
      getContext: () => ({
        refreshCount: runtime.macroRunning ? 1 : 0,
        isLive: runtime.macroRunning,
      }),
    }),
  },
}));

vi.mock("../lib/paper_validation_loop", () => ({
  startPaperValidationLoop: vi.fn(async () => {
    runtime.paperRunning = true;
  }),
  getPaperValidationStatus: vi.fn(() => ({
    running: runtime.paperRunning,
    last_error: null,
    latest_status: runtime.paperRunning ? "HEALTHY" : null,
    last_cycle_at: runtime.paperRunning ? new Date().toISOString() : null,
  })),
}));

vi.mock("../lib/retrain_scheduler", () => ({
  startRetrainScheduler: vi.fn(async () => {
    runtime.retrainRunning = true;
  }),
  getSchedulerStats: vi.fn(() => ({
    running: runtime.retrainRunning,
    isRetraining: false,
    totalRetrains: runtime.retrainRunning ? 1 : 0,
  })),
}));

describe("autonomy_supervisor", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRuntime();
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_KEY_ID;
    delete process.env.ALPACA_SECRET_KEY;
    process.env.AUTONOMY_SUPERVISOR_AUTO_HEAL = "true";
  });

  it("disables alpaca-dependent services when credentials are absent", async () => {
    const { getAutonomySupervisorSnapshot } = await import("../lib/autonomy_supervisor");
    const snapshot = getAutonomySupervisorSnapshot();

    const byName = new Map(snapshot.services.map((svc) => [svc.name, svc]));
    expect(byName.get("alpaca_stream")?.expected).toBe(false);
    expect(byName.get("fill_reconciler")?.expected).toBe(false);
    expect(byName.get("scanner_scheduler")?.expected).toBe(false);
    expect(byName.get("macro_context")?.expected).toBe(false);

    expect(byName.get("alpaca_stream")?.health).toBe("DISABLED");
    expect(byName.get("fill_reconciler")?.health).toBe("DISABLED");
    expect(byName.get("scanner_scheduler")?.health).toBe("DISABLED");
    expect(byName.get("macro_context")?.health).toBe("DISABLED");
  });

  it("auto-heals all expected services on tick when credentials exist", async () => {
    process.env.ALPACA_API_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";

    const { runAutonomySupervisorTick } = await import("../lib/autonomy_supervisor");
    const snapshot = await runAutonomySupervisorTick("test");
    const byName = new Map(snapshot.services.map((svc) => [svc.name, svc]));

    expect(byName.get("alpaca_stream")?.health).toBe("HEALTHY");
    expect(byName.get("fill_reconciler")?.health).toBe("HEALTHY");
    expect(byName.get("scanner_scheduler")?.health).toBe("HEALTHY");
    expect(byName.get("macro_context")?.health).toBe("HEALTHY");
    expect(byName.get("paper_validation")?.health).toBe("HEALTHY");
    expect(byName.get("retrain_scheduler")?.health).toBe("HEALTHY");
    expect(snapshot.total_heal_actions).toBeGreaterThanOrEqual(6);
  });
});

