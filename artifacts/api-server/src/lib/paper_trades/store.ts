/**
 * Phase 4 — paper_trades store.
 *
 * Reads/writes the existing `trades` table (lib/db schema/trades.ts) and
 * derives RejectedTrade rows from the persisted execution_audit JSON
 * stream produced by Phase 3's audit_log.ts. No new schema required.
 *
 * `notes` column carries a JSON blob with audit_id, broker_order_id, mode,
 * bypass_reasons, closing — fields the existing schema does not have a
 * dedicated column for.
 */
import { db, tradesTable } from "@workspace/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { logger } from "../logger.js";
import { persistRead } from "../persistent_store.js";
import type { ExecutedTrade, RejectedTrade } from "./types.js";

interface NotesBlob {
  audit_id?: string | null;
  broker_order_id?: string | null;
  mode?: "paper" | "live" | "dry_run";
  bypass_reasons?: string[];
  closing?: boolean;
  /** Phase 5: equity in quote currency at the moment of open. */
  equity_at_entry?: number | null;
  /** Set on close: realised R; convenience cache. */
  realized_r?: number | null;
  exit_reason?: string;
}

function packNotes(b: NotesBlob): string {
  return JSON.stringify(b);
}
function unpackNotes(s: string | null): NotesBlob {
  if (!s) return {};
  try { return JSON.parse(s) as NotesBlob; } catch { return {}; }
}

export interface RecordOpenInput {
  audit_id: string;
  broker_order_id: string | null;
  symbol: string;
  strategy_id: string;
  direction: "long" | "short";
  quantity: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  entry_time: string;
  mode: "paper" | "live" | "dry_run";
  bypass_reasons: ReadonlyArray<string>;
  closing: boolean;
  regime?: string;
  session?: string;
  /** Phase 5: account equity (quote currency) at the moment of order open. */
  equity_at_entry?: number | null;
}

/** Insert a new row at order-accept time. Returns the new trade id. */
export async function recordTradeOpen(input: RecordOpenInput): Promise<number | null> {
  try {
    const rows = await db
      .insert(tradesTable)
      .values({
        instrument: input.symbol,
        setup_type: input.strategy_id,
        direction: input.direction,
        entry_price: String(input.entry_price),
        stop_loss: String(input.stop_loss),
        take_profit: String(input.take_profit),
        quantity: String(input.quantity),
        outcome: "open",
        status: input.closing ? "closed" : "open",
        entry_time: new Date(input.entry_time),
        regime: input.regime ?? null,
        session: input.session ?? null,
        notes: packNotes({
          audit_id: input.audit_id,
          broker_order_id: input.broker_order_id,
          mode: input.mode,
          bypass_reasons: [...input.bypass_reasons],
          closing: input.closing,
          equity_at_entry: input.equity_at_entry ?? null,
        }),
      })
      .returning({ id: tradesTable.id });
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error({ err, audit_id: input.audit_id }, "recordTradeOpen failed");
    return null;
  }
}

export interface RecordCloseInput {
  /** Either trade id or broker_order_id is required. */
  trade_id?: number;
  broker_order_id?: string;
  exit_price: number;
  exit_time: string;
  exit_reason: "take_profit" | "stop_loss" | "manual_close" | "expired" | "fallback_close" | "other";
}

/** Update an open trade row to closed. Idempotent: a second call is a no-op. */
export async function recordTradeClose(input: RecordCloseInput): Promise<boolean> {
  try {
    const row = await findOpenRow(input);
    if (!row) {
      logger.warn({ input }, "recordTradeClose: no matching open row found");
      return false;
    }
    const entry = Number(row.entry_price);
    const stop = Number(row.stop_loss);
    const qty = Number(row.quantity);
    const direction = row.direction as "long" | "short";
    const pnlPerUnit = direction === "long" ? input.exit_price - entry : entry - input.exit_price;
    const pnl = pnlPerUnit * qty;
    const plannedRisk = Math.abs(entry - stop);
    const realizedR = plannedRisk > 0 ? pnlPerUnit / plannedRisk : null;
    const outcome: ExecutedTrade["outcome"] =
      input.exit_reason === "expired" ? "expired"
      : input.exit_reason === "fallback_close" ? "fallback_close"
      : pnl > 0 ? "win"
      : pnl < 0 ? "loss"
      : "breakeven";

    const oldNotes = unpackNotes(row.notes);
    const equityAtEntry = oldNotes.equity_at_entry ?? null;
    const pnlPct = equityAtEntry && equityAtEntry > 0
      ? (pnl / equityAtEntry) * 100
      : null;

    await db.update(tradesTable)
      .set({
        exit_price: String(input.exit_price),
        exit_time: new Date(input.exit_time),
        pnl: String(pnl),
        pnl_pct: pnlPct !== null ? String(pnlPct) : null,
        outcome,
        status: "closed",
        notes: packNotes({
          ...oldNotes,
          exit_reason: input.exit_reason,
          realized_r: realizedR,
        }),
        updated_at: new Date(),
      })
      .where(eq(tradesTable.id, row.id));
    return true;
  } catch (err) {
    logger.error({ err, input }, "recordTradeClose failed");
    return false;
  }
}

