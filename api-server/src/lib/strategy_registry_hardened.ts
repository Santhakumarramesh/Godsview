/**
 * strategy_registry_hardened.ts — Hardened Strategy Registry with Persistence (Phase 51)
 *
 * Enhanced lifecycle state machine with:
 *   - Durable JSON-file persistence
 *   - Promotion gate enforcement with metrics
 *   - Strategy rollback capability
 *   - Immutable version history
 *   - Approval chain tracking
 *
 * Lifecycle: draft → parsed → backtested → stress_tested → paper_approved
 *            → live_assisted_approved → autonomous_approved → retired
 */

import { logger } from "./logger.js";
import {
  persistWrite,
  persistRead,
  persistAppend,
  persistDelete,
} from "./persistent_store.js";

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

export interface PromotionGate {
  fromState: StrategyState;
  toState: StrategyState;
  requirements: { metric: string; operator: "gte" | "lte" | "eq"; value: number }[];
}

const PROMOTION_GATES: PromotionGate[] = [
  {
    fromState: "draft",
    toState: "parsed",
    requirements: [],
  },
  {
    fromState: "parsed",
    toState: "backtested",
    requirements: [{ metric: "totalTrades", operator: "gte", value: 20 }],
  },
  {
    fromState: "backtested",
    toState: "stress_tested",
    requirements: [
      { metric: "profitFactor", operator: "gte", value: 1.2 },
      { metric: "winRate", operator: "gte", value: 0.5 },
    ],
  },
  {
    fromState: "stress_tested",
    toState: "paper_approved",
    requirements: [
      { metric: "walkForwardPass", operator: "eq", value: 1 },
      { metric: "maxDrawdown", operator: "lte", value: 15 },
    ],
  },
  {
    fromState: "paper_approved",
    toState: "live_assisted_approved",
    requirements: [
      { metric: "paperTrades", operator: "gte", value: 50 },
      { metric: "paperProfitFactor", operator: "gte", value: 1.1 },
    ],
  },
  {
    fromState: "live_assisted_approved",
    toState: "autonomous_approved",
    requirements: [
      { metric: "assistedTrades", operator: "gte", value: 100 },
      { metric: "sharpe", operator: "gte", value: 0.8 },
    ],
  },
];

export interface StrategyVersion {
  version: number;
  parameters: Record<string, unknown>;
  changelog: string;
  createdAt: string;
}

