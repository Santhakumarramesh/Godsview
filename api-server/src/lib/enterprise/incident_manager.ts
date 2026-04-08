/**
 * Incident Manager — In-memory incident store
 *
 * Manages incident lifecycle: create, escalate, resolve.
 */

export type IncidentSeverity = "info" | "warning" | "critical" | "emergency";
export type IncidentStatus = "open" | "acknowledged" | "escalated" | "resolved";

export interface Incident {
  id: string;
  severity: IncidentSeverity;
  category: string;
  title: string;
  description?: string;
  affected_strategies?: string[];
  status: IncidentStatus;
  escalation_level: number;
  acknowledged_by?: string;
  acknowledged_at?: Date;
  resolved_by?: string;
  resolved_at?: Date;
  resolution_notes?: string;
  created_at: Date;
  updated_at: Date;
}

// In-memory store
let incidents = new Map<string, Incident>();

/**
 * Generate incident ID with eic_ prefix
 */
function generateIncidentId(): string {
  return `eic_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new incident
 */
export function createIncident(
  severity: IncidentSeverity,
  category: string,
  title: string,
  description?: string,
  affected_strategies?: string[]
): Incident {
  const now = new Date();
  const incident: Incident = {
    id: generateIncidentId(),
    severity,
    category,
    title,
    description,
    affected_strategies,
    status: "open",
    escalation_level: 0,
    created_at: now,
    updated_at: now,
  };

  incidents.set(incident.id, incident);
  return incident;
}

/**
 * Get incident by ID
 */
export function getIncident(id: string): Incident | undefined {
  return incidents.get(id);
}

/**
 * Get all open incidents
 */
export function getOpenIncidents(): Incident[] {
  return Array.from(incidents.values()).filter((i) => i.status === "open");
}

/**
 * Get all incidents with optional limit (most recent first)
 */
export function getAllIncidents(limit: number = 100): Incident[] {
  return Array.from(incidents.values())
    .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
    .slice(0, limit);
}

/**
 * Acknowledge an incident
 */
export function acknowledgeIncident(id: string, acknowledged_by: string): Incident {
  const incident = incidents.get(id);
  if (!incident) {
    throw new Error(`Incident ${id} not found`);
  }

  incident.status = "acknowledged";
  incident.acknowledged_by = acknowledged_by;
  incident.acknowledged_at = new Date();
  incident.updated_at = new Date();

  incidents.set(id, incident);
  return incident;
}

/**
 * Escalate an incident
 */
export function escalateIncident(id: string, new_level: number): Incident {
  const incident = incidents.get(id);
  if (!incident) {
    throw new Error(`Incident ${id} not found`);
  }

  incident.escalation_level = new_level;
  incident.status = "escalated";
  incident.updated_at = new Date();

  incidents.set(id, incident);
  return incident;
}

/**
 * Resolve an incident
 */
export function resolveIncident(
  id: string,
  resolved_by: string,
  notes?: string
): Incident {
  const incident = incidents.get(id);
  if (!incident) {
    throw new Error(`Incident ${id} not found`);
  }

  incident.status = "resolved";
  incident.resolved_by = resolved_by;
  incident.resolved_at = new Date();
  incident.resolution_notes = notes;
  incident.updated_at = new Date();

  incidents.set(id, incident);
  return incident;
}

/**
 * Clear all incidents (for testing)
 */
export function _clearAll() {
  incidents.clear();
}