async function findOpenRow(input: RecordCloseInput) {
  if (typeof input.trade_id === "number") {
    const rows = await db.select().from(tradesTable).where(eq(tradesTable.id, input.trade_id)).limit(1);
    return rows[0] ?? null;
  }
  if (typeof input.broker_order_id === "string" && input.broker_order_id.length > 0) {
    // notes is a JSON string column; must filter in app code
    const rows = await db.select().from(tradesTable).where(eq(tradesTable.status, "open")).limit(2000);
    for (const r of rows) {
      const n = unpackNotes(r.notes);
      if (n.broker_order_id === input.broker_order_id) return r;
    }
  }
  return null;
}

/** Read all executed trades from DB, mapped to ExecutedTrade. */
export async function listExecutedTrades(limit = 1000): Promise<ExecutedTrade[]> {
  try {
    const rows = await db.select().from(tradesTable).orderBy(desc(tradesTable.entry_time)).limit(limit);
    return rows.map((r: any) => mapRow(r));
  } catch (err) {
    logger.error({ err }, "listExecutedTrades failed");
    return [];
  }
}

function mapRow(r: any): ExecutedTrade {
  const n = unpackNotes(r.notes);
  const entry = Number(r.entry_price);
  const stop = Number(r.stop_loss);
  const planned = Math.abs(entry - stop);
  const pnl = r.pnl !== null && r.pnl !== undefined ? Number(r.pnl) : null;
  const realizedR = pnl !== null && planned > 0 ? pnl / Number(r.quantity) / planned : null;
  return {
    id: Number(r.id),
    audit_id: n.audit_id ?? null,
    broker_order_id: n.broker_order_id ?? null,
    symbol: r.instrument,
    strategy_id: r.setup_type,
    direction: r.direction as "long" | "short",
    quantity: Number(r.quantity),
    entry_price: entry,
    stop_loss: stop,
    take_profit: Number(r.take_profit),
    exit_price: r.exit_price !== null && r.exit_price !== undefined ? Number(r.exit_price) : null,
    pnl,
    pnl_pct: r.pnl_pct !== null && r.pnl_pct !== undefined ? Number(r.pnl_pct) : null,
    realized_r: realizedR,
    outcome: (r.outcome ?? "open") as ExecutedTrade["outcome"],
    status: (r.status ?? "open") as ExecutedTrade["status"],
    entry_time: r.entry_time instanceof Date ? r.entry_time.toISOString() : String(r.entry_time ?? ""),
    exit_time: r.exit_time instanceof Date ? r.exit_time.toISOString() : (r.exit_time ?? null),
    mode: (n.mode ?? "paper") as "paper" | "live" | "dry_run",
    bypass_reasons: n.bypass_reasons ?? [],
    closing: n.closing ?? false,
    equity_at_entry: n.equity_at_entry ?? null,
  };
}

/** Read rejected trades from the Phase 3 execution_audit JSON. */
export function listRejectedTrades(limit = 1000): RejectedTrade[] {
  try {
    const all = persistRead<any[]>("execution_audit", []);
    const rejected = all.filter((e) => e?.outcome === "rejected_by_gate" || e?.outcome === "validation_error");
    const tail = rejected.slice(-limit).reverse();
    return tail.map((e) => ({
      audit_id: String(e.audit_id ?? ""),
      timestamp: String(e.timestamp ?? ""),
      symbol: String(e.symbol ?? ""),
      side: (e.side ?? "buy") as "buy" | "sell",
      direction: (e.direction ?? "long") as "long" | "short",
      quantity: Number(e.quantity ?? 0),
      entry_price: Number(e.entry_price ?? 0),
      stop_loss: Number(e.stop_loss ?? 0),
      take_profit: Number(e.take_profit ?? 0),
      bypass_reasons: Array.isArray(e.bypass_reasons) ? e.bypass_reasons : [],
      blocking_gate: String(e.blocking_gate ?? ""),
      blocking_reason: String(e.blocking_reason ?? ""),
    }));
  } catch (err) {
    logger.warn({ err }, "listRejectedTrades read failed");
    return [];
  }
}

export function rejectedCount(): number {
  try {
    const all = persistRead<any[]>("execution_audit", []);
    return all.filter((e) => e?.outcome === "rejected_by_gate" || e?.outcome === "validation_error").length;
  } catch { return 0; }
}
