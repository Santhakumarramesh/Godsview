import { Router, type IRouter } from "express";
import {
  brainEntitiesTable,
  brainMemoriesTable,
  brainRelationsTable,
  db,
} from "@workspace/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getConsciousnessSnapshot, getLatestBrainSnapshot, runBrainCycle } from "../lib/brain_bridge";

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
  // Tables are created by @workspace/db on startup (PGlite auto-create block).
  // This guard is kept for safety in case of external Postgres where migrations
  // haven't run yet — but each statement must be executed separately because
  // PGlite rejects multi-statement prepared statements.
  if (brainTablesReady) return;
  const statements = CREATE_BRAIN_TABLES_SQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
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
    res.status(503).json({ error: "internal_error", message: "Failed to fetch brain entities" });
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
      // Route exists, snapshot file just hasn't been generated yet.
      // Return 200 with has_data:false so the dashboard renders an
      // empty state instead of treating this as a missing endpoint.
      res.json({
        has_data: false,
        connected: false,
        message: "No orchestrator snapshot yet. Run POST /api/brain/update to generate one (requires Python orchestrator).",
        snapshot: null,
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
    res.status(503).json({ error: "internal_error", message: "Failed to fetch brain snapshot" });
  }
});

router.get("/brain/consciousness", async (req, res) => {
  try {
    const force = String(req.query.force ?? "").toLowerCase() === "true";
    const consciousness = await getConsciousnessSnapshot(force);
    if (!consciousness) {
      // Route exists, artifact just not generated. Return 200 + empty state.
      res.json({
        has_data: false,
        connected: false,
        message: "No consciousness snapshot yet. Run POST /api/brain/update first (requires Python orchestrator).",
        consciousness: null,
      });
      return;
    }
    res.json({ has_data: true, ...consciousness });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch consciousness snapshot");
    res.status(503).json({ error: "internal_error", message: "Failed to fetch consciousness snapshot" });
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
    // When the python orchestrator isn't installed (default in dev), runBrainCycle
    // returns ok:false. Surface that as 200 + available:false rather than 500 so
    // dashboard pages can render an empty/disabled state instead of an error.
    res.json({
      ok: result.ok,
      available: result.ok,
      symbol,
      command: result.command.join(" "),
      stdout: result.stdout,
      stderr: result.stderr,
      snapshot_generated_at: String(result.snapshot?.generated_at ?? ""),
      blocked: Boolean(result.snapshot?.blocked ?? false),
      block_reason: String(result.snapshot?.block_reason ?? ""),
      message: result.ok
        ? "Brain cycle completed"
        : "Python orchestrator not available — set GODSVIEW_OPENBB_DIR + PYTHON_BIN and install godsview-openbb to enable.",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run brain update");
    res.json({
      ok: false,
      available: false,
      error: err instanceof Error ? err.message : "Failed to run brain update",
      message: "Brain orchestrator unavailable",
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
    res.json({
      ok: result.ok,
      available: result.ok,
      symbol,
      mode: "evolve",
      command: result.command.join(" "),
      snapshot_generated_at: String(result.snapshot?.generated_at ?? ""),
      blocked: Boolean(result.snapshot?.blocked ?? false),
      block_reason: String(result.snapshot?.block_reason ?? ""),
      consciousness,
      message: result.ok
        ? "Evolve cycle completed"
        : "Python orchestrator not available — install godsview-openbb to enable.",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run brain evolve cycle");
    res.json({
      ok: false,
      available: false,
      error: err instanceof Error ? err.message : "Failed to run brain evolve cycle",
      message: "Brain orchestrator unavailable",
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
    res.status(503).json({ error: "internal_error", message: "Failed to fetch brain memories" });
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
    res.status(503).json({ error: "internal_error", message: "Failed to fetch brain context" });
  }
});

// ─── Market DNA endpoint ───────────────────────────────────────────────────
router.get("/brain/:symbol/dna", async (req, res) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase();
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
    res.status(503).json({ error: "internal_error", message: "Failed to compute Market DNA" });
  }
});

// ─── Setup Memory endpoint ─────────────────────────────────────────────────
router.get("/brain/:symbol/memory", async (req, res) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase();
    const { getSetupMemory } = await import("../lib/setup_memory");
    const memory = await getSetupMemory(symbol);
    res.json(memory);
  } catch (err) {
    req.log.error({ err }, "Failed to compute setup memory");
    res.status(503).json({ error: "internal_error", message: "Failed to compute setup memory" });
  }
});

// ─── Combined intelligence endpoint (DNA + Memory + Context) ───────────────
router.get("/brain/:symbol/intelligence", async (req, res) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase();
    
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
    res.status(503).json({ error: "internal_error", message: "Failed to fetch brain intelligence" });
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
    const symbol = String(req.params.symbol ?? "").toUpperCase();
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
    res.status(503).json({ error: "internal_error", message: "Failed to compute SMC state" });
  }
});

// ─── Regime + Spectral endpoint ────────────────────────────────────────────
router.get("/brain/:symbol/regime", async (req, res) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase();
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
    res.status(503).json({ error: "internal_error", message: "Failed to compute regime state" });
  }
});

