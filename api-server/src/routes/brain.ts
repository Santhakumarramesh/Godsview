import { Router, type IRouter } from "express";
import {
  brainEntitiesTable,
  brainMemoriesTable,
  brainRelationsTable,
  db,
} from "@workspace/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getConsciousnessSnapshot, getLatestBrainSnapshot, runBrainCycle } from "../lib/brain_bridge";
import {
  runFullBrainCycle,
  runBrainCycleForSymbol,
  runBacktestAndChartPipeline,
  startBrainScheduler,
  stopBrainScheduler,
  getBrainSchedulerStatus,
  type BrainCycleInput,
} from "../lib/brain_orchestrator";
import { brainEventBus, type BrainEvent } from "../lib/brain_event_bus";
import { autonomousBrain } from "../lib/autonomous_brain";
import { brainJobQueue, BrainJobs } from "../lib/job_queue";
import { strategyRegistry, rankStrategies } from "../lib/strategy_evolution";
import { superIntelligenceV2 } from "../lib/super_intelligence_v2";
import { brainExecutionBridge, brainPositions, type BrainSignal } from "../lib/brain_execution_bridge";
import { brainPnLTracker, updatePriceCache } from "../lib/brain_pnl_tracker";
import {
  getJobHistory,
  getJobLatencyStats,
  loadRecentOutcomes,
  getOutcomeStats,
  listChartSnapshots,
  loadChartSnapshot,
  getPortfolioStats,
} from "../lib/brain_persistence";
import { brainStreamBridge } from "../lib/brain_stream_bridge";
import { correlationEngine } from "../lib/correlation_engine";
import { brainAlerts } from "../lib/brain_alerts";
import { brainWatchdog } from "../lib/brain_watchdog";
import { brainPerformance } from "../lib/brain_performance";

const router: IRouter = Router();

