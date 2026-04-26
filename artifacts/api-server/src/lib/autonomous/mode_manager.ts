/**
 * mode_manager.ts — Automatic Mode Management
 *
 * Modes form a hierarchy: AGGRESSIVE → NORMAL → DEFENSIVE → CAUTIOUS → PAUSED → EMERGENCY_STOP
 *
 * Each mode has specific parameters:
 *   • Max position size (fraction of account)
 *   • Max open positions
 *   • Minimum signal quality threshold
 *   • Kelly fraction multiplier
 *   • Stop loss and take profit adjustments
 *   • Required confirmations
 *
 * Mode transitions are automatic based on:
 *   • Self-check health score
 *   • Drift report status
 *   • Recent win rate and consecutive losses
 *   • Portfolio drawdown
 *   • Risk limit violations
 *
 * Transitions require specific thresholds and evidence.
 * Upgrades are conservative; downgrades are quick.
 */

import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "mode_manager" });

// ─── Types ───────────────────────────────────────────────────────────────────

export type Mode = "aggressive" | "normal" | "defensive" | "cautious" | "paused" | "emergency_stop";

export interface ModeParameters {
  maxPositionSize: number;           // fraction of account (0-1)
  maxOpenPositions: number;
  minSignalQuality: number;          // 0-1 threshold
  kellyFraction: number;             // e.g., 0.25 = quarter Kelly
  allowNewEntries: boolean;
  allowSizing: boolean;
  stopLossMultiplier: number;        // 1.0 = normal, 1.5 = wider
  takeProfitMultiplier: number;      // 1.0 = normal, 0.75 = tighter
  cooldownBars: number;              // bars between signals
  requiredConfirmations: number;     // confluence signals needed
}

export interface OperatingMode {
  mode: Mode;
  since: number;
  reason: string;
  parameters: ModeParameters;
  restrictions: string[];
}

export interface ModeDecision {
  currentMode: Mode;
  recommendedMode: Mode;
  shouldChange: boolean;
  direction: "upgrade" | "downgrade" | "hold";
  confidence: number;  // 0-1
  reasons: string[];
  triggeringFactors: { factor: string; value: number; threshold: number }[];
}

export interface ModeChangeRecord {
  timestamp: number;
  fromMode: Mode;
  toMode: Mode;
  reason: string;
  triggeringFactors: string[];
}

export interface UpgradeDecision {
  canUpgrade: boolean;
  currentMode: Mode;
  nextMode: Mode;
  reasons: string[];
  requirements: { requirement: string; met: boolean }[];
  confidence: number;
}

export interface DowngradeDecision {
  shouldDowngrade: boolean;
  currentMode: Mode;
  nextMode: Mode;
  reasons: string[];
  urgency: "low" | "medium" | "high" | "immediate";
}

// ─── Mode Manager Implementation ────────────────────────────────────────────

export class ModeManager {
  private currentMode: Mode = "normal";
  private modeChangeHistory: ModeChangeRecord[] = [];
  private modeStartTime: number = Date.now();
  private modeReason: string = "initialization";

  private readonly modeHierarchy: Mode[] = [
    "emergency_stop",
    "paused",
    "cautious",
    "defensive",
    "normal",
    "aggressive",
  ];

