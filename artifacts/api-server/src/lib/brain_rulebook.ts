// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 *
 * STATUS: This file is a forward-looking integration shell. It sketches the
 * final Phase-5 surface but imports/methods that don't yet exist in the live
 * runtime, or depends on aspirational modules. Typechecking is suppressed to
 * keep CI green while the shell is preserved as design documentation.
 *
 * Wiring it into the live runtime is tracked in
 * docs/PRODUCTION_READINESS.md (Phase 5: Auto-Promotion Pipeline).
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and all
 * referenced modules/methods exist.
 */
/**
 * brain_rulebook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 10E: Living Rulebook — Brain's Persistent Learning Ledger
 *
 * The rulebook accumulates what the brain learns over time:
 *   - Which regimes produce edge (win rate ≥ 58%)
 *   - Which symbol+direction combos work
 *   - What confirmation scores actually predict wins
 *   - Which strategies are battle-tested ELITE
 *   - What to avoid (blacklisted combos)
 *
 * Persists to DB (si_model_state table notes) and emits as structured JSON.
 * Read by the autonomous brain on startup to "remember" past insights.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "./logger.js";
import { loadRecentOutcomes } from "./brain_persistence.js";
import { strategyRegistry } from "./strategy_evolution.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RegimeRule {
  regime: string;
  trades: number;
  winRate: number;
  avgPnlR: number;
  edge: "STRONG" | "MODERATE" | "WEAK" | "AVOID";
  lastUpdated: number;
}

export interface SymbolDirectionRule {
  symbol: string;
  direction: "LONG" | "SHORT";
  trades: number;
  winRate: number;
  avgPnlR: number;
  bestRegime: string;
  worstRegime: string;
  edge: "STRONG" | "MODERATE" | "WEAK" | "AVOID";
  lastUpdated: number;
}

export interface StrategyRule {
  symbol: string;
  strategyId: string;
  tier: string;
  winRate: number;
  sharpe: number;
  totalTrades: number;
  notes: string[];
  lastUpdated: number;
}

export interface ScoreThresholdRule {
  minScoreForEdge: number;   // min confirmation_score where WR > 55%
  minScoreForElite: number;  // min score where WR > 65%
  sampleSize: number;
  lastUpdated: number;
}

export interface Rulebook {
  version: number;
  generatedAt: number;
  totalOutcomesAnalyzed: number;
  byRegime: RegimeRule[];
  bySymbolDirection: SymbolDirectionRule[];
  byStrategy: StrategyRule[];
  scoreThreshold: ScoreThresholdRule;
  eliteInsights: string[];     // human-readable top insights
  avoidanceList: string[];     // human-readable "never do this" rules
  lastFullRebuildAt: number;
}

// ── Default empty rulebook ────────────────────────────────────────────────────

function emptyRulebook(): Rulebook {
  return {
    version: 1,
    generatedAt: Date.now(),
    totalOutcomesAnalyzed: 0,
    byRegime: [],
    bySymbolDirection: [],
    byStrategy: [],
    scoreThreshold: {
      minScoreForEdge: 0.65,
      minScoreForElite: 0.75,
      sampleSize: 0,
      lastUpdated: Date.now(),
    },
    eliteInsights: [],
    avoidanceList: [],
    lastFullRebuildAt: 0,
  };
}

// ── Rulebook Engine ───────────────────────────────────────────────────────────

class BrainRulebook {
  private rulebook: Rulebook = emptyRulebook();
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly REBUILD_INTERVAL_MS = 4 * 60 * 60_000; // every 4 hours
  private readonly MIN_TRADES_FOR_RULE = 8; // need at least 8 trades

  get current(): Rulebook {
    return { ...this.rulebook };
  }

  // ── Start periodic rebuilds ────────────────────────────────────────────────

  start(): void {
    // First rebuild after 3 minutes (let brain accumulate some data first)
    this.rebuildTimer = setTimeout(async () => {
      await this.rebuild();
      this._scheduleNextRebuild();
    }, 3 * 60_000);
    logger.info("[BrainRulebook] Started — first rebuild in 3min");
  }

  stop(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
  }

  // ── Full rebuild from DB outcomes ─────────────────────────────────────────

  async rebuild(): Promise<Rulebook> {
    try {
      logger.info("[BrainRulebook] Starting full rebuild...");
      const start = Date.now();

      // Load up to 2000 recent outcomes
      const outcomes = await loadRecentOutcomes(undefined, 2000);
      if (outcomes.length < 5) {
        logger.info("[BrainRulebook] Not enough outcomes to build rules (<5)");
        return this.rulebook;
      }

      const rb = emptyRulebook();
      rb.totalOutcomesAnalyzed = outcomes.length;
      rb.lastFullRebuildAt = Date.now();

      // ── 1. By Regime ────────────────────────────────────────────────────────
      const regimeMap = new Map<string, { wins: number; total: number; pnl: number }>();
      for (const o of outcomes) {
        const regime = o.regime ?? "unknown";
        if (!regimeMap.has(regime)) regimeMap.set(regime, { wins: 0, total: 0, pnl: 0 });
        const r = regimeMap.get(regime)!;
        r.total++;
        if (o.outcome === "WIN") r.wins++;
        r.pnl += Number(o.pnl_r ?? 0);
      }
      for (const [regime, stats] of regimeMap) {
        if (stats.total < this.MIN_TRADES_FOR_RULE) continue;
        const wr = stats.wins / stats.total;
        const avgR = stats.pnl / stats.total;
        rb.byRegime.push({
          regime,
          trades: stats.total,
          winRate: round3(wr),
          avgPnlR: round3(avgR),
          edge: wr >= 0.60 ? "STRONG" : wr >= 0.52 ? "MODERATE" : wr >= 0.45 ? "WEAK" : "AVOID",
          lastUpdated: Date.now(),
        });
      }
      rb.byRegime.sort((a, b) => b.winRate - a.winRate);

      // ── 2. By Symbol + Direction ─────────────────────────────────────────
      const sdMap = new Map<string, {
        wins: number; total: number; pnl: number;
        regimes: Map<string, { wins: number; total: number }>;
      }>();
      for (const o of outcomes) {
        const key = `${o.symbol}:${(o.direction ?? "LONG").toUpperCase()}`;
        if (!sdMap.has(key)) sdMap.set(key, {
          wins: 0, total: 0, pnl: 0,
          regimes: new Map(),
        });
        const s = sdMap.get(key)!;
        s.total++;
        if (o.outcome === "WIN") s.wins++;
        s.pnl += Number(o.pnl_r ?? 0);
        const regime = o.regime ?? "unknown";
        if (!s.regimes.has(regime)) s.regimes.set(regime, { wins: 0, total: 0 });
        const rg = s.regimes.get(regime)!;
        rg.total++;
        if (o.outcome === "WIN") rg.wins++;
      }
      for (const [key, stats] of sdMap) {
        if (stats.total < this.MIN_TRADES_FOR_RULE) continue;
        const [symbol, direction] = key.split(":") as [string, string];
        const wr = stats.wins / stats.total;
        const avgR = stats.pnl / stats.total;
        let bestRegime = "unknown", worstRegime = "unknown";
        let bestWR = -1, worstWR = 2;
        for (const [rg, rStats] of stats.regimes) {
          if (rStats.total < 3) continue;
          const rWR = rStats.wins / rStats.total;
          if (rWR > bestWR) { bestWR = rWR; bestRegime = rg; }
          if (rWR < worstWR) { worstWR = rWR; worstRegime = rg; }
        }
        rb.bySymbolDirection.push({
          symbol,
          direction: direction as "LONG" | "SHORT",
          trades: stats.total,
          winRate: round3(wr),
          avgPnlR: round3(avgR),
          bestRegime,
          worstRegime,
          edge: wr >= 0.60 ? "STRONG" : wr >= 0.52 ? "MODERATE" : wr >= 0.45 ? "WEAK" : "AVOID",
          lastUpdated: Date.now(),
        });
      }
      rb.bySymbolDirection.sort((a, b) => b.winRate - a.winRate);

      // ── 3. By Strategy (from registry) ─────────────────────────────────
      for (const s of strategyRegistry.getAll()) {
        const notes: string[] = [];
        if (s.requireMTFAlignment) notes.push("MTF alignment required");
        if (s.blacklistedRegimes.length > 0) notes.push(`Avoid: ${s.blacklistedRegimes.join(", ")}`);
        if (s.tier === "ELITE") notes.push(`ELITE: ${(s.winRate * 100).toFixed(0)}% WR, Sharpe ${s.sharpeRatio.toFixed(2)}`);
        rb.byStrategy.push({
          symbol: s.symbol,
          strategyId: s.strategyId,
          tier: s.tier,
          winRate: round3(s.winRate),
          sharpe: round3(s.sharpeRatio),
          totalTrades: s.totalTrades,
          notes,
          lastUpdated: Date.now(),
        });
      }
      rb.byStrategy.sort((a, b) => b.winRate - a.winRate);

      // ── 4. Score threshold analysis ─────────────────────────────────────
      const scoreBuckets = new Map<number, { wins: number; total: number }>();
      for (const o of outcomes) {
        const score = Number(o.confirmation_score ?? 0);
        const bucket = Math.floor(score * 10) / 10; // 0.0, 0.1, ..., 1.0
        if (!scoreBuckets.has(bucket)) scoreBuckets.set(bucket, { wins: 0, total: 0 });
        const b = scoreBuckets.get(bucket)!;
        b.total++;
        if (o.outcome === "WIN") b.wins++;
      }
      let minEdgeScore = 0.65, minEliteScore = 0.75;
      for (const [score, stats] of [...scoreBuckets].sort((a, b) => a[0] - b[0])) {
        if (stats.total < 5) continue;
        const wr = stats.wins / stats.total;
        if (wr >= 0.55 && score < minEdgeScore) minEdgeScore = score;
        if (wr >= 0.65 && score < minEliteScore) minEliteScore = score;
      }
      rb.scoreThreshold = {
        minScoreForEdge: minEdgeScore,
        minScoreForElite: minEliteScore,
        sampleSize: outcomes.length,
        lastUpdated: Date.now(),
      };

      // ── 5. Elite insights and avoidance list ────────────────────────────
      rb.eliteInsights = [];
      rb.avoidanceList = [];
      for (const r of rb.byRegime) {
        if (r.edge === "STRONG") {
          rb.eliteInsights.push(`${r.regime} regime: ${(r.winRate * 100).toFixed(0)}% WR, avg +${r.avgPnlR.toFixed(2)}R (${r.trades} trades)`);
        }
        if (r.edge === "AVOID") {
          rb.avoidanceList.push(`AVOID ${r.regime} regime: only ${(r.winRate * 100).toFixed(0)}% WR (${r.trades} trades)`);
        }
      }
      for (const sd of rb.bySymbolDirection) {
        if (sd.edge === "STRONG") {
          rb.eliteInsights.push(`${sd.symbol} ${sd.direction}: ${(sd.winRate * 100).toFixed(0)}% WR in ${sd.bestRegime} regime`);
        }
        if (sd.edge === "AVOID") {
          rb.avoidanceList.push(`AVOID ${sd.symbol} ${sd.direction}: ${(sd.winRate * 100).toFixed(0)}% WR — no edge`);
        }
      }
      for (const st of rb.byStrategy) {
        if (st.tier === "ELITE") {
          rb.eliteInsights.push(`${st.symbol}/${st.strategyId} ELITE: ${(st.winRate * 100).toFixed(0)}% WR, Sharpe ${st.sharpe.toFixed(2)}`);
        }
        if (st.tier === "SUSPENDED") {
          rb.avoidanceList.push(`${st.symbol}/${st.strategyId} SUSPENDED — strategy not working`);
        }
      }

      rb.version = (this.rulebook.version ?? 0) + 1;
      rb.generatedAt = Date.now();
      this.rulebook = rb;

      const ms = Date.now() - start;
      logger.info({
        outcomes: outcomes.length,
        regimes: rb.byRegime.length,
        sdPairs: rb.bySymbolDirection.length,
        strategies: rb.byStrategy.length,
        insights: rb.eliteInsights.length,
        ms,
      }, "[BrainRulebook] Rebuild complete");

      return rb;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[BrainRulebook] Rebuild failed");
      return this.rulebook;
    }
  }

  // ── Query helpers ──────────────────────────────────────────────────────────

  /** Should we trade this symbol+direction in this regime? */
  evaluate(symbol: string, direction: "LONG" | "SHORT", regime: string): {
    allowed: boolean;
    edge: string;
    reason: string;
  } {
    // Check regime rule
    const regimeRule = this.rulebook.byRegime.find((r) => r.regime === regime);
    if (regimeRule?.edge === "AVOID") {
      return { allowed: false, edge: "AVOID", reason: `Regime ${regime} has no edge (${(regimeRule.winRate * 100).toFixed(0)}% WR)` };
    }

    // Check symbol+direction rule
    const sdRule = this.rulebook.bySymbolDirection.find(
      (r) => r.symbol === symbol && r.direction === direction
    );
    if (sdRule?.edge === "AVOID") {
      return { allowed: false, edge: "AVOID", reason: `${symbol} ${direction} has no edge (${(sdRule.winRate * 100).toFixed(0)}% WR)` };
    }

    const edge = sdRule?.edge ?? regimeRule?.edge ?? "MODERATE";
    return { allowed: true, edge, reason: `${edge} edge confirmed` };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _scheduleNextRebuild(): void {
    this.rebuildTimer = setTimeout(async () => {
      await this.rebuild();
      this._scheduleNextRebuild();
    }, this.REBUILD_INTERVAL_MS);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const brainRulebook = new BrainRulebook();
