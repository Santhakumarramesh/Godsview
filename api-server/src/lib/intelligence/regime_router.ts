/**
 * Phase 101 — Regime-Aware Signal Router
 *
 * Dynamically adjusts MCP pipeline behavior based on detected market regime.
 * Each regime has learned performance profiles that gate which signals
 * pass through and how aggressively they're sized.
 *
 * Regimes: trend_up, trend_down, range, compression, expansion, chaotic
 * Each maps to a RegimeProfile with:
 *   - allowed signal types
 *   - confirmation score adjustments
 *   - risk multiplier
 *   - max concurrent positions
 *   - preferred timeframes
 */

import { EventEmitter } from "events";

// ── Types ──────────────────────────────────────────────────────────────────────

export type BasicRegime =
  | "trend_up"
  | "trend_down"
  | "range"
  | "compression"
  | "expansion"
  | "chaotic";

export type SignalType =
  | "breakout"
  | "breakdown"
  | "reversal_long"
  | "reversal_short"
  | "pullback_long"
  | "pullback_short"
  | "squeeze_fire"
  | "divergence_bull"
  | "divergence_bear"
  | "vwap_reclaim"
  | "order_block_entry"
  | "fvg_fill"
  | "sweep_reclaim"
  | "opening_range_breakout"
  | "custom";

export interface RegimeProfile {
  regime: BasicRegime;
  allowedSignals: SignalType[];
  blockedSignals: SignalType[];
  confirmationBoost: number; // -0.2 to +0.2
  riskMultiplier: number; // 0.25 to 1.5
  maxConcurrentPositions: number; // 1-10
  preferredTimeframes: string[];
  minDataQuality: number; // 0-1, higher in chaotic regimes
  description: string;
}

export interface RouteDecision {
  allowed: boolean;
  adjustedConfirmationScore: number;
  adjustedRiskMultiplier: number;
  blockReason?: string;
  warnings: string[];
}

export interface SignalOutcome {
  regime: BasicRegime;
  signalType: SignalType;
  won: boolean;
  timestamp: number;
}

interface SignalStats {
  regime: BasicRegime;
  signalType: SignalType;
  wins: number;
  losses: number;
  totalTrades: number;
  winRate: number;
  lastUpdated: number;
}

// ── Default Profiles ───────────────────────────────────────────────────────────

const DEFAULT_PROFILES: Map<BasicRegime, RegimeProfile> = new Map([
  [
    "trend_up",
    {
      regime: "trend_up",
      allowedSignals: ["breakout", "pullback_long", "squeeze_fire", "vwap_reclaim"],
      blockedSignals: ["reversal_long", "divergence_bear"],
      confirmationBoost: 0.1,
      riskMultiplier: 1.2,
      maxConcurrentPositions: 5,
      preferredTimeframes: ["1h", "4h", "1d"],
      minDataQuality: 0.7,
      description: "Uptrend — favor momentum breakouts and pullback entries",
    },
  ],
  [
    "trend_down",
    {
      regime: "trend_down",
      allowedSignals: ["breakdown", "pullback_short", "divergence_bear"],
      blockedSignals: ["reversal_short", "breakout"],
      confirmationBoost: 0.08,
      riskMultiplier: 1.0,
      maxConcurrentPositions: 4,
      preferredTimeframes: ["1h", "4h", "1d"],
      minDataQuality: 0.7,
      description: "Downtrend — favor momentum breakdowns and short pullbacks",
    },
  ],
  [
    "range",
    {
      regime: "range",
      allowedSignals: ["reversal_long", "reversal_short", "fvg_fill", "order_block_entry"],
      blockedSignals: ["breakout", "breakdown"],
      confirmationBoost: -0.05,
      riskMultiplier: 0.7,
      maxConcurrentPositions: 3,
      preferredTimeframes: ["5m", "15m", "1h"],
      minDataQuality: 0.6,
      description: "Range-bound — favor reversals at support/resistance, avoid breakouts",
    },
  ],
  [
    "compression",
    {
      regime: "compression",
      allowedSignals: ["squeeze_fire", "opening_range_breakout"],
      blockedSignals: [
        "reversal_long",
        "reversal_short",
        "pullback_long",
        "pullback_short",
        "fvg_fill",
      ],
      confirmationBoost: 0.15,
      riskMultiplier: 0.5,
      maxConcurrentPositions: 2,
      preferredTimeframes: ["1m", "5m", "15m"],
      minDataQuality: 0.8,
      description:
        "Bollinger squeeze — only fire on confirmed volatility expansion breakouts",
    },
  ],
  [
    "expansion",
    {
      regime: "expansion",
      allowedSignals: ["breakout", "breakdown", "sweep_reclaim"],
      blockedSignals: ["reversal_long", "reversal_short"],
      confirmationBoost: 0.12,
      riskMultiplier: 1.5,
      maxConcurrentPositions: 5,
      preferredTimeframes: ["15m", "1h", "4h"],
      minDataQuality: 0.75,
      description: "High volatility expansion — favor trend continuation and reversions",
    },
  ],
  [
    "chaotic",
    {
      regime: "chaotic",
      allowedSignals: [],
      blockedSignals: [
        "breakout",
        "breakdown",
        "reversal_long",
        "reversal_short",
        "pullback_long",
        "pullback_short",
        "squeeze_fire",
        "divergence_bull",
        "divergence_bear",
        "vwap_reclaim",
        "order_block_entry",
        "fvg_fill",
        "sweep_reclaim",
        "opening_range_breakout",
      ],
      confirmationBoost: -0.2,
      riskMultiplier: 0.0,
      maxConcurrentPositions: 0,
      preferredTimeframes: [],
      minDataQuality: 1.0,
      description: "Circuit breaker — no trading in chaotic regimes",
    },
  ],
]);