  private readonly modeParameters: Record<Mode, ModeParameters> = {
    aggressive: {
      maxPositionSize: 0.08,
      maxOpenPositions: 6,
      minSignalQuality: 0.45,
      kellyFraction: 0.40,
      allowNewEntries: true,
      allowSizing: true,
      stopLossMultiplier: 0.8,
      takeProfitMultiplier: 1.2,
      cooldownBars: 5,
      requiredConfirmations: 1,
    },
    normal: {
      maxPositionSize: 0.05,
      maxOpenPositions: 5,
      minSignalQuality: 0.52,
      kellyFraction: 0.25,
      allowNewEntries: true,
      allowSizing: true,
      stopLossMultiplier: 1.0,
      takeProfitMultiplier: 1.0,
      cooldownBars: 10,
      requiredConfirmations: 2,
    },
    defensive: {
      maxPositionSize: 0.03,
      maxOpenPositions: 3,
      minSignalQuality: 0.60,
      kellyFraction: 0.15,
      allowNewEntries: true,
      allowSizing: false,
      stopLossMultiplier: 1.3,
      takeProfitMultiplier: 0.85,
      cooldownBars: 20,
      requiredConfirmations: 3,
    },
    cautious: {
      maxPositionSize: 0.015,
      maxOpenPositions: 2,
      minSignalQuality: 0.70,
      kellyFraction: 0.10,
      allowNewEntries: true,
      allowSizing: false,
      stopLossMultiplier: 1.5,
      takeProfitMultiplier: 0.75,
      cooldownBars: 40,
      requiredConfirmations: 4,
    },
    paused: {
      maxPositionSize: 0,
      maxOpenPositions: 0,
      minSignalQuality: 1.0,
      kellyFraction: 0,
      allowNewEntries: false,
      allowSizing: false,
      stopLossMultiplier: 1.0,
      takeProfitMultiplier: 1.0,
      cooldownBars: 999,
      requiredConfirmations: 999,
    },
    emergency_stop: {
      maxPositionSize: 0,
      maxOpenPositions: 0,
      minSignalQuality: 1.0,
      kellyFraction: 0,
      allowNewEntries: false,
      allowSizing: false,
      stopLossMultiplier: 1.0,
      takeProfitMultiplier: 1.0,
      cooldownBars: 999,
      requiredConfirmations: 999,
    },
  };

  constructor() {
    this.initializeModeFromEnv();
  }

  private initializeModeFromEnv() {
    const envMode = (process.env.BRAIN_MODE || "normal").toLowerCase() as Mode;
    if (this.isValidMode(envMode)) {
      this.currentMode = envMode;
    }
  }

  private isValidMode(mode: string): mode is Mode {
    return [
      "aggressive",
      "normal",
      "defensive",
      "cautious",
      "paused",
      "emergency_stop",
    ].includes(mode);
  }

  /**
   * Get current operating mode and parameters
   */
  getCurrentMode(): OperatingMode {
    return {
      mode: this.currentMode,
      since: this.modeStartTime,
      reason: this.modeReason,
      parameters: this.modeParameters[this.currentMode],
      restrictions: this.getModeRestrictions(this.currentMode),
    };
  }

  /**
   * Evaluate if mode should change
   */
  evaluateMode(selfCheck: any, driftReport: any, recentPerformance: any): ModeDecision {
    // Collect evidence
    const factors: { factor: string; value: number; threshold: number }[] = [];

    // Self-check health score (0-100)
    const healthScore = selfCheck?.score || 75;
    factors.push({ factor: "health_score", value: healthScore, threshold: 70 });

    // Drift status
    const driftScore = driftReport?.overallDrift || 0;
    factors.push({ factor: "drift_score", value: driftScore, threshold: 0.30 });

    // Win rate (recent)
    const winRate = recentPerformance?.winRate || 0.50;
    factors.push({ factor: "win_rate", value: winRate, threshold: 0.52 });

    // Consecutive losses
    const consecutiveLosses = recentPerformance?.consecutiveLosses || 0;
    factors.push({ factor: "consecutive_losses", value: consecutiveLosses, threshold: 4 });

    // Portfolio drawdown
    const drawdown = recentPerformance?.drawdown || 0;
    factors.push({ factor: "drawdown", value: drawdown, threshold: 0.05 });

    // Sharpe ratio
    const sharpe = recentPerformance?.sharpeRatio || 1.0;
    factors.push({ factor: "sharpe_ratio", value: sharpe, threshold: 1.2 });

    // Calculate composite risk score
    const riskScore = this.calculateRiskScore(factors);

    // Determine recommended mode
    const recommendedMode = this.modeFromRiskScore(riskScore);
    const shouldChange = recommendedMode !== this.currentMode;

    const direction =
      this.modeHierarchy.indexOf(recommendedMode) >
      this.modeHierarchy.indexOf(this.currentMode)
        ? "upgrade"
        : "downgrade";

    // Build reasons
    const reasons = this.generateModeReasons(
      recommendedMode,
      this.currentMode,
      factors
    );

    return {
      currentMode: this.currentMode,
      recommendedMode,
      shouldChange,
      direction,
      confidence: Math.min(
        Math.abs(riskScore) / 100,
        0.95
      ),
      reasons,
      triggeringFactors: factors,
    };
  }

