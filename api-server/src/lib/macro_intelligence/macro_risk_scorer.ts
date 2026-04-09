/**
 * Phase 33 — Macro Intelligence: Macro Risk Scorer
 *
 * Computes macro risk scores (0-100) for symbols based on:
 * - Active economic events and their severity
 * - News distortion flags (unexpected headlines, unusual sentiment)
 * - Lockout/cooldown window status
 *
 * Risk formula:
 *   base 10
 *   + event severity weights (low=5, medium=15, high=30, critical=50)
 *   + distortion severity weights (low=10, medium=20, high=40)
 *   + active lockout penalty (+20)
 */

import { randomUUID } from "node:crypto";
import type { EconomicEvent } from "./event_calendar.js";
import { isInLockout, isInCooldown, getEventWindows } from "./event_calendar.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "elevated" | "high" | "extreme";

export interface MacroRiskScore {
  score_id: string;
  symbol: string;
  risk_score: number; // 0-100
  risk_level: RiskLevel;
  active_events: string[]; // event_ids
  lockout_active: boolean;
  cooldown_active: boolean;
  news_distortion_flag: boolean;
  computed_at: string; // ISO 8601 timestamp
}

export interface NewsDistortion {
  distortion_id: string;
  symbol: string;
  source: string;
  headline: string;
  severity: "low" | "medium" | "high";
  created_at: string;
  expires_at: string; // ISO timestamp
}

// ─── State ────────────────────────────────────────────────────────────────

const riskScores = new Map<string, MacroRiskScore>();
const newsDistortions = new Map<string, NewsDistortion>();

// ─── Helpers ──────────────────────────────────────────────────────────────

function getRiskLevel(score: number): RiskLevel {
  if (score < 25) return "low";
  if (score < 50) return "elevated";
  if (score < 75) return "high";
  return "extreme";
}

function getDistortionSeverityWeight(severity: "low" | "medium" | "high"): number {
  const weights: Record<string, number> = {
    low: 10,
    medium: 20,
    high: 40,
  };
  return weights[severity] ?? 0;
}

function getEventSeverityWeight(severity: string): number {
  const weights: Record<string, number> = {
    low: 5,
    medium: 15,
    high: 30,
    critical: 50,
  };
  return weights[severity] ?? 0;
}

function cleanupExpiredDistortions(): void {
  const now = new Date();
  const toDelete: string[] = [];

  for (const [id, distortion] of newsDistortions.entries()) {
    if (new Date(distortion.expires_at) <= now) {
      toDelete.push(id);
    }
  }

  toDelete.forEach((id) => newsDistortions.delete(id));
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Compute macro risk score for a symbol based on active events and distortions.
 * This is called on-demand or cached.
 */
export function computeMacroRisk(
  symbol: string,
  activeEvents: EconomicEvent[]
): {
  success: boolean;
  data?: MacroRiskScore;
  error?: string;
} {
  try {
    cleanupExpiredDistortions();

    let risk_score = 10; // Base
    const active_events: string[] = [];
    const lockout_active = isInLockout(symbol);
    const cooldown_active = isInCooldown(symbol);

    // Add risk from active events affecting this symbol
    for (const event of activeEvents) {
      if (event.symbols_affected.includes(symbol)) {
        active_events.push(event.event_id);
        risk_score += getEventSeverityWeight(event.severity);
      }
    }

    // Add risk from news distortions
    let news_distortion_flag = false;
    for (const distortion of newsDistortions.values()) {
      if (distortion.symbol === symbol) {
        news_distortion_flag = true;
        risk_score += getDistortionSeverityWeight(distortion.severity);
      }
    }

    // Apply lockout penalty
    if (lockout_active) {
      risk_score += 20;
    }

    // Cap at 100
    risk_score = Math.min(risk_score, 100);

    const scoreId = `mrs_${randomUUID()}`;
    const now = new Date().toISOString();

    const result: MacroRiskScore = {
      score_id: scoreId,
      symbol,
      risk_score,
      risk_level: getRiskLevel(risk_score),
      active_events,
      lockout_active,
      cooldown_active,
      news_distortion_flag,
      computed_at: now,
    };

    // Store in cache
    riskScores.set(scoreId, result);

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: `Failed to compute macro risk: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Add a news distortion flag for a symbol with specified duration.
 */
export function addNewsDistortion(
  symbol: string,
  source: string,
  headline: string,
  severity: "low" | "medium" | "high",
  duration_minutes: number
): {
  success: boolean;
  data?: NewsDistortion;
  error?: string;
} {
  try {
    const distortion_id = `nws_${randomUUID()}`;
    const now = new Date();
    const expires_at = new Date(now.getTime() + duration_minutes * 60_000);

    const distortion: NewsDistortion = {
      distortion_id,
      symbol,
      source,
      headline,
      severity,
      created_at: now.toISOString(),
      expires_at: expires_at.toISOString(),
    };

    newsDistortions.set(distortion_id, distortion);
    return { success: true, data: distortion };
  } catch (err) {
    return {
      success: false,
      error: `Failed to add news distortion: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Get active distortions, optionally filtered by symbol.
 */
export function getActiveDistortions(symbol?: string): NewsDistortion[] {
  cleanupExpiredDistortions();

  let result = Array.from(newsDistortions.values());
  if (symbol) {
    result = result.filter((d) => d.symbol === symbol);
  }

  return result;
}

/**
 * Get cached macro risk score by ID.
 */
export function getMacroRiskScore(score_id: string): MacroRiskScore | null {
  return riskScores.get(score_id) ?? null;
}

/**
 * Get all cached risk scores.
 */
export function getAllRiskScores(): MacroRiskScore[] {
  return Array.from(riskScores.values());
}

/**
 * Clear all state (for testing).
 */
export function _clearAll(): void {
  riskScores.clear();
  newsDistortions.clear();
}
