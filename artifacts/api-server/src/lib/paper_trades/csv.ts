/**
 * Phase 4 — Pure CSV serialization for trade exports.
 *
 * RFC 4180–style: comma-separated, double-quoted fields when needed,
 * embedded quotes doubled. Header row is always present.
 */
import type { ExecutedTrade } from "./types.js";

const HEADER = [
  "id", "audit_id", "broker_order_id",
  "symbol", "strategy_id", "direction", "quantity",
  "entry_price", "stop_loss", "take_profit",
  "exit_price", "pnl", "pnl_pct", "realized_r",
  "outcome", "status",
  "entry_time", "exit_time",
  "mode", "closing", "bypass_reasons",
] as const;

function quote(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function tradesToCsv(trades: ExecutedTrade[]): string {
  const lines: string[] = [HEADER.join(",")];
  for (const t of trades) {
    lines.push(
      [
        t.id, t.audit_id, t.broker_order_id,
        t.symbol, t.strategy_id, t.direction, t.quantity,
        t.entry_price, t.stop_loss, t.take_profit,
        t.exit_price, t.pnl, t.pnl_pct, t.realized_r,
        t.outcome, t.status,
        t.entry_time, t.exit_time,
        t.mode, t.closing, t.bypass_reasons.join("|"),
      ].map(quote).join(","),
    );
  }
  return lines.join("\n") + "\n";
}
