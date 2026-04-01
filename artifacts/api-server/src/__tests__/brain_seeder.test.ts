/**
 * brain_seeder.test.ts — Phase 37 tests
 *
 * Verifies the brain knowledge graph seeder:
 *   1. Skips when entities already exist
 *   2. Seeds correct number of entities
 *   3. Seeds memories for each entity type
 *   4. Seeds correlation relations
 *   5. Returns correct result shape
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state (module-level so mocks close over them) ────────────────────────

const insertedEntities:  Record<string, unknown>[] = [];
const insertedMemories:  Record<string, unknown>[] = [];
const insertedRelations: Record<string, unknown>[] = [];
let mockEntityCount = 0;

// Fake entities returned by the second select (entity fetch)
const fakeEntities: Record<string, unknown>[] = [];

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  // Use sentinel strings for table identity
  const BRAIN_ENTITIES  = "__brainEntities__";
  const BRAIN_MEMORIES  = "__brainMemories__";
  const BRAIN_RELATIONS = "__brainRelations__";

  let selectCalls = 0;

  const makeInsertChain = (target: Record<string, unknown>[]) => ({
    values: (row: Record<string, unknown>) => {
      target.push(row);
      return { onConflictDoNothing: () => Promise.resolve() };
    },
  });

  return {
    db: {
      select: vi.fn(() => {
        selectCalls++;
        return {
          from: (table: unknown) => {
            if (selectCalls === 1) {
              // First call: count check
              return Promise.resolve([{ cnt: mockEntityCount }]);
            }
            // Second call: entity fetch for ID mapping
            return Promise.resolve(fakeEntities);
          },
        };
      }),
      insert: vi.fn((table: unknown) => {
        if (table === BRAIN_ENTITIES)  return makeInsertChain(insertedEntities);
        if (table === BRAIN_MEMORIES)  return makeInsertChain(insertedMemories);
        return makeInsertChain(insertedRelations);
      }),
    },
    brainEntitiesTable:  BRAIN_ENTITIES,
    brainMemoriesTable:  BRAIN_MEMORIES,
    brainRelationsTable: BRAIN_RELATIONS,
  };
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("seedBrainEntities — skip logic", () => {
  beforeEach(() => {
    vi.resetModules();
    mockEntityCount = 12; // Already seeded
    insertedEntities.length = insertedMemories.length = insertedRelations.length = 0;
    fakeEntities.length = 0;
  });

  it("skips when 12+ entities already exist", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    const result = await seedBrainEntities();
    expect(result.skipped).toBe(true);
    expect(result.entitiesInserted).toBe(0);
    expect(insertedEntities.length).toBe(0);
  });

  it("returns zero memoriesInserted when skipping", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    const result = await seedBrainEntities();
    expect(result.memoriesInserted).toBe(0);
    expect(result.relationsInserted).toBe(0);
  });
});

describe("seedBrainEntities — full seed on empty DB", () => {
  beforeEach(() => {
    vi.resetModules();
    mockEntityCount = 0;
    insertedEntities.length = insertedMemories.length = insertedRelations.length = 0;
    fakeEntities.length = 0;
    // Populate fake entity IDs (simulates what DB returns after insert)
    const symbols = ["BTCUSD","ETHUSD","SPY","QQQ","IWM","AAPL","MSFT","NVDA","TSLA","AMZN","GOOGL","META"];
    symbols.forEach((s, i) => fakeEntities.push({ id: i + 1, symbol: s }));
  });

  it("does not throw on empty DB", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    await expect(seedBrainEntities()).resolves.not.toThrow();
  });

  it("result.skipped is false on empty DB", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    const result = await seedBrainEntities();
    expect(result.skipped).toBe(false);
  });

  it("inserts entities for all default symbols", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    await seedBrainEntities();
    expect(insertedEntities.length).toBeGreaterThanOrEqual(10);
  });

  it("each inserted entity has required fields", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    await seedBrainEntities();
    for (const e of insertedEntities) {
      expect(typeof e.symbol).toBe("string");
      expect(typeof e.entity_type).toBe("string");
      expect(typeof e.name).toBe("string");
      expect(["crypto", "etf", "stock"]).toContain(e.entity_type);
    }
  });

  it("seeds memories with valid content for all entities", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    await seedBrainEntities();
    expect(insertedMemories.length).toBeGreaterThan(0);
    for (const m of insertedMemories) {
      expect(typeof m.content).toBe("string");
      expect((m.content as string).length).toBeGreaterThan(10);
      expect(m.memory_type).toBe("archetype");
      expect(typeof m.title).toBe("string");
      expect(typeof m.confidence).toBe("string");
    }
  });

  it("seeds correlation relations between symbols", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    await seedBrainEntities();
    expect(insertedRelations.length).toBeGreaterThan(0);
    for (const r of insertedRelations) {
      expect(typeof r.source_entity_id).toBe("number");
      expect(typeof r.target_entity_id).toBe("number");
      expect(typeof r.relation_type).toBe("string");
      expect(typeof r.strength).toBe("string");
    }
  });

  it("entitiesInserted count matches insertedEntities.length", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    const result = await seedBrainEntities();
    expect(result.entitiesInserted).toBe(insertedEntities.length);
  });

  it("memoriesInserted count matches insertedMemories.length", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    const result = await seedBrainEntities();
    expect(result.memoriesInserted).toBe(insertedMemories.length);
  });
});

describe("seedBrainEntities — result shape and timing", () => {
  beforeEach(() => {
    vi.resetModules();
    mockEntityCount = 0;
    insertedEntities.length = insertedMemories.length = insertedRelations.length = 0;
    fakeEntities.length = 0;
  });

  it("returns BrainSeederResult with all required fields", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    const result = await seedBrainEntities();

    expect(typeof result.skipped).toBe("boolean");
    expect(typeof result.entitiesInserted).toBe("number");
    expect(typeof result.memoriesInserted).toBe("number");
    expect(typeof result.relationsInserted).toBe("number");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("completes within 5 seconds", async () => {
    const { seedBrainEntities } = await import("../lib/brain_seeder");
    const result = await seedBrainEntities();
    expect(result.durationMs).toBeLessThan(5000);
  });
});
