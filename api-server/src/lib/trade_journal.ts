/**
 * Phase 57 — Trade Journal + Replay Engine
 * Records every trade with full context, enables replay & analytics.
 */

import { persistWrite, persistRead, persistAppend } from "./persistent_store";
import { logger } from "./logger";

export interface JournalEntry {
  id: string;
  tradeId: string;
  symbol: string;
  direction: "long" | "short";
  strategyId: string;
  strategyName: string;
  entryPrice: number;
  entryTime: string;
  entryReason: string;
  positionSize: number;
  riskPct: number;
  exitPrice?: number;
  exitTime?: string;
  exitReason?: string;
  pnl?: number;
  pnlPct?: number;
  holdDurationMs?: number;
  maxDrawdownPct?: number;
  maxRunupPct?: number;
  regimeAtEntry?: string;
  regimeAtExit?: string;
  tags: string[];
  notes: string;
  qualityScore?: number;
  status: "open" | "closed";
}

export interface ReplayStep {
  timestamp: string;
  action: "entry" | "exit" | "stop_move" | "partial_exit" | "note";
  price: number;
  detail: string;
}

export interface ReplayResult {
  entryId: string;
  steps: ReplayStep[];
  summary: string;
  lessonsLearned: string[];
}

export interface JournalAnalytics {
  totalTrades: number;
  winRate: number;
  avgPnlPct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  largestWinPct: number;
  largestLossPct: number;
  avgHoldDurationMs: number;
  bestStrategy: string;
  worstStrategy: string;
  byStrategy: Record<string, { trades: number; winRate: number; avgPnl: number }>;
}

export interface TradeJournalSnapshot {
  totalEntries: number;
  openTrades: number;
  closedTrades: number;
  winRate: number;
  totalPnl: number;
  replaysGenerated: number;
}

/* ── state ── */
const journal: JournalEntry[] = [];
let replayCount = 0;
let nextId = 1;

function genId(): string {
  return `tj_${nextId++}_${Date.now()}`;
}

/* ── core operations ── */

export function recordEntry(params: {
  tradeId: string;
  symbol: string;
  direction: "long" | "short";
  strategyId: string;
  strategyName: string;
  entryPrice: number;
  entryReason: string;
  positionSize: number;
  riskPct: number;
  regimeAtEntry?: string;
  tags?: string[];
  notes?: string;
}): JournalEntry {
  const entry: JournalEntry = {
    id: genId(),
    tradeId: params.tradeId,
    symbol: params.symbol,
    direction: params.direction,
    strategyId: params.strategyId,
    strategyName: params.strategyName,
    entryPrice: params.entryPrice,
    entryTime: new Date().toISOString(),
    entryReason: params.entryReason,
    positionSize: params.positionSize,
    riskPct: params.riskPct,
    regimeAtEntry: params.regimeAtEntry,
    tags: params.tags ?? [],
    notes: params.notes ?? "",
    status: "open",
  };
  journal.push(entry);

  // Persist journal entry
  try {
    persistAppend("journal_entries", entry, 5000);
  } catch (err) {
    logger.warn({ err, tradeId: params.tradeId }, "Failed to persist journal entry");
  }

  return entry;
}

export function recordExit(params: {
  tradeId: string;
  exitPrice: number;
  exitReason: string;
  regimeAtExit?: string;
  maxDrawdownPct?: number;
  maxRunupPct?: number;
  qualityScore?: number;
}): JournalEntry {
  const entry = journal.find(
    (e) => e.tradeId === params.tradeId && e.status === "open"
  );
  if (!entry) throw new Error(`Open trade ${params.tradeId} not found`);

  entry.exitPrice = params.exitPrice;
  entry.exitTime = new Date().toISOString();
  entry.exitReason = params.exitReason;
  entry.regimeAtExit = params.regimeAtExit;
  entry.maxDrawdownPct = params.maxDrawdownPct;
  entry.maxRunupPct = params.maxRunupPct;
  entry.qualityScore = params.qualityScore;
  entry.status = "closed";

  const dir = entry.direction === "long" ? 1 : -1;
  entry.pnl =
    (params.exitPrice - entry.entryPrice) * dir * entry.positionSize;
  entry.pnlPct =
    ((params.exitPrice - entry.entryPrice) / entry.entryPrice) * dir * 100;
  entry.holdDurationMs =
    new Date(entry.exitTime!).getTime() -
    new Date(entry.entryTime).getTime();

  return entry;
}