const CREATE_BRAIN_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS brain_entities (
    id SERIAL PRIMARY KEY,
    symbol TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'stock',
    name TEXT,
    sector TEXT,
    regime TEXT,
    volatility NUMERIC(8,4),
    last_price NUMERIC(14,6),
    state_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_brain_entities_symbol ON brain_entities(symbol);
  CREATE TABLE IF NOT EXISTS brain_relations (
    id SERIAL PRIMARY KEY,
    source_entity_id INTEGER NOT NULL,
    target_entity_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    strength NUMERIC(6,4) NOT NULL DEFAULT 0.5000,
    context_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_brain_relations_source ON brain_relations(source_entity_id);
  CREATE INDEX IF NOT EXISTS idx_brain_relations_target ON brain_relations(target_entity_id);
  CREATE TABLE IF NOT EXISTS brain_memories (
    id SERIAL PRIMARY KEY,
    entity_id INTEGER NOT NULL,
    memory_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    signal_id INTEGER,
    trade_id INTEGER,
    confidence NUMERIC(6,4) NOT NULL DEFAULT 0.5000,
    outcome_score NUMERIC(8,4),
    tags TEXT,
    context_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_brain_memories_entity ON brain_memories(entity_id);
  CREATE INDEX IF NOT EXISTS idx_brain_memories_created_at ON brain_memories(created_at);
`;
let brainTablesReady = false;

async function ensureBrainTables(): Promise<void> {
  if (brainTablesReady) return;
  await db.execute(sql.raw(CREATE_BRAIN_TABLES_SQL));
  brainTablesReady = true;
}

function parseLimit(raw: unknown, fallback = 50, max = 500): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

function asOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function asRequiredSymbol(value: unknown): string {
  const symbol = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!symbol) {
    throw new Error("symbol is required.");
  }
  return symbol;
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDbNumericOrUndefined(value: number | null): string | undefined {
  if (value === null) return undefined;
  return String(value);
}

async function getOrCreateEntityId(symbolRaw: unknown): Promise<number> {
  const symbol = asRequiredSymbol(symbolRaw);
  const existing = await db
    .select({ id: brainEntitiesTable.id })
    .from(brainEntitiesTable)
    .where(eq(brainEntitiesTable.symbol, symbol))
    .orderBy(desc(brainEntitiesTable.updated_at))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(brainEntitiesTable)
    .values({
      symbol,
      entity_type: "stock",
      updated_at: new Date(),
    })
    .returning({ id: brainEntitiesTable.id });

  return inserted.id;
}

router.get("/brain/entities", async (req, res) => {
  try {
    await ensureBrainTables();
    const limit = parseLimit(req.query.limit, 100, 500);
    const symbol = asOptionalText(req.query.symbol)?.toUpperCase();
    const entityType = asOptionalText(req.query.entity_type);

    const conditions = [];
    if (symbol) conditions.push(eq(brainEntitiesTable.symbol, symbol));
    if (entityType) conditions.push(eq(brainEntitiesTable.entity_type, entityType));

    const rows = await db
      .select()
      .from(brainEntitiesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(brainEntitiesTable.updated_at))
      .limit(limit);

    res.json({ count: rows.length, entities: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch brain entities");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch brain entities" });
  }
});

router.post("/brain/entities", async (req, res) => {
  try {
    await ensureBrainTables();
    const symbol = asRequiredSymbol(req.body?.symbol);
    const entityType = asOptionalText(req.body?.entity_type) ?? "stock";
    const name = asOptionalText(req.body?.name);
    const sector = asOptionalText(req.body?.sector);
    const regime = asOptionalText(req.body?.regime);
    const stateJson = asOptionalText(req.body?.state_json);
    const volatility = asNumberOrNull(req.body?.volatility);
    const lastPrice = asNumberOrNull(req.body?.last_price);

    const existing = await db
      .select({ id: brainEntitiesTable.id })
      .from(brainEntitiesTable)
      .where(eq(brainEntitiesTable.symbol, symbol))
      .orderBy(desc(brainEntitiesTable.updated_at))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(brainEntitiesTable)
        .set({
          entity_type: entityType,
          name: name ?? undefined,
          sector: sector ?? undefined,
          regime: regime ?? undefined,
          state_json: stateJson ?? undefined,
          volatility: toDbNumericOrUndefined(volatility),
          last_price: toDbNumericOrUndefined(lastPrice),
          updated_at: new Date(),
        })
        .where(eq(brainEntitiesTable.id, existing[0].id))
        .returning();

      res.json({ entity: updated, created: false });
      return;
    }

    const [entity] = await db
      .insert(brainEntitiesTable)
      .values({
        symbol,
        entity_type: entityType,
        name: name ?? undefined,
        sector: sector ?? undefined,
        regime: regime ?? undefined,
        state_json: stateJson ?? undefined,
        volatility: toDbNumericOrUndefined(volatility),
        last_price: toDbNumericOrUndefined(lastPrice),
        updated_at: new Date(),
      })
      .returning();

    res.status(201).json({ entity, created: true });
  } catch (err) {
    req.log.error({ err }, "Failed to upsert brain entity");
    res.status(400).json({
      error: "invalid_request",
      message: err instanceof Error ? err.message : "Failed to upsert brain entity",
    });
  }
});

router.post("/brain/relations", async (req, res) => {
  try {
    await ensureBrainTables();
    const sourceSymbol = asRequiredSymbol(req.body?.source_symbol);
    const targetSymbol = asRequiredSymbol(req.body?.target_symbol);
    const relationType = asOptionalText(req.body?.relation_type);
    if (!relationType) {
      throw new Error("relation_type is required.");
    }
    const strength = asNumberOrNull(req.body?.strength);
    const contextJson = asOptionalText(req.body?.context_json);

    const sourceEntityId = await getOrCreateEntityId(sourceSymbol);
    const targetEntityId = await getOrCreateEntityId(targetSymbol);

    const [relation] = await db
      .insert(brainRelationsTable)
      .values({
        source_entity_id: sourceEntityId,
        target_entity_id: targetEntityId,
        relation_type: relationType,
        strength: toDbNumericOrUndefined(strength) ?? "0.5000",
        context_json: contextJson ?? undefined,
      })
      .returning();

    res.status(201).json({ relation });
  } catch (err) {
    req.log.error({ err }, "Failed to create brain relation");
    res.status(400).json({
      error: "invalid_request",
      message: err instanceof Error ? err.message : "Failed to create brain relation",
    });
  }
});

router.post("/brain/memories", async (req, res) => {
  try {
    await ensureBrainTables();
    const symbol = asRequiredSymbol(req.body?.symbol);
    const memoryType = asOptionalText(req.body?.memory_type) ?? "episodic";
    const title = asOptionalText(req.body?.title);
    const content = asOptionalText(req.body?.content);
    if (!title || !content) {
      throw new Error("title and content are required.");
    }

    const entityId = await getOrCreateEntityId(symbol);
    const confidence = asNumberOrNull(req.body?.confidence);
    const outcomeScore = asNumberOrNull(req.body?.outcome_score);
    const signalId = asNumberOrNull(req.body?.signal_id);
    const tradeId = asNumberOrNull(req.body?.trade_id);
    const tags = asOptionalText(req.body?.tags);
    const contextJson = asOptionalText(req.body?.context_json);

    const [memory] = await db
      .insert(brainMemoriesTable)
      .values({
        entity_id: entityId,
        memory_type: memoryType,
        title,
        content,
        signal_id: signalId ?? undefined,
        trade_id: tradeId ?? undefined,
        confidence: toDbNumericOrUndefined(confidence) ?? "0.5000",
        outcome_score: toDbNumericOrUndefined(outcomeScore),
        tags: tags ?? undefined,
        context_json: contextJson ?? undefined,
      })
      .returning();

    res.status(201).json({ memory });
  } catch (err) {
    req.log.error({ err }, "Failed to create brain memory");
    res.status(400).json({
      error: "invalid_request",
      message: err instanceof Error ? err.message : "Failed to create brain memory",
    });
  }
});

router.get("/brain/snapshot", async (req, res) => {
  try {
    const force = String(req.query.force ?? "").toLowerCase() === "true";
    const snapshot = await getLatestBrainSnapshot(force);
    if (!snapshot) {
      res.status(404).json({
        error: "not_found",
        message: "No orchestrator snapshot found at godsview-openbb/data/processed/latest_orchestrator_run.json",
      });
      return;
    }
    res.json({
      has_data: true,
      generated_at: String(snapshot.generated_at ?? ""),
      symbol: String(snapshot.symbol ?? ""),
      blocked: Boolean(snapshot.blocked ?? false),
      block_reason: String(snapshot.block_reason ?? ""),
      snapshot,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch brain snapshot");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch brain snapshot" });
  }
});

router.get("/brain/consciousness", async (req, res) => {
  try {
    const force = String(req.query.force ?? "").toLowerCase() === "true";
    const consciousness = await getConsciousnessSnapshot(force);
    if (!consciousness) {
      res.status(404).json({
        error: "not_found",
        message: "No consciousness snapshot available. Run /brain/update first.",
      });
      return;
    }
    res.json({ has_data: true, ...consciousness });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch consciousness snapshot");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch consciousness snapshot" });
  }
});

router.post("/brain/update", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.body?.symbol ?? req.query.symbol ?? "AAPL");
    const withReplay = Boolean(req.body?.with_replay ?? false);
    const live = Boolean(req.body?.live ?? false);
    const dryRun = Boolean(req.body?.dry_run ?? true);
    const approve = Boolean(req.body?.approve ?? false);

    const result = await runBrainCycle({
      symbol,
      withReplay,
      live,
      dryRun,
      approve,
    });
    res.status(result.ok ? 200 : 500).json({
      ok: result.ok,
      symbol,
      command: result.command.join(" "),
      stdout: result.stdout,
      stderr: result.stderr,
      snapshot_generated_at: String(result.snapshot?.generated_at ?? ""),
      blocked: Boolean(result.snapshot?.blocked ?? false),
      block_reason: String(result.snapshot?.block_reason ?? ""),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run brain update");
    res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : "Failed to run brain update",
    });
  }
});

router.post("/brain/evolve", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.body?.symbol ?? req.query.symbol ?? "AAPL");
    const result = await runBrainCycle({
      symbol,
      withReplay: true,
      live: false,
      dryRun: true,
      approve: false,
    });
    const consciousness = await getConsciousnessSnapshot(true);
    res.status(result.ok ? 200 : 500).json({
      ok: result.ok,
      symbol,
      mode: "evolve",
      command: result.command.join(" "),
      snapshot_generated_at: String(result.snapshot?.generated_at ?? ""),
      blocked: Boolean(result.snapshot?.blocked ?? false),
      block_reason: String(result.snapshot?.block_reason ?? ""),
      consciousness,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run brain evolve cycle");
    res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : "Failed to run brain evolve cycle",
    });
  }
});

router.get("/brain/:symbol/memories", async (req, res) => {
  try {
    await ensureBrainTables();
    const symbol = asRequiredSymbol(req.params.symbol);
    const memoryType = asOptionalText(req.query.type);
    const limit = parseLimit(req.query.limit, 100, 500);

    const entity = await db
      .select()
      .from(brainEntitiesTable)
      .where(eq(brainEntitiesTable.symbol, symbol))
      .orderBy(desc(brainEntitiesTable.updated_at))
      .limit(1);

    if (entity.length === 0) {
      res.status(404).json({ error: "not_found", message: `No brain entity found for ${symbol}` });
      return;
    }

    const conditions = [eq(brainMemoriesTable.entity_id, entity[0].id)];
    if (memoryType) {
      conditions.push(eq(brainMemoriesTable.memory_type, memoryType));
    }

    const memories = await db
      .select()
      .from(brainMemoriesTable)
      .where(and(...conditions))
      .orderBy(desc(brainMemoriesTable.created_at))
      .limit(limit);

    res.json({ symbol, count: memories.length, memories });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch brain memories");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch brain memories" });
  }
});

router.get("/brain/:symbol/context", async (req, res) => {
  try {
    await ensureBrainTables();
    const symbol = asRequiredSymbol(req.params.symbol);
    const relationLimit = parseLimit(req.query.relation_limit, 50, 250);
    const memoryLimit = parseLimit(req.query.memory_limit, 50, 250);

    const entityRows = await db
      .select()
      .from(brainEntitiesTable)
      .where(eq(brainEntitiesTable.symbol, symbol))
      .orderBy(desc(brainEntitiesTable.updated_at))
      .limit(1);

    if (entityRows.length === 0) {
      res.status(404).json({ error: "not_found", message: `No brain entity found for ${symbol}` });
      return;
    }
    const entity = entityRows[0];

    const [memories, relations] = await Promise.all([
      db
        .select()
        .from(brainMemoriesTable)
        .where(eq(brainMemoriesTable.entity_id, entity.id))
        .orderBy(desc(brainMemoriesTable.created_at))
        .limit(memoryLimit),
      db
        .select()
        .from(brainRelationsTable)
        .where(
          or(
            eq(brainRelationsTable.source_entity_id, entity.id),
            eq(brainRelationsTable.target_entity_id, entity.id),
          ),
        )
        .orderBy(desc(brainRelationsTable.created_at))
        .limit(relationLimit),
    ]);

    const relatedEntityIds: number[] = Array.from(
      new Set(
        relations.map((relation: any): number =>
          Number(
            relation.source_entity_id === entity.id
              ? relation.target_entity_id
              : relation.source_entity_id,
          ),
        ),
      ),
    );

    const relatedEntities = relatedEntityIds.length
      ? await db
          .select({
            id: brainEntitiesTable.id,
            symbol: brainEntitiesTable.symbol,
            entity_type: brainEntitiesTable.entity_type,
            name: brainEntitiesTable.name,
          })
          .from(brainEntitiesTable)
          .where(inArray(brainEntitiesTable.id, relatedEntityIds))
      : [];

    const entityById = new Map<number, (typeof relatedEntities)[number]>();
    for (const related of relatedEntities) {
      entityById.set(related.id, related);
    }

    const relationContext = relations.map((relation: any) => {
      const linkedId =
        relation.source_entity_id === entity.id
          ? relation.target_entity_id
          : relation.source_entity_id;
      const linked = entityById.get(linkedId);
      return {
        ...relation,
        linked_entity: linked ?? null,
      };
    });

    res.json({
      symbol,
      entity,
      memories,
      relations: relationContext,
      counts: {
        memories: memories.length,
        relations: relations.length,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch brain context");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch brain context" });
  }
});

// ─── Market DNA endpoint ───────────────────────────────────────────────────
router.get("/brain/:symbol/dna", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { getMarketDNA } = await import("../lib/market_dna");
    
    // Fetch recent bars from Alpaca for DNA computation
    let bars: Array<{ open: number; high: number; low: number; close: number; volume: number }> = [];
    try {
      const { getBars } = await import("../lib/alpaca");
      const rawBars = await getBars(symbol, "1Min", 300);
      bars = rawBars.map((b: any) => ({
        open: Number(b.o ?? b.open ?? 0),
        high: Number(b.h ?? b.high ?? 0),
        low: Number(b.l ?? b.low ?? 0),
        close: Number(b.c ?? b.close ?? 0),
        volume: Number(b.v ?? b.volume ?? 0),
      }));
    } catch {
      // If 1Min fails, try 5Min with fewer bars
      try {
        const { getBars } = await import("../lib/alpaca");
        const rawBars = await getBars(symbol, "5Min", 100);
        bars = rawBars.map((b: any) => ({
          open: Number(b.o ?? b.open ?? 0),
          high: Number(b.h ?? b.high ?? 0),
          low: Number(b.l ?? b.low ?? 0),
          close: Number(b.c ?? b.close ?? 0),
          volume: Number(b.v ?? b.volume ?? 0),
        }));
      } catch {
        // Return default DNA if no bar data available
      }
    }

    const dna = await getMarketDNA(symbol, bars);
    res.json(dna);
  } catch (err) {
    req.log.error({ err }, "Failed to compute Market DNA");
    res.status(500).json({ error: "internal_error", message: "Failed to compute Market DNA" });
  }
});

// ─── Setup Memory endpoint ─────────────────────────────────────────────────
router.get("/brain/:symbol/memory", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { getSetupMemory } = await import("../lib/setup_memory");
    const memory = await getSetupMemory(symbol);
    res.json(memory);
  } catch (err) {
    req.log.error({ err }, "Failed to compute setup memory");
    res.status(500).json({ error: "internal_error", message: "Failed to compute setup memory" });
  }
});

// ─── Combined intelligence endpoint (DNA + Memory + Context) ───────────────
router.get("/brain/:symbol/intelligence", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    
    const [dnaResult, memoryResult, contextResult] = await Promise.allSettled([
      (async () => {
        const { getMarketDNA } = await import("../lib/market_dna");
        let bars: Array<{ open: number; high: number; low: number; close: number; volume: number }> = [];
        try {
          const { getBars } = await import("../lib/alpaca");
          const rawBars = await getBars(symbol, "1Min", 300);
          bars = rawBars.map((b: any) => ({
            open: Number(b.o ?? b.open ?? 0), high: Number(b.h ?? b.high ?? 0),
            low: Number(b.l ?? b.low ?? 0), close: Number(b.c ?? b.close ?? 0),
            volume: Number(b.v ?? b.volume ?? 0),
          }));
        } catch { /* use empty bars */ }
        return getMarketDNA(symbol, bars);
      })(),
      (async () => {
        const { getSetupMemory } = await import("../lib/setup_memory");
        return getSetupMemory(symbol);
      })(),
      (async () => {
        await ensureBrainTables();
        const entityRows = await db
          .select()
          .from(brainEntitiesTable)
          .where(eq(brainEntitiesTable.symbol, symbol))
          .orderBy(desc(brainEntitiesTable.updated_at))
          .limit(1);
        if (entityRows.length === 0) return null;
        const entity = entityRows[0];
        const memories = await db
          .select()
          .from(brainMemoriesTable)
          .where(eq(brainMemoriesTable.entity_id, entity.id))
          .orderBy(desc(brainMemoriesTable.created_at))
          .limit(20);
        return { entity, memories };
      })(),
    ]);

    res.json({
      symbol,
      dna: dnaResult.status === "fulfilled" ? dnaResult.value : null,
      setup_memory: memoryResult.status === "fulfilled" ? memoryResult.value : null,
      context: contextResult.status === "fulfilled" ? contextResult.value : null,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch brain intelligence");
    res.status(500).json({ error: "internal_error", message: "Failed to fetch brain intelligence" });
  }
});

// ─── Helper: fetch bars as SMCBar shape ────────────────────────────────────
async function fetchSMCBars(
  symbol: string,
  timeframe: "1Min" | "5Min" | "15Min" | "1Hour" | "1Day",
  limit: number,
): Promise<Array<{ Timestamp: string; Open: number; High: number; Low: number; Close: number; Volume: number }>> {
  const { getBars } = await import("../lib/alpaca");
  const rawBars = await getBars(symbol, timeframe, limit);
  return rawBars.map((b: any) => ({
    Timestamp: String(b.t ?? b.Timestamp ?? ""),
    Open: Number(b.o ?? b.Open ?? 0),
    High: Number(b.h ?? b.High ?? 0),
    Low: Number(b.l ?? b.Low ?? 0),
    Close: Number(b.c ?? b.Close ?? 0),
    Volume: Number(b.v ?? b.Volume ?? 0),
  }));
}

// ─── SMC State endpoint ────────────────────────────────────────────────────
router.get("/brain/:symbol/smc", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { computeSMCState } = await import("../lib/smc_engine");

    let bars1m: any[] = [];
    let bars5m: any[] = [];
    try {
      bars1m = await fetchSMCBars(symbol, "1Min", 200);
    } catch { /* fallback empty */ }
    try {
      bars5m = await fetchSMCBars(symbol, "5Min", 100);
    } catch { /* fallback empty */ }

    const smc = computeSMCState(symbol, bars1m, bars5m);
    res.json(smc);
  } catch (err) {
    req.log.error({ err }, "Failed to compute SMC state");
    res.status(500).json({ error: "internal_error", message: "Failed to compute SMC state" });
  }
});

// ─── Regime + Spectral endpoint ────────────────────────────────────────────
router.get("/brain/:symbol/regime", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { computeFullRegime } = await import("../lib/regime_engine");

    let bars: any[] = [];
    try {
      bars = await fetchSMCBars(symbol, "5Min", 150);
    } catch {
      try {
        bars = await fetchSMCBars(symbol, "1Min", 200);
      } catch { /* empty */ }
    }

    const regime = computeFullRegime(bars);
    res.json({ symbol, ...regime });
  } catch (err) {
    req.log.error({ err }, "Failed to compute regime state");
    res.status(500).json({ error: "internal_error", message: "Failed to compute regime state" });
  }
});

// ─── Order Flow endpoint ───────────────────────────────────────────────────
router.get("/brain/:symbol/orderflow", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { computeOrderflowState, computeLiquidityMapState, buildCandlePackets } =
      await import("../lib/orderflow_engine");

    let bars: any[] = [];
    try {
      bars = await fetchSMCBars(symbol, "1Min", 100);
    } catch { /* empty */ }

    // Try to get live orderbook
    let orderbook = null;
    try {
      const { normalizeMarketSymbol } = await import("../lib/market/symbols");
      const { orderBookManager } = await import("../lib/market/orderbook");
      const alpacaSymbol = normalizeMarketSymbol(symbol);
      orderbook = orderBookManager.getSnapshot(alpacaSymbol);
    } catch { /* no orderbook */ }

    const orderflowState = computeOrderflowState(bars, orderbook);
    const liquidityMap = computeLiquidityMapState(orderbook);
    const candlePackets = buildCandlePackets(bars, orderbook, 20);

    res.json({
      symbol,
      orderflow: orderflowState,
      liquidity: liquidityMap,
      candle_packets: candlePackets,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute orderflow state");
    res.status(500).json({ error: "internal_error", message: "Failed to compute orderflow state" });
  }
});

// ─── Volatility / Stress endpoint ──────────────────────────────────────────
router.get("/brain/:symbol/stress", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { computeVolatilityState } = await import("../lib/stress_engine");

    let bars: any[] = [];
    try {
      bars = await fetchSMCBars(symbol, "1Min", 200);
    } catch {
      try {
        bars = await fetchSMCBars(symbol, "5Min", 100);
      } catch { /* empty */ }
    }

    const vol = computeVolatilityState(symbol, bars);
    res.json({ symbol, volatility: vol });
  } catch (err) {
    req.log.error({ err }, "Failed to compute stress state");
    res.status(500).json({ error: "internal_error", message: "Failed to compute stress state" });
  }
});

// ─── Full Brain State endpoint (all engines combined) ──────────────────────
router.get("/brain/:symbol/brain-state", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { computeSymbolBrainState } = await import("../lib/symbol_brain");

    let bars1m: any[] = [];
    let bars5m: any[] = [];
    try {
      bars1m = await fetchSMCBars(symbol, "1Min", 200);
    } catch { /* empty */ }
    try {
      bars5m = await fetchSMCBars(symbol, "5Min", 100);
    } catch { /* empty */ }

    // Try to get live orderbook
    let orderbook = null;
    try {
      const { normalizeMarketSymbol } = await import("../lib/market/symbols");
      const { orderBookManager } = await import("../lib/market/orderbook");
      const alpacaSymbol = normalizeMarketSymbol(symbol);
      orderbook = orderBookManager.getSnapshot(alpacaSymbol);
    } catch { /* no orderbook */ }

    // Try to get Market DNA
    let dna = null;
    try {
      const { getMarketDNA } = await import("../lib/market_dna");
      const dnaBars = bars1m.map((b: any) => ({
        open: b.Open, high: b.High, low: b.Low, close: b.Close, volume: b.Volume,
      }));
      dna = await getMarketDNA(symbol, dnaBars);
    } catch { /* no DNA */ }

    const brainState = computeSymbolBrainState(
      symbol, bars1m, bars5m, orderbook, null, dna,
    );

    res.json(brainState);
  } catch (err) {
    req.log.error({ err }, "Failed to compute brain state");
    res.status(500).json({ error: "internal_error", message: "Failed to compute brain state" });
  }
});

// ─── Global Market Stress endpoint ────────────────────────────────────────
router.get("/brain/market-stress", async (req, res) => {
  try {
    const symbolsQuery = (req.query.symbols as string) || "";
    const symbols = symbolsQuery.split(",").filter(Boolean).map((s) => s.toUpperCase());

    if (symbols.length < 2) {
      return res.json({ systemicStressScore: 0, stressRegime: "low", symbolCount: symbols.length });
    }

    const { computeMarketStress } = await import("../lib/stress_engine");

    const symbolReturns = new Map<string, number[]>();

    for (const symbol of symbols) {
      try {
        const bars = await fetchSMCBars(symbol, "1Min", 100);
        const returns: number[] = [];
        for (let i = 1; i < bars.length; i++) {
          const prev = bars[i - 1].Close;
          const curr = bars[i].Close;
          if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
        }
        if (returns.length > 5) {
          symbolReturns.set(symbol, returns);
        }
      } catch {
        /* skip failing symbols */
      }
    }

    const marketStress = computeMarketStress(symbolReturns);
    return res.json(marketStress);
  } catch (err) {
    req.log.error({ err }, "Failed to compute global market stress");
    return res.status(500).json({ error: "internal_error", message: "Failed to compute global market stress" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENT-BRAIN CYCLE ENDPOINTS
// These power the multi-agent intelligence pipeline:
//   POST /brain/cycle          — Run a full brain cycle, return decisions
//   GET  /brain/cycle/stream   — SSE: stream brain events live to frontend
//   GET  /brain/cycle/latest   — Get the latest cycle's decisions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper: build BrainCycleInput for a symbol by fetching bars + orderbook + stress
 */
async function buildCycleInput(symbol: string): Promise<BrainCycleInput> {
  let bars1m: any[] = [];
  let bars5m: any[] = [];
  let orderbook: any = null;
  let dna: any = null;
  let marketStress: any = null;

  // Fetch bars in parallel
  const [bars1mResult, bars5mResult] = await Promise.allSettled([
    fetchSMCBars(symbol, "1Min", 200).catch(() => []),
    fetchSMCBars(symbol, "5Min", 100).catch(() => []),
  ]);
  bars1m = bars1mResult.status === "fulfilled" ? bars1mResult.value : [];
  bars5m = bars5mResult.status === "fulfilled" ? bars5mResult.value : [];

  // Try orderbook
  try {
    const { normalizeMarketSymbol } = await import("../lib/market/symbols");
    const { orderBookManager } = await import("../lib/market/orderbook");
    const alpacaSymbol = normalizeMarketSymbol(symbol);
    orderbook = orderBookManager.getSnapshot(alpacaSymbol);
  } catch { /* no orderbook */ }

  // Try Market DNA
  try {
    const { getMarketDNA } = await import("../lib/market_dna");
    const dnaBars = bars1m.map((b: any) => ({
      open: b.Open, high: b.High, low: b.Low, close: b.Close, volume: b.Volume,
    }));
    dna = await getMarketDNA(symbol, dnaBars);
  } catch { /* no DNA */ }

  return { symbol, bars1m, bars5m, orderbook, marketStress, dna };
}

/**
 * POST /brain/cycle
 * Run a full brain cycle for one or more symbols.
 * Body: { symbols: ["AAPL", "TSLA", ...] }
 * Returns: { cycleId, decisions, latencyMs }
 */
router.post("/brain/cycle", async (req, res) => {
  try {
    const rawSymbols = req.body?.symbols;
    const symbols: string[] = Array.isArray(rawSymbols)
      ? rawSymbols.map((s: any) => String(s).trim().toUpperCase()).filter(Boolean)
      : typeof rawSymbols === "string"
        ? rawSymbols.split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean)
        : ["AAPL"];

    if (symbols.length === 0) {
      res.status(400).json({ error: "invalid_request", message: "At least one symbol is required" });
      return;
    }
    if (symbols.length > 20) {
      res.status(400).json({ error: "invalid_request", message: "Maximum 20 symbols per cycle" });
      return;
    }

    // Build inputs in parallel
    const inputs = await Promise.all(symbols.map(buildCycleInput));

    // Optionally compute market stress across all symbols
    if (symbols.length >= 2) {
      try {
        const { computeMarketStress } = await import("../lib/stress_engine");
        const symbolReturns = new Map<string, number[]>();
        for (const input of inputs) {
          const bars = input.bars1m.length > 0 ? input.bars1m : input.bars5m;
          const returns: number[] = [];
          for (let i = 1; i < bars.length; i++) {
            const prev = (bars[i - 1] as any).Close;
            const curr = (bars[i] as any).Close;
            if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
          }
          if (returns.length > 5) symbolReturns.set(input.symbol, returns);
        }
        if (symbolReturns.size >= 2) {
          const stress = computeMarketStress(symbolReturns);
          for (const input of inputs) {
            input.marketStress = stress;
          }
        }
      } catch { /* stress computation optional */ }
    }

    // Run the brain cycle
    const result = await runFullBrainCycle(inputs);

    res.json({
      ok: true,
      cycleId: result.cycleId,
      symbolCount: symbols.length,
      decisions: result.decisions.map((d) => ({
        symbol: d.symbol,
        action: d.action,
        confidence: d.confidence,
        readinessScore: d.readinessScore,
        attentionScore: d.attentionScore,
        reasoning: d.reasoning,
        riskGate: d.riskGate,
        blockReason: d.blockReason,
        agentReports: d.agentReports.map((r) => ({
          agentId: r.agentId,
          status: r.status,
          confidence: r.confidence,
          score: r.score,
          verdict: r.verdict,
          flags: r.flags,
          latencyMs: r.latencyMs,
        })),
        cycleLatencyMs: d.cycleLatencyMs,
      })),
      latencyMs: result.latencyMs,
      timestamp: Date.now(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run brain cycle");
    res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : "Failed to run brain cycle",
    });
  }
});

/**
 * GET /brain/cycle/stream
 * Server-Sent Events endpoint that streams brain events live.
 * The frontend connects here and receives real-time agent reports,
 * decisions, and cycle lifecycle events as they happen.
 */
router.get("/brain/cycle/stream", (req, res) => {
  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ connected: true, timestamp: Date.now() })}\n\n`);

  // Keep-alive ping every 15 seconds
  const keepAlive = setInterval(() => {
    res.write(`:ping ${Date.now()}\n\n`);
  }, 15000);

  // Subscribe to all brain events
  const unsubscribe = brainEventBus.on("*", (event: BrainEvent) => {
    try {
      const eventType = event.type.replace(":", "_"); // SSE event names can't have colons
      const data = JSON.stringify({
        type: event.type,
        cycleId: event.cycleId,
        symbol: event.symbol,
        agentId: event.agentId,
        payload: event.payload,
        timestamp: event.timestamp,
      });
      res.write(`event: ${eventType}\ndata: ${data}\n\n`);
    } catch { /* client disconnected */ }
  });

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

/**
 * GET /brain/cycle/latest
 * Get the latest brain cycle's decisions and agent reports.
 * Useful for initial page load (before SSE connects).
 */
router.get("/brain/cycle/latest", (_req, res) => {
  const state = brainEventBus.cycleState;
  if (!state) {
    res.json({
      hasCycle: false,
      cycleId: 0,
      decisions: [],
      agents: [],
      events: [],
    });
    return;
  }

  res.json({
    hasCycle: true,
    cycleId: state.cycleId,
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt ?? null,
    decisions: Array.from(state.decisions.values()),
    agents: Array.from(state.agents.values()),
    events: brainEventBus.getRecentEvents(100),
  });
});

/**
 * POST /brain/cycle/single
 * Run a brain cycle for a single symbol — lighter endpoint for
 * quick analysis. Returns the full decision with all agent reports.
 */
router.post("/brain/cycle/single", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.body?.symbol ?? req.query.symbol);
    const input = await buildCycleInput(symbol);

    const cycleId = brainEventBus.startCycle();
    const decision = await runBrainCycleForSymbol(input);
    brainEventBus.endCycle();

    res.json({
      ok: true,
      cycleId,
      decision: {
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        readinessScore: decision.readinessScore,
        attentionScore: decision.attentionScore,
        reasoning: decision.reasoning,
        riskGate: decision.riskGate,
        blockReason: decision.blockReason,
        agentReports: decision.agentReports.map((r) => ({
          agentId: r.agentId,
          status: r.status,
          confidence: r.confidence,
          score: r.score,
          verdict: r.verdict,
          data: r.data,
          flags: r.flags,
          latencyMs: r.latencyMs,
        })),
        cycleLatencyMs: decision.cycleLatencyMs,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run single brain cycle");
    res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : "Failed to run single brain cycle",
    });
  }
});

