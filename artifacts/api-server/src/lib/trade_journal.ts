/**
 * trade_journal.ts — SI Decision Journal + Outcome Recording
 *
 * Records every SI pipeline decision (blocked or passed) with full context:
 *   - Symbol, setup type, direction, timestamp
 *   - Macro bias snapshot (score, conviction, direction, reasons)
 *   - Sentiment snapshot (score, crowding, institutional edge)
 *   - Gate that blocked (if any) — NoTradeReason
 *   - Entry price, exit price, PnL (filled in after trade closes)
 *   - Quality scores from the pipeline
 *
 * Supports both in-memory operation (always available) and optional DB persistence.
 * In-memory store is capped at MAX_ENTRIES to prevent unbounded growth.
 *
 * Phase 18: provides the data layer for attribution_engine.ts which analyses
 * whether each gate (macro_bias_block, sentiment_crowding_block, etc.) improved
 * or hurt overall performance.
 */

import { logger } from "./logger";
import type { NoTradeReason } from "./strategy_engine";
import type { MacroBiasResult } from "./macro_bias_engine";
import type { SentimentResult } from "./sentiment_engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type JournalDecision = "blocked" | "passed" | "pending";
export type JournalOutcome  = "win" | "loss" | "breakeven" | "unknown";
export type TradeDirection  = "long" | "short";

export interface JournalMacroBiasSnapshot {
  bias:            string;
  direction:       string;
  score:           number;
  conviction:      string;
  tailwind:        boolean;
  headwind:        boolean;
  aligned:         boolean;
  blockedDirections: string[];
}

export interface JournalSentimentSnapshot {
  retailBias:       string;
  institutionalEdge: string;
  sentimentScore:   number;
  crowdingLevel:    string;
  aligned:          boolean;
  contrarian:       boolean;
}

export interface JournalQualityScores {
  structure:   number;
  orderFlow:   number;
  recall:      number;
  ml:          number;
  final:       number;
}

export interface TradeJournalEntry {
  /** Unique entry ID */
  id: string;
  /** Symbol traded or evaluated */
  symbol: string;
  /** Setup type from the pipeline */
  setupType: string;
  /** Intended direction at decision time */
  direction: TradeDirection;
  /** When the signal was evaluated */
  decidedAt: string;
  /** Pipeline decision */
  decision: JournalDecision;
  /** Gate that blocked (if decision === "blocked") */
  blockReason: NoTradeReason;
  /** Macro bias active at decision time */
  macroBias: JournalMacroBiasSnapshot;
  /** Retail sentiment active at decision time */
  sentiment: JournalSentimentSnapshot;
  /** Quality scores at decision time */
  quality: JournalQualityScores;
  /** Price at signal generation */
  signalPrice: number;
  /** Regime label at decision time */
  regime: string;
  /** Trade outcome — filled when trade closes */
  outcome: JournalOutcome;
  /** Entry price (filled when trade opens) */
  entryPrice: number | null;
  /** Exit price (filled when trade closes) */
  exitPrice: number | null;
  /** PnL in percentage terms (exitPrice/entryPrice - 1) */
  pnlPct: number | null;
  /** Absolute PnL in USD (if position size known) */
  pnlUsd: number | null;
  /** When trade was entered */
  enteredAt: string | null;
  /** When trade was closed */
  closedAt: string | null;
  /** Free-form notes */
  notes: string;
}

export interface JournalEntryCreate {
  symbol: string;
  setupType: string;
  direction: TradeDirection;
  decision: JournalDecision;
  blockReason?: NoTradeReason;
  macroBias: MacroBiasResult;
  sentiment: SentimentResult;
  quality?: Partial<JournalQualityScores>;
  signalPrice: number;
  regime?: string;
  notes?: string;
}

