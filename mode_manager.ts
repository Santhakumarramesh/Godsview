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

import { logger as _logger } from "./logger";

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