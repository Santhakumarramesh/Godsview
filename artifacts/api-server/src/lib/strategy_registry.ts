/**
 * strategy_registry.ts — Strategy Registry Foundation (Phase 50)
 *
 * Lifecycle state machine for strategies:
 *   draft → parsed → backtested → stress_tested → paper_approved
 *   → live_assisted_approved → autonomous_approved → retired
 *
 * Features:
 *   - Register, version, promote, retire strategies
 *   - State machine with valid transitions
 *   - Metadata: author, description, parameters, tags
 *   - Version history tracking
 *   - Query by state, tag, performance
 */

import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StrategyState =
  | "draft"
  | "parsed"
  | "backtested"
  | "stress_tested"
  | "paper_approved"
  | "live_assisted_approved"
  | "autonomous_approved"
  | "retired";

const VALID_TRANSITIONS: Record<StrategyState, StrategyState[]> = {
  draft: ["parsed"],
  parsed: ["backtested", "draft"],
  backtested: ["stress_tested", "parsed"],
  stress_tested: ["paper_approved", "backtested"],
  paper_approved: ["live_assisted_approved", "stress_tested"],
  live_assisted_approved: ["autonomous_approved", "paper_approved"],
  autonomous_approved: ["retired", "live_assisted_approved"],
  retired: [],
};

export interface StrategyVersion {
  version: number;
  parameters: Record<string, unknown>;
  changelog: string;
  createdAt: string;
}

export interface StrategyEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  state: StrategyState;
  tags: string[];
  currentVersion: number;
  versions: StrategyVersion[];
  parameters: Record<string, unknown>;
  performance: StrategyPerformanceMetrics | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  retiredAt: string | null;
}

export interface StrategyPerformanceMetrics {
  sharpe: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalTrades: number;
  netPnl: number;
  lastUpdated: string;
}

export interface StrategyRegistrySnapshot {
  totalStrategies: number;
  byState: Record<StrategyState, number>;
  recentPromotions: { id: string; name: string; from: StrategyState; to: StrategyState; at: string }[];
  recentRetirements: { id: string; name: string; at: string }[];
  topPerformers: { id: string; name: string; sharpe: number }[];
}

// ─── State ────────────────────────────────────────────────────────────────────

const registry = new Map<string, StrategyEntry>();
const promotionLog: { id: string; name: string; from: StrategyState; to: StrategyState; at: string }[] = [];
const retirementLog: { id: string; name: string; at: string }[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `strat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Core Operations ──────────────────────────────────────────────────────────

export function registerStrategy(params: {
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  parameters?: Record<string, unknown>;
}): StrategyEntry {
  const { name, description = "", author = "system", tags = [], parameters = {} } = params;
  const id = generateId();
  const now = new Date().toISOString();

  const entry: StrategyEntry = {
    id, name, description, author,
    state: "draft",
    tags,
    currentVersion: 1,
    versions: [{
      version: 1,
      parameters: { ...parameters },
      changelog: "Initial registration",
      createdAt: now,
    }],
    parameters,
    performance: null,
    createdAt: now,
    updatedAt: now,
    promotedAt: null,
    retiredAt: null,
  };

  registry.set(id, entry);
  logger.info({ id, name, state: "draft" }, "Strategy registered");
  return entry;
}

export function promoteStrategy(id: string, targetState: StrategyState, reason?: string): StrategyEntry {
  const entry = registry.get(id);
  if (!entry) throw new Error(`Strategy ${id} not found`);

  const validNextStates = VALID_TRANSITIONS[entry.state];
  if (!validNextStates.includes(targetState)) {
    throw new Error(`Invalid transition: ${entry.state} → ${targetState}. Valid: ${validNextStates.join(", ")}`);
  }

  const fromState = entry.state;
  entry.state = targetState;
  entry.updatedAt = new Date().toISOString();
  entry.promotedAt = entry.updatedAt;

  if (targetState === "retired") {
    entry.retiredAt = entry.updatedAt;
    retirementLog.unshift({ id, name: entry.name, at: entry.updatedAt });
  }

  promotionLog.unshift({ id, name: entry.name, from: fromState, to: targetState, at: entry.updatedAt });
  if (promotionLog.length > 100) promotionLog.pop();
  if (retirementLog.length > 50) retirementLog.pop();

  logger.info({ id, name: entry.name, from: fromState, to: targetState, reason }, "Strategy promoted");
  return entry;
}

export function updateStrategyVersion(id: string, params: {
  parameters: Record<string, unknown>;
  changelog: string;
}): StrategyEntry {
  const entry = registry.get(id);
  if (!entry) throw new Error(`Strategy ${id} not found`);

  entry.currentVersion++;
  entry.versions.push({
    version: entry.currentVersion,
    parameters: { ...params.parameters },
    changelog: params.changelog,
    createdAt: new Date().toISOString(),
  });
  entry.parameters = { ...params.parameters };
  entry.updatedAt = new Date().toISOString();

  logger.info({ id, version: entry.currentVersion }, "Strategy version updated");
  return entry;
}

export function updateStrategyPerformance(id: string, metrics: StrategyPerformanceMetrics): StrategyEntry {
  const entry = registry.get(id);
  if (!entry) throw new Error(`Strategy ${id} not found`);
  entry.performance = { ...metrics };
  entry.updatedAt = new Date().toISOString();
  return entry;
}

export function getStrategy(id: string): StrategyEntry | undefined {
  return registry.get(id);
}

export function listStrategies(filter?: {
  state?: StrategyState;
  tag?: string;
  author?: string;
}): StrategyEntry[] {
  let results = Array.from(registry.values());
  if (filter?.state) results = results.filter((s) => s.state === filter.state);
  if (filter?.tag) results = results.filter((s) => s.tags.includes(filter.tag!));
  if (filter?.author) results = results.filter((s) => s.author === filter.author);
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getLiveStrategies(): StrategyEntry[] {
  return Array.from(registry.values()).filter((s) =>
    s.state === "live_assisted_approved" || s.state === "autonomous_approved"
  );
}

export function getRegistrySnapshot(): StrategyRegistrySnapshot {
  const byState: Record<string, number> = {};
  for (const state of Object.keys(VALID_TRANSITIONS)) byState[state] = 0;
  for (const entry of registry.values()) byState[entry.state] = (byState[entry.state] ?? 0) + 1;

  const topPerformers = Array.from(registry.values())
    .filter((s) => s.performance && s.state !== "retired")
    .sort((a, b) => (b.performance?.sharpe ?? 0) - (a.performance?.sharpe ?? 0))
    .slice(0, 10)
    .map((s) => ({ id: s.id, name: s.name, sharpe: s.performance!.sharpe }));

  return {
    totalStrategies: registry.size,
    byState: byState as Record<StrategyState, number>,
    recentPromotions: promotionLog.slice(0, 10),
    recentRetirements: retirementLog.slice(0, 10),
    topPerformers,
  };
}

export function resetRegistry(): void {
  registry.clear();
  promotionLog.length = 0;
  retirementLog.length = 0;
  logger.info("Strategy registry reset");
}
