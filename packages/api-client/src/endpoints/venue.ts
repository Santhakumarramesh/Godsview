/**
 * @gv/api-client — Phase 7 venue latency + outage endpoints.
 *
 * Surfaces served by services/control_plane/app/routes/venue.py:
 *
 *   api.venue.latency              — rolling latency reports + filters
 *   api.venue.outages              — open + historical outage events
 *   api.venue.registry             — aggregated registry summary
 *
 * The venue probe cron writes a `VenueLatencyReport` per venue per minute.
 * Breaches trigger `VenueOutageEvent` rows (open until the venue recovers)
 * and optionally raise anomalies / trip the kill-switch depending on
 * severity + subscription policy.
 *
 * Outage close is operator-driven on `operator_declared` outages and
 * automatic on `probe_*` / `latency_breach` outages (the cron closes them
 * once the probe series stabilises inside the configured ceiling).
 */
import type {
  VenueLatencyFilter,
  VenueLatencyReport,
  VenueLatencyReportsList,
  VenueOutageEvent,
  VenueOutageEventsList,
  VenueOutageFilter,
  VenueRegistrySummary,
} from "@gv/types";
import type { ApiClient } from "../client.js";

// ───────────────────────────── query-string helper ──────────────────────

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ───────────────────────────── latency ─────────────────────────────────

export interface VenueLatencyEndpoints {
  /** GET /venue/latency — rolling probe snapshots with filter support. */
  list: (filter?: VenueLatencyFilter) => Promise<VenueLatencyReportsList>;
  /** GET /venue/latency/:id — single report row. */
  get: (id: string) => Promise<VenueLatencyReport>;
  /**
   * POST /venue/latency/probe — ad-hoc probe against a specific venue.
   * Admin-gated. Returns the report the probe wrote.
   */
  probe: (venue: string, adapterId?: string) => Promise<VenueLatencyReport>;
}

export function venueLatencyEndpoints(
  client: ApiClient,
): VenueLatencyEndpoints {
  return {
    list: (filter = { limit: 100 } as VenueLatencyFilter) =>
      client.get<VenueLatencyReportsList>(`/venue/latency${qs(filter)}`),
    get: (id) =>
      client.get<VenueLatencyReport>(
        `/venue/latency/${encodeURIComponent(id)}`,
      ),
    probe: (venue, adapterId) =>
      client.post<VenueLatencyReport>(
        `/venue/latency/probe`,
        adapterId ? { venue, adapterId } : { venue },
      ),
  };
}

// ───────────────────────────── outages ─────────────────────────────────

export interface VenueOutageEndpoints {
  /** GET /venue/outages — filter by venue / adapter / open flag. */
  list: (filter?: VenueOutageFilter) => Promise<VenueOutageEventsList>;
  /** GET /venue/outages/:id */
  get: (id: string) => Promise<VenueOutageEvent>;
  /**
   * POST /venue/outages — operator-declared outage row. The live gate
   * treats operator-declared outages the same as probe-detected ones
   * until they close.
   */
  declare: (req: {
    venue: string;
    adapterId?: string;
    reason: string;
  }) => Promise<VenueOutageEvent>;
  /**
   * POST /venue/outages/:id/close — close an open outage. Admin-gated;
   * auto-outages close themselves when probe health recovers.
   */
  close: (id: string, reason: string) => Promise<VenueOutageEvent>;
}

export function venueOutageEndpoints(
  client: ApiClient,
): VenueOutageEndpoints {
  return {
    list: (filter = { limit: 100 } as VenueOutageFilter) =>
      client.get<VenueOutageEventsList>(`/venue/outages${qs(filter)}`),
    get: (id) =>
      client.get<VenueOutageEvent>(
        `/venue/outages/${encodeURIComponent(id)}`,
      ),
    declare: (req) => client.post<VenueOutageEvent>(`/venue/outages`, req),
    close: (id, reason) =>
      client.post<VenueOutageEvent>(
        `/venue/outages/${encodeURIComponent(id)}/close`,
        { reason },
      ),
  };
}

// ───────────────────────────── registry ────────────────────────────────

export interface VenueRegistryEndpoints {
  /** GET /venue/registry — aggregated per-venue state for the ops page. */
  summary: () => Promise<VenueRegistrySummary>;
}

export function venueRegistryEndpoints(
  client: ApiClient,
): VenueRegistryEndpoints {
  return {
    summary: () => client.get<VenueRegistrySummary>(`/venue/registry`),
  };
}
