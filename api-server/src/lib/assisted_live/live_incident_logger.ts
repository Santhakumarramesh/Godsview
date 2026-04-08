/**
 * Live Incident Logger — Phase 21
 *
 * Records safety events during assisted-live trading.
 * All incidents are immutable once created.
 * Resolution requires operator action.
 */

import { logger } from "../logger";
import crypto from "crypto";

export type IncidentSeverity = "info" | "warning" | "critical" | "emergency";
export type IncidentType =
  | "slippage_spike"
  | "data_gap"
  | "execution_timeout"
  | "risk_breach"
  | "emergency_flatten"
  | "manual_pause"
  | "kill_switch"
  | "daily_loss_breach"
  | "approval_expired"
  | "gate_failure"
  | "system_error";

export interface LiveIncident {
  incident_id: string;
  session_id?: string;
  strategy_id?: string;
  severity: IncidentSeverity;
  type: IncidentType;
  title: string;
  description?: string;
  details_json?: Record<string, unknown>;
  metrics_json?: Record<string, unknown>;
  resolved: boolean;
  resolved_by?: string;
  resolved_at?: Date;
  resolution_notes?: string;
  auto_action?: string;
  created_at: Date;
}

// In-memory store
const incidents: Map<string, LiveIncident> = new Map();

export function logIncident(params: {
  session_id?: string;
  strategy_id?: string;
  severity: IncidentSeverity;
  type: IncidentType;
  title: string;
  description?: string;
  details_json?: Record<string, unknown>;
  metrics_json?: Record<string, unknown>;
  auto_action?: string;
}): LiveIncident {
  const incident_id = `inc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const incident: LiveIncident = {
    incident_id,
    session_id: params.session_id,
    strategy_id: params.strategy_id,
    severity: params.severity,
    type: params.type,
    title: params.title,
    description: params.description,
    details_json: params.details_json,
    metrics_json: params.metrics_json,
    resolved: false,
    auto_action: params.auto_action,
    created_at: new Date(),
  };

  incidents.set(incident_id, incident);

  const logFn = params.severity === "emergency" || params.severity === "critical" ? logger.fatal.bind(logger) : logger.warn.bind(logger);
  logFn({ incident_id, severity: params.severity, type: params.type, session_id: params.session_id }, `Live incident: ${params.title}`);

  return incident;
}

export function resolveIncident(
  incident_id: string,
  resolved_by: string,
  notes?: string
): { success: boolean; incident?: LiveIncident; error?: string } {
  const incident = incidents.get(incident_id);
  if (!incident) return { success: false, error: "Incident not found" };
  if (incident.resolved) return { success: false, error: "Incident already resolved" };

  incident.resolved = true;
  incident.resolved_by = resolved_by;
  incident.resolved_at = new Date();
  incident.resolution_notes = notes;

  logger.info({ incident_id, resolved_by }, "Incident resolved");
  return { success: true, incident };
}

export function getIncidentsForSession(session_id: string): LiveIncident[] {
  return Array.from(incidents.values())
    .filter((i) => i.session_id === session_id)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export function getOpenIncidents(): LiveIncident[] {
  return Array.from(incidents.values())
    .filter((i) => !i.resolved)
    .sort((a, b) => {
      const severityOrder: Record<string, number> = { emergency: 0, critical: 1, warning: 2, info: 3 };
      return (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
    });
}

export function getAllIncidents(limit = 100): LiveIncident[] {
  return Array.from(incidents.values())
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, limit);
}

export function getIncident(incident_id: string): LiveIncident | undefined {
  return incidents.get(incident_id);
}

/** Clear — for testing */
export function _clearIncidents(): void {
  incidents.clear();
}
