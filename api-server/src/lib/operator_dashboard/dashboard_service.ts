import crypto from "crypto";
import pino from "pino";

const logger = pino({ name: "operator-dashboard" });

export type SystemMode = "live" | "staging" | "dev" | "maintenance";
export type HealthStatus = "critical" | "degraded" | "healthy";

export interface StrategyCard {
  strategy_id: string;
  strategy_name: string;
  status: "active" | "paused" | "archived";
  daily_pnl: number;
  win_rate: number;
  exposure: number;
  last_trade: string;
  alerts_count: number;
}

export interface OperatorAlert {
  id: string;
  strategy_id: string;
  severity: "fatal" | "critical" | "warning" | "info";
  message: string;
  created_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
}

export interface DailyBrief {
  id: string;
  created_at: string;
  system_health: HealthStatus;
  strategies_count: number;
  total_pnl: number;
  alerts_summary: { fatal: number; critical: number; warning: number; info: number };
  top_performers: StrategyCard[];
  key_events: string[];
}

export interface SystemOverview {
  mode: SystemMode;
  active_strategies: number;
  daily_pnl: number;
  system_health: HealthStatus;
  total_alerts: number;
  fatal_alerts: number;
}

// Storage
const strategies = new Map<string, StrategyCard>();
const alerts = new Map<string, OperatorAlert>();
const briefs = new Map<string, DailyBrief>();

let systemMode: SystemMode = "dev";
let fatalAlertThreshold = 0;
let criticalAlertThreshold = 0;

export function setSystemMode(mode: SystemMode): { success: boolean } {
  systemMode = mode;
  logger.info({ mode }, "System mode changed");
  return { success: true };
}

export function registerStrategy(card: StrategyCard): StrategyCard {
  strategies.set(card.strategy_id, card);
  logger.info({ strategy_id: card.strategy_id, name: card.strategy_name }, "Strategy registered");
  return card;
}

export function updateStrategyCard(strategy_id: string, update: Partial<StrategyCard>): { success: boolean; error?: string } {
  const card = strategies.get(strategy_id);
  if (!card) return { success: false, error: "Strategy not found" };

  const updated = { ...card, ...update, strategy_id };
  strategies.set(strategy_id, updated);
  return { success: true };
}

export function getStrategyCards(): StrategyCard[] {
  return Array.from(strategies.values());
}

export function createAlert(config: {
  strategy_id: string;
  severity: "fatal" | "critical" | "warning" | "info";
  message: string;
}): OperatorAlert {
  const alert: OperatorAlert = {
    id: `oa_${crypto.randomUUID()}`,
    strategy_id: config.strategy_id,
    severity: config.severity,
    message: config.message,
    created_at: new Date().toISOString(),
  };

  alerts.set(alert.id, alert);

  if (config.severity === "fatal") fatalAlertThreshold++;
  if (config.severity === "critical") criticalAlertThreshold++;

  logger.warn({ id: alert.id, severity: config.severity }, "Alert created");
  return alert;
}

export function acknowledgeAlert(alert_id: string, acknowledged_by: string): { success: boolean; error?: string } {
  const alert = alerts.get(alert_id);
  if (!alert) return { success: false, error: "Alert not found" };
  if (alert.acknowledged_at) return { success: false, error: "Alert already acknowledged" };

  alert.acknowledged_at = new Date().toISOString();
  alert.acknowledged_by = acknowledged_by;
  return { success: true };
}

export function getActiveAlerts(): OperatorAlert[] {
  return Array.from(alerts.values()).filter(a => !a.acknowledged_at);
}

export function getAllAlerts(limit?: number): OperatorAlert[] {
  const all = Array.from(alerts.values());
  return limit ? all.slice(-limit) : all;
}

export function generateDailyBrief(): DailyBrief {
  const allAlerts = Array.from(alerts.values());
  const unacknowledged = allAlerts.filter(a => !a.acknowledged_at);

  const alertsSummary = {
    fatal: unacknowledged.filter(a => a.severity === "fatal").length,
    critical: unacknowledged.filter(a => a.severity === "critical").length,
    warning: unacknowledged.filter(a => a.severity === "warning").length,
    info: unacknowledged.filter(a => a.severity === "info").length,
  };

  const cards = Array.from(strategies.values());
  const totalPnl = cards.reduce((sum, c) => sum + c.daily_pnl, 0);
  const topPerformers = cards.sort((a, b) => b.daily_pnl - a.daily_pnl).slice(0, 5);

  const keyEvents: string[] = [];
  if (alertsSummary.fatal > 0) keyEvents.push(`${alertsSummary.fatal} fatal alert(s)`);
  if (cards.filter(c => c.status === "paused").length > 0) {
    keyEvents.push(`${cards.filter(c => c.status === "paused").length} paused strateg(ies)`);
  }

  const brief: DailyBrief = {
    id: `db_${crypto.randomUUID()}`,
    created_at: new Date().toISOString(),
    system_health: alertsSummary.fatal > 0 ? "critical" : alertsSummary.critical > 0 ? "degraded" : "healthy",
    strategies_count: cards.length,
    total_pnl: totalPnl,
    alerts_summary: alertsSummary,
    top_performers: topPerformers,
    key_events: keyEvents,
  };

  briefs.set(brief.id, brief);
  logger.info({ id: brief.id, health: brief.system_health }, "Daily brief generated");
  return brief;
}

export function getBrief(id: string): DailyBrief | undefined {
  return briefs.get(id);
}

export function getAllBriefs(limit?: number): DailyBrief[] {
  const all = Array.from(briefs.values());
  return limit ? all.slice(-limit) : all;
}

export function getSystemOverview(): SystemOverview {
  const cards = Array.from(strategies.values());
  const activeAlerts = getActiveAlerts();
  const fatalCount = activeAlerts.filter(a => a.severity === "fatal").length;
  const criticalCount = activeAlerts.filter(a => a.severity === "critical").length;

  const health: HealthStatus = fatalCount > 0 ? "critical" : criticalCount > 0 ? "degraded" : "healthy";

  return {
    mode: systemMode,
    active_strategies: cards.filter(c => c.status === "active").length,
    daily_pnl: cards.reduce((sum, c) => sum + c.daily_pnl, 0),
    system_health: health,
    total_alerts: activeAlerts.length,
    fatal_alerts: fatalCount,
  };
}

export function _clearDashboard(): void {
  strategies.clear();
  alerts.clear();
  briefs.clear();
  systemMode = "dev";
  fatalAlertThreshold = 0;
  criticalAlertThreshold = 0;
}
