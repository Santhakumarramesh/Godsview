/**
 * Accuracy Bootstrap Seeder v2
 *
 * Generates 1000 synthetic accuracy_results rows so the SI ensemble can
 * train immediately on first boot. Uses standardized regime/setup names
 * that EXACTLY match super_intelligence.ts constants (critical for OHE).
 *
 * Win probability model mirrors the real signal quality heuristic:
 *   - High quality (>0.75) + aligned regime → ~68% win rate
 *   - Medium quality (0.55-0.75) → ~60% win rate
 *   - Low quality (<0.55) → ~50% win rate
 *
 * Tagged signal_detected='SYNTHETIC_BOOTSTRAP_V2' for filtering.
 * Replaced by real outcomes as live paper-trading accumulates.
 */

import { logger } from "./logger";
import { SETUP_TYPES, REGIMES } from "./super_intelligence";

const DIRECTIONS = ["long", "short"] as const;
const TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;
const SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ", "GOOGL", "META", "AMZN", "AMD"];

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Realistic win probability:
 *   - Trending regime + aligned direction gets +8% bonus
 *   - Quality drives 0-20% of win rate above baseline 50%
 *   - Small random noise (±6%) for diversity
 */
function syntheticWinProb(
  structure: number,
  orderFlow: number,
  recall: number,
  quality: number,
  regime: string,
  direction: string,
): number {
  const scoreAvg = (structure * 0.35 + orderFlow * 0.30 + recall * 0.20 + quality * 0.15);

  const regimeBonus =
    (regime === "trending_bull" && direction === "long") ? 0.08
    : (regime === "trending_bear" && direction === "short") ? 0.08
    : regime === "chop" ? -0.10
    : regime === "volatile" ? -0.03
    : regime === "ranging" ? -0.02
    : 0;

  // Base: 50% + up to 20% from quality + regime bonus + noise
  const winProb = clamp(0.50 + scoreAvg * 0.20 + regimeBonus + rand(-0.06, 0.06));
  return winProb;
}

/** Score generator: biased toward high quality for realism */
function genScore(tier: "high" | "medium" | "low"): number {
  if (tier === "high") return clamp(rand(0.72, 0.96) + rand(-0.04, 0.04));
  if (tier === "medium") return clamp(rand(0.52, 0.74) + rand(-0.04, 0.04));
  return clamp(rand(0.25, 0.55) + rand(-0.04, 0.04));
}

export async function seedAccuracyBootstrap(): Promise<{ seeded: number; skipped: boolean }> {
  try {
    const { db, accuracyResultsTable } = await import("@workspace/db");
    const { count: drizzleCount } = await import("drizzle-orm");

    const [{ value }] = await db
      .select({ value: drizzleCount() })
      .from(accuracyResultsTable);
    const existing = Number(value ?? 0);

    if (existing >= 500) {
      logger.info({ existing }, "Seeder skipped — sufficient data already present");
      return { seeded: 0, skipped: true };
    }

    const TARGET = 1000;
    const needed = TARGET - existing;

    logger.info({ existing, needed }, "Seeding synthetic accuracy_results for SI bootstrap v2...");

    const now = new Date();
    const rows = [];

    for (let i = 0; i < needed; i++) {
      // Mix of quality tiers: 40% high, 40% medium, 20% low
      const rng = Math.random();
      const tier = rng < 0.40 ? "high" : rng < 0.80 ? "medium" : "low";

      const structure_score = genScore(tier);
      const order_flow_score = genScore(tier);
      const recall_score = genScore(tier);
      const final_quality = clamp(
        structure_score * 0.35 + order_flow_score * 0.30 +
        recall_score * 0.20 + rand(0, 0.15)
      );

      // Regime distribution: 25% bull, 20% bear, 30% ranging, 15% volatile, 10% chop
      const regimeRng = Math.random();
      const regime =
        regimeRng < 0.25 ? "trending_bull"
        : regimeRng < 0.45 ? "trending_bear"
        : regimeRng < 0.75 ? "ranging"
        : regimeRng < 0.90 ? "volatile"
        : "chop";

      const direction = pick(DIRECTIONS);
      const setup_type = pick(SETUP_TYPES);

      const winProb = syntheticWinProb(
        structure_score, order_flow_score, recall_score, final_quality,
        regime, direction,
      );
      const outcome: "win" | "loss" = Math.random() < winProb ? "win" : "loss";

      // Spread bar_time over last 90 days for realistic time series
      const barTime = new Date(now.getTime() - rand(0.5, 90) * 24 * 60 * 60 * 1000);

      rows.push({
        symbol: pick(SYMBOLS),
        setup_type,
        timeframe: pick(TIMEFRAMES),
        bar_time: barTime,
        signal_detected: "SYNTHETIC_BOOTSTRAP_V2",
        structure_score: structure_score.toFixed(4),
        order_flow_score: order_flow_score.toFixed(4),
        recall_score: recall_score.toFixed(4),
        final_quality: final_quality.toFixed(4),
        outcome,
        tp_ticks: Math.round(rand(10, 80)),
        sl_ticks: Math.round(rand(5, 40)),
        hit_tp: outcome === "win" ? "true" : "false",
        forward_bars_checked: Math.round(rand(5, 30)),
        regime,
        direction,
      });
    }

    // Insert in chunks of 50
    for (let i = 0; i < rows.length; i += 50) {
      await db.insert(accuracyResultsTable).values(rows.slice(i, i + 50));
    }

    const wins = rows.filter(r => r.outcome === "win").length;
    const winRate = (wins / rows.length * 100).toFixed(1);

    logger.info(
      { seeded: rows.length, win_rate: `${winRate}%` },
      "SI accuracy bootstrap seeded — ensemble can now train at full accuracy"
    );

    return { seeded: rows.length, skipped: false };

  } catch (err: any) {
    logger.error({ err }, "accuracy_seeder failed");
    return { seeded: 0, skipped: false };
  }
}