export function getJournal(filters?: {
  symbol?: string;
  strategyId?: string;
  status?: "open" | "closed";
  tag?: string;
}): JournalEntry[] {
  let results = [...journal];
  if (filters?.symbol)
    results = results.filter((e) => e.symbol === filters.symbol);
  if (filters?.strategyId)
    results = results.filter((e) => e.strategyId === filters.strategyId);
  if (filters?.status)
    results = results.filter((e) => e.status === filters.status);
  if (filters?.tag)
    results = results.filter((e) => e.tags.includes(filters.tag!));
  return results;
}

export function replayTrade(tradeId: string): ReplayResult {
  const entry = journal.find((e) => e.tradeId === tradeId);
  if (!entry) throw new Error(`Trade ${tradeId} not found`);

  const steps: ReplayStep[] = [];
  steps.push({
    timestamp: entry.entryTime,
    action: "entry",
    price: entry.entryPrice,
    detail: `${entry.direction.toUpperCase()} entry — ${entry.entryReason}`,
  });

  if (entry.exitPrice && entry.exitTime) {
    steps.push({
      timestamp: entry.exitTime,
      action: "exit",
      price: entry.exitPrice,
      detail: `Exit — ${entry.exitReason ?? "unknown"}`,
    });
  }

  const lessons: string[] = [];
  if (entry.status === "closed") {
    const win = (entry.pnl ?? 0) > 0;
    if (win) {
      lessons.push(`Winning trade on ${entry.symbol} (+${entry.pnlPct?.toFixed(2)}%)`);
      if ((entry.maxRunupPct ?? 0) > (entry.pnlPct ?? 0) * 1.5) {
        lessons.push("Significant runup before exit — consider trailing stop");
      }
    } else {
      lessons.push(`Losing trade on ${entry.symbol} (${entry.pnlPct?.toFixed(2)}%)`);
      if ((entry.maxDrawdownPct ?? 0) > (entry.riskPct ?? 1) * 2) {
        lessons.push("Drawdown exceeded 2x risk — review stop placement");
      }
    }
  }

  replayCount++;
  return {
    entryId: entry.id,
    steps,
    summary: `Replay of ${entry.direction} ${entry.symbol} via ${entry.strategyName}`,
    lessonsLearned: lessons,
  };
}

export function getJournalAnalytics(): JournalAnalytics {
  const closed = journal.filter((e) => e.status === "closed");
  const wins = closed.filter((e) => (e.pnl ?? 0) > 0);
  const losses = closed.filter((e) => (e.pnl ?? 0) <= 0);
  const totalPnl = closed.reduce((s, e) => s + (e.pnlPct ?? 0), 0);
  const grossWin = wins.reduce((s, e) => s + (e.pnlPct ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, e) => s + (e.pnlPct ?? 0), 0));

  const byStrategy: Record<string, { trades: number; winRate: number; avgPnl: number }> = {};
  for (const e of closed) {
    const key = e.strategyName;
    if (!byStrategy[key]) byStrategy[key] = { trades: 0, winRate: 0, avgPnl: 0 };
    byStrategy[key].trades++;
  }
  for (const key of Object.keys(byStrategy)) {
    const strats = closed.filter((e) => e.strategyName === key);
    const stratWins = strats.filter((e) => (e.pnl ?? 0) > 0);
    byStrategy[key].winRate = strats.length ? stratWins.length / strats.length : 0;
    byStrategy[key].avgPnl = strats.length
      ? strats.reduce((s, e) => s + (e.pnlPct ?? 0), 0) / strats.length
      : 0;
  }

  const stratEntries = Object.entries(byStrategy);
  const best = stratEntries.sort((a, b) => b[1].avgPnl - a[1].avgPnl)[0];
  const worst = stratEntries.sort((a, b) => a[1].avgPnl - b[1].avgPnl)[0];

  return {
    totalTrades: closed.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    avgPnlPct: closed.length ? totalPnl / closed.length : 0,
    avgWinPct: wins.length ? grossWin / wins.length : 0,
    avgLossPct: losses.length ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    largestWinPct: wins.length ? Math.max(...wins.map((e) => e.pnlPct ?? 0)) : 0,
    largestLossPct: losses.length ? Math.min(...losses.map((e) => e.pnlPct ?? 0)) : 0,
    avgHoldDurationMs: closed.length
      ? closed.reduce((s, e) => s + (e.holdDurationMs ?? 0), 0) / closed.length
      : 0,
    bestStrategy: best ? best[0] : "N/A",
    worstStrategy: worst ? worst[0] : "N/A",
    byStrategy,
  };
}