// ── In-memory backtest cache (cleared on restart) ───────────────────────────
// In production you'd persist this to DB. For now it stores the last N results.
const backtestCache = new Map<string, {
  symbol: string;
  runAt: string;
  latencyMs: number;
  backtestOutput: Record<string, unknown>;
  chartOutput: Record<string, unknown>;
}>();
const BACKTEST_CACHE_MAX = 20;

/**
 * POST /brain/backtest
 * Trigger a full L7+L8 backtest + chart pipeline for one symbol.
 * Body: { symbol: string, lookbackBars?: number }
 *
 * This runs the quant-grade walk-forward backtester (L7) then generates
 * annotated chart snapshots for the top setups (L8).
 * Results are cached in memory and returned immediately.
 */
router.post("/brain/backtest", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.body?.symbol ?? req.query.symbol);
    const lookbackBars = Math.min(
      5000,
      Math.max(100, Number(req.body?.lookbackBars ?? req.query.lookbackBars ?? 2000))
    );

    const input = await buildCycleInput(symbol);

    const result = await runBacktestAndChartPipeline(input, lookbackBars);

    // Store in cache
    const cacheEntry = {
      symbol,
      runAt: new Date().toISOString(),
      latencyMs: result.latencyMs,
      backtestOutput: result.backtestOutput as unknown as Record<string, unknown>,
      chartOutput: {
        snapshotsGenerated: result.chartOutput.snapshotsGenerated,
        topConfirmationId: result.chartOutput.topConfirmationId,
        topConfirmationScore: result.chartOutput.topConfirmationScore,
        allSnapshotIds: result.chartOutput.allSnapshotIds,
        // SVG is large — don't include in the cache summary
      },
    };
    backtestCache.set(symbol, cacheEntry);
    if (backtestCache.size > BACKTEST_CACHE_MAX) {
      const firstKey = backtestCache.keys().next().value;
      if (firstKey !== undefined) backtestCache.delete(firstKey);
    }

    res.json({
      ok: true,
      symbol,
      runAt: cacheEntry.runAt,
      latencyMs: result.latencyMs,
      backtest: result.backtestOutput,
      chart: {
        snapshotsGenerated: result.chartOutput.snapshotsGenerated,
        topConfirmationId: result.chartOutput.topConfirmationId,
        topConfirmationScore: result.chartOutput.topConfirmationScore,
        allSnapshotIds: result.chartOutput.allSnapshotIds,
      },
      // Include the top SVG inline for the UI to render immediately
      topSnapshotSvg: result.chartOutput.topSnapshotSvg ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Backtest failed");
    res.status(500).json({
      error: "backtest_error",
      message: err instanceof Error ? err.message : "Backtest failed",
    });
  }
});

