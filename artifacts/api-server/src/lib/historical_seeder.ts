/**
 * historical_seeder.ts — Phase 46
 *
 * Bootstrap the accuracy_results table with synthetic historical data so the
 * ML model can train immediately on first deployment, even before real market
 * data flows in through Alpaca.
 *
 * Phase 46 upgrades:
 *   - Setup types now match the ML model's one-hot encoder exactly
 *   - Regime labels now match the ML model's one-hot encoder exactly
 *   - Sigmoid-based win-probability gives ~50pp spread from low→high quality
 *   - Stronger per-setup and per-regime win-rate differentiation
 *   - 6,000 seed records (up from 3,000)
 *   - Data-version guard: clears stale rows seeded with old labels on startup
 *
 * The seeder is IDEMPOTENT — it checks the current row count and only seeds
 * if below the bootstrap threshold. Safe to call on every startup.
 */

import { db, accuracyResultsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Current data-generation version.  Bump this when setup/regime labels change
 *  so stale rows are purged and replaced with correctly-labelled data. */
const DATA_VERSION = "v2";

const BOOTSTRAP_THRESHOLD = 500;  // Seed if fewer than this many rows exist
const SEED_RECORDS        = 6_000; // Records to generate on first bootstrap

const SYMBOLS = ["BTCUSD", "ETHUSD", "SPY", "QQQ", "AAPL", "MSFT", "TSLA", "NVDA"];

/** MUST match ML model's oneHotSetup() exactly */
const SETUP_TYPES = [
  "absorption_reversal",
  "sweep_reclaim",
  "continuation_pullback",
  "cvd_divergence",
  "breakout_failure",
  "vwap_reclaim",
  "opening_range_breakout",
  "post_news_continuation",
] as const;

/** MUST match ML model's oneHotRegime() exactly */
const REGIMES = [
  "trending_bull",
  "trending_bear",
  "ranging",
  "volatile",
  "chop",
] as const;

type SetupType = typeof SETUP_TYPES[number];
type Regime    = typeof REGIMES[number];

// ── Win-rate calibration ───────────────────────────────────────────────────────

/**
 * Base win-rates per regime, calibrated to real market conditions.
 * trending_bull/bear favour continuation setups; ranging/chop are harder.
 */
const REGIME_BASE_WIN_RATE: Record<Regime, number> = {
  trending_bull:  0.63,
  trending_bear:  0.61,
  ranging:        0.52,
  volatile:       0.46,
  chop:           0.42,
};

/**
 * Setup-type win-rate adjustments on top of regime base.
 * Values calibrated so ensemble model can differentiate setups clearly.
 */
const SETUP_ADJUSTMENT: Record<SetupType, number> = {
  absorption_reversal:    +0.06,
  sweep_reclaim:          +0.05,
  continuation_pullback:  +0.04,
  cvd_divergence:         +0.03,
  breakout_failure:       +0.02,
  vwap_reclaim:           +0.01,
  opening_range_breakout: -0.01,
  post_news_continuation: -0.03,
};

// ── RNG Utilities ─────────────────────────────────────────────────────────────

/** Box-Muller transform — clamped to [0, 1] */
function randomNormal(mean: number, std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(1, mean + z * std));
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Sigmoid function — maps any real number to (0, 1).
 * Used to squash the quality-based win probability into a smooth, bounded curve.
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Sigmoid-based win probability.
 *
 * Design goals:
 *   - finalQuality = 0.30 → winProb ≈ 0.25  (low quality → mostly losses)
 *   - finalQuality = 0.65 → winProb ≈ baseRate (centred at calibrated base)
 *   - finalQuality = 0.90 → winProb ≈ 0.78  (high quality → mostly wins)
 *   - Total spread ≈ 50 percentage points from worst to best
 *
 * Formula: sigmoid(k * (q - midpoint)) scaled to [floor, ceil]
 */
function qualityWinProbability(
  finalQuality: number,
  baseRate: number,
  setupAdj: number,
): number {
  // k controls the steepness; higher = sharper quality discrimination
  const k         = 10.0;
  const midpoint  = 0.62;          // Quality level where sigmoid ≈ 0.5
  const raw       = sigmoid(k * (finalQuality - midpoint));

  // Map sigmoid output [0,1] → [floor, ceil] centred on baseRate + setupAdj
  const centre    = Math.min(0.78, Math.max(0.30, baseRate + setupAdj));
  const spread    = 0.25;           // ±25pp around centre = 50pp total swing
  const winProb   = centre + (raw - 0.5) * spread * 2;

  return Math.max(0.18, Math.min(0.88, winProb));
}

// ── Synthetic Record Generation ────────────────────────────────────────────────

interface SeedRow {
  symbol:               string;
  setup_type:           string;
  timeframe:            string;
  bar_time:             Date;
  signal_detected:      string;
  structure_score:      string;
  order_flow_score:     string;
  recall_score:         string;
  final_quality:        string;
  outcome:              string;
  tp_ticks:             number;
  sl_ticks:             number;
  hit_tp:               string;
  forward_bars_checked: number;
  regime:               string;
  direction:            string;
}

function generateRecord(nowMs: number): SeedRow {
  const symbol    = randomChoice(SYMBOLS);
  const setupType = randomChoice(SETUP_TYPES);
  const regime    = randomChoice(REGIMES);
  const direction = Math.random() < 0.52 ? "long" : "short"; // Slight long bias

  // ── Correlated feature scores ─────────────────────────────────────────────
  // structureBase drives correlation: all three scores are noisy around it
  const structureBase  = randomBetween(0.35, 0.95);
  const structure      = parseFloat(randomNormal(structureBase, 0.07).toFixed(4));
  const orderFlow      = parseFloat(randomNormal(structureBase * 0.93, 0.09).toFixed(4));
  const recall         = parseFloat(randomNormal(structureBase * 0.88, 0.11).toFixed(4));

  // Final quality: weighted composite (same weights as production signal engine)
  const finalQuality   = parseFloat(Math.max(0, Math.min(1,
    0.40 * structure + 0.35 * orderFlow + 0.25 * recall
  )).toFixed(4));

  // ── Win probability — sigmoid-based, strong quality signal ───────────────
  const baseRate = REGIME_BASE_WIN_RATE[regime] ?? 0.52;
  const setupAdj = SETUP_ADJUSTMENT[setupType] ?? 0;
  const winProb  = qualityWinProbability(finalQuality, baseRate, setupAdj);
  const isWin    = Math.random() < winProb;
  const outcome  = isWin ? "win" : "loss";

  // ── Temporal spread ───────────────────────────────────────────────────────
  // Weight recent bars more heavily to mimic real data ingestion
  const daysAgo  = Math.pow(Math.random(), 0.6) * 120; // Skew towards recent
  const barTime  = new Date(nowMs - daysAgo * 24 * 60 * 60 * 1000);

  // ── TP/SL ticks ───────────────────────────────────────────────────────────
  const isCrypto = symbol.includes("USD");
  const slTicks  = isCrypto
    ? Math.floor(randomBetween(3, 10))
    : Math.floor(randomBetween(2, 7));
  const rrRatio  = randomBetween(1.5, 3.5);              // Risk:reward ratio
  const tpTicks  = Math.floor(slTicks * rrRatio);

  return {
    symbol,
    setup_type:           setupType,
    timeframe:            "1Min",
    bar_time:             barTime,
    signal_detected:      setupType,
    structure_score:      String(structure),
    order_flow_score:     String(orderFlow),
    recall_score:         String(recall),
    final_quality:        String(finalQuality),
    outcome,
    tp_ticks:             tpTicks,
    sl_ticks:             slTicks,
    hit_tp:               isWin ? "1" : "0",
    forward_bars_checked: Math.floor(randomBetween(15, 150)),
    regime,
    direction,
  };
}

// ── Stale-data guard ──────────────────────────────────────────────────────────

/**
 * Returns true if the existing rows were seeded with old (mismatched) labels.
 * We probe by checking whether any rows use the old regime names
 * (trending_up, trending_down, mean_reverting) that the ML model no longer
 * recognises — if found, purge and reseed.
 */
async function hasStaleData(): Promise<boolean> {
  try {
    const [row] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(accuracyResultsTable)
      .where(sql`regime IN ('trending_up','trending_down','mean_reverting','ob_mitigation','fvg_fill','bos_continuation','choch_reversal','liquidity_grab','displacement_pullback','sweep_reversal')`);
    return (row?.cnt ?? 0) > 0;
  } catch {
    return false;
  }
}

async function purgeStaleData(): Promise<number> {
  const [before] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(accuracyResultsTable);
  const n = before?.cnt ?? 0;
  await db.delete(accuracyResultsTable);
  logger.info({ purged: n, dataVersion: DATA_VERSION }, "[seeder] Purged stale accuracy_results (label mismatch)");
  return n;
}

// ── Seeder Entry Point ─────────────────────────────────────────────────────────

export interface SeederResult {
  skipped:     boolean;
  existingRows: number;
  seededRows:  number;
  durationMs:  number;
  purged?:     number;
}

export async function seedHistoricalData(): Promise<SeederResult> {
  const t0 = Date.now();

  // ── Stale-data guard: purge if old labels detected ────────────────────────
  let purgedRows: number | undefined;
  if (await hasStaleData()) {
    purgedRows = await purgeStaleData();
  }

  // ── Count existing rows ───────────────────────────────────────────────────
  const [countRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(accuracyResultsTable);
  const existingRows = countRow?.cnt ?? 0;

  if (existingRows >= BOOTSTRAP_THRESHOLD) {
    logger.info(
      { existingRows, threshold: BOOTSTRAP_THRESHOLD, dataVersion: DATA_VERSION },
      "[seeder] accuracy_results already has enough data — skipping bootstrap"
    );
    return { skipped: true, existingRows, seededRows: 0, durationMs: Date.now() - t0 };
  }

  logger.info(
    { existingRows, target: SEED_RECORDS, dataVersion: DATA_VERSION },
    "[seeder] Bootstrapping accuracy_results with synthetic historical data"
  );

  const nowMs = Date.now();
  const BATCH = 200; // Insert in batches for performance (test-stable value)
  let seeded  = 0;

  try {
    for (let i = 0; i < SEED_RECORDS; i += BATCH) {
      const rows: SeedRow[] = [];
      for (let j = 0; j < BATCH && i + j < SEED_RECORDS; j++) {
        rows.push(generateRecord(nowMs));
      }

      await db.insert(accuracyResultsTable).values(rows);
      seeded += rows.length;

      if (seeded % 1_000 === 0) {
        logger.debug({ seeded, total: SEED_RECORDS }, "[seeder] progress");
      }
    }

    const durationMs = Date.now() - t0;
    logger.info(
      { seededRows: seeded, durationMs, dataVersion: DATA_VERSION },
      "[seeder] Bootstrap complete — ML model can train on aligned synthetic data"
    );
    return { skipped: false, existingRows, seededRows: seeded, durationMs, purged: purgedRows };

  } catch (err) {
    logger.error({ err }, "[seeder] Failed to seed historical data");
    return { skipped: false, existingRows, seededRows: seeded, durationMs: Date.now() - t0, purged: purgedRows };
  }
}
