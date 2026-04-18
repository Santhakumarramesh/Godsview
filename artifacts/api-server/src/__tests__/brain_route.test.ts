/**
 * brain_route.test.ts — Phase 57
 *
 * Tests for the Brain engine endpoints (routes/brain.ts):
 *
 *   GET  /brain/entities                  — list brain entities
 *   POST /brain/entities                  — create/upsert entity
 *   POST /brain/relations                 — upsert relation
 *   POST /brain/memories                  — store memory
 *   GET  /brain/snapshot                  — latest orchestrator snapshot
 *   GET  /brain/consciousness             — consciousness snapshot
 *   POST /brain/update                    — run brain cycle
 *   POST /brain/evolve                    — evolve cycle
 *   GET  /brain/:symbol/memories          — entity memories
 *   GET  /brain/:symbol/context           — full brain context
 *   GET  /brain/:symbol/dna               — market DNA
 *   GET  /brain/:symbol/memory            — setup memory
 *   GET  /brain/:symbol/intelligence      — combined intelligence
 *   GET  /brain/:symbol/smc               — SMC state
 *   GET  /brain/:symbol/regime            — regime state
 *   GET  /brain/:symbol/orderflow         — order flow state
 *   GET  /brain/:symbol/stress            — volatility/stress
 *   GET  /brain/:symbol/brain-state       — full brain state
 *   GET  /brain/market-stress             — global market stress
 *
 * Dependencies mocked:
 *   @workspace/db           — db (select/execute chain)
 *   drizzle-orm             — operators as no-ops
 *   ../lib/brain_bridge     — getConsciousnessSnapshot, getLatestBrainSnapshot, runBrainCycle
 *   (dynamic imports)       — market_dna, setup_memory, alpaca, smc_engine,
 *                             regime_engine, orderflow_engine, stress_engine,
 *                             symbol_brain, market/symbols, market/orderbook
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── @workspace/db mock ────────────────────────────────────────────────────────

function makeDbChain(rows: unknown[] = [{ id: 1, symbol: "BTCUSD" }]) {
  const chain: any = {};
  chain.select    = vi.fn().mockReturnValue(chain);
  chain.from      = vi.fn().mockReturnValue(chain);
  chain.where     = vi.fn().mockReturnValue(chain);
  chain.orderBy   = vi.fn().mockReturnValue(chain);
  chain.limit     = vi.fn().mockResolvedValue(rows);
  chain.then      = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  // Insert chain
  chain.insert    = vi.fn().mockReturnValue(chain);
  chain.values    = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  // Update chain
  chain.update    = vi.fn().mockReturnValue(chain);
  chain.set       = vi.fn().mockReturnValue(chain);
  return chain;
}

vi.mock("@workspace/db", () => {
  const chain = makeDbChain();
  const db = new Proxy({} as any, {
    get(_t, key) {
      if (key === "select")  return (..._args: any[]) => chain;
      if (key === "insert")  return (..._args: any[]) => chain;
      if (key === "update")  return (..._args: any[]) => chain;
      if (key === "delete")  return (..._args: any[]) => chain;
      if (key === "execute") return vi.fn().mockResolvedValue(undefined);
      return undefined;
    },
  });
  return {
    // drizzle-orm re-exports (now provided by @workspace/db)
    and:       (...args: unknown[]) => args,
    or:        (...args: unknown[]) => args,
    eq:        () => null,
    ne:        () => null,
    gt:        () => null,
    gte:       () => null,
    lt:        () => null,
    lte:       () => null,
    isNotNull: () => null,
    isNull:    () => null,
    desc:      () => null,
    asc:       () => null,
    inArray:   () => null,
    notInArray:() => null,
    count:     () => 0,
    sum:       () => 0,
    max:       () => null,
    min:       () => null,
    between:   () => null,
    like:      () => null,
    ilike:     () => null,
    exists:    () => null,
    not:       () => null,
    sql:       Object.assign(vi.fn(() => ""), { raw: vi.fn((s: string) => s) }),

    db,
    brainEntitiesTable:  { id: "id", symbol: "symbol", entity_type: "entity_type", name: "name", sector: "sector", regime: "regime", volatility: "volatility", last_price: "last_price", state_json: "state_json", created_at: "created_at", updated_at: "updated_at" },
    brainRelationsTable: { id: "id", source_entity_id: "source_entity_id", target_entity_id: "target_entity_id", relation_type: "relation_type", strength: "strength", context_json: "context_json", created_at: "created_at" },
    brainMemoriesTable:  { id: "id", entity_id: "entity_id", memory_type: "memory_type", title: "title", content: "content", signal_id: "signal_id", trade_id: "trade_id", confidence: "confidence", outcome_score: "outcome_score", tags: "tags", context_json: "context_json", created_at: "created_at" },
  };
});

// ── drizzle-orm operators as no-ops ───────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  and:       vi.fn((...args: unknown[]) => args),
  or:        vi.fn((...args: unknown[]) => args),
  gte:       vi.fn(() => null),
  lte:       vi.fn(() => null),
  eq:        vi.fn(() => null),
  ne:        vi.fn(() => null),
  isNotNull: vi.fn(() => null),
  isNull:    vi.fn(() => null),
  desc:      vi.fn(() => null),
  asc:       vi.fn(() => null),
  inArray:   vi.fn(() => null),
  sql:       Object.assign(vi.fn(() => ""), { raw: vi.fn((s: string) => s) }),
  count:     vi.fn(() => 0),
}));

// ── Static lib mocks ──────────────────────────────────────────────────────────

const MOCK_SNAPSHOT = {
  generated_at: new Date().toISOString(),
  symbol:       "BTCUSD",
  blocked:      false,
  block_reason: "",
  decision:     "wait",
};

const MOCK_CONSCIOUSNESS = {
  generated_at:   new Date().toISOString(),
  market_regime:  "ranging",
  active_symbols: ["BTCUSD"],
  risk_level:     "medium",
};

const MOCK_RUN_RESULT = {
  ok:       true,
  command:  ["python", "brain.py"],
  stdout:   "OK",
  stderr:   "",
  snapshot: MOCK_SNAPSHOT,
};

vi.mock("../lib/brain_bridge", () => ({
  getLatestBrainSnapshot:    vi.fn(async () => MOCK_SNAPSHOT),
  getConsciousnessSnapshot:  vi.fn(async () => MOCK_CONSCIOUSNESS),
  runBrainCycle:             vi.fn(async () => MOCK_RUN_RESULT),
}));

// ── Dynamic import mocks (intercepted by vitest) ──────────────────────────────

vi.mock("../lib/market_dna", () => ({
  getMarketDNA: vi.fn(async () => ({
    symbol:    "BTCUSD",
    regime:    "ranging",
    dna_score: 0.65,
    traits:    [],
  })),
}));

vi.mock("../lib/setup_memory", () => ({
  getSetupMemory: vi.fn(async () => ({
    symbol:  "BTCUSD",
    setups:  [],
    summary: { totalTrades: 0, winRate: 0 },
  })),
}));

vi.mock("../lib/alpaca", () => ({
  getBars: vi.fn(async () => Array.from({ length: 20 }, (_, i) => ({
    Timestamp: new Date(Date.now() - (20 - i) * 60_000).toISOString(),
    Open:  42000 + i, High:  42100 + i,
    Low:   41900 + i, Close: 42050 + i,
    Volume: 500 + i,
  }))),
}));

vi.mock("../lib/smc_engine", () => ({
  computeSMCState: vi.fn(() => ({
    structure:      { structureScore: 0.6, bos: false, choch: false, trend: "range" },
    activeOBs:      [],
    unfilledFVGs:   [],
    liquidityPools: [],
  })),
}));

vi.mock("../lib/regime_engine", () => ({
  computeFullRegime: vi.fn(() => ({
    regime:  "ranging",
    score:   0.5,
    metrics: {},
  })),
}));

vi.mock("../lib/orderflow_engine", () => ({
  computeOrderflowState:    vi.fn(() => ({ delta: 0, absorption: false })),
  computeLiquidityMapState: vi.fn(() => ({ zones: [] })),
  buildCandlePackets:       vi.fn(() => []),
}));

vi.mock("../lib/stress_engine", () => ({
  computeVolatilityState: vi.fn(() => ({
    atr:     200,
    stressLevel: "low",
    vix_proxy: 0.12,
  })),
  computeMarketStress: vi.fn(() => ({
    systemicStressScore: 0.2,
    stressRegime:        "low",
    symbolCount:         2,
  })),
}));

vi.mock("../lib/symbol_brain", () => ({
  computeSymbolBrainState: vi.fn(() => ({
    symbol:    "BTCUSD",
    smc:       {},
    regime:    {},
    orderflow: {},
    stress:    {},
    dna:       null,
    score:     0.55,
    bias:      "neutral",
  })),
}));

vi.mock("../lib/market/symbols", () => ({
  normalizeMarketSymbol:  vi.fn((sym: string) => sym || "BTCUSD"),
  isCryptoSymbol:         vi.fn(() => true),
}));

vi.mock("../lib/market/orderbook", () => ({
  orderBookManager: {
    getSnapshot:    vi.fn(() => null),
    fetchSnapshot:  vi.fn(async () => null),
    subscribe:      vi.fn(),
    unsubscribe:    vi.fn(),
  },
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import brainRouter from "../routes/brain";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use("/", brainRouter);

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

const get  = (path: string)               => httpReq("GET",  path);
const post = (path: string, body: unknown) => httpReq("POST", path, body);

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/entities
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/entities", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/entities");
    expect(status).toBe(200);
  });

  it("response has entities array", async () => {
    const { data } = await get("/brain/entities");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entities");
    expect(Array.isArray(d.entities)).toBe(true);
  });

  it("accepts symbol query param", async () => {
    const { status } = await get("/brain/entities?symbol=BTCUSD");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /brain/entities
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /brain/entities", () => {
  it("returns 200 with valid symbol", async () => {
    const { status } = await post("/brain/entities", { symbol: "BTCUSD" });
    expect(status).toBe(200);
  });

  it("returns 400 when symbol missing", async () => {
    const { status } = await post("/brain/entities", {});
    expect(status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /brain/relations
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /brain/relations", () => {
  it("returns 201 with valid relation data", async () => {
    const { status } = await post("/brain/relations", {
      source_symbol:  "BTCUSD",
      target_symbol:  "ETHUSD",
      relation_type:  "correlated",
      strength:       0.75,
    });
    expect(status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /brain/memories
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /brain/memories", () => {
  it("returns 201 with valid memory data", async () => {
    const { status } = await post("/brain/memories", {
      symbol:      "BTCUSD",
      memory_type: "setup",
      title:       "Test memory",
      content:     "BTC showing bullish structure",
    });
    expect(status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/snapshot", () => {
  it("returns 200 when snapshot exists", async () => {
    const { status } = await get("/brain/snapshot");
    expect(status).toBe(200);
  });

  it("response has has_data=true", async () => {
    const { data } = await get("/brain/snapshot");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("has_data");
    expect(d.has_data).toBe(true);
  });

  it("returns 404 when snapshot is null", async () => {
    const { getLatestBrainSnapshot } = await import("../lib/brain_bridge");
    vi.mocked(getLatestBrainSnapshot).mockResolvedValueOnce(null as any);
    const { status } = await get("/brain/snapshot");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/consciousness
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/consciousness", () => {
  it("returns 200 when consciousness exists", async () => {
    const { status } = await get("/brain/consciousness");
    expect(status).toBe(200);
  });

  it("response has has_data=true", async () => {
    const { data } = await get("/brain/consciousness");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("has_data");
  });

  it("returns 404 when consciousness is null", async () => {
    const { getConsciousnessSnapshot } = await import("../lib/brain_bridge");
    vi.mocked(getConsciousnessSnapshot).mockResolvedValueOnce(null as any);
    const { status } = await get("/brain/consciousness");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /brain/update
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /brain/update", () => {
  it("returns 200 with valid symbol", async () => {
    const { status } = await post("/brain/update", { symbol: "BTCUSD" });
    expect(status).toBe(200);
  });

  it("response has ok=true", async () => {
    const { data } = await post("/brain/update", { symbol: "BTCUSD" });
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("ok");
    expect(d.ok).toBe(true);
  });

  it("response has command and stdout", async () => {
    const { data } = await post("/brain/update", { symbol: "BTCUSD" });
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("command");
    expect(d).toHaveProperty("stdout");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /brain/evolve
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /brain/evolve", () => {
  it("returns 200", async () => {
    const { status } = await post("/brain/evolve", { symbol: "BTCUSD" });
    expect(status).toBe(200);
  });

  it("response has ok and mode fields", async () => {
    const { data } = await post("/brain/evolve", { symbol: "BTCUSD" });
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("ok");
    expect(d.mode).toBe("evolve");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/memories
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/memories", () => {
  it("returns 200 for known symbol", async () => {
    const { status } = await get("/brain/BTCUSD/memories");
    expect(status).toBe(200);
  });

  it("response has memories array", async () => {
    const { data } = await get("/brain/BTCUSD/memories");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("memories");
    expect(Array.isArray(d.memories)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/context
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/context", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/context");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/brain/BTCUSD/context");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/dna
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/dna", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/dna");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/memory
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/memory", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/memory");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/intelligence
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/intelligence", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/intelligence");
    expect(status).toBe(200);
  });

  it("response has symbol and computed_at", async () => {
    const { data } = await get("/brain/BTCUSD/intelligence");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
    expect(d).toHaveProperty("computed_at");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/smc
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/smc", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/smc");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/regime
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/regime", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/regime");
    expect(status).toBe(200);
  });

  it("response has symbol field", async () => {
    const { data } = await get("/brain/BTCUSD/regime");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/orderflow
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/orderflow", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/orderflow");
    expect(status).toBe(200);
  });

  it("response has orderflow, liquidity, candle_packets", async () => {
    const { data } = await get("/brain/BTCUSD/orderflow");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("orderflow");
    expect(d).toHaveProperty("liquidity");
    expect(d).toHaveProperty("candle_packets");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/stress
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/stress", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/stress");
    expect(status).toBe(200);
  });

  it("response has symbol and volatility", async () => {
    const { data } = await get("/brain/BTCUSD/stress");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
    expect(d).toHaveProperty("volatility");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/:symbol/brain-state
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/:symbol/brain-state", () => {
  it("returns 200", async () => {
    const { status } = await get("/brain/BTCUSD/brain-state");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /brain/market-stress
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /brain/market-stress", () => {
  it("returns 200 with single symbol (no stress calc)", async () => {
    const { status } = await get("/brain/market-stress?symbols=BTCUSD");
    expect(status).toBe(200);
  });

  it("response has systemicStressScore when <2 symbols", async () => {
    const { data } = await get("/brain/market-stress?symbols=BTCUSD");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("systemicStressScore");
    expect(d.systemicStressScore).toBe(0);
  });

  it("returns 200 with multiple symbols", async () => {
    const { status } = await get("/brain/market-stress?symbols=BTCUSD,ETHUSD");
    expect(status).toBe(200);
  });
});
