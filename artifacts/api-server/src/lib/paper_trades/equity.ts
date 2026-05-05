/**
 * Phase 4 — Equity curve builder (pure).
 *
 * No smoothing, no interpolation. One point per closed trade, ordered by
 * exit_time ascending. Uses the actual realized PnL of each trade.
 */
import type { ExecutedTrade, EquityCurve } from "./types.js";

export function buildEquityCurve(
  trades: ExecutedTrade[],
  startingEquity: number,
): EquityCurve {
  const closed = trades.filter((t) => t.status === "closed" && t.exit_time !== null);
  const sorted = [...closed].sort((a, b) =>
    (a.exit_time ?? "").localeCompare(b.exit_time ?? ""),
  );

  let equity = startingEquity;
  const points = sorted.map((t) => {
    const pnl = t.pnl ?? 0;
    equity += pnl;
    return {
      timestamp: t.exit_time ?? t.entry_time,
      trade_id: t.id,
      pnl,
      equity,
    };
  });

  return {
    starting_equity: startingEquity,
    starting_at: sorted.length > 0 ? sorted[0]!.entry_time : null,
    points,
    ending_equity: equity,
  };
}
