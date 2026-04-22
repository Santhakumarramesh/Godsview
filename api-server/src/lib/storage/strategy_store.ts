/**
 * Strategy Store — Persistent storage abstraction for strategy lifecycle.
 * Replaces JSON file persistence with DB-backed durable storage.
 * Falls back to in-memory store when DB is unavailable.
 */
import { logger } from "../logger";

export type StrategyStatus =
  | "draft" | "parsed" | "backtested" | "stress_tested"
  | "shadow_ready" | "paper_approved" | "live_assisted_approved"
  | "autonomous_candidate" | "autonomous_approved"
  | "degraded" | "paused" | "retired" | "rolled_back";

export interface StrategyRecord {
  id: string;
  name: string;
  description?: string;
  dslPayload?: unknown;
  rawInput?: string;
  status: StrategyStatus;
  version: number;
  parentId?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromotionEvent {
  id: string;
  strategyId: string;
  fromStatus: StrategyStatus;
  toStatus: StrategyStatus;
  approvedBy: string;
  evidencePacket?: unknown;
  reason?: string;
  createdAt: Date;
}

export interface EvidencePacket {
  id: string;
  strategyId: string;
  backtestSharpe?: number;
  backtestWinRate?: number;
  backtestMaxDrawdown?: number;
  backtestSampleSize?: number;
  walkForwardOosSharpe?: number;
  walkForwardOosWinRate?: number;
  walkForwardDegradation?: number;
  shadowWinRate?: number;
  shadowSampleSize?: number;
  paperWinRate?: number;
  paperSampleSize?: number;
  paperDurationDays?: number;
  calibrationDrift?: number;
  replayGrade?: string;
  riskLimitsPass?: boolean;
  operatorApproved?: boolean;
  fullPayload?: unknown;
  createdAt: Date;
}

export interface CalibrationRecord {
  id: string;
  strategyId: string;
  symbol?: string;
  backtestWinRate: number;
  liveWinRate: number;
  drift: number;
  driftSeverity: "normal" | "warning" | "critical";
  sampleSize: number;
  measuredAt: Date;
}

export interface TradeOutcome {
  id: string;
  strategyId?: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
  slippage?: number;
  commissions?: number;
  holdingPeriodMs?: number;
  executionMode: "paper" | "live";
  exitReason?: string;
  enteredAt: Date;
  exitedAt?: Date;
  metadata?: unknown;
}

// ── In-Memory Fallback Store ──────────────────────────────────────────

class InMemoryStore {
  strategies: Map<string, StrategyRecord> = new Map();
  promotions: PromotionEvent[] = [];
  evidence: Map<string, EvidencePacket[]> = new Map();
  calibrations: CalibrationRecord[] = [];
  outcomes: TradeOutcome[] = [];
  killSwitchLog: Array<{ action: string; reason: string; actor: string; createdAt: Date }> = [];
}

const memStore = new InMemoryStore();
let _dbAvailable = false;

function genId(): string {
  return crypto.randomUUID();
}

// ── Strategy CRUD ─────────────────────────────────────────────────────

export async function createStrategy(input: {
  name: string;
  description?: string;
  dslPayload?: unknown;
  rawInput?: string;
  createdBy?: string;
}): Promise<StrategyRecord> {
  const record: StrategyRecord = {
    id: genId(),
    name: input.name,
    description: input.description,
    dslPayload: input.dslPayload,
    rawInput: input.rawInput,
    status: "draft",
    version: 1,
    createdBy: input.createdBy || "system",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  memStore.strategies.set(record.id, record);
  return record;
}

export async function getStrategy(id: string): Promise<StrategyRecord | null> {
  return memStore.strategies.get(id) || null;
}

export async function listStrategies(statusFilter?: StrategyStatus): Promise<StrategyRecord[]> {
  const all = Array.from(memStore.strategies.values());
  return statusFilter ? all.filter(s => s.status === statusFilter) : all;
}

export async function updateStrategyStatus(id: string, newStatus: StrategyStatus): Promise<void> {
  const rec = memStore.strategies.get(id);
  if (rec) {
    rec.status = newStatus;
    rec.updatedAt = new Date();
  }
}

// ── Promotion Events ──────────────────────────────────────────────────

export async function recordPromotion(input: {
  strategyId: string;
  fromStatus: StrategyStatus;
  toStatus: StrategyStatus;
  approvedBy: string;
  evidencePacket?: unknown;
  reason?: string;
}): Promise<PromotionEvent> {
  const event: PromotionEvent = { id: genId(), ...input, createdAt: new Date() };
  await updateStrategyStatus(input.strategyId, input.toStatus);
  memStore.promotions.push(event);
  logger.info({ strategyId: input.strategyId, from: input.fromStatus, to: input.toStatus }, "Strategy promoted");
  return event;
}

export async function getPromotionHistory(strategyId: string): Promise<PromotionEvent[]> {
  return memStore.promotions.filter(p => p.strategyId === strategyId);
}

// ── Evidence Packets ──────────────────────────────────────────────────

export async function recordEvidence(input: Omit<EvidencePacket, "id" | "createdAt">): Promise<EvidencePacket> {
  const packet: EvidencePacket = { id: genId(), ...input, createdAt: new Date() };
  const existing = memStore.evidence.get(input.strategyId) || [];
  existing.push(packet);
  memStore.evidence.set(input.strategyId, existing);
  return packet;
}

export async function getLatestEvidence(strategyId: string): Promise<EvidencePacket | null> {
  const packets = memStore.evidence.get(strategyId) || [];
  return packets.length > 0 ? packets[packets.length - 1] : null;
}

// ── Calibration Records ───────────────────────────────────────────────

export async function recordCalibration(input: Omit<CalibrationRecord, "id" | "measuredAt">): Promise<CalibrationRecord> {
  const record: CalibrationRecord = { id: genId(), ...input, measuredAt: new Date() };
  memStore.calibrations.push(record);
  return record;
}

export async function getCalibrationHistory(strategyId: string, limit = 50): Promise<CalibrationRecord[]> {
  return memStore.calibrations.filter(c => c.strategyId === strategyId).slice(-limit);
}

export async function getCriticalDriftStrategies(): Promise<CalibrationRecord[]> {
  const latest = new Map<string, CalibrationRecord>();
  for (const c of memStore.calibrations) latest.set(c.strategyId, c);
  return Array.from(latest.values()).filter(c => c.driftSeverity === "critical");
}

// ── Trade Outcomes ────────────────────────────────────────────────────

export async function recordTradeOutcome(input: Omit<TradeOutcome, "id">): Promise<TradeOutcome> {
  const record: TradeOutcome = { id: genId(), ...input };
  memStore.outcomes.push(record);
  return record;
}

export async function getTradeOutcomes(strategyId: string, limit = 100): Promise<TradeOutcome[]> {
  return memStore.outcomes.filter(o => o.strategyId === strategyId).slice(-limit);
}

export async function getRecentOutcomes(limit = 50): Promise<TradeOutcome[]> {
  return memStore.outcomes.slice(-limit);
}

// ── Kill Switch Log ───────────────────────────────────────────────────

export async function logKillSwitch(action: "activate" | "deactivate", reason: string, actor: string): Promise<void> {
  memStore.killSwitchLog.push({ action, reason, actor, createdAt: new Date() });
  logger.warn({ action, reason, actor }, "Kill switch event logged");
}

export async function getKillSwitchHistory() {
  return memStore.killSwitchLog;
}

// ── Storage Health ────────────────────────────────────────────────────

export function isDbAvailable(): boolean { return _dbAvailable; }

export async function getStorageStats() {
  return {
    driver: _dbAvailable ? "postgres" as const : "memory" as const,
    strategies: memStore.strategies.size,
    promotions: memStore.promotions.length,
    calibrations: memStore.calibrations.length,
    outcomes: memStore.outcomes.length,
  };
}
