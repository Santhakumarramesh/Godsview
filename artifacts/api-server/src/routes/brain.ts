import { Router, type IRouter } from "express";
import {
  brainEntitiesTable,
  brainMemoriesTable,
  brainRelationsTable,
  db,
} from "@workspace/db";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

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

export default router;
