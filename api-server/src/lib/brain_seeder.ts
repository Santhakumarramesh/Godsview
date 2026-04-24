/**
 * brain_seeder.ts — Phase 37
 *
 * Initializes the Brain knowledge graph on first startup.
 *
 * Creates brain_entities for the default trading watchlist and seeds initial
 * brain_memories with archetype patterns — "institutional memory" for the
 * most common setup types per symbol class.
 *
 * This gives the Recall layer (SI Layer 3) something to work with before any
 * real trades have been executed, and ensures the Brain visualization shows
 * nodes immediately.
 *
 * IDEMPOTENT: Uses ON CONFLICT DO NOTHING / upsert semantics — safe on every
 * startup.
 */

import { db, brainEntitiesTable, brainMemoriesTable, brainRelationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// ── Symbol definitions ────────────────────────────────────────────────────────

interface SymbolDef {
  symbol:      string;
  entity_type: string;
  name:        string;
  sector:      string;
  volatility:  string;  // Drizzle numeric → string insert
}

const DEFAULT_SYMBOLS: SymbolDef[] = [
  // Crypto
  { symbol: "BTCUSD",  entity_type: "crypto", name: "Bitcoin",       sector: "cryptocurrency", volatility: "0.0350" },
  { symbol: "ETHUSD",  entity_type: "crypto", name: "Ethereum",      sector: "cryptocurrency", volatility: "0.0420" },
  // Broad market ETFs
  { symbol: "SPY",     entity_type: "etf",    name: "S&P 500 ETF",   sector: "broad_market",   volatility: "0.0120" },
  { symbol: "QQQ",     entity_type: "etf",    name: "Nasdaq 100 ETF",sector: "broad_market",   volatility: "0.0150" },
  { symbol: "IWM",     entity_type: "etf",    name: "Russell 2000",  sector: "broad_market",   volatility: "0.0180" },
  // Large caps
  { symbol: "AAPL",    entity_type: "stock",  name: "Apple",         sector: "technology",     volatility: "0.0140" },
  { symbol: "MSFT",    entity_type: "stock",  name: "Microsoft",     sector: "technology",     volatility: "0.0130" },
  { symbol: "NVDA",    entity_type: "stock",  name: "Nvidia",        sector: "technology",     volatility: "0.0260" },
  { symbol: "TSLA",    entity_type: "stock",  name: "Tesla",         sector: "consumer",       volatility: "0.0290" },
  { symbol: "AMZN",    entity_type: "stock",  name: "Amazon",        sector: "technology",     volatility: "0.0160" },
  { symbol: "GOOGL",   entity_type: "stock",  name: "Alphabet",      sector: "technology",     volatility: "0.0140" },
  { symbol: "META",    entity_type: "stock",  name: "Meta",          sector: "technology",     volatility: "0.0180" },
];

// ── Initial memory archetypes ─────────────────────────────────────────────────

interface MemoryArchetype {
  memory_type: string;
  title:       string;
  content:     string;
  tags:        string;
  confidence:  string;
}

const CRYPTO_MEMORIES: MemoryArchetype[] = [
  {
    memory_type: "archetype",
    title:       "Sweep + Reversal Pattern",
    content:     "Crypto frequently sweeps local liquidity highs/lows before reversing. " +
                 "A wicked candle into a major OB with high orderflow absorption is a high-probability reversal. " +
                 "Best in ranging-to-trending transitions with rising CVD divergence.",
    tags:        "sweep,reversal,orderflow,crypto",
    confidence:  "0.7500",
  },
  {
    memory_type: "archetype",
    title:       "OB Mitigation Long Bias",
    content:     "Bullish order blocks formed during strong upward displacement are magnets. " +
                 "Price returns to the base of the OB within 2-12 hours in ~65% of cases. " +
                 "Entry on the first wick into the OB zone with sl below the OB base.",
    tags:        "ob,mitigation,crypto,long",
    confidence:  "0.6800",
  },
];

const EQUITY_MEMORIES: MemoryArchetype[] = [
  {
    memory_type: "archetype",
    title:       "Pre-Market Gap Fill",
    content:     "Equities that gap up/down >0.5% on open frequently fill 40-70% of the gap " +
                 "within the first 45 minutes. Works best with matching direction bias from " +
                 "overnight futures and above-average volume at open.",
    tags:        "gap,fill,equity,open",
    confidence:  "0.6200",
  },
  {
    memory_type: "archetype",
    title:       "VWAP Reclaim Pattern",
    content:     "When price is below VWAP with bearish momentum and reclaims it on elevated " +
                 "volume, a long entry on the retest of VWAP as support provides 1:2+ RR. " +
                 "Most reliable in trending_up regime on SPY/QQQ.",
    tags:        "vwap,reclaim,equity,long",
    confidence:  "0.6500",
  },
];

const ETF_MEMORIES: MemoryArchetype[] = [
  {
    memory_type: "archetype",
    title:       "Trend Continuation After Pullback",
    content:     "In trending regime, ETFs commonly pull back 0.3-0.8% to the prior bar's " +
                 "high/VWAP before continuing. Best entries are on the first touch of the " +
                 "pullback level with order flow absorption on 1m chart.",
    tags:        "trend,pullback,etf,continuation",
    confidence:  "0.7000",
  },
];

// ── Correlation relationships ─────────────────────────────────────────────────

interface RelationDef {
  sourceSymbol:   string;
  targetSymbol:   string;
  relation_type:  string;
  strength:       string;
}

const DEFAULT_RELATIONS: RelationDef[] = [
  { sourceSymbol: "SPY",    targetSymbol: "QQQ",   relation_type: "correlated",  strength: "0.9200" },
  { sourceSymbol: "SPY",    targetSymbol: "IWM",   relation_type: "correlated",  strength: "0.8500" },
  { sourceSymbol: "QQQ",    targetSymbol: "NVDA",  relation_type: "leads",       strength: "0.7800" },
  { sourceSymbol: "QQQ",    targetSymbol: "AAPL",  relation_type: "correlated",  strength: "0.8800" },
  { sourceSymbol: "QQQ",    targetSymbol: "MSFT",  relation_type: "correlated",  strength: "0.8600" },
  { sourceSymbol: "QQQ",    targetSymbol: "META",  relation_type: "correlated",  strength: "0.8000" },
  { sourceSymbol: "BTCUSD", targetSymbol: "ETHUSD",relation_type: "leads",       strength: "0.8700" },
  { sourceSymbol: "NVDA",   targetSymbol: "TSLA",  relation_type: "sentiment",   strength: "0.6500" },
];

// ── Seeder ────────────────────────────────────────────────────────────────────

export interface BrainSeederResult {
  skipped:          boolean;
  entitiesInserted: number;
  memoriesInserted: number;
  relationsInserted: number;
  durationMs:       number;
}

export async function seedBrainEntities(): Promise<BrainSeederResult> {
  const t0 = Date.now();

  // Check if already seeded
  const [countRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(brainEntitiesTable);
  const existing = countRow?.cnt ?? 0;

  if (existing >= DEFAULT_SYMBOLS.length) {
    logger.info(
      { existing, required: DEFAULT_SYMBOLS.length },
      "[brain-seeder] brain_entities already seeded — skipping"
    );
    return { skipped: true, entitiesInserted: 0, memoriesInserted: 0, relationsInserted: 0, durationMs: Date.now() - t0 };
  }

  logger.info("[brain-seeder] Seeding brain entities, memories, and relations...");

  let entitiesInserted  = 0;
  let memoriesInserted  = 0;
  let relationsInserted = 0;

  try {
    // ── 1. Insert entities ────────────────────────────────────────────────────
    for (const sym of DEFAULT_SYMBOLS) {
      try {
        await db
          .insert(brainEntitiesTable)
          .values({
            symbol:      sym.symbol,
            entity_type: sym.entity_type,
            name:        sym.name,
            sector:      sym.sector,
            regime:      "unknown",
            volatility:  sym.volatility,
          })
          .onConflictDoNothing();
        entitiesInserted++;
      } catch {
        // onConflictDoNothing should handle this, but catch just in case
      }
    }

    // ── 2. Fetch inserted entity IDs ──────────────────────────────────────────
    const entities = await db.select().from(brainEntitiesTable);
    const entityMap = new Map<string, number>();
    for (const e of entities) {
      entityMap.set(e.symbol, e.id);
    }

    // ── 3. Insert memory archetypes ───────────────────────────────────────────
    for (const sym of DEFAULT_SYMBOLS) {
      const entityId = entityMap.get(sym.symbol);
      if (!entityId) continue;

      let archetypes: MemoryArchetype[];
      if (sym.entity_type === "crypto")       archetypes = CRYPTO_MEMORIES;
      else if (sym.entity_type === "etf")     archetypes = ETF_MEMORIES;
      else                                    archetypes = EQUITY_MEMORIES;

      for (const arch of archetypes) {
        try {
          await db.insert(brainMemoriesTable).values({
            entity_id:   entityId,
            memory_type: arch.memory_type,
            title:       arch.title,
            content:     arch.content,
            tags:        arch.tags,
            confidence:  arch.confidence,
          }).onConflictDoNothing();
          memoriesInserted++;
        } catch {
          // skip duplicates
        }
      }
    }

    // ── 4. Insert correlation relations ───────────────────────────────────────
    for (const rel of DEFAULT_RELATIONS) {
      const srcId = entityMap.get(rel.sourceSymbol);
      const tgtId = entityMap.get(rel.targetSymbol);
      if (!srcId || !tgtId) continue;

      try {
        await db.insert(brainRelationsTable).values({
          source_entity_id: srcId,
          target_entity_id: tgtId,
          relation_type:    rel.relation_type,
          strength:         rel.strength,
          context_json:     JSON.stringify({ seeded: true }),
        }).onConflictDoNothing();
        relationsInserted++;
      } catch {
        // skip duplicates
      }
    }

    const durationMs = Date.now() - t0;
    logger.info(
      { entitiesInserted, memoriesInserted, relationsInserted, durationMs },
      "[brain-seeder] Brain knowledge graph initialized"
    );

    return { skipped: false, entitiesInserted, memoriesInserted, relationsInserted, durationMs };

  } catch (err) {
    logger.error({ err }, "[brain-seeder] Seeding failed");
    return { skipped: false, entitiesInserted, memoriesInserted, relationsInserted, durationMs: Date.now() - t0 };
  }
}
