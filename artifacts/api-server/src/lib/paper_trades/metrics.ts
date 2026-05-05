/**
 * Phase 4 — Pure metrics over an executed-trade list.
 *
 * Every number here is computed from the input array. No defaults. No
 * smoothing. No interpolation. If a metric cannot be computed (e.g. no
 * closed trades), it returns null instead of a fabricated value.
 */
import type { ExecutedTrade, Metrics, EquityCurve } from "./types.js";

export interface MetricsInput {
  trades: ExecutedTrade[];
  rejectedCount: number;
  startingEquity: number;
  /** When provided, drawdown is computed against this curve (which already
   *  reflects starting_equity). Otherwise it is computed inline. */
  equityCurve?: EquityCurve;
}

export function computeMetrics(input: MetricsInput): Metrics {
  const { trades, rejectedCount, startingEquity } = input;
  const closed = trades.filter((t) => t.status === "closed" && t.exit_time !== null);
  const open = trades.filter((t) => t.status !== "closed");
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
  const breakevens = closed.filter((t) => (t.pnl ?? 0) === 0);

  const closedCount = closed.length;
  const winRate = closedCount > 0 ? wins.length / closedCount : null;
  const lossRate = closedCount > 0 ? losses.length / closedCount : null;

  const rValues = closed
    .map((t) => t.realized_r)
    .filter((r): r is number => r !== null && Number.isFinite(r));
  const avgR = rValues.length > 0 ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null;
  const medianR = rValues.length > 0 ? medianOf(rValues) : null;
  const bestR = rValues.length > 0 ? Math.max(...rValues) : null;
  const worstR = rValues.length > 0 ? Math.min(...rValues) : null;

  const pnls = closed.map((t) => t.pnl ?? 0);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const avgPnl = closedCount > 0 ? totalPnl / closedCount : null;

  const positiveSum = wins.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const negativeSum = losses.reduce((a, t) => a + Math.abs(t.pnl ?? 0), 0);
  const profitFactor = negativeSum > 0 ? positiveSum / negativeSum : null;

  const dd = drawdown(input.equityCurve ?? buildCurveInternal(closed, startingEquity), startingEquity);

  const sortedByOpen = [...trades].sort((a, b) => a.entry_time.localeCompare(b.entry_time));
  const firstAt = sortedByOpen.length > 0 ? sortedByOpen[0]!.entry_time : null;
  const lastClosed = closed
    .map((t) => t.exit_time)
    .filter((t): t is string => t !== null)
    .sort();
  const lastAt = lastClosed.length > 0 ? lastClosed[lastClosed.length - 1]! : firstAt;

  return {
    total_executed: trades.length,
    total_open: open.length,
    total_closed: closedCount,
    total_wins: wins.length,
    total_losses: losses.length,
    total_breakevens: breakevens.length,
    total_rejected: rejectedCount,
    win_rate: winRate,
    loss_rate: lossRate,
    avg_r: avgR,
    median_r: medianR,
    best_r: bestR,
    worst_r: worstR,
    total_pnl: totalPnl,
    avg_pnl_per_trade: avgPnl,
    profit_factor: profitFactor,
    max_drawdown_pct: dd.pct,
    max_drawdown_abs: dd.abs,
    first_trade_at: firstAt,
    last_trade_at: lastAt,
    computed_at: new Date().toISOString(),
  };
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

function buildCurveInternal(closed: ExecutedTrade[], starting: number): EquityCurve {
  const sorted = [...closed].sort((a, b) =>
    (a.exit_time ?? "").localeCompare(b.exit_time ?? ""),
  );
  let equity = starting;
  const points = sorted.map((t) => {
    equity += t.pnl ?? 0;
    return {
      timestamp: t.exit_time ?? t.entry_time,
      trade_id: t.id,
      pnl: t.pnl ?? 0,
      equity,
    };
  });
  return {
    starting_equity: starting,
    starting_at: sorted.length > 0 ? sorted[0]!.entry_time : null,
    points,
    ending_equity: equity,
  };
}

function drawdown(curve: EquityCurve, starting: number): { abs: number | null; pct: number | null } {
  if (curve.points.length === 0) return { abs: null, pct: null };
  let peak = starting;
  let maxAbs = 0;
  for (const p of curve.points) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    if (dd > maxAbs) maxAbs = dd;
  }
  return {
    abs: maxAbs,
    pct: peak > 0 ? (maxAbs / peak) * 100 : null,
  };
}