/**
 * GET /brain/backtest/:symbol
 * Retrieve the cached backtest result for a symbol (no re-run).
 */
router.get("/brain/backtest/:symbol", (req, res) => {
  const symbol = asRequiredSymbol(req.params.symbol);
  const cached = backtestCache.get(symbol);
  if (!cached) {
    res.status(404).json({ error: "not_found", message: `No backtest result cached for ${symbol}. POST /brain/backtest to run one.` });
    return;
  }
  res.json({ ok: true, ...cached });
});

/**
 * GET /brain/backtest
 * List all cached backtest results (symbol index).
 */
router.get("/brain/backtest", (_req, res) => {
  const entries = Array.from(backtestCache.values()).map((e) => ({
    symbol: e.symbol,
    runAt: e.runAt,
    latencyMs: e.latencyMs,
    winRate: (e.backtestOutput as any).winRate,
    sharpeRatio: (e.backtestOutput as any).sharpeRatio,
    totalTrades: (e.backtestOutput as any).totalTrades,
    snapshotsGenerated: (e.chartOutput as any).snapshotsGenerated,
  }));
  res.json({ ok: true, count: entries.length, results: entries });
});

// ── In-memory SVG snapshot store (keyed by confirmationId) ──────────────────
const svgSnapshotStore = new Map<string, { symbol: string; svg: string; meta: Record<string, unknown> }>();