// ── RegimeRouter Class ─────────────────────────────────────────────────────────

export class RegimeRouter extends EventEmitter {
  private profiles: Map<BasicRegime, RegimeProfile>;
  private signalStats: Map<string, SignalStats>; // key: "${regime}:${signalType}"

  constructor(profiles?: Map<BasicRegime, RegimeProfile>) {
    super();
    this.profiles = profiles ? new Map(profiles) : new Map(DEFAULT_PROFILES);
    this.signalStats = new Map();
    this.initializeStats();
  }

  /**
   * Initialize signal stats from profiles
   */
  private initializeStats(): void {
    for (const profile of this.profiles.values()) {
      for (const signalType of [
        ...profile.allowedSignals,
        ...profile.blockedSignals,
      ]) {
        const key = `${profile.regime}:${signalType}`;
        if (!this.signalStats.has(key)) {
          this.signalStats.set(key, {
            regime: profile.regime,
            signalType,
            wins: 0,
            losses: 0,
            totalTrades: 0,
            winRate: 0.5,
            lastUpdated: Date.now(),
          });
        }
      }
    }
  }

  /**
   * Route a signal through regime-aware filters
   */
  public routeSignal(
    signal: SignalType,
    regime: BasicRegime,
    regimeConfidence: number,
  ): RouteDecision {
    const profile = this.profiles.get(regime);
    if (!profile) {
      return {
        allowed: false,
        adjustedConfirmationScore: 0,
        adjustedRiskMultiplier: 0,
        blockReason: `Unknown regime: ${regime}`,
        warnings: [],
      };
    }

    const warnings: string[] = [];

    // Check if signal is explicitly blocked
    if (profile.blockedSignals.includes(signal)) {
      return {
        allowed: false,
        adjustedConfirmationScore: 0,
        adjustedRiskMultiplier: 0,
        blockReason: `Signal "${signal}" is blocked in ${regime} regime`,
        warnings,
      };
    }

    // Check if signal is allowed (only if not in blockedSignals, optionally check allowedSignals)
    if (profile.allowedSignals.length > 0 && !profile.allowedSignals.includes(signal)) {
      warnings.push(
        `Signal "${signal}" is not in preferred signals for ${regime} regime`,
      );
    }

    // Adjust confirmation score based on regime
    let adjustedConfirmationScore = 0.5; // baseline
    adjustedConfirmationScore += profile.confirmationBoost;

    // Warn if regime confidence is low
    if (regimeConfidence < 0.6) {
      warnings.push(
        `Regime confidence is low (${regimeConfidence.toFixed(2)}) — signal may be unreliable`,
      );
    }

    // Chaotic regime always blocks
    if (regime === "chaotic") {
      return {
        allowed: false,
        adjustedConfirmationScore: 0,
        adjustedRiskMultiplier: 0,
        blockReason: "Trading blocked in chaotic regime",
        warnings: [
          ...warnings,
          "Market conditions are highly chaotic — circuit breaker active",
        ],
      };
    }

    return {
      allowed: true,
      adjustedConfirmationScore: Math.max(0, Math.min(1, adjustedConfirmationScore)),
      adjustedRiskMultiplier: profile.riskMultiplier,
      warnings,
    };
  }

  /**
   * Update a profile with new parameters
   */
  public updateProfile(regime: BasicRegime, updates: Partial<RegimeProfile>): void {
    const existing = this.profiles.get(regime);
    if (!existing) {
      throw new Error(`Regime ${regime} not found`);
    }

    const updated: RegimeProfile = {
      ...existing,
      ...updates,
      regime, // ensure regime doesn't change
    };

    this.profiles.set(regime, updated);
    this.emit("profileUpdated", { regime, profile: updated });
  }