export function getTradeJournalSnapshot(): TradeJournalSnapshot {
  const closed = journal.filter((e) => e.status === "closed");
  const wins = closed.filter((e) => (e.pnl ?? 0) > 0);
  return {
    totalEntries: journal.length,
    openTrades: journal.filter((e) => e.status === "open").length,
    closedTrades: closed.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    totalPnl: closed.reduce((s, e) => s + (e.pnl ?? 0), 0),
    replaysGenerated: replayCount,
  };
}

/**
 * Journal health check
 */
export function journalHealthCheck(): {
  total_entries: number;
  entries_today: number;
  avg_pnl: number;
  open_positions: number;
} {
  const today = new Date().toDateString();
  const todayEntries = journal.filter((e) => new Date(e.entryTime).toDateString() === today);
  const closed = journal.filter((e) => e.status === "closed");
  const avgPnl = closed.length > 0
    ? closed.reduce((s, e) => s + (e.pnl ?? 0), 0) / closed.length
    : 0;

  return {
    total_entries: journal.length,
    entries_today: todayEntries.length,
    avg_pnl: Math.round(avgPnl * 100) / 100,
    open_positions: journal.filter((e) => e.status === "open").length,
  };
}

/**
 * Get journal stats by period (new aggregation function)
 */
export function getJournalStatsByPeriod(period: "day" | "week" | "month"): {
  period: string;
  trades: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  largest_win: number;
  largest_loss: number;
} {
  const now = Date.now();
  const periodMs = period === "day"
    ? 24 * 60 * 60 * 1000
    : period === "week"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;

  const cutoff = now - periodMs;
  const filtered = journal.filter(
    (e) => e.status === "closed" && new Date(e.entryTime).getTime() >= cutoff,
  );

  if (filtered.length === 0) {
    return {
      period,
      trades: 0,
      win_rate: 0,
      total_pnl: 0,
      avg_pnl: 0,
      largest_win: 0,
      largest_loss: 0,
    };
  }

  const wins = filtered.filter((e) => (e.pnl ?? 0) > 0);
  const pnls = filtered.map((e) => e.pnl ?? 0);
  const totalPnl = pnls.reduce((s, v) => s + v, 0);

  return {
    period,
    trades: filtered.length,
    win_rate: wins.length / filtered.length,
    total_pnl: Math.round(totalPnl * 100) / 100,
    avg_pnl: Math.round((totalPnl / filtered.length) * 100) / 100,
    largest_win: Math.max(...pnls),
    largest_loss: Math.min(...pnls),
  };
}

export function resetTradeJournal(): void {
  journal.length = 0;
  replayCount = 0;
  nextId = 1;
}


/* ══════════════════════════════════════════════════════════════════
   Backward-compatibility shims for old journal API consumers
   (attribution_engine, equity_engine, scanner_scheduler, journal route)
   ══════════════════════════════════════════════════════════════════ */

export interface JournalDecision {
  symbol: string;
  direction: "long" | "short";
  strategyId?: string;
  strategyName?: string;
  entryPrice?: number;
  reason?: string;
  gates?: Record<string, string>;
  macroConviction?: string;
  sentimentScore?: number;
  crowdingLevel?: string;
  blocked?: boolean;
  blockReason?: string;
  setupType?: string;
  regime?: string;
  decision?: string;
  signalPrice?: number;
  macroBias?: any;
  sentiment?: any;
  quality?: any;
  [key: string]: any;
}

export interface JournalOutcome {
  pnl: number;
  pnlPct: number;
  exitPrice: number;
  exitReason: string;
  holdDurationMs: number;
}

/** Legacy flat entry used by attribution_engine, equity_engine etc. */
export interface TradeJournalEntry {
  id: string;
  symbol: string;
  direction: "long" | "short";
  strategyId: string;
  strategyName: string;
  entryPrice: number;
  entryTime: string;
  entryReason: string;
  positionSize: number;
  riskPct: number;
  exitPrice?: number;
  exitTime?: string;
  exitReason?: string;
  pnl?: number;
  pnlPct?: number;
  holdDurationMs?: number;
  tags: string[];
  notes: string;
  status: "open" | "closed";
  /* legacy flat fields for attribution_engine / equity_engine / leaderboard */
  decision: "blocked" | "passed" | "unknown";
  blockReason?: string;
  outcome: "win" | "loss" | "breakeven" | "unknown";
  macroBias: { conviction: string; direction: string };
  sentiment: { crowdingLevel: string; institutionalEdge: string; aligned: boolean };
  decidedAt: string;
  setupType: string;
  regime: string;
}

export type JournalOutcomeUpdate = Partial<JournalOutcome>;