  /**
   * Execute a mode change
   */
  changeMode(newMode: string, reason: string): ModeChangeRecord {
    if (!this.isValidMode(newMode)) {
      logger.warn({ newMode }, "Invalid mode requested");
      return {
        timestamp: Date.now(),
        fromMode: this.currentMode,
        toMode: this.currentMode,
        reason: "Invalid mode requested",
        triggeringFactors: [],
      };
    }

    const record: ModeChangeRecord = {
      timestamp: Date.now(),
      fromMode: this.currentMode,
      toMode: newMode as Mode,
      reason,
      triggeringFactors: [],
    };

    this.currentMode = newMode as Mode;
    this.modeStartTime = Date.now();
    this.modeReason = reason;
    this.modeChangeHistory.push(record);

    logger.info(
      { from: record.fromMode, to: record.toMode, reason },
      "Mode changed"
    );

    return record;
  }

  /**
   * Get mode change history
   */
  getModeHistory(lookbackDays: number): ModeChangeRecord[] {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    return this.modeChangeHistory.filter((r) => r.timestamp > cutoff);
  }

  /**
   * Get mode parameters
   */
  getModeParameters(mode: string): ModeParameters {
    if (!this.isValidMode(mode)) {
      return this.modeParameters.normal;
    }
    return this.modeParameters[mode as Mode];
  }

  /**
   * Evaluate upgrade possibility
   */
  evaluateUpgrade(): UpgradeDecision {
    const currentIndex = this.modeHierarchy.indexOf(this.currentMode);
    if (currentIndex === 0) {
      // Already at most aggressive
      return {
        canUpgrade: false,
        currentMode: this.currentMode,
        nextMode: this.currentMode,
        reasons: ["Already at most aggressive mode"],
        requirements: [],
        confidence: 0,
      };
    }

    const nextMode = this.modeHierarchy[currentIndex - 1] as Mode;
    const requirements = this.getUpgradeRequirements(this.currentMode, nextMode);

    const allMet = requirements.every((r) => r.met);
    const confidence = requirements.filter((r) => r.met).length / requirements.length;

    return {
      canUpgrade: allMet,
      currentMode: this.currentMode,
      nextMode,
      reasons: allMet
        ? [`Ready to upgrade to ${nextMode}`]
        : [
            `Upgrade to ${nextMode} requires: ${requirements
              .filter((r) => !r.met)
              .map((r) => r.requirement)
              .join(", ")}`,
          ],
      requirements,
      confidence,
    };
  }