// ─── Order Flow endpoint ───────────────────────────────────────────────────
router.get("/brain/:symbol/orderflow", async (req, res) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase();
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
    res.status(503).json({ error: "internal_error", message: "Failed to compute orderflow state" });
  }
});

// ─── Volatility / Stress endpoint ──────────────────────────────────────────
router.get("/brain/:symbol/stress", async (req, res) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase();
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
    res.status(503).json({ error: "internal_error", message: "Failed to compute stress state" });
  }
});

// ─── Full Brain State endpoint (all engines combined) ──────────────────────
router.get("/brain/:symbol/brain-state", async (req, res) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase();
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
    res.status(503).json({ error: "internal_error", message: "Failed to compute brain state" });
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
    return res.status(503).json({ error: "internal_error", message: "Failed to compute global market stress" });
  }
});

// ─── Global Brain State for Hologram UI ──────────────────────────────────────
// Returns aggregated system state (symbols, strategies, agents, connections)
// in the format the brain-hologram.tsx component expects.
// Falls back to live system data when available, safe defaults when not.
router.get("/brain/state", async (req, res) => {
  try {
    // ── Gather live symbol data from brain entities table ──────────────
    let symbolNodes: any[] = [];
    try {
      const entities = await db
        .select()
        .from(brainEntitiesTable)
        .orderBy(desc(brainEntitiesTable.updated_at))
        .limit(20);

      symbolNodes = entities.map((e: any, i: number) => {
        let stateJson: any = {};
        try { stateJson = e.state_json ? JSON.parse(e.state_json) : {}; } catch { /* */ }
        return {
          id: `sym${i + 1}`,
          symbol: e.symbol,
          confidence: stateJson.confidence ?? Math.min(1, Math.max(0, (e.volatility ?? 0.5))),
          active: stateJson.active ?? true,
          alerts: stateJson.alerts ?? 0,
        };
      });
    } catch {
      // DB not available — use watchlist fallback
    }

    // If no DB data, provide default watchlist symbols
    if (symbolNodes.length === 0) {
      const defaultSymbols = ["AAPL", "TSLA", "SPY", "NVDA", "QQQ", "MSFT", "AMZN"];
      symbolNodes = defaultSymbols.map((sym, i) => ({
        id: `sym${i + 1}`,
        symbol: sym,
        confidence: 0.5 + Math.random() * 0.4,
        active: i < 4,
        alerts: 0,
      }));
    }

    // ── Gather strategies from strategy registry or defaults ───────────
    let strategyNodes: any[] = [];
    try {
      const { listStrategies } = await import("../lib/strategy_registry");
      const strategies = listStrategies?.() ?? [];
      strategyNodes = strategies.slice(0, 8).map((s: any, i: number) => ({
        id: `strat${i + 1}`,
        name: s.name || s.id || `Strategy-${i + 1}`,
        strength: s.performance?.winRate ?? s.strength ?? 0.5 + Math.random() * 0.4,
      }));
    } catch { /* */ }

    if (strategyNodes.length === 0) {
      strategyNodes = [
        { id: "strat1", name: "Momentum", strength: 0.82 },
        { id: "strat2", name: "Mean-Reversion", strength: 0.65 },
        { id: "strat3", name: "OB-Retest", strength: 0.78 },
        { id: "strat4", name: "Structure-Break", strength: 0.71 },
      ];
    }

    // ── Agent nodes (reflect actual system services) ──────────────────
    const agentNodes = [
      { id: "agent1", name: "Scanner", status: "active" as const },
      { id: "agent2", name: "Structure", status: "active" as const },
      { id: "agent3", name: "OrderFlow", status: "active" as const },
      { id: "agent4", name: "Execution", status: "active" as const },
      { id: "agent5", name: "Risk", status: "active" as const },
      { id: "agent6", name: "Memory", status: "active" as const },
    ];

    // Try to get pipeline status for agent liveness
    try {
      const { getPipelineStatus } = await import("../lib/bootstrap");
      const status = getPipelineStatus();
      if (status && !status.initialized) {
        agentNodes.forEach((a) => (a.status = "idle" as any));
      }
    } catch { /* */ }

    // ── Build connections (scanner→strategies→symbols, agents→symbols) ─
    const connections: any[] = [];
    // Scanner feeds all strategies
    strategyNodes.forEach((s) => {
      connections.push({ from: "agent1", to: s.id, strength: 0.7 + Math.random() * 0.25 });
    });
    // Strategies connect to top symbols
    strategyNodes.forEach((s, si) => {
      const targetSym = symbolNodes[si % symbolNodes.length];
      if (targetSym) {
        connections.push({ from: s.id, to: targetSym.id, strength: s.strength });
      }
    });
    // Execution + Risk agents connect to active symbols
    symbolNodes.filter((s) => s.active).forEach((sym) => {
      connections.push({ from: "agent4", to: sym.id, strength: 0.85 });
      connections.push({ from: "agent5", to: sym.id, strength: 0.9 });
    });

    res.json({
      symbols: symbolNodes,
      strategies: strategyNodes,
      agents: agentNodes,
      connections,
      timestamp: Date.now(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute global brain state");
    res.status(503).json({
      error: "internal_error",
      message: "Failed to compute global brain state",
    });
  }
});

export default router;
