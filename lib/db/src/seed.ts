/**
 * seed.ts — Database Seed Script for GodsView
 *
 * Populates the database with initial data needed for a working system:
 *   - Default strategies
 *   - Sample watchlist symbols
 *   - Risk policy defaults
 *   - Initial brain entities for hologram
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx lib/db/src/seed.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const DEFAULT_STRATEGIES = [
  {
    id: "strat-ob-retest",
    name: "Order Block Retest",
    type: "structure",
    description: "Enters on order block retests after BOS confirmation",
    status: "active",
    tier: "PAPER",
    config: JSON.stringify({
      entryRules: [
        { type: "order_block_retest", confirmationRequired: true },
        { type: "bos_confirmed", direction: "with_trend" },
      ],
      exitRules: [
        { type: "stop_loss", method: "atr_multiple", multiplier: 1.5 },
        { type: "profit_target", rrRatio: 3.0 },
      ],
      positionSizingRules: { type: "volatility_adjusted", maxRiskPct: 1.0 },
      timeframes: ["1h", "15m"],
      symbols: ["SPY", "QQQ", "AAPL", "MSFT"],
    }),
  },
  {
    id: "strat-liq-sweep",
    name: "Liquidity Sweep Reversal",
    type: "liquidity",
    description: "Fades liquidity sweep events with confluence",
    status: "active",
    tier: "LEARNING",
    config: JSON.stringify({
      entryRules: [
        { type: "liquidity_sweep", minWickRatio: 0.6 },
        { type: "order_flow_absorption", threshold: 0.7 },
      ],
      exitRules: [
        { type: "stop_loss", method: "swing_low", buffer: 0.002 },
        { type: "profit_target", rrRatio: 2.5 },
      ],
      positionSizingRules: { type: "fixed_risk", riskPct: 0.5 },
      timeframes: ["5m", "15m"],
      symbols: ["SPY", "QQQ", "ES", "NQ"],
    }),
  },
  {
    id: "strat-trend-continuation",
    name: "Trend Continuation",
    type: "momentum",
    description: "Enters pullbacks within established trends",
    status: "active",
    tier: "PROVEN",
    config: JSON.stringify({
      entryRules: [
        { type: "ema_pullback", fastPeriod: 9, slowPeriod: 21 },
        { type: "premium_discount", zone: "discount" },
      ],
      exitRules: [
        { type: "trailing_stop", method: "atr", multiplier: 2.0 },
        { type: "profit_target", rrRatio: 4.0 },
      ],
      positionSizingRules: { type: "volatility_adjusted", maxRiskPct: 1.5 },
      timeframes: ["1h", "4h"],
      symbols: ["SPY", "QQQ", "AAPL", "TSLA", "NVDA"],
    }),
  },
];

const DEFAULT_WATCHLIST_SYMBOLS = [
  "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL",
  "META", "AMD", "IWM", "DIA", "GLD", "TLT", "VIX",
];

const DEFAULT_BRAIN_ENTITIES = DEFAULT_WATCHLIST_SYMBOLS.slice(0, 10).map(
  (symbol, i) => ({
    symbol,
    entity_type: "symbol",
    volatility: 0.15 + Math.random() * 0.2,
    trend_score: -0.5 + Math.random(),
    state_json: JSON.stringify({
      confidence: 0.3 + Math.random() * 0.5,
      active: true,
      alerts: Math.floor(Math.random() * 3),
      lastUpdate: new Date().toISOString(),
    }),
  }),
);

async function seed(connectionString?: string): Promise<void> {
  const dbUrl = connectionString || process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    console.log("[seed] No DATABASE_URL — cannot seed. Provide DATABASE_URL env var.");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: dbUrl,
    max: 2,
    connectionTimeoutMillis: 10_000,
  });

  const client = await pool.connect();

  try {
    console.log("[seed] Starting database seeding...");

    // ── Strategies ─────────────────────────────────────────────────────
    console.log("[seed] Seeding strategies...");
    for (const strat of DEFAULT_STRATEGIES) {
      await client.query(
        `INSERT INTO strategies (id, name, type, description, status, config, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           config = EXCLUDED.config,
           updated_at = NOW()`,
        [strat.id, strat.name, strat.type, strat.description, strat.status, strat.config],
      );
    }
    console.log(`[seed]   ✓ ${DEFAULT_STRATEGIES.length} strategies seeded`);

    // ── Brain Entities ─────────────────────────────────────────────────
    console.log("[seed] Seeding brain entities...");
    for (const entity of DEFAULT_BRAIN_ENTITIES) {
      await client.query(
        `INSERT INTO brain_entities (symbol, entity_type, volatility, trend_score, state_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [entity.symbol, entity.entity_type, entity.volatility, entity.trend_score, entity.state_json],
      );
    }
    console.log(`[seed]   ✓ ${DEFAULT_BRAIN_ENTITIES.length} brain entities seeded`);

    // ── Risk Policy Defaults ───────────────────────────────────────────
    console.log("[seed] Seeding risk policy defaults...");
    await client.query(
      `INSERT INTO risk_assessments (strategy_id, assessment_type, risk_level, details, created_at)
       VALUES ('system', 'policy_defaults', 'low', $1, NOW())
       ON CONFLICT DO NOTHING`,
      [
        JSON.stringify({
          maxDailyLossPct: 3,
          maxOpenPositions: 8,
          maxExposurePct: 30,
          cooldownMinutes: 10,
          killSwitchDailyLossPct: 5,
          maxCorrelatedPositions: 3,
          maxDrawdownPct: 10,
        }),
      ],
    );
    console.log("[seed]   ✓ Risk policy defaults seeded");

    console.log("[seed] Database seeding complete!");
  } catch (err: any) {
    console.error(`[seed] Seeding failed: ${err.message}`);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

/* Run directly: DATABASE_URL=... npx tsx lib/db/src/seed.ts */
const isMainModule =
  process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");
if (isMainModule) {
  seed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { seed };
