/**
 * watchlist_route.test.ts — Phase 54
 *
 * Tests for watchlist CRUD, scanner control, and auto-trade config endpoints:
 *
 *   GET    /api/watchlist
 *   POST   /api/watchlist
 *   DELETE /api/watchlist/:symbol
 *   PATCH  /api/watchlist/:symbol/enable
 *   PATCH  /api/watchlist/:symbol/disable
 *   GET    /api/watchlist/:symbol
 *
 *   GET    /api/watchlist/scanner/status
 *   POST   /api/watchlist/scanner/start
 *   POST   /api/watchlist/scanner/stop
 *   POST   /api/watchlist/scanner/scan
 *   GET    /api/watchlist/scanner/history
 *   DELETE /api/watchlist/scanner/cooldowns
 *   DELETE /api/watchlist/scanner/cooldowns/:symbol
 *
 *   GET    /api/watchlist/auto-trade/status
 *   GET    /api/watchlist/auto-trade/config
 *   PATCH  /api/watchlist/auto-trade/config
 *   POST   /api/watchlist/auto-trade/enable
 *   POST   /api/watchlist/auto-trade/disable
 *   GET    /api/watchlist/auto-trade/log
 *   POST   /api/watchlist/auto-trade/reset-session
 *
 * watchlist and auto_trade_config are pure in-memory.
 * ScannerScheduler is mocked to prevent actual scan loops.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock ScannerScheduler ────────────────────────────────────────────────────
// Must be declared before router import

const mockScheduler = {
  isRunning:      vi.fn(() => false),
  getScanCount:   vi.fn(() => 0),
  getIntervalMs:  vi.fn(() => 120_000),
  getCooldownMs:  vi.fn(() => 600_000),
  getCurrentRun:  vi.fn(() => null),
  start:          vi.fn(),
  stop:           vi.fn(),
  forceScan:      vi.fn(async () => ({
    id: "test-run-1",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    symbolsScanned: 2,
    alertsEmitted: 0,
    errors: [],
  })),
  getHistory:     vi.fn(() => []),
  resetCooldowns: vi.fn(),
};

vi.mock("../lib/scanner_scheduler", () => ({
  ScannerScheduler: {
    getInstance: vi.fn(() => mockScheduler),
  },
  getScannerScheduler: vi.fn(() => mockScheduler),
}));

// ── Mock signal_stream (publishAlert used by auto_trade_config) ──────────────
vi.mock("../lib/signal_stream", () => ({
  publishAlert: vi.fn(),
}));

// ── Import router + state management AFTER mocks ─────────────────────────────
import watchlistRouter from "../routes/watchlist";
import { clearWatchlist, addSymbol, initWatchlistDefaults } from "../lib/watchlist";
import { resetAutoTradeSession } from "../lib/auto_trade_config";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", watchlistRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  clearWatchlist();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  clearWatchlist();
  resetAutoTradeSession();
  vi.clearAllMocks();
  // Re-set mock defaults after clearAllMocks
  mockScheduler.isRunning.mockReturnValue(false);
  mockScheduler.getScanCount.mockReturnValue(0);
  mockScheduler.getIntervalMs.mockReturnValue(120_000);
  mockScheduler.getCooldownMs.mockReturnValue(600_000);
  mockScheduler.getCurrentRun.mockReturnValue(null);
  mockScheduler.getHistory.mockReturnValue([]);
  mockScheduler.forceScan.mockResolvedValue({
    id: "test-run-1",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    symbolsScanned: 2,
    alertsEmitted: 0,
    errors: [],
  });
});

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
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
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get    = (path: string)               => httpReq("GET",    path);
const post   = (path: string, body: unknown) => httpReq("POST",   path, body);
const patch  = (path: string, body: unknown) => httpReq("PATCH",  path, body);
const del    = (path: string)               => httpReq("DELETE", path);

// ── Seed helpers ──────────────────────────────────────────────────────────────

function seedSymbol(symbol = "TSTUSD") {
  return addSymbol({ symbol, label: symbol, assetClass: "crypto", enabled: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/watchlist
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/watchlist", () => {
  it("returns 200 with watchlist array and count", async () => {
    const { status, data } = await get("/api/watchlist");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("watchlist");
    expect(Array.isArray(d.watchlist)).toBe(true);
    expect(d).toHaveProperty("count");
    expect(typeof d.count).toBe("number");
  });

  it("count matches watchlist array length", async () => {
    const { data } = await get("/api/watchlist");
    const d = data as Record<string, unknown>;
    const list = d.watchlist as unknown[];
    expect(d.count).toBe(list.length);
  });

  it("returns added symbol in list", async () => {
    seedSymbol("BTCUSD");
    const { data } = await get("/api/watchlist");
    const list = (data as Record<string, unknown>).watchlist as Array<Record<string, unknown>>;
    expect(list.some((e) => e.symbol === "BTCUSD")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/watchlist
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/watchlist", () => {
  it("returns 201 with entry on valid input", async () => {
    const { status, data } = await post("/api/watchlist", {
      symbol: "ETHUSD",
      assetClass: "crypto",
    });
    expect(status).toBe(201);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entry");
  });

  it("entry has expected fields", async () => {
    const { data } = await post("/api/watchlist", {
      symbol: "SOLUSD",
      assetClass: "crypto",
      label: "Solana",
      enabled: true,
      note: "test note",
    });
    const entry = (data as Record<string, unknown>).entry as Record<string, unknown>;
    expect(entry).toHaveProperty("symbol");
    expect(entry).toHaveProperty("assetClass");
    expect(entry).toHaveProperty("enabled");
    expect(entry.symbol).toBe("SOLUSD");
  });

  it("returns 400 when symbol is missing", async () => {
    const { status } = await post("/api/watchlist", { assetClass: "crypto" });
    expect(status).toBe(400);
  });

  it("returns 400 when assetClass is invalid", async () => {
    const { status } = await post("/api/watchlist", { symbol: "BTCUSD", assetClass: "invalid" });
    expect(status).toBe(400);
  });

  it("accepts all valid asset classes", async () => {
    for (const assetClass of ["crypto", "forex", "equity", "commodity"]) {
      const { status } = await post("/api/watchlist", {
        symbol: `TEST${assetClass.toUpperCase()}`,
        assetClass,
      });
      expect(status).toBe(201);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/watchlist/:symbol
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/watchlist/:symbol", () => {
  it("returns 200 with removed=true for existing symbol", async () => {
    seedSymbol("REMOVEME");
    const { status, data } = await del("/api/watchlist/REMOVEME");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.removed).toBe(true);
    expect(d.symbol).toBe("REMOVEME");
  });

  it("returns 404 for unknown symbol", async () => {
    const { status } = await del("/api/watchlist/NONEXISTENT");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/watchlist/:symbol/enable and /disable
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/watchlist/:symbol/enable", () => {
  it("returns 200 with entry for existing symbol", async () => {
    seedSymbol("ENATEST");
    const { status, data } = await patch("/api/watchlist/ENATEST/enable", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entry");
  });

  it("entry.enabled is true after enable", async () => {
    seedSymbol("ENATEST2");
    const { data } = await patch("/api/watchlist/ENATEST2/enable", {});
    const entry = (data as Record<string, unknown>).entry as Record<string, unknown>;
    expect(entry.enabled).toBe(true);
  });

  it("returns 404 for unknown symbol", async () => {
    const { status } = await patch("/api/watchlist/UNKNOWNSYM/enable", {});
    expect(status).toBe(404);
  });
});

describe("PATCH /api/watchlist/:symbol/disable", () => {
  it("returns 200 with entry for existing symbol", async () => {
    seedSymbol("DISTEST");
    const { status, data } = await patch("/api/watchlist/DISTEST/disable", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entry");
  });

  it("entry.enabled is false after disable", async () => {
    seedSymbol("DISTEST2");
    const { data } = await patch("/api/watchlist/DISTEST2/disable", {});
    const entry = (data as Record<string, unknown>).entry as Record<string, unknown>;
    expect(entry.enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/watchlist/:symbol
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/watchlist/:symbol", () => {
  it("returns 200 with entry for existing symbol", async () => {
    seedSymbol("GETTEST");
    const { status, data } = await get("/api/watchlist/GETTEST");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entry");
    const entry = d.entry as Record<string, unknown>;
    expect(entry.symbol).toBe("GETTEST");
  });

  it("returns 404 for unknown symbol", async () => {
    const { status } = await get("/api/watchlist/NOSUCHSYMBOL");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/watchlist/scanner/status
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/watchlist/scanner/status", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/watchlist/scanner/status");
    expect(status).toBe(200);
  });

  it("response has running field", async () => {
    const { data } = await get("/api/watchlist/scanner/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("running");
    expect(typeof d.running).toBe("boolean");
  });

  it("response has scanCount, intervalMs, cooldownMs", async () => {
    const { data } = await get("/api/watchlist/scanner/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("scanCount");
    expect(d).toHaveProperty("intervalMs");
    expect(d).toHaveProperty("cooldownMs");
  });

  it("response has watchlistSize field", async () => {
    seedSymbol("SIZESYM");
    const { data } = await get("/api/watchlist/scanner/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("watchlistSize");
    expect(typeof d.watchlistSize).toBe("number");
    expect(Number(d.watchlistSize)).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/watchlist/scanner/start and /stop
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/watchlist/scanner/start", () => {
  it("returns 200 with started=true", async () => {
    mockScheduler.isRunning.mockReturnValue(true);
    const { status, data } = await post("/api/watchlist/scanner/start", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.started).toBe(true);
  });

  it("calls scheduler.start()", async () => {
    await post("/api/watchlist/scanner/start", {});
    expect(mockScheduler.start).toHaveBeenCalled();
  });
});

describe("POST /api/watchlist/scanner/stop", () => {
  it("returns 200 with stopped=true and running=false", async () => {
    const { status, data } = await post("/api/watchlist/scanner/stop", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.stopped).toBe(true);
    expect(d.running).toBe(false);
  });

  it("calls scheduler.stop()", async () => {
    await post("/api/watchlist/scanner/stop", {});
    expect(mockScheduler.stop).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/watchlist/scanner/scan
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/watchlist/scanner/scan", () => {
  it("returns 200 with run object", async () => {
    const { status, data } = await post("/api/watchlist/scanner/scan", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("run");
  });

  it("run has expected fields", async () => {
    const { data } = await post("/api/watchlist/scanner/scan", {});
    const run = (data as Record<string, unknown>).run as Record<string, unknown>;
    expect(run).toHaveProperty("id");
    expect(run).toHaveProperty("startedAt");
  });

  it("returns 500 when forceScan throws", async () => {
    mockScheduler.forceScan.mockRejectedValueOnce(new Error("scan error"));
    const { status } = await post("/api/watchlist/scanner/scan", {});
    expect([500, 503]).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/watchlist/scanner/history
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/watchlist/scanner/history", () => {
  it("returns 200 with history array and count", async () => {
    const { status, data } = await get("/api/watchlist/scanner/history");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("history");
    expect(Array.isArray(d.history)).toBe(true);
    expect(d).toHaveProperty("count");
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/api/watchlist/scanner/history?limit=5");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/watchlist/scanner/cooldowns
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/watchlist/scanner/cooldowns", () => {
  it("returns 200 with reset=true and scope=all", async () => {
    const { status, data } = await del("/api/watchlist/scanner/cooldowns");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.reset).toBe(true);
    expect(d.scope).toBe("all");
  });

  it("calls scheduler.resetCooldowns() without args", async () => {
    await del("/api/watchlist/scanner/cooldowns");
    expect(mockScheduler.resetCooldowns).toHaveBeenCalled();
  });
});

describe("DELETE /api/watchlist/scanner/cooldowns/:symbol", () => {
  it("returns 200 with reset=true and scope=BTCUSD", async () => {
    const { status, data } = await del("/api/watchlist/scanner/cooldowns/BTCUSD");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.reset).toBe(true);
    expect(d.scope).toBe("BTCUSD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/watchlist/auto-trade/status
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/watchlist/auto-trade/status", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/watchlist/auto-trade/status");
    expect(status).toBe(200);
  });

  it("response has config object", async () => {
    const { data } = await get("/api/watchlist/auto-trade/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("config");
    expect(typeof d.config).toBe("object");
  });

  it("response has executionsThisSession field", async () => {
    const { data } = await get("/api/watchlist/auto-trade/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("executionsThisSession");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/watchlist/auto-trade/config
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/watchlist/auto-trade/config", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/watchlist/auto-trade/config");
    expect(status).toBe(200);
  });

  it("response has enabled field", async () => {
    const { data } = await get("/api/watchlist/auto-trade/config");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("enabled");
    expect(typeof d.enabled).toBe("boolean");
  });

  it("response has qualityFloor field", async () => {
    const { data } = await get("/api/watchlist/auto-trade/config");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("qualityFloor");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/watchlist/auto-trade/config
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/watchlist/auto-trade/config", () => {
  it("returns 200 with ok=true and config", async () => {
    const { status, data } = await patch("/api/watchlist/auto-trade/config", {
      qualityFloor: 0.80,
    });
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("config");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/watchlist/auto-trade/enable and /disable
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/watchlist/auto-trade/enable", () => {
  it("returns 200 with ok=true and enabled=true", async () => {
    const { status, data } = await post("/api/watchlist/auto-trade/enable", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.ok).toBe(true);
    expect(d.enabled).toBe(true);
  });
});

describe("POST /api/watchlist/auto-trade/disable", () => {
  it("returns 200 with ok=true and enabled=false", async () => {
    const { status, data } = await post("/api/watchlist/auto-trade/disable", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.ok).toBe(true);
    expect(d.enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/watchlist/auto-trade/log
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/watchlist/auto-trade/log", () => {
  it("returns 200 with log array and count", async () => {
    const { status, data } = await get("/api/watchlist/auto-trade/log");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("log");
    expect(Array.isArray(d.log)).toBe(true);
    expect(d).toHaveProperty("count");
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/api/watchlist/auto-trade/log?limit=10");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/watchlist/auto-trade/reset-session
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/watchlist/auto-trade/reset-session", () => {
  it("returns 200 with ok=true", async () => {
    const { status, data } = await post("/api/watchlist/auto-trade/reset-session", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.ok).toBe(true);
  });
});