/**
 * POST /brain/chart
 * Generate annotated chart snapshots for a symbol.
 * Body: { symbol: string, lookbackBars?: number }
 * Stores SVGs in memory and returns snapshot IDs.
 */
router.post("/brain/chart", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.body?.symbol ?? req.query.symbol);
    const lookbackBars = Math.min(5000, Math.max(100, Number(req.body?.lookbackBars ?? 2000)));

    const input = await buildCycleInput(symbol);
    const result = await runBacktestAndChartPipeline(input, lookbackBars);

    // Store snapshots
    const ids: string[] = [];
    // chartOutput.allSnapshotIds has IDs — we need the actual snapshots from a re-run
    // We store whatever we got from the top SVG
    if (result.chartOutput.topSnapshotSvg && result.chartOutput.topConfirmationId) {
      svgSnapshotStore.set(result.chartOutput.topConfirmationId, {
        symbol,
        svg: result.chartOutput.topSnapshotSvg,
        meta: {
          score: result.chartOutput.topConfirmationScore,
          generatedAt: new Date().toISOString(),
        },
      });
      ids.push(result.chartOutput.topConfirmationId);
    }

    res.json({
      ok: true,
      symbol,
      snapshotsGenerated: result.chartOutput.snapshotsGenerated,
      storedIds: ids,
      topConfirmationId: result.chartOutput.topConfirmationId,
      topConfirmationScore: result.chartOutput.topConfirmationScore,
      topSnapshotSvg: result.chartOutput.topSnapshotSvg ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Chart generation failed");
    res.status(500).json({
      error: "chart_error",
      message: err instanceof Error ? err.message : "Chart generation failed",
    });
  }
});

/**
 * GET /brain/chart/:symbol/:confirmationId
 * Return the SVG snapshot for a specific confirmation.
 * Use Accept: image/svg+xml to get raw SVG, or application/json for metadata.
 */
router.get("/brain/chart/:symbol/:confirmationId", (req, res) => {
  const symbol = asRequiredSymbol(req.params.symbol);
  const confirmationId = String(req.params.confirmationId ?? "").trim();

  if (!confirmationId) {
    res.status(400).json({ error: "confirmation_id_required" });
    return;
  }

  const snap = svgSnapshotStore.get(confirmationId);
  if (!snap) {
    res.status(404).json({
      error: "not_found",
      message: `No snapshot for ${symbol}/${confirmationId}. Run POST /brain/chart first.`,
    });
    return;
  }

  const accept = String(req.headers.accept ?? "");
  if (accept.includes("image/svg+xml") || accept.includes("text/html")) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(snap.svg);
  } else {
    res.json({
      ok: true,
      symbol: snap.symbol,
      confirmationId,
      meta: snap.meta,
      svgSize: snap.svg.length,
      svg: snap.svg,
    });
  }
});