export interface StrategyPerformanceMetrics {
  sharpe: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalTrades: number;
  netPnl: number;
  lastUpdated: string;
  paperTrades?: number;
  paperProfitFactor?: number;
  assistedTrades?: number;
  walkForwardPass?: boolean;
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

export interface StrategyVersionSnapshot {
  versionId: string;
  strategyId: string;
  state: StrategyState;
  metrics: Record<string, number>;
  promotedAt: string;
  approvedBy: string;
  reason: string;
}

export interface PromotionResult {
  success: boolean;
  strategyId: string;
  fromState: StrategyState;
  toState: StrategyState;
  failedGates: string[];
  version?: StrategyVersionSnapshot;
  error?: string;
}

export interface StrategyRegistrySnapshot {
  totalStrategies: number;
  byState: Record<StrategyState, number>;
  recentPromotions: PromotionResult[];
  recentRetirements: { id: string; name: string; at: string }[];
  topPerformers: { id: string; name: string; sharpe: number }[];
}

// ─── Initialization ───────────────────────────────────────────────────────────

let registry: Map<string, StrategyEntry> | null = null;

function loadRegistry(): Map<string, StrategyEntry> {
  if (registry) return registry;

  registry = new Map();
  const persisted = persistRead<StrategyEntry[]>("strategy_registry", []);

  for (const entry of persisted) {
    registry.set(entry.id, entry);
  }

  logger.info({ count: registry.size }, "Loaded strategy registry from persistence");
  return registry;
}

function saveRegistry(): void {
  const entries = Array.from(loadRegistry().values());
  persistWrite("strategy_registry", entries);
  logger.debug({ count: entries.length }, "Saved strategy registry to persistence");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `strat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function checkPromotionGates(
  fromState: StrategyState,
  toState: StrategyState,
  metrics: Record<string, number>
): string[] {
  const gates = PROMOTION_GATES.filter(
    (g) => g.fromState === fromState && g.toState === toState
  );

  const failedGates: string[] = [];

  for (const gate of gates) {
    for (const req of gate.requirements) {
      const metricValue = metrics[req.metric];
      if (metricValue === undefined) {
        failedGates.push(`Missing metric: ${req.metric}`);
        continue;
      }

      let passed = false;
      if (req.operator === "gte") passed = metricValue >= req.value;
      else if (req.operator === "lte") passed = metricValue <= req.value;
      else if (req.operator === "eq") passed = metricValue === req.value;

      if (!passed) {
        failedGates.push(
          `${req.metric} ${req.operator} ${req.value} (actual: ${metricValue})`
        );
      }
    }
  }

  return failedGates;
}

// ─── Core Operations ──────────────────────────────────────────────────────────

export function registerStrategy(params: {
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  parameters?: Record<string, unknown>;
}): StrategyEntry {
  const {
    name,
    description = "",
    author = "system",
    tags = [],
    parameters = {},
  } = params;
  const id = generateId();
  const now = new Date().toISOString();

  const entry: StrategyEntry = {
    id,
    name,
    description,
    author,
    state: "draft",
    tags,
    currentVersion: 1,
    versions: [
      {
        version: 1,
        parameters: { ...parameters },
        changelog: "Initial registration",
        createdAt: now,
      },
    ],
    parameters,
    performance: null,
    createdAt: now,
    updatedAt: now,
    promotedAt: null,
    retiredAt: null,
  };

  const reg = loadRegistry();
  reg.set(id, entry);
  saveRegistry();

  logger.info({ id, name, state: "draft" }, "Strategy registered");
  return entry;
}

export function promoteWithGates(
  strategyId: string,
  targetState: StrategyState,
  metrics: Record<string, number>,
  approvedBy: string,
  reason: string
): PromotionResult {
  const reg = loadRegistry();
  const entry = reg.get(strategyId);

  if (!entry) {
    return {
      success: false,
      strategyId,
      fromState: "draft",
      toState: targetState,
      failedGates: [],
      error: `Strategy ${strategyId} not found`,
    };
  }

  const fromState = entry.state;
  const validNextStates = VALID_TRANSITIONS[fromState];

  if (!validNextStates.includes(targetState)) {
    return {
      success: false,
      strategyId,
      fromState,
      toState: targetState,
      failedGates: [],
      error: `Invalid transition: ${fromState} → ${targetState}`,
    };
  }

  const failedGates = checkPromotionGates(fromState, targetState, metrics);

  if (failedGates.length > 0) {
    logger.warn(
      { strategyId, failedGates, reason },
      "Strategy promotion blocked by gates"
    );
    return {
      success: false,
      strategyId,
      fromState,
      toState: targetState,
      failedGates,
      error: `Promotion gates failed: ${failedGates.join("; ")}`,
    };
  }

  // Promotion approved — create version snapshot
  const versionId = `v${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const versionSnapshot: StrategyVersionSnapshot = {
    versionId,
    strategyId,
    state: targetState,
    metrics,
    promotedAt: now,
    approvedBy,
    reason,
  };

  entry.state = targetState;
  entry.updatedAt = now;
  entry.promotedAt = now;

  if (targetState === "retired") {
    entry.retiredAt = now;
  }

  reg.set(strategyId, entry);
  saveRegistry();

  // Persist version snapshot
  persistAppend("strategy_versions", versionSnapshot);

  logger.info(
    {
      strategyId,
      name: entry.name,
      from: fromState,
      to: targetState,
      approvedBy,
      reason,
    },
    "Strategy promoted with gates"
  );

  const result: PromotionResult = {
    success: true,
    strategyId,
    fromState,
    toState: targetState,
    failedGates: [],
    version: versionSnapshot,
  };

  persistAppend("promotion_history", result);

  return result;
}

export function rollbackStrategy(strategyId: string, reason: string): PromotionResult {
  const reg = loadRegistry();
  const entry = reg.get(strategyId);

  if (!entry) {
    return {
      success: false,
      strategyId,
      fromState: "draft",
      toState: "draft",
      failedGates: [],
      error: `Strategy ${strategyId} not found`,
    };
  }

  const fromState = entry.state;
  const validPreviousStates = Object.entries(VALID_TRANSITIONS)
    .filter(([_, targets]) => targets.includes(fromState))
    .map(([state]) => state as StrategyState);

  if (validPreviousStates.length === 0) {
    return {
      success: false,
      strategyId,
      fromState,
      toState: fromState,
      failedGates: [],
      error: `Cannot rollback from state ${fromState}`,
    };
  }

  // Rollback to first valid previous state
  const toState = validPreviousStates[0]!;
  const now = new Date().toISOString();

  entry.state = toState;
  entry.updatedAt = now;

  reg.set(strategyId, entry);
  saveRegistry();

  logger.warn(
    { strategyId, from: fromState, to: toState, reason },
    "Strategy rolled back"
  );

  const result: PromotionResult = {
    success: true,
    strategyId,
    fromState,
    toState,
    failedGates: [],
  };

  persistAppend("strategy_rollbacks", result);

  return result;
}

export function updateStrategyVersion(
  id: string,
  params: {
    parameters: Record<string, unknown>;
    changelog: string;
  }
): StrategyEntry {
  const reg = loadRegistry();
  const entry = reg.get(id);
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

  reg.set(id, entry);
  saveRegistry();

  logger.info({ id, version: entry.currentVersion }, "Strategy version updated");
  return entry;
}

export function updateStrategyPerformance(
  id: string,
  metrics: StrategyPerformanceMetrics
): StrategyEntry {
  const reg = loadRegistry();
  const entry = reg.get(id);
  if (!entry) throw new Error(`Strategy ${id} not found`);

  entry.performance = { ...metrics };
  entry.updatedAt = new Date().toISOString();

  reg.set(id, entry);
  saveRegistry();

  return entry;
}

export function getStrategy(id: string): StrategyEntry | undefined {
  return loadRegistry().get(id);
}

export function listStrategies(filter?: {
  state?: StrategyState;
  tag?: string;
  author?: string;
}): StrategyEntry[] {
  let results = Array.from(loadRegistry().values());
  if (filter?.state) results = results.filter((s) => s.state === filter.state);
  if (filter?.tag) results = results.filter((s) => s.tags.includes(filter.tag!));
  if (filter?.author) results = results.filter((s) => s.author === filter.author);
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getLiveStrategies(): StrategyEntry[] {
  return Array.from(loadRegistry().values()).filter(
    (s) => s.state === "live_assisted_approved" || s.state === "autonomous_approved"
  );
}

export function getVersionHistory(strategyId: string): StrategyVersionSnapshot[] {
  const versions = persistRead<StrategyVersionSnapshot[]>("strategy_versions", []);
  return versions.filter((v) => v.strategyId === strategyId);
}

export function getPromotionGates(): PromotionGate[] {
  return PROMOTION_GATES;
}

export function getRegistrySnapshot(): StrategyRegistrySnapshot {
  const reg = loadRegistry();
  const byState: Record<string, number> = {};

  for (const state of Object.keys(VALID_TRANSITIONS)) byState[state] = 0;
  for (const entry of reg.values()) byState[entry.state] = (byState[entry.state] ?? 0) + 1;

  const topPerformers = Array.from(reg.values())
    .filter((s) => s.performance && s.state !== "retired")
    .sort((a, b) => (b.performance?.sharpe ?? 0) - (a.performance?.sharpe ?? 0))
    .slice(0, 10)
    .map((s) => ({ id: s.id, name: s.name, sharpe: s.performance!.sharpe }));

  const recentPromotions = persistRead<PromotionResult[]>("promotion_history", []).slice(
    -10
  );
  const recentRetirements = Array.from(reg.values())
    .filter((s) => s.state === "retired" && s.retiredAt)
    .sort((a, b) => (b.retiredAt ?? "").localeCompare(a.retiredAt ?? ""))
    .slice(0, 10)
    .map((s) => ({ id: s.id, name: s.name, at: s.retiredAt! }));

  return {
    totalStrategies: reg.size,
    byState: byState as Record<StrategyState, number>,
    recentPromotions,
    recentRetirements,
    topPerformers,
  };
}

export function resetRegistry(): void {
  const reg = loadRegistry();
  reg.clear();
  persistDelete("strategy_registry");
  persistDelete("strategy_versions");
  persistDelete("promotion_history");
  persistDelete("strategy_rollbacks");
  logger.info("Strategy registry reset (persistence cleared)");
}
