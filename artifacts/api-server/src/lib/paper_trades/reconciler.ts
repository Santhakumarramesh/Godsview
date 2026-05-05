/**
 * Phase 5 — Trade reconciler.
 *
 * Detects orphan trade rows: rows in the DB with status="open" whose symbol
 * does NOT appear in the current Alpaca positions list. Closes them with
 * outcome="reconciled_orphan" (as the special "fallback_close" outcome).
 *
 * Two layers:
 *
 *   classifyOrphans(openRows, brokerPositions, opts)  ← PURE
 *     Returns { orphans, untrackedPositions, kept }.
 *
 *   reconcileOrphans()  ← DB + broker; calls classifyOrphans then closes orphans.
 *
 * Failure scenarios handled:
 *   - Broker fetch fails    → returns { error, processed: 0, closed: 0 }; NEVER closes any rows.
 *   - DB query fails        → returns { error, processed: 0, closed: 0 }; NEVER closes any rows.
 *   - Position with no row  → reported as untrackedPositions (logged WARN; not closed).
 *   - Trade row younger than graceMs → kept (race-window protection).
 */
import { reconLog } from "../log_channels.js";
import { listExecutedTrades, recordTradeClose } from "./store.js";

export interface ReconcilerOpenRow {
  id: number;
  symbol: string;
  broker_order_id: string | null;
  entry_price: number;
  entry_time: string;       // ISO
  status: string;
  quantity: number;
}

export interface BrokerPositionLite {
  symbol: string;
  qty: number;
}

export interface ClassifyOpts {
  /** Now (ms since epoch) — injected so tests are deterministic. */
  nowMs: number;
  /** Open trades younger than graceMs are NOT classified as orphans (race protection). Default 5 min. */
  graceMs?: number;
}

export interface OrphanClassification {
  orphans: ReconcilerOpenRow[];
  /** Positions reported by the broker that don't have a matching open DB row. */
  untrackedPositions: BrokerPositionLite[];
  /** Open rows kept (matched a broker position OR younger than the grace window). */
  kept: ReconcilerOpenRow[];
}

export function classifyOrphans(
  openRows: ReconcilerOpenRow[],
  brokerPositions: BrokerPositionLite[],
  opts: ClassifyOpts,
): OrphanClassification {
  const grace = opts.graceMs ?? 5 * 60_000;
  const positionsBySymbol = new Map<string, number>();
  for (const p of brokerPositions) {
    positionsBySymbol.set(p.symbol, (positionsBySymbol.get(p.symbol) ?? 0) + Math.abs(p.qty));
  }
  const matchedSymbols = new Set<string>();

  const orphans: ReconcilerOpenRow[] = [];
  const kept: ReconcilerOpenRow[] = [];

  for (const r of openRows) {
    const ageMs = opts.nowMs - Date.parse(r.entry_time);
    if (Number.isNaN(ageMs) || ageMs < grace) {
      kept.push(r);
      continue;
    }
    if (positionsBySymbol.has(r.symbol)) {
      matchedSymbols.add(r.symbol);
      kept.push(r);
      continue;
    }
    orphans.push(r);
  }

  const untrackedPositions = [...positionsBySymbol.entries()]
    .filter(([sym]) => !matchedSymbols.has(sym))
    .map(([symbol, qty]) => ({ symbol, qty }));

  return { orphans, untrackedPositions, kept };
}

export interface ReconcilerResult {
  ran_at: string;
  duration_ms: number;
  open_rows_total: number;
  positions_total: number;
  orphans_found: number;
  orphans_closed: number;
  untracked_positions: number;
  error: string | null;
}

let lastResult: ReconcilerResult | null = null;
export function getLastReconcilerResult(): ReconcilerResult | null {
  return lastResult;
}

/**
 * Run the reconciler once. Safe to call repeatedly. Failures NEVER close
 * rows; they record an error in the result and return.
 */
export async function reconcileOrphans(opts?: { graceMs?: number }): Promise<ReconcilerResult> {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  let openRows: ReconcilerOpenRow[] = [];
  let positions: BrokerPositionLite[] = [];

  // Step 1: read open rows from DB
  try {
    const trades = await listExecutedTrades(5_000);
    openRows = trades
      .filter((t) => t.status === "open")
      .map((t) => ({
        id: t.id,
        symbol: t.symbol,
        broker_order_id: t.broker_order_id,
        entry_price: t.entry_price,
        entry_time: t.entry_time,
        status: t.status,
        quantity: t.quantity,
      }));
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    reconLog.error({ err: msg }, "[reconciler] DB read failed; skipping run");
    lastResult = {
      ran_at: startedAt.toISOString(),
      duration_ms: Date.now() - startMs,
      open_rows_total: 0, positions_total: 0,
      orphans_found: 0, orphans_closed: 0, untracked_positions: 0,
      error: `db_read_failed: ${msg}`,
    };
    return lastResult;
  }

  // Step 2: fetch broker positions
  try {
    const { getTypedPositions } = await import("../alpaca.js");
    const raw = await getTypedPositions();
    positions = raw.map((p) => ({ symbol: String(p.symbol), qty: Number(p.qty) }));
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    reconLog.error({ err: msg }, "[reconciler] broker positions fetch failed; skipping closures");
    lastResult = {
      ran_at: startedAt.toISOString(),
      duration_ms: Date.now() - startMs,
      open_rows_total: openRows.length, positions_total: 0,
      orphans_found: 0, orphans_closed: 0, untracked_positions: 0,
      error: `broker_fetch_failed: ${msg}`,
    };
    return lastResult;
  }

  // Step 3: classify
  const classification = classifyOrphans(openRows, positions, {
    nowMs: Date.now(),
    graceMs: opts?.graceMs,
  });

  if (classification.untrackedPositions.length > 0) {
    reconLog.warn(
      { untracked: classification.untrackedPositions },
      "[reconciler] broker holds positions with no matching DB row (manual trade?)",
    );
  }

  // Step 4: close orphans
  let closed = 0;
  for (const r of classification.orphans) {
    try {
      const ok = await recordTradeClose({
        trade_id: r.id,
        exit_price: r.entry_price, // we don't know the actual exit; mark at entry → pnl = 0
        exit_time: new Date().toISOString(),
        exit_reason: "fallback_close",
      });
      if (ok) {
        closed += 1;
        reconLog.warn({ trade_id: r.id, symbol: r.symbol }, "[reconciler] orphan closed (no broker position)");
      } else {
        reconLog.error({ trade_id: r.id, symbol: r.symbol }, "[reconciler] orphan close FAILED to update row");
      }
    } catch (err) {
      reconLog.error({ err, trade_id: r.id }, "[reconciler] orphan close threw");
    }
  }

  lastResult = {
    ran_at: startedAt.toISOString(),
    duration_ms: Date.now() - startMs,
    open_rows_total: openRows.length,
    positions_total: positions.length,
    orphans_found: classification.orphans.length,
    orphans_closed: closed,
    untracked_positions: classification.untrackedPositions.length,
    error: null,
  };
  reconLog.info(lastResult, "[reconciler] run complete");
  return lastResult;
}