export interface JournalOutcomeUpdate {
  entryPrice?: number;
  exitPrice?: number;
  outcome?: JournalOutcome;
  enteredAt?: string;
  closedAt?: string;
  pnlUsd?: number;
  notes?: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const MAX_ENTRIES = 10_000;
const _entries = new Map<string, TradeJournalEntry>();
const _insertOrder: string[] = [];

let _entryCounter = 0;

function generateId(): string {
  _entryCounter++;
  return `jrn_${Date.now()}_${_entryCounter.toString().padStart(4, "0")}`;
}

function snapshotBias(bias: MacroBiasResult): JournalMacroBiasSnapshot {
  return {
    bias:             bias.bias,
    direction:        bias.direction,
    score:            bias.score,
    conviction:       bias.conviction,
    tailwind:         bias.tailwind,
    headwind:         bias.headwind,
    aligned:          bias.aligned,
    blockedDirections: [...bias.blockedDirections],
  };
}

function snapshotSentiment(sent: SentimentResult): JournalSentimentSnapshot {
  return {
    retailBias:       sent.retailBias,
    institutionalEdge: sent.institutionalEdge,
    sentimentScore:   sent.sentimentScore,
    crowdingLevel:    sent.crowdingLevel,
    aligned:          sent.aligned,
    contrarian:       sent.contrarian,
  };
}

function computePnlPct(entry: number, exit: number, dir: TradeDirection): number {
  return dir === "long"
    ? (exit - entry) / entry
    : (entry - exit) / entry;
}

function classifyOutcome(pnlPct: number): JournalOutcome {
  if (pnlPct >  0.001) return "win";
  if (pnlPct < -0.001) return "loss";
  return "breakeven";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a new SI pipeline decision to the journal.
 * Returns the newly created entry.
 */
export function recordDecision(params: JournalEntryCreate): TradeJournalEntry {
  // Evict oldest if at capacity
  if (_entries.size >= MAX_ENTRIES) {
    const oldest = _insertOrder.shift();
    if (oldest) _entries.delete(oldest);
  }

  const id = generateId();
  const entry: TradeJournalEntry = {
    id,
    symbol:      params.symbol,
    setupType:   params.setupType,
    direction:   params.direction,
    decidedAt:   new Date().toISOString(),
    decision:    params.decision,
    blockReason: params.blockReason ?? "none",
    macroBias:   snapshotBias(params.macroBias),
    sentiment:   snapshotSentiment(params.sentiment),
    quality: {
      structure:  params.quality?.structure  ?? 0,
      orderFlow:  params.quality?.orderFlow  ?? 0,
      recall:     params.quality?.recall     ?? 0,
      ml:         params.quality?.ml         ?? 0,
      final:      params.quality?.final      ?? 0,
    },
    signalPrice:  params.signalPrice,
    regime:       params.regime ?? "unknown",
    outcome:      "unknown",
    entryPrice:   null,
    exitPrice:    null,
    pnlPct:       null,
    pnlUsd:       null,
    enteredAt:    null,
    closedAt:     null,
    notes:        params.notes ?? "",
  };

  _entries.set(id, entry);
  _insertOrder.push(id);

  logger.debug(`[journal] Recorded: ${id} ${params.symbol} ${params.decision} (${params.blockReason ?? "none"})`);
  return entry;
}

/**
 * Update a journal entry with trade outcome after position closes.
 */
export function recordOutcome(id: string, update: JournalOutcomeUpdate): TradeJournalEntry | null {
  const entry = _entries.get(id);
  if (!entry) {
    logger.warn(`[journal] recordOutcome: entry ${id} not found`);
    return null;
  }

  if (update.entryPrice !== undefined) entry.entryPrice = update.entryPrice;
  if (update.exitPrice  !== undefined) entry.exitPrice  = update.exitPrice;
  if (update.enteredAt  !== undefined) entry.enteredAt  = update.enteredAt;
  if (update.closedAt   !== undefined) entry.closedAt   = update.closedAt;
  if (update.pnlUsd     !== undefined) entry.pnlUsd     = update.pnlUsd;
  if (update.notes      !== undefined) entry.notes      = update.notes;

  if (entry.entryPrice !== null && entry.exitPrice !== null) {
    entry.pnlPct = computePnlPct(entry.entryPrice, entry.exitPrice, entry.direction);
    entry.outcome = update.outcome ?? classifyOutcome(entry.pnlPct);
  } else if (update.outcome) {
    entry.outcome = update.outcome;
  }

  logger.debug(`[journal] Outcome updated: ${id} → ${entry.outcome} (${entry.pnlPct !== null ? (entry.pnlPct * 100).toFixed(2) + "%" : "pending"})`);
  return entry;
}

/**
 * Get a single entry by ID.
 */
export function getJournalEntry(id: string): TradeJournalEntry | undefined {
  return _entries.get(id);
}

/**
 * List all entries, newest first. Supports optional filters.
 */
export function listJournalEntries(opts: {
  symbol?:   string;
  decision?: JournalDecision;
  outcome?:  JournalOutcome;
  from?:     string;   // ISO date
  to?:       string;   // ISO date
  limit?:    number;
  offset?:   number;
} = {}): TradeJournalEntry[] {
  let results = [..._insertOrder]
    .reverse()
    .map(id => _entries.get(id)!)
    .filter(Boolean);

  if (opts.symbol)   results = results.filter(e => e.symbol === opts.symbol!.toUpperCase());
  if (opts.decision) results = results.filter(e => e.decision === opts.decision);
  if (opts.outcome)  results = results.filter(e => e.outcome  === opts.outcome);
  if (opts.from)     results = results.filter(e => e.decidedAt >= opts.from!);
  if (opts.to)       results = results.filter(e => e.decidedAt <= opts.to!);

  const offset = opts.offset ?? 0;
  // limit: 0 = "no limit" (return all entries); undefined defaults to 100
  const limit  = opts.limit === 0 ? results.length : (opts.limit ?? 100);
  return results.slice(offset, offset + limit);
}

/**
 * Returns journal summary stats.
 */
export function getJournalStats(): {
  total: number;
  blocked: number;
  passed: number;
  resolved: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgPnlPct: number;
} {
  let blocked = 0, passed = 0, resolved = 0, wins = 0, losses = 0, breakeven = 0;
  let totalPnl = 0;

  for (const entry of _entries.values()) {
    if (entry.decision === "blocked") blocked++;
    else                              passed++;

    if (entry.outcome !== "unknown") {
      resolved++;
      if (entry.outcome === "win")       wins++;
      else if (entry.outcome === "loss") losses++;
      else                               breakeven++;
      if (entry.pnlPct !== null)         totalPnl += entry.pnlPct;
    }
  }

  const total = _entries.size;
  return {
    total, blocked, passed, resolved, wins, losses, breakeven,
    winRate:   resolved > 0 ? wins / resolved : 0,
    avgPnlPct: resolved > 0 ? totalPnl / resolved : 0,
  };
}

/**
 * Clear all journal entries (used in tests / manual reset).
 */
export function clearJournal(): void {
  _entries.clear();
  _insertOrder.length = 0;
  logger.info("[journal] Cleared");
}