/**
 * GET /brain/chart/:symbol
 * List all stored snapshot IDs for a symbol.
 */
router.get("/brain/chart/:symbol", (req, res) => {
  const symbol = asRequiredSymbol(req.params.symbol);
  const entries = Array.from(svgSnapshotStore.entries())
    .filter(([, v]) => v.symbol === symbol)
    .map(([id, v]) => ({ confirmationId: id, ...v.meta }));

  res.json({ ok: true, symbol, count: entries.length, snapshots: entries });
});

// ── Scheduler Control ────────────────────────────────────────────────────────

/**
 * POST /brain/scheduler/start
 * Start the non-stop auto-scheduler.
 * Body: { symbols: string[], cycleIntervalMs?: number, backtestIntervalMs?: number }
 */
router.post("/brain/scheduler/start", async (req, res) => {
  try {
    const rawSymbols = req.body?.symbols ?? req.body?.symbol;
    if (!rawSymbols) {
      res.status(400).json({ error: "symbols_required", message: "Provide symbols: ['EURUSD', 'BTCUSDT']" });
      return;
    }
    const symbols: string[] = (Array.isArray(rawSymbols) ? rawSymbols : String(rawSymbols).split(","))
      .map((s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .filter(Boolean);

    if (symbols.length === 0) {
      res.status(400).json({ error: "no_valid_symbols" });
      return;
    }

    const options = {
      cycleIntervalMs: Number(req.body?.cycleIntervalMs ?? 30_000),
      backtestIntervalMs: Number(req.body?.backtestIntervalMs ?? 3_600_000),
    };

    startBrainScheduler(buildCycleInput, symbols, options);

    res.json({
      ok: true,
      message: `Brain scheduler started for ${symbols.join(", ")}`,
      symbols,
      cycleIntervalMs: options.cycleIntervalMs,
      backtestIntervalMs: options.backtestIntervalMs,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to start scheduler");
    res.status(500).json({ error: "scheduler_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /brain/scheduler/stop
 * Stop the auto-scheduler gracefully.
 */
router.post("/brain/scheduler/stop", (_req, res) => {
  stopBrainScheduler();
  res.json({ ok: true, message: "Brain scheduler stopped" });
});

/**
 * GET /brain/scheduler/status
 * Get the current scheduler health (cycle count, errors, symbols, uptime).
 */
router.get("/brain/scheduler/status", (_req, res) => {
  res.json({ ok: true, ...getBrainSchedulerStatus() });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: AUTONOMOUS BRAIN + JOB QUEUE + STRATEGY EVOLUTION + SUPER INTEL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /brain/autonomous/start
 * Start the Autonomous Brain — assigns jobs, runs non-stop, learns continuously.
 * Body: { symbols: string[], cycleIntervalMs?, backtestIntervalMs? }
 */
router.post("/brain/autonomous/start", async (req, res) => {
  try {
    const rawSymbols = req.body?.symbols ?? req.body?.symbol;
    if (!rawSymbols) {
      res.status(400).json({ error: "symbols_required" });
      return;
    }
    const symbols: string[] = (Array.isArray(rawSymbols) ? rawSymbols : String(rawSymbols).split(","))
      .map((s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .filter(Boolean);

    if (symbols.length === 0) {
      res.status(400).json({ error: "no_valid_symbols" });
      return;
    }

    const timers: Record<string, number> = {};
    if (req.body?.cycleIntervalMs) timers.scanIntervalMs = Number(req.body.cycleIntervalMs);
    if (req.body?.backtestIntervalMs) timers.backtestIntervalMs = Number(req.body.backtestIntervalMs);

    autonomousBrain.start(
      symbols,
      buildCycleInput,
      runFullBrainCycle,
      runBacktestAndChartPipeline,
      timers,
    );

    res.json({
      ok: true,
      message: `Autonomous Brain started for ${symbols.join(", ")}`,
      symbols,
      status: autonomousBrain.status,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to start autonomous brain");
    res.status(500).json({ error: "brain_start_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /brain/autonomous/stop
 */
router.post("/brain/autonomous/stop", (_req, res) => {
  autonomousBrain.stop();
  res.json({ ok: true, message: "Autonomous Brain stopped" });
});

/**
 * GET /brain/autonomous/status
 * Full status: brain state + job queue + strategies + super intel
 */
router.get("/brain/autonomous/status", (_req, res) => {
  res.json({ ok: true, ...autonomousBrain.getFullStatus() });
});

/**
 * POST /brain/autonomous/mode
 * Set brain operating mode (AGGRESSIVE | NORMAL | DEFENSIVE | PAUSED)
 */
router.post("/brain/autonomous/mode", (req, res) => {
  const mode = String(req.body?.mode ?? "").toUpperCase() as any;
  if (!["AGGRESSIVE", "NORMAL", "DEFENSIVE", "PAUSED"].includes(mode)) {
    res.status(400).json({ error: "invalid_mode", valid: ["AGGRESSIVE", "NORMAL", "DEFENSIVE", "PAUSED"] });
    return;
  }
  autonomousBrain.setMode(mode);
  res.json({ ok: true, mode });
});

/**
 * POST /brain/autonomous/signal
 * Notify the brain that a signal was confirmed — boosts attention + priority scan
 */
router.post("/brain/autonomous/signal", (req, res) => {
  const symbol = asRequiredSymbol(req.body?.symbol);
  const direction = String(req.body?.direction ?? "long") as "long" | "short";
  const score = Number(req.body?.score ?? 0.7);
  autonomousBrain.onSignalConfirmed(symbol, direction, score);
  res.json({ ok: true, symbol, direction, score });
});

/**
 * POST /brain/autonomous/outcome
 * Record a completed trade outcome — feeds back into ML and strategy evolution
 */
router.post("/brain/autonomous/outcome", (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.body?.symbol);
    const direction = String(req.body?.direction ?? "long") as "long" | "short";
    const won = Boolean(req.body?.won);
    const achievedR = Number(req.body?.achievedR ?? 0);
    const regime = String(req.body?.regime ?? "unknown");
    const predictedWinProb = Number(req.body?.predictedWinProb ?? 0.5);
    const features = req.body?.features ?? {};

    autonomousBrain.recordTradeOutcome(symbol, direction, won, achievedR, regime, predictedWinProb, features);

    res.json({ ok: true, symbol, won, achievedR, regime });
  } catch (err) {
    res.status(400).json({ error: "invalid_outcome", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── Job Queue Endpoints ──────────────────────────────────────────────────────

/**
 * GET /brain/jobs
 * Get current job queue + stats
 */
router.get("/brain/jobs", (_req, res) => {
  const queue = brainJobQueue.getQueue();
  const stats = brainJobQueue.getStats();
  const recent = brainJobQueue.getCompleted(20);
  res.json({
    ok: true,
    stats,
    queue: queue.slice(0, 50).map((j) => ({
      id: j.id, type: j.type, priority: j.priority, status: j.status,
      symbol: j.symbol, reason: j.reason, createdBy: j.createdBy,
      createdAt: j.createdAt, attempts: j.attempts,
    })),
    recentCompleted: recent.slice(-10).map((j) => ({
      id: j.id, type: j.type, status: j.status, symbol: j.symbol,
      latencyMs: j.finishedAt ? j.finishedAt - (j.startedAt ?? j.createdAt) : null,
    })),
  });
});

/**
 * POST /brain/jobs/enqueue
 * Manually enqueue a job
 * Body: { type, symbol, priority?, reason? }
 */
router.post("/brain/jobs/enqueue", (req, res) => {
  try {
    const type = String(req.body?.type ?? "") as any;
    const validTypes = ["SCAN_SYMBOL", "BACKTEST", "CHART_SNAPSHOT", "EVOLVE_STRATEGY", "RETRAIN_ML", "ANALYZE_REGIME", "RANK_SYMBOLS", "BUILD_RULEBOOK"];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: "invalid_type", valid: validTypes });
      return;
    }
    const symbol = asRequiredSymbol(req.body?.symbol ?? "BTCUSD");
    const priority = Math.min(4, Math.max(0, Number(req.body?.priority ?? 2))) as 0 | 1 | 2 | 3 | 4;
    const reason = String(req.body?.reason ?? `Manual ${type} request`);

    let job;
    switch (type) {
      case "SCAN_SYMBOL":
        job = BrainJobs.scanSymbol(symbol, reason, priority);
        break;
      case "BACKTEST":
        job = BrainJobs.backtest(symbol, Number(req.body?.lookbackBars ?? 2000), reason, priority);
        break;
      case "RETRAIN_ML":
        job = BrainJobs.retrainML(reason, 0, symbol);
        break;
      case "RANK_SYMBOLS":
        job = BrainJobs.rankSymbols([symbol]);
        break;
      case "BUILD_RULEBOOK":
        job = BrainJobs.buildRulebook([symbol], 20, reason);
        break;
      default:
        job = BrainJobs.scanSymbol(symbol, reason, priority);
    }

    res.json({ ok: true, jobId: job.id, type: job.type, status: job.status });
  } catch (err) {
    res.status(400).json({ error: "enqueue_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── Strategy Evolution Endpoints ─────────────────────────────────────────────

/**
 * GET /brain/strategies
 * List all evolved strategies + current params
 */
router.get("/brain/strategies", (req, res) => {
  const symbol = req.query.symbol ? asRequiredSymbol(req.query.symbol) : undefined;
  const strategies = symbol
    ? strategyRegistry.getAllForSymbol(symbol)
    : strategyRegistry.getAll();

  res.json({
    ok: true,
    count: strategies.length,
    strategies: strategies.map((s) => ({
      strategyId: s.strategyId,
      symbol: s.symbol,
      name: s.name,
      tier: s.tier,
      version: s.version,
      winRate: s.winRate,
      sharpeRatio: s.sharpeRatio,
      calmarRatio: s.calmarRatio,
      totalTrades: s.totalTrades,
      minConfirmationScore: s.minConfirmationScore,
      requireMTFAlignment: s.requireMTFAlignment,
      blacklistedRegimes: s.blacklistedRegimes,
      stopATRMultiplier: s.stopATRMultiplier,
      takeProfitATRMultiplier: s.takeProfitATRMultiplier,
      maxKellyFraction: s.maxKellyFraction,
      lastEvolvedAt: s.lastEvolvedAt,
      changeCount: s.changelog.length,
    })),
  });
});

/**
 * GET /brain/strategies/:symbol/:strategyId/changelog
 */
router.get("/brain/strategies/:symbol/:strategyId/changelog", (req, res) => {
  const symbol = asRequiredSymbol(req.params.symbol);
  const strategyId = String(req.params.strategyId ?? "smc_ob_fvg");
  const strategy = strategyRegistry.get(strategyId, symbol);
  if (!strategy) {
    res.status(404).json({ error: "not_found", message: `No strategy ${strategyId} for ${symbol}` });
    return;
  }
  res.json({ ok: true, symbol, strategyId, version: strategy.version, changelog: strategy.changelog });
});

/**
 * GET /brain/strategies/rank
 * Rank all strategies by composite score
 */
router.get("/brain/strategies/rank", (req, res) => {
  const rawSymbols = req.query.symbols as string | undefined;
  const symbols = rawSymbols ? rawSymbols.split(",").map((s) => s.trim().toUpperCase()) : undefined;
  const rankings = rankStrategies(symbols);
  res.json({ ok: true, count: rankings.length, rankings });
});

// ── Super Intelligence v2 Endpoints ──────────────────────────────────────────

/**
 * GET /brain/superintel/status
 * Get Super Intelligence v2 per-symbol model state
 */
router.get("/brain/superintel/status", (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
  const status = superIntelligenceV2.getStatus(symbol);
  res.json({ ok: true, models: status });
});

/**
 * POST /brain/superintel/outcome
 * Record an outcome to improve the model (same as /brain/autonomous/outcome)
 */
router.post("/brain/superintel/outcome", (req, res) => {
  try {
    superIntelligenceV2.recordOutcome({
      id: `manual_${Date.now()}`,
      symbol: asRequiredSymbol(req.body?.symbol),
      strategyId: String(req.body?.strategyId ?? "smc_ob_fvg"),
      direction: String(req.body?.direction ?? "long") as "long" | "short",
      regime: String(req.body?.regime ?? "unknown"),
      features: req.body?.features ?? {},
      predictedWinProb: Number(req.body?.predictedWinProb ?? 0.5),
      actualWon: Boolean(req.body?.won),
      achievedR: Number(req.body?.achievedR ?? 0),
      timestamp: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: "outcome_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /brain/superintel/retrain
 * Force retrain for a symbol or globally
 */
router.post("/brain/superintel/retrain", (req, res) => {
  const symbol = req.body?.symbol ? String(req.body.symbol).toUpperCase() : undefined;
  if (symbol) {
    const result = superIntelligenceV2.retrain(symbol);
    res.json({ ok: true, symbol, ...result });
  } else {
    const count = superIntelligenceV2.triggerGlobalEvolution();
    res.json({ ok: true, globalRetrain: true, symbolCount: count });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 7: PERSISTENCE + LIVE EXECUTION ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── Execution Bridge ──────────────────────────────────────────────────────────

/**
 * GET /brain/execution/status
 * Execution bridge status — open positions, approval rates, config
 */
router.get("/brain/execution/status", (_req, res) => {
  res.json({ ok: true, ...brainExecutionBridge.getStatus() });
});

/**
 * POST /brain/execution/signal
 * Manually route a brain signal through the execution bridge (test/override)
 */
router.post("/brain/execution/signal", async (req, res) => {
  try {
    const signal = req.body as BrainSignal;
    if (!signal?.symbol || !signal?.direction || !signal?.entryPrice) {
      res.status(400).json({ error: "missing_fields", message: "symbol, direction, entryPrice required" });
      return;
    }
    const decision = await brainExecutionBridge.evaluate(signal);
    res.json({ ok: true, decision });
  } catch (err) {
    res.status(500).json({ error: "execution_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /brain/execution/close
 * Manually close a brain-managed position
 */
router.post("/brain/execution/close", async (req, res) => {
  try {
    const { symbol, exitPrice, reason } = req.body ?? {};
    if (!symbol || !exitPrice) {
      res.status(400).json({ error: "missing_fields", message: "symbol and exitPrice required" });
      return;
    }
    await brainExecutionBridge.onPositionClosed(
      String(symbol).toUpperCase(),
      Number(exitPrice),
      reason ?? "MANUAL",
    );
    res.json({ ok: true, symbol, exitPrice, reason: reason ?? "MANUAL" });
  } catch (err) {
    res.status(500).json({ error: "close_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /brain/execution/positions
 * All open brain-managed positions with current P&L
 */
router.get("/brain/execution/positions", (_req, res) => {
  res.json({ ok: true, positions: brainPositions.getAll() });
});

// ── P&L Tracker ───────────────────────────────────────────────────────────────

/**
 * GET /brain/pnl/summary
 * Full P&L summary — open positions, today/week/all-time stats
 */
router.get("/brain/pnl/summary", async (_req, res) => {
  try {
    const summary = await brainPnLTracker.getSummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: "pnl_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /brain/pnl/price
 * Push a live price update for a symbol (from websocket/stream consumers)
 */
router.post("/brain/pnl/price", (req, res) => {
  const { symbol, price } = req.body ?? {};
  if (!symbol || !price) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  updatePriceCache(String(symbol).toUpperCase(), Number(price));
  res.json({ ok: true });
});

/**
 * POST /brain/pnl/tracker/start
 * Start the P&L tracker
 */
router.post("/brain/pnl/tracker/start", (_req, res) => {
  brainPnLTracker.start();
  res.json({ ok: true, running: brainPnLTracker.isRunningStatus() });
});

/**
 * POST /brain/pnl/tracker/stop
 * Stop the P&L tracker
 */
router.post("/brain/pnl/tracker/stop", (_req, res) => {
  brainPnLTracker.stop();
  res.json({ ok: true, running: false });
});

// ── Job History (Persistence) ─────────────────────────────────────────────────

/**
 * GET /brain/history/jobs
 * Completed + failed job history with optional type filter
 */
router.get("/brain/history/jobs", async (req, res) => {
  try {
    const limit = Math.min(500, Number(req.query.limit ?? 100));
    const jobType = req.query.type ? String(req.query.type) : undefined;
    const rows = await getJobHistory(limit, jobType);
    res.json({ ok: true, count: rows.length, jobs: rows });
  } catch (err) {
    res.status(500).json({ error: "db_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /brain/history/jobs/latency
 * Job latency stats by type — p50, p95, avg, success rate
 */
router.get("/brain/history/jobs/latency", async (_req, res) => {
  try {
    const stats = await getJobLatencyStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ error: "db_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── Trade Outcomes (Persistence) ──────────────────────────────────────────────

/**
 * GET /brain/history/outcomes
 * Recent trade outcomes for a symbol
 */
router.get("/brain/history/outcomes", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.query.symbol as string ?? "SPY");
    const limit = Math.min(500, Number(req.query.limit ?? 100));
    const outcomes = await loadRecentOutcomes(symbol, limit);
    res.json({ ok: true, symbol, count: outcomes.length, outcomes });
  } catch (err) {
    res.status(500).json({ error: "db_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /brain/history/outcomes/stats
 * Aggregated outcome stats for a symbol
 */
router.get("/brain/history/outcomes/stats", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.query.symbol as string ?? "SPY");
    const stats = await getOutcomeStats(symbol);
    res.json({ ok: true, symbol, ...stats });
  } catch (err) {
    res.status(500).json({ error: "db_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /brain/history/portfolio
 * Portfolio-level stats across all symbols
 */
router.get("/brain/history/portfolio", async (_req, res) => {
  try {
    const stats = await getPortfolioStats();
    res.json({ ok: true, count: stats.length, stats });
  } catch (err) {
    res.status(500).json({ error: "db_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── Chart Snapshots (Persistence) ─────────────────────────────────────────────

/**
 * GET /brain/history/charts
 * List persisted chart snapshots for a symbol
 */
router.get("/brain/history/charts", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.query.symbol as string ?? "SPY");
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const snapshots = await listChartSnapshots(symbol, limit);
    res.json({ ok: true, symbol, count: snapshots.length, snapshots });
  } catch (err) {
    res.status(500).json({ error: "db_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /brain/history/charts/:confirmationId
 * Load full SVG chart for a specific confirmation
 */
router.get("/brain/history/charts/:confirmationId", async (req, res) => {
  try {
    const confirmationId = String(req.params.confirmationId);
    const snapshot = await loadChartSnapshot(confirmationId);
    if (!snapshot) {
      res.status(404).json({ error: "not_found", message: `No chart for confirmation ${confirmationId}` });
      return;
    }
    res.json({ ok: true, ...snapshot });
  } catch (err) {
    res.status(500).json({ error: "db_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 8: STREAM BRIDGE + CORRELATION + ALERTS + WATCHDOG + PERFORMANCE
// ═════════════════════════════════════════════════════════════════════════════

// ── Stream Bridge ─────────────────────────────────────────────────────────────

/**
 * GET /brain/stream/status
 * Alpaca WebSocket bridge status
 */
router.get("/brain/stream/status", (_req, res) => {
  res.json({ ok: true, ...brainStreamBridge.getStatus() });
});

/**
 * POST /brain/stream/start
 * Start the stream bridge
 */
router.post("/brain/stream/start", (_req, res) => {
  brainStreamBridge.start();
  res.json({ ok: true, status: brainStreamBridge.getStatus() });
});

/**
 * POST /brain/stream/subscribe
 * Subscribe a symbol to the live price stream
 */
router.post("/brain/stream/subscribe", (req, res) => {
  const symbol = asRequiredSymbol(req.body?.symbol ?? "");
  brainStreamBridge.subscribeSymbol(symbol);
  res.json({ ok: true, symbol });
});

// ── Correlation Engine ────────────────────────────────────────────────────────

/**
 * GET /brain/correlation/snapshot
 * Latest correlation matrix snapshot
 */
router.get("/brain/correlation/snapshot", (_req, res) => {
  const snap = correlationEngine.getSnapshot();
  res.json({ ok: true, snapshot: snap });
});

/**
 * GET /brain/correlation/summary
 * Correlation summary + contagion status
 */
router.get("/brain/correlation/summary", (_req, res) => {
  res.json({ ok: true, ...correlationEngine.getSummary() });
});

/**
 * POST /brain/correlation/price
 * Feed a price observation into the correlation engine
 */
router.post("/brain/correlation/price", (req, res) => {
  const { symbol, price } = req.body ?? {};
  if (!symbol || !price) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  correlationEngine.onPrice(String(symbol).toUpperCase(), Number(price));
  // Also update brain price cache
  updatePriceCache(String(symbol).toUpperCase(), Number(price));
  res.json({ ok: true });
});

// ── Alert System ──────────────────────────────────────────────────────────────

/**
 * GET /brain/alerts
 * Get recent alerts with optional level/code filter
 */
router.get("/brain/alerts", (req, res) => {
  const limit = Math.min(200, Number(req.query.limit ?? 50));
  const level = req.query.level ? String(req.query.level) as any : undefined;
  const code = req.query.code ? String(req.query.code) as any : undefined;
  const alerts = brainAlerts.getAlerts(limit, level, code);
  const stats = brainAlerts.getStats();
  res.json({ ok: true, count: alerts.length, alerts, stats });
});

/**
 * GET /brain/alerts/unread
 * Get unread alerts
 */
router.get("/brain/alerts/unread", (_req, res) => {
  const unread = brainAlerts.getUnread();
  res.json({ ok: true, count: unread.length, alerts: unread });
});

/**
 * POST /brain/alerts/read
 * Mark alerts as read
 */
router.post("/brain/alerts/read", (req, res) => {
  const { alertIds, all } = req.body ?? {};
  if (all) {
    brainAlerts.markAllRead();
    res.json({ ok: true, markedAll: true });
  } else if (Array.isArray(alertIds)) {
    brainAlerts.markRead(alertIds);
    res.json({ ok: true, markedCount: alertIds.length });
  } else {
    res.status(400).json({ error: "missing_fields", message: "alertIds array or all: true required" });
  }
});

/**
 * POST /brain/alerts/fire
 * Manually fire a custom alert (for testing or operator use)
 */
router.post("/brain/alerts/fire", (req, res) => {
  const { level, title, message, data } = req.body ?? {};
  if (!level || !title || !message) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  const alert = brainAlerts.custom(level, title, message, data);
  res.json({ ok: true, alert });
});

/**
 * GET /brain/alerts/stream
 * SSE stream for real-time alert notifications
 */
router.get("/brain/alerts/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const unsubscribe = brainAlerts.subscribe((alert) => {
    const data = JSON.stringify(alert);
    res.write(`data: ${data}\n\n`);
  });

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: "connected", ts: Date.now() })}\n\n`);

  req.on("close", () => {
    unsubscribe();
  });
});

// ── Watchdog ──────────────────────────────────────────────────────────────────

/**
 * GET /brain/watchdog/report
 * Full watchdog health report
 */
router.get("/brain/watchdog/report", (_req, res) => {
  res.json({ ok: true, report: brainWatchdog.getReport() });
});

/**
 * POST /brain/watchdog/start
 * Start the watchdog
 */
router.post("/brain/watchdog/start", (_req, res) => {
  brainWatchdog.start();
  res.json({ ok: true, running: brainWatchdog.isRunningStatus() });
});

/**
 * POST /brain/watchdog/stop
 * Stop the watchdog
 */
router.post("/brain/watchdog/stop", (_req, res) => {
  brainWatchdog.stop();
  res.json({ ok: true, running: false });
});

// ── Performance Dashboard ─────────────────────────────────────────────────────

/**
 * GET /brain/performance/:symbol
 * Full performance report for a symbol — equity curve, Sharpe, regime breakdown
 */
router.get("/brain/performance/:symbol", async (req, res) => {
  try {
    const symbol = asRequiredSymbol(req.params.symbol);
    const report = brainPerformance.getReport(symbol);
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ error: "perf_error", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /brain/performance/portfolio/summary
 * Portfolio-level equity curve + per-symbol breakdown
 */
router.get("/brain/performance/portfolio/summary", async (_req, res) => {
  try {
    const report = await brainPerformance.getPortfolioReport();
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ error: "perf_error", message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