  /**
   * Learn from a trade outcome and adjust profiles
   */
  public learnFromOutcome(outcome: SignalOutcome): void {
    const key = `${outcome.regime}:${outcome.signalType}`;
    const stats = this.signalStats.get(key);

    if (!stats) {
      this.signalStats.set(key, {
        regime: outcome.regime,
        signalType: outcome.signalType,
        wins: outcome.won ? 1 : 0,
        losses: outcome.won ? 0 : 1,
        totalTrades: 1,
        winRate: outcome.won ? 1.0 : 0.0,
        lastUpdated: Date.now(),
      });
      return;
    }

    // Update stats
    stats.wins += outcome.won ? 1 : 0;
    stats.losses += outcome.won ? 0 : 1;
    stats.totalTrades += 1;
    stats.winRate = stats.wins / stats.totalTrades;
    stats.lastUpdated = Date.now();

    // Only adjust profile if we have 20+ samples
    if (stats.totalTrades < 20) {
      return;
    }

    const profile = this.profiles.get(outcome.regime);
    if (!profile) return;

    // If win rate < 30%, add to blockedSignals
    if (stats.winRate < 0.3 && !profile.blockedSignals.includes(outcome.signalType)) {
      profile.blockedSignals.push(outcome.signalType);
      // Remove from allowedSignals if present
      const idx = profile.allowedSignals.indexOf(outcome.signalType);
      if (idx !== -1) {
        profile.allowedSignals.splice(idx, 1);
      }
      this.emit("signalBlocked", {
        regime: outcome.regime,
        signal: outcome.signalType,
        reason: `Low win rate: ${(stats.winRate * 100).toFixed(1)}%`,
      });
    }

    // If win rate > 60%, add to allowedSignals
    if (stats.winRate > 0.6 && !profile.allowedSignals.includes(outcome.signalType)) {
      profile.allowedSignals.push(outcome.signalType);
      // Remove from blockedSignals if present
      const idx = profile.blockedSignals.indexOf(outcome.signalType);
      if (idx !== -1) {
        profile.blockedSignals.splice(idx, 1);
      }
      this.emit("signalPromoted", {
        regime: outcome.regime,
        signal: outcome.signalType,
        reason: `High win rate: ${(stats.winRate * 100).toFixed(1)}%`,
      });
    }

    this.signalStats.set(key, stats);
  }

  /**
   * Get all current profiles
   */
  public getProfiles(): Map<BasicRegime, RegimeProfile> {
    return new Map(this.profiles);
  }

  /**
   * Get profile for a specific regime
   */
  public getProfile(regime: BasicRegime): RegimeProfile | undefined {
    return this.profiles.get(regime);
  }

  /**
   * Get performance stats per regime
   */
  public getRegimeStats(): Map<string, SignalStats> {
    return new Map(this.signalStats);
  }

  /**
   * Get stats for a specific regime
   */
  public getRegimeStatsForRegime(regime: BasicRegime): SignalStats[] {
    return Array.from(this.signalStats.values()).filter((s) => s.regime === regime);
  }

  /**
   * Get stats for a specific signal type across all regimes
   */
  public getSignalTypeStats(signalType: SignalType): SignalStats[] {
    return Array.from(this.signalStats.values()).filter((s) => s.signalType === signalType);
  }

  /**
   * Reset all statistics (useful for backtesting or strategy reset)
   */
  public resetStats(): void {
    for (const stats of this.signalStats.values()) {
      stats.wins = 0;
      stats.losses = 0;
      stats.totalTrades = 0;
      stats.winRate = 0.5;
      stats.lastUpdated = Date.now();
    }
    this.emit("statsReset");
  }

  /**
   * Reset to default profiles and clear stats
   */
  public reset(): void {
    this.profiles.clear();
    for (const [regime, profile] of DEFAULT_PROFILES) {
      this.profiles.set(regime, { ...profile });
    }
    this.resetStats();
    this.emit("routerReset");
  }

  /**
   * Export current state for persistence
   */
  public export(): {
    profiles: Record<BasicRegime, RegimeProfile>;
    stats: Record<string, SignalStats>;
  } {
    const profilesRecord: Record<BasicRegime, RegimeProfile> = {} as Record<
      BasicRegime,
      RegimeProfile
    >;
    for (const [regime, profile] of this.profiles) {
      profilesRecord[regime] = profile;
    }

    const statsRecord: Record<string, SignalStats> = {};
    for (const [key, stats] of this.signalStats) {
      statsRecord[key] = stats;
    }

    return { profiles: profilesRecord, stats: statsRecord };
  }

  /**
   * Import saved state
   */
  public import(data: {
    profiles?: Record<BasicRegime, RegimeProfile>;
    stats?: Record<string, SignalStats>;
  }): void {
    if (data.profiles) {
      this.profiles.clear();
      for (const [regime, profile] of Object.entries(data.profiles)) {
        this.profiles.set(regime as BasicRegime, profile);
      }
    }

    if (data.stats) {
      this.signalStats.clear();
      for (const [key, stats] of Object.entries(data.stats)) {
        this.signalStats.set(key, stats);
      }
    }

    this.emit("routerImported");
  }
}

export default RegimeRouter;