/**
 * live_intelligence_monitor.ts — Live Intelligence Monitor (Phase 54)
 *
 * Real-time intelligence aggregation:
 *   1. News lockout detection — block trading during high-impact events
 *   2. Regime integration — track current market regime
 *   3. Cross-engine health monitoring
 *   4. Alert generation for anomalies
 *   5. Unified intelligence feed
 */

import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL" | "EMERGENCY";
export type AlertCategory = "NEWS_LOCKOUT" | "REGIME_CHANGE" | "ENGINE_HEALTH" | "RISK_BREACH" | "ANOMALY" | "OPPORTUNITY";

export interface IntelligenceAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  symbol?: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export interface NewsEvent {
  id: string;
  title: string;
  impact: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  symbols: string[];
  lockoutUntil: string | null;
  source: string;
  publishedAt: string;
}

export type MarketRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "CRISIS";

export interface RegimeState {
  current: MarketRegime;
  confidence: number;
  duration: number; // minutes in current regime
  previousRegime: MarketRegime | null;
  changedAt: string;
}

export interface EngineHealthStatus {
  engine: string;
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  lastHeartbeat: string;
  latencyMs: number;
  errorRate: number;
  details: string;
}

export interface IntelligenceFeed {
  timestamp: string;
  regime: RegimeState;
  newsLockout: { active: boolean; reason: string | null; until: string | null };
  activeAlerts: IntelligenceAlert[];
  engineHealth: EngineHealthStatus[];
  tradingAllowed: boolean;
  overallRisk: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
}

export interface LiveMonitorSnapshot {
  totalAlerts: number;
  activeAlerts: number;
  newsLockouts: number;
  regimeChanges: number;
  currentRegime: MarketRegime;
  tradingAllowed: boolean;
  overallRisk: string;
  engineStatuses: EngineHealthStatus[];
}

// ─── State ────────────────────────────────────────────────────────────────────

const alerts: IntelligenceAlert[] = [];
const newsEvents: NewsEvent[] = [];
let currentRegime: RegimeState = {
  current: "RANGING",
  confidence: 0.5,
  duration: 0,
  previousRegime: null,
  changedAt: new Date().toISOString(),
};
let newsLockoutActive = false;
let newsLockoutReason: string | null = null;
let newsLockoutUntil: string | null = null;
let totalAlerts = 0;
let totalLockouts = 0;
let totalRegimeChanges = 0;

const ENGINE_LIST = [
  "context_fusion", "adaptive_learning", "execution_intelligence",
  "strategy_registry", "godsview_lab", "walk_forward_stress",
  "tradingview_overlay", "macro_engine", "sentiment_engine",
];
const engineHealth = new Map<string, EngineHealthStatus>();

// Initialize all engines as healthy
for (const eng of ENGINE_LIST) {
  engineHealth.set(eng, {
    engine: eng, status: "HEALTHY",
    lastHeartbeat: new Date().toISOString(),
    latencyMs: 0, // Real values come from actual engine health monitoring
    errorRate: 0, details: "Running",
  });
}

const MAX_ALERTS = 200;

// ─── Alert System ─────────────────────────────────────────────────────────────

export function createAlert(params: {
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  symbol?: string;
  metadata?: Record<string, unknown>;
  expiresInMs?: number;
}): IntelligenceAlert {
  const { severity, category, title, message, symbol, metadata = {}, expiresInMs } = params;
  const now = new Date();
  const alert: IntelligenceAlert = {
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    severity, category, title, message, symbol, metadata,
    acknowledged: false,
    createdAt: now.toISOString(),
    expiresAt: expiresInMs ? new Date(now.getTime() + expiresInMs).toISOString() : null,
  };

  alerts.unshift(alert);
  if (alerts.length > MAX_ALERTS) alerts.pop();
  totalAlerts++;

  logger.info({ id: alert.id, severity, category, title }, "Intelligence alert created");
  return alert;
}

export function acknowledgeAlert(id: string): boolean {
  const alert = alerts.find((a) => a.id === id);
  if (!alert) return false;
  alert.acknowledged = true;
  return true;
}

export function getActiveAlerts(): IntelligenceAlert[] {
  const now = Date.now();
  return alerts.filter((a) =>
    !a.acknowledged && (!a.expiresAt || new Date(a.expiresAt).getTime() > now)
  );
}

// ─── News Lockout ─────────────────────────────────────────────────────────────

export function triggerNewsLockout(params: {
  title: string;
  impact: "HIGH" | "CRITICAL";
  symbols?: string[];
  lockoutMinutes?: number;
  source?: string;
}): NewsEvent {
  const { title, impact, symbols = [], lockoutMinutes = 30, source = "live_monitor" } = params;
  const now = new Date();
  const lockoutUntil = new Date(now.getTime() + lockoutMinutes * 60000).toISOString();

  const event: NewsEvent = {
    id: `news_${Date.now()}`,
    title, impact, symbols, lockoutUntil, source,
    publishedAt: now.toISOString(),
  };
  newsEvents.unshift(event);
  if (newsEvents.length > 50) newsEvents.pop();

  newsLockoutActive = true;
  newsLockoutReason = title;
  newsLockoutUntil = lockoutUntil;
  totalLockouts++;

  createAlert({
    severity: impact === "CRITICAL" ? "EMERGENCY" : "CRITICAL",
    category: "NEWS_LOCKOUT",
    title: `News Lockout: ${title}`,
    message: `Trading locked out until ${lockoutUntil}. Impact: ${impact}`,
    metadata: { event },
    expiresInMs: lockoutMinutes * 60000,
  });

  logger.info({ title, impact, lockoutUntil }, "News lockout triggered");
  return event;
}

