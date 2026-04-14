/**
 * incident_management/index.ts — Phase 68: Incident Management
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. IncidentEngine       — incident lifecycle with severity.
 *   2. IncidentTimeline     — timeline events with categorization.
 *   3. PostmortemBuilder    — blameless postmortem with sections.
 *   4. OncallDirectory      — rotation schedule + handoff.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Incidents ──────────────────────────────────────────────────────────────

export type IncidentSeverity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type IncidentStatus = "detected" | "investigating" | "mitigating" | "monitoring" | "resolved" | "closed";

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  detectedAt: number;
  resolvedAt?: number;
  closedAt?: number;
  commander?: string;
  services: string[];
  customerImpact: string;
  createdAt: number;
  updatedAt: number;
}

export class IncidentEngine {
  private readonly incidents = new Map<string, Incident>();

  declare(params: {
    title: string;
    description: string;
    severity: IncidentSeverity;
    services?: string[];
    customerImpact?: string;
    commander?: string;
  }): Incident {
    const id = `inc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const incident: Incident = {
      id,
      title: params.title,
      description: params.description,
      severity: params.severity,
      status: "detected",
      detectedAt: now,
      commander: params.commander,
      services: params.services ?? [],
      customerImpact: params.customerImpact ?? "unknown",
      createdAt: now,
      updatedAt: now,
    };
    this.incidents.set(id, incident);
    logger.warn({ incidentId: id, severity: params.severity }, "[Incident] Declared");
    return incident;
  }

  transition(id: string, status: IncidentStatus, actor?: string): Incident | null {
    const incident = this.incidents.get(id);
    if (!incident) return null;
    incident.status = status;
    incident.updatedAt = Date.now();
    if (status === "resolved" && !incident.resolvedAt) incident.resolvedAt = incident.updatedAt;
    if (status === "closed" && !incident.closedAt) incident.closedAt = incident.updatedAt;
    logger.info({ incidentId: id, status, actor }, "[Incident] Transition");
    return incident;
  }

  assignCommander(id: string, commander: string): Incident | null {
    const incident = this.incidents.get(id);
    if (!incident) return null;
    incident.commander = commander;
    incident.updatedAt = Date.now();
    return incident;
  }

  get(id: string): Incident | null {
    return this.incidents.get(id) ?? null;
  }

  list(filter?: { status?: IncidentStatus; severity?: IncidentSeverity }): Incident[] {
    let out = Array.from(this.incidents.values());
    if (filter?.status) out = out.filter((i) => i.status === filter.status);
    if (filter?.severity) out = out.filter((i) => i.severity === filter.severity);
    return out.sort((a, b) => b.detectedAt - a.detectedAt);
  }

  open(): Incident[] {
    return this.list().filter((i) => i.status !== "resolved" && i.status !== "closed");
  }

  mttr(sinceMs = 30 * 24 * 60 * 60 * 1000): { count: number; avgMinutes: number } {
    const since = Date.now() - sinceMs;
    const resolved = this.list().filter((i) => i.resolvedAt && i.detectedAt >= since);
    if (resolved.length === 0) return { count: 0, avgMinutes: 0 };
    const total = resolved.reduce((s, i) => s + (i.resolvedAt! - i.detectedAt), 0);
    return { count: resolved.length, avgMinutes: total / resolved.length / 60_000 };
  }
}

// ── Timeline ───────────────────────────────────────────────────────────────

export type TimelineEventKind = "detection" | "comms" | "investigation" | "action" | "observation" | "resolution" | "note";

export interface TimelineEvent {
  id: string;
  incidentId: string;
  at: number;
  kind: TimelineEventKind;
  actor: string;
  message: string;
  data?: Record<string, unknown>;
}

export class IncidentTimeline {
  private readonly events: TimelineEvent[] = [];

  append(params: {
    incidentId: string;
    kind: TimelineEventKind;
    actor: string;
    message: string;
    data?: Record<string, unknown>;
  }): TimelineEvent {
    const event: TimelineEvent = {
      id: `tl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      ...params,
    };
    this.events.push(event);
    if (this.events.length > 50_000) this.events.shift();
    return event;
  }

  forIncident(incidentId: string): TimelineEvent[] {
    return this.events.filter((e) => e.incidentId === incidentId).sort((a, b) => a.at - b.at);
  }
}

// ── Postmortem ─────────────────────────────────────────────────────────────

export interface PostmortemSection {
  title: string;
  body: string;
}

export interface ActionItem {
  id: string;
  title: string;
  owner: string;
  status: "open" | "in_progress" | "done";
  dueAt?: number;
}

export interface Postmortem {
  id: string;
  incidentId: string;
  author: string;
  createdAt: number;
  finalizedAt?: number;
  status: "draft" | "in_review" | "finalized";
  summary: string;
  sections: PostmortemSection[];
  actionItems: ActionItem[];
  contributingFactors: string[];
  customerImpactSummary: string;
  rootCause: string;
  whatWentWell: string[];
  whatWentPoorly: string[];
  luck: string[];
}

export class PostmortemBuilder {
  private readonly postmortems = new Map<string, Postmortem>();

  draft(params: { incidentId: string; author: string }): Postmortem {
    const id = `pm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const postmortem: Postmortem = {
      id,
      incidentId: params.incidentId,
      author: params.author,
      createdAt: Date.now(),
      status: "draft",
      summary: "",
      sections: [],
      actionItems: [],
      contributingFactors: [],
      customerImpactSummary: "",
      rootCause: "",
      whatWentWell: [],
      whatWentPoorly: [],
      luck: [],
    };
    this.postmortems.set(id, postmortem);
    return postmortem;
  }

  update(id: string, patch: Partial<Postmortem>): Postmortem | null {
    const pm = this.postmortems.get(id);
    if (!pm) return null;
    Object.assign(pm, patch);
    return pm;
  }

  addActionItem(id: string, item: Omit<ActionItem, "id">): Postmortem | null {
    const pm = this.postmortems.get(id);
    if (!pm) return null;
    pm.actionItems.push({ id: `ai_${Math.random().toString(36).slice(2, 8)}`, ...item });
    return pm;
  }

  finalize(id: string): Postmortem | null {
    const pm = this.postmortems.get(id);
    if (!pm) return null;
    pm.status = "finalized";
    pm.finalizedAt = Date.now();
    return pm;
  }

  forIncident(incidentId: string): Postmortem | null {
    return Array.from(this.postmortems.values()).find((p) => p.incidentId === incidentId) ?? null;
  }

  get(id: string): Postmortem | null {
    return this.postmortems.get(id) ?? null;
  }

  list(): Postmortem[] {
    return Array.from(this.postmortems.values());
  }
}

// ── Oncall Directory ───────────────────────────────────────────────────────

export interface OncallShift {
  id: string;
  userId: string;
  userName: string;
  role: "primary" | "secondary" | "commander";
  service: string;
  startsAt: number;
  endsAt: number;
}

export class OncallDirectory {
  private readonly shifts: OncallShift[] = [];

  schedule(params: Omit<OncallShift, "id">): OncallShift {
    const shift: OncallShift = {
      id: `oc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      ...params,
    };
    this.shifts.push(shift);
    return shift;
  }

  currentOncall(service: string, at = Date.now()): OncallShift[] {
    return this.shifts.filter((s) => s.service === service && s.startsAt <= at && s.endsAt > at);
  }

  upcoming(service: string, withinMs = 7 * 24 * 60 * 60 * 1000): OncallShift[] {
    const now = Date.now();
    const until = now + withinMs;
    return this.shifts.filter((s) => s.service === service && s.startsAt > now && s.startsAt <= until)
      .sort((a, b) => a.startsAt - b.startsAt);
  }

  list(): OncallShift[] {
    return [...this.shifts].sort((a, b) => a.startsAt - b.startsAt);
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const incidentEngine = new IncidentEngine();
export const incidentTimeline = new IncidentTimeline();
export const postmortemBuilder = new PostmortemBuilder();
export const oncallDirectory = new OncallDirectory();
