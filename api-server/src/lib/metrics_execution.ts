/**
 * Execution-layer Prometheus metrics.
 * Supplements the core metrics.ts with trading execution observability.
 */

import { collectMetrics as collectCoreMetrics } from "./metrics";
import { getBreakerSnapshot } from "./drawdown_breaker";
import { getReconciliationSnapshot } from "./fill_reconciler";
import { getManagedPositions } from "./position_monitor";
import { isKillSwitchActive, getRiskEngineSnapshot } from "./risk_engine";
import { getProductionGateStats } from "./production_gate";
import { getAlertHistory } from "./alerts";
import { logger } from "./logger";

/**
 * Collect execution-specific metrics and append to core metrics.
 * Returns full Prometheus text exposition format.
 */
export function collectAllMetrics(): string {
  const core = collectCoreMetrics();
  const lines: string[] = [core];

  try {
    const breaker = getBreakerSnapshot();
    lines.push(
      "# HELP godsview_breaker_level Drawdown breaker level (0=NORMAL, 1=WARNING, 2=THROTTLE, 3=HALT)",
      "# TYPE godsview_breaker_level gauge",
      `godsview_breaker_level ${levelToNum(breaker.level)}`,
      "",
      "# HELP godsview_breaker_realized_pnl_usd Realized PnL today in USD",
      "# TYPE godsview_breaker_realized_pnl_usd gauge",
      `godsview_breaker_realized_pnl_usd ${breaker.realized_pnl_today}`,
      "",
      "# HELP godsview_breaker_unrealized_pnl_usd Unrealized PnL in USD",
      "# TYPE godsview_breaker_unrealized_pnl_usd gauge",
      `godsview_breaker_unrealized_pnl_usd ${breaker.unrealized_pnl}`,
      "",
      "# HELP godsview_breaker_consecutive_losses Consecutive losing trades",
      "# TYPE godsview_breaker_consecutive_losses gauge",
      `godsview_breaker_consecutive_losses ${breaker.consecutive_losses}`,
      "",
      "# HELP godsview_breaker_position_size_multiplier Position size throttle multiplier",
      "# TYPE godsview_breaker_position_size_multiplier gauge",
      `godsview_breaker_position_size_multiplier ${breaker.position_size_multiplier}`,
      "",
      "# HELP godsview_trades_today_total Trades executed today",
      "# TYPE godsview_trades_today_total counter",
      `godsview_trades_today_total ${breaker.trades_today}`,
      "",
      "# HELP godsview_wins_today_total Winning trades today",
      "# TYPE godsview_wins_today_total counter",
      `godsview_wins_today_total ${breaker.wins_today}`,
      "",
      "# HELP godsview_losses_today_total Losing trades today",
      "# TYPE godsview_losses_today_total counter",
      `godsview_losses_today_total ${breaker.losses_today}`,
      "",
      "# HELP godsview_hourly_pnl_velocity_usd PnL velocity over last hour in USD",
      "# TYPE godsview_hourly_pnl_velocity_usd gauge",
      `godsview_hourly_pnl_velocity_usd ${breaker.hourly_pnl_velocity}`,
    );
  } catch { /* breaker not initialized */ }

  try {
    const recon = getReconciliationSnapshot();
    lines.push(
      "",
      "# HELP godsview_fills_today_total Fill events reconciled today",
      "# TYPE godsview_fills_today_total counter",
      `godsview_fills_today_total ${recon.fills_today}`,
      "",
      "# HELP godsview_unmatched_fills_total Fills not matched to tracked positions",
      "# TYPE godsview_unmatched_fills_total counter",
      `godsview_unmatched_fills_total ${recon.unmatched_fills}`,
    );
  } catch { /* reconciler not initialized */ }

  try {
    const positions = getManagedPositions();
    lines.push(
      "",
      "# HELP godsview_managed_positions Active positions under monitor",
      "# TYPE godsview_managed_positions gauge",
      `godsview_managed_positions ${positions.length}`,
    );
    for (const p of positions) {
      lines.push(
        `godsview_position_trail_active{symbol="${p.symbol}"} ${p.trail_active ? 1 : 0}`,
      );
    }
  } catch (err) { logger.warn({ err }, "[metrics] position_monitor not yet initialized — skipping managed_positions metric"); }

  try {
    lines.push(
      "",
      "# HELP godsview_kill_switch Kill switch state (0=off, 1=on)",
      "# TYPE godsview_kill_switch gauge",
      `godsview_kill_switch ${isKillSwitchActive() ? 1 : 0}`,
    );
  } catch (err) { logger.warn({ err }, "[metrics] risk_engine not yet initialized — skipping kill_switch metric"); }

  try {
    const gate = getProductionGateStats();
    lines.push(
      "",
      "# HELP godsview_gate_daily_trades Daily trade count at production gate",
      "# TYPE godsview_gate_daily_trades counter",
      `godsview_gate_daily_trades ${gate.daily_trades}`,
    );
  } catch (err) { logger.warn({ err }, "[metrics] production_gate not yet initialized — skipping gate metric"); }

  try {
    const alerts = getAlertHistory(50);
    const unacked = alerts.filter((a) => !a.acknowledged).length;
    lines.push(
      "",
      "# HELP godsview_active_alerts Unacknowledged alerts",
      "# TYPE godsview_active_alerts gauge",
      `godsview_active_alerts ${unacked}`,
    );
  } catch (err) { logger.warn({ err }, "[metrics] alerts not yet initialized — skipping active_alerts metric"); }

  return lines.join("\n") + "\n";
}

function levelToNum(level: string): number {
  switch (level) {
    case "WARNING": return 1;
    case "THROTTLE": return 2;
    case "HALT": return 3;
    default: return 0;
  }
}