export function checkNewsLockout(): { active: boolean; reason: string | null; until: string | null } {
  if (newsLockoutActive && newsLockoutUntil) {
    if (new Date(newsLockoutUntil).getTime() < Date.now()) {
      newsLockoutActive = false;
      newsLockoutReason = null;
      newsLockoutUntil = null;
    }
  }
  return { active: newsLockoutActive, reason: newsLockoutReason, until: newsLockoutUntil };
}

// ─── Regime Management ────────────────────────────────────────────────────────

export function updateRegime(newRegime: MarketRegime, confidence?: number): RegimeState {
  if (newRegime !== currentRegime.current) {
    const prev = currentRegime.current;
    currentRegime = {
      current: newRegime,
      confidence: confidence ?? 0.5,
      duration: 0,
      previousRegime: prev,
      changedAt: new Date().toISOString(),
    };
    totalRegimeChanges++;

    createAlert({
      severity: newRegime === "CRISIS" ? "EMERGENCY" : "WARNING",
      category: "REGIME_CHANGE",
      title: `Regime Change: ${prev} → ${newRegime}`,
      message: `Market regime shifted from ${prev} to ${newRegime} (confidence: ${(confidence ?? 0.5).toFixed(2)})`,
      metadata: { from: prev, to: newRegime, confidence },
    });

    logger.info({ from: prev, to: newRegime, confidence }, "Regime changed");
  } else {
    currentRegime.confidence = confidence ?? currentRegime.confidence;
    currentRegime.duration += 1;
  }
  return { ...currentRegime };
}

export function getRegime(): RegimeState {
  return { ...currentRegime };
}

// ─── Engine Health ────────────────────────────────────────────────────────────

export function updateEngineHealth(engine: string, status: EngineHealthStatus["status"], latencyMs?: number, errorRate?: number): void {
  const current = engineHealth.get(engine);
  const updated: EngineHealthStatus = {
    engine, status,
    lastHeartbeat: new Date().toISOString(),
    latencyMs: latencyMs ?? current?.latencyMs ?? 0,
    errorRate: errorRate ?? current?.errorRate ?? 0,
    details: status === "HEALTHY" ? "Running" : `Status: ${status}`,
  };
  engineHealth.set(engine, updated);

  if (status === "DOWN") {
    createAlert({
      severity: "CRITICAL", category: "ENGINE_HEALTH",
      title: `Engine DOWN: ${engine}`,
      message: `${engine} is not responding. Last latency: ${updated.latencyMs}ms`,
      metadata: { engine, status },
    });
  }
}

// ─── Intelligence Feed ────────────────────────────────────────────────────────

export function getIntelligenceFeed(): IntelligenceFeed {
  const lockout = checkNewsLockout();
  const activeAlerts = getActiveAlerts();
  const healths = Array.from(engineHealth.values());
  const downEngines = healths.filter((h) => h.status === "DOWN").length;

  let overallRisk: IntelligenceFeed["overallRisk"] = "LOW";
  if (currentRegime.current === "CRISIS" || lockout.active) overallRisk = "EXTREME";
  else if (currentRegime.current === "HIGH_VOLATILITY" || downEngines > 0) overallRisk = "HIGH";
  else if (activeAlerts.some((a) => a.severity === "CRITICAL")) overallRisk = "MEDIUM";

  const tradingAllowed = !lockout.active && overallRisk !== "EXTREME" && downEngines === 0;

  return {
    timestamp: new Date().toISOString(),
    regime: { ...currentRegime },
    newsLockout: lockout,
    activeAlerts: activeAlerts.slice(0, 20),
    engineHealth: healths,
    tradingAllowed,
    overallRisk,
  };
}

// ─── Snapshot & Reset ─────────────────────────────────────────────────────────

export function getLiveMonitorSnapshot(): LiveMonitorSnapshot {
  const lockout = checkNewsLockout();
  return {
    totalAlerts,
    activeAlerts: getActiveAlerts().length,
    newsLockouts: totalLockouts,
    regimeChanges: totalRegimeChanges,
    currentRegime: currentRegime.current,
    tradingAllowed: !lockout.active,
    overallRisk: getIntelligenceFeed().overallRisk,
    engineStatuses: Array.from(engineHealth.values()),
  };
}

export function resetLiveMonitor(): void {
  alerts.length = 0;
  newsEvents.length = 0;
  totalAlerts = 0;
  totalLockouts = 0;
  totalRegimeChanges = 0;
  newsLockoutActive = false;
  newsLockoutReason = null;
  newsLockoutUntil = null;
  currentRegime = { current: "RANGING", confidence: 0.5, duration: 0, previousRegime: null, changedAt: new Date().toISOString() };
  for (const eng of ENGINE_LIST) {
    engineHealth.set(eng, { engine: eng, status: "HEALTHY", lastHeartbeat: new Date().toISOString(), latencyMs: 0, errorRate: 0, details: "Running" });
  }
  logger.info("Live intelligence monitor reset");
}