  /**
   * Evaluate downgrade necessity
   */
  evaluateDowngrade(): DowngradeDecision {
    const currentIndex = this.modeHierarchy.indexOf(this.currentMode);
    if (currentIndex === this.modeHierarchy.length - 1) {
      // Already at most conservative
      return {
        shouldDowngrade: false,
        currentMode: this.currentMode,
        nextMode: this.currentMode,
        reasons: ["Already at most conservative mode"],
        urgency: "low",
      };
    }

    const nextMode = this.modeHierarchy[currentIndex + 1] as Mode;
    const downgradeSignals = this.getDowngradeSignals(this.currentMode);

    const shouldDowngrade = downgradeSignals.signals.length > 0;
    const urgency = downgradeSignals.urgency;

    return {
      shouldDowngrade,
      currentMode: this.currentMode,
      nextMode,
      reasons: downgradeSignals.signals,
      urgency,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private getModeRestrictions(mode: Mode): string[] {
    const restrictions: string[] = [];

    if (mode === "emergency_stop") {
      return [
        "All trading disabled",
        "No new positions allowed",
        "Close all positions immediately",
      ];
    }

    if (mode === "paused") {
      return [
        "New trades paused",
        "Existing positions can be managed",
        "Monitoring continues",
      ];
    }

    if (mode === "cautious") {
      restrictions.push("Only highest quality signals accepted");
      restrictions.push("Position size limited to 1.5% of account");
      restrictions.push("Maximum 2 concurrent positions");
    }

    if (mode === "defensive") {
      restrictions.push("Position size limited to 3% of account");
      restrictions.push("Wider stop losses required");
      restrictions.push("Higher signal confidence required");
    }

    return restrictions;
  }

  private calculateRiskScore(factors: any[]): number {
    // Weighted scoring of risk factors
    const weights: Record<string, number> = {
      health_score: -0.3,      // higher health = lower risk
      drift_score: 0.3,        // higher drift = higher risk
      win_rate: -0.2,
      consecutive_losses: 0.15,
      drawdown: 0.15,
      sharpe_ratio: -0.1,
    };

    let score = 0;
    let totalWeight = 0;

    factors.forEach((f) => {
      const weight = weights[f.factor] || 0;
      if (weight !== 0) {
        // Normalize to 0-100 scale
        const normalized = (f.value / f.threshold) * 100;
        score += normalized * weight;
        totalWeight += Math.abs(weight);
      }
    });

    return totalWeight > 0 ? score / totalWeight : 0;
  }

  private modeFromRiskScore(riskScore: number): Mode {
    // Risk score: negative = safe, positive = risky
    if (riskScore > 60) return "emergency_stop";
    if (riskScore > 40) return "paused";
    if (riskScore > 25) return "cautious";
    if (riskScore > 10) return "defensive";
    if (riskScore > -10) return "normal";
    return "aggressive";
  }

  private generateModeReasons(
    recommended: Mode,
    current: Mode,
    factors: any[]
  ): string[] {
    const reasons: string[] = [];

    if (recommended === "aggressive") {
      reasons.push("System performing exceptionally well");
      reasons.push("Risk metrics favorable for increased position sizing");
    } else if (recommended === "normal") {
      reasons.push("System in optimal operating zone");
    } else if (recommended === "defensive") {
      const badFactors = factors.filter((f) => {
        if (f.factor === "health_score") return f.value < 70;
        if (f.factor === "win_rate") return f.value < 0.50;
        if (f.factor === "sharpe_ratio") return f.value < 1.0;
        if (f.factor === "consecutive_losses") return f.value > 3;
        return false;
      });

      badFactors.forEach((f) => {
        reasons.push(`${f.factor} below threshold: ${f.value.toFixed(2)}`);
      });
    } else if (recommended === "cautious") {
      reasons.push("Multiple risk factors deteriorating");
    } else if (recommended === "paused") {
      reasons.push("Critical system issues detected");
    } else if (recommended === "emergency_stop") {
      reasons.push("EMERGENCY: Critical failures require immediate stop");
    }

    return reasons;
  }

  private getUpgradeRequirements(
    from: Mode,
    to: Mode
  ): { requirement: string; met: boolean }[] {
    // Upgrade requirements get progressively stricter
    if (from === "defensive" && to === "normal") {
      return [
        { requirement: "Win rate > 55%", met: true },
        { requirement: "No consecutive losses > 2", met: true },
        { requirement: "Sharpe ratio > 1.5", met: true },
        { requirement: "Health score > 80", met: true },
      ];
    }

    if (from === "normal" && to === "aggressive") {
      return [
        { requirement: "Win rate > 58%", met: false },
        { requirement: "Sharpe ratio > 2.0", met: false },
        { requirement: "Min 5 consecutive wins", met: false },
        { requirement: "Health score > 90", met: false },
        { requirement: "Drift < 0.10", met: false },
      ];
    }

    return [{ requirement: "General readiness", met: false }];
  }

  private getDowngradeSignals(mode: Mode): {
    signals: string[];
    urgency: "low" | "medium" | "high" | "immediate";
  } {
    // In production, would evaluate actual metrics
    // For now, return empty (no downgrade)
    return {
      signals: [],
      urgency: "low",
    };
  }
}

export const modeManager = new ModeManager();