const legacyJournal: TradeJournalEntry[] = [];

export function recordDecision(decision: JournalDecision): TradeJournalEntry {
  const isBlocked = decision.blocked === true || decision.decision === "blocked";
  const now = new Date().toISOString();
  const entry: TradeJournalEntry = {
    id: genId(),
    symbol: decision.symbol,
    direction: decision.direction,
    strategyId: decision.strategyId ?? "unknown",
    strategyName: decision.strategyName ?? decision.setupType ?? "unknown",
    entryPrice: decision.entryPrice ?? decision.signalPrice ?? 0,
    entryTime: now,
    entryReason: decision.reason ?? (isBlocked ? "blocked" : "signal"),
    positionSize: 0,
    riskPct: 0,
    tags: isBlocked ? ["blocked"] : [],
    notes: decision.blockReason ?? "",
    status: isBlocked ? "closed" : "open",
    decision: isBlocked ? "blocked" : "passed",
    blockReason: decision.blockReason,
    outcome: "unknown",
    macroBias: decision.macroBias ?? { conviction: decision.macroConviction ?? "unknown", direction: decision.direction },
    sentiment: decision.sentiment ?? { crowdingLevel: decision.crowdingLevel ?? "unknown", institutionalEdge: "neutral", aligned: true },
    decidedAt: now,
    setupType: decision.setupType ?? "unknown",
    regime: decision.regime ?? "unknown",
  };
  legacyJournal.push(entry);
  return entry;
}

export function listJournalEntries(opts?: {
  symbol?: string;
  strategyId?: string;
  decision?: string;
  outcome?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  offset?: number;
}): TradeJournalEntry[] {
  let entries: TradeJournalEntry[] = [...legacyJournal];
  if (opts?.symbol) entries = entries.filter((e) => e.symbol === opts.symbol);
  if (opts?.strategyId) entries = entries.filter((e) => e.strategyId === opts.strategyId);
  if (opts?.decision) entries = entries.filter((e) => e.decision === opts.decision);
  if (opts?.outcome) entries = entries.filter((e) => e.outcome === opts.outcome);
  if (opts?.from) entries = entries.filter((e) => e.entryTime >= opts.from!);
  if (opts?.to) entries = entries.filter((e) => e.entryTime <= opts.to!);
  if (opts?.limit) {
    const start = opts.offset ?? ((opts.page ?? 1) - 1) * opts.limit;
    return entries.slice(start, start + opts.limit);
  }
  return entries;
}

export function getJournalEntry(id: string): TradeJournalEntry | undefined {
  return legacyJournal.find((e) => e.id === id);
}

export function recordOutcome(id: string, update: JournalOutcomeUpdate): TradeJournalEntry {
  const entry = getJournalEntry(id);
  if (!entry) throw new Error(`Journal entry ${id} not found`);
  if (update.pnl !== undefined) entry.pnl = update.pnl;
  if (update.pnlPct !== undefined) entry.pnlPct = update.pnlPct;
  if (update.exitPrice !== undefined) entry.exitPrice = update.exitPrice;
  if (update.exitReason !== undefined) entry.exitReason = update.exitReason;
  if (update.holdDurationMs !== undefined) entry.holdDurationMs = update.holdDurationMs;

  // If exitPrice is provided but pnlPct is not, calculate it
  if (entry.exitPrice !== undefined && entry.pnlPct === undefined) {
    const dir = entry.direction === "long" ? 1 : -1;
    entry.pnlPct = ((entry.exitPrice - entry.entryPrice) / entry.entryPrice) * dir * 100;
  }
  // If pnl is not set but we have pnlPct, we don't need to calculate pnl for outcome determination

  entry.outcome = (entry.pnlPct ?? 0) > 0 ? "win" : (entry.pnlPct ?? 0) < 0 ? "loss" : "breakeven";
  entry.status = "closed";
  return entry;
}

export function getJournalStats(): {
  total: number;
  withOutcome: number;
  winRate: number;
  avgPnl: number;
  avgHold: number;
} {
  const all = [...legacyJournal];
  const withOutcome = all.filter((e) => e.outcome !== "unknown");
  const pnls = withOutcome.map((e) => e.pnlPct ?? 0);
  const wins = pnls.filter((p) => p > 0);
  return {
    total: all.length,
    withOutcome: withOutcome.length,
    winRate: pnls.length ? wins.length / pnls.length : 0,
    avgPnl: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0,
    avgHold: 0,
  };
}

export function clearJournal(): void {
  legacyJournal.length = 0;
  resetTradeJournal();
}
