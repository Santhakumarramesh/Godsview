/**
 * Venue latency + outage primitives — Phase 7 surface.
 *
 * Phase 4's data-truth monitor tracked *feed* latency (market data
 * staleness). Phase 7 adds *venue* latency: round-trip time from
 * GodsView to each execution venue (Alpaca paper/live, IB, …). The
 * probe cron writes one `VenueLatencyReport` row per venue per minute;
 * anomaly detectors (Phase 7 PR5) convert breaches to
 * `venue_latency_breach` anomaly events that can auto-demote strategies
 * or trip the kill-switch:
 *
 *   venue probe cron
 *         │
 *         ▼
 *   VenueLatencyReport ──►  anomaly detector (latency breach)
 *         │                         │
 *         │                         └──►  autonomy.suspend
 *         │
 *         └──►  VenueOutageEvent (open) ──►  kill_switch trip (scope=account)
 *                                 │
 *                                 └──►  VenueOutageEvent (close) on recovery
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * Latency values are wall-clock milliseconds between probe send and
 *     vendor acknowledgement; `null` means the probe could not connect.
 *   * A venue is the *vendor routing surface* (Alpaca US Equities, IB CFE,
 *     etc.). One broker adapter can front multiple venues.
 */
import { z } from "zod";
import { BrokerAdapterStatusSchema } from "./brokers.js";

// ──────────────────────────── venue identity ─────────────────────────

/**
 * Venue identifier — the execution surface a broker adapter routes to.
 * Enumerated here for discoverability; adding a new value is a schema
 * migration + venue registry entry.
 */
export const VenueKindSchema = z.enum([
  "alpaca_us_equity",
  "alpaca_crypto",
  "ib_us_equity",
  "ib_us_options",
  "ib_futures",
  "ib_forex",
  "internal_paper",
  "other",
]);
export type VenueKind = z.infer<typeof VenueKindSchema>;

// ──────────────────────────── latency reports ────────────────────────

/**
 * Rolling latency snapshot for a single venue. The probe cron writes
 * one row per venue per minute; the live gate reads the most recent row
 * for the venue a route would target, and blocks the route if p95 breaches
 * the configured ceiling.
 */
export const VenueLatencyReportSchema = z.object({
  id: z.string(),
  venue: VenueKindSchema,
  /** Adapter id the probe ran against; null if the venue has no adapter yet. */
  adapterId: z.string().nullable(),
  sampleCount: z.number().int().nonnegative(),
  latencyP50Ms: z.number().nonnegative().nullable(),
  latencyP95Ms: z.number().nonnegative().nullable(),
  latencyP99Ms: z.number().nonnegative().nullable(),
  errorRate: z.number().min(0).max(1),
  status: BrokerAdapterStatusSchema,
  /** Latency ceiling at report time; informational for drill-downs. */
  latencyP95CeilingMs: z.number().nonnegative().nullable(),
  /** Operator-readable note attached at write time. */
  notes: z.string().nullable(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  observedAt: z.string().datetime(),
});
export type VenueLatencyReport = z.infer<typeof VenueLatencyReportSchema>;

export const VenueLatencyReportsListSchema = z.object({
  reports: z.array(VenueLatencyReportSchema),
  total: z.number().int().nonnegative(),
});
export type VenueLatencyReportsList = z.infer<
  typeof VenueLatencyReportsListSchema
>;

export const VenueLatencyFilterSchema = z.object({
  venue: VenueKindSchema.optional(),
  adapterId: z.string().optional(),
  status: BrokerAdapterStatusSchema.optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type VenueLatencyFilter = z.infer<typeof VenueLatencyFilterSchema>;

// ──────────────────────────── outage events ──────────────────────────

/**
 * Append-only outage row. One row per trip; `closedAt` is filled when the
 * venue recovers. Outage rows back the `/ops/venues` incident panel and
 * feed the kill-switch `automated_broker_health` trigger.
 */
export const VenueOutageTriggerSchema = z.enum([
  "probe_timeout",
  "probe_error_threshold",
  "latency_breach",
  "broker_reported",
  "operator_declared",
]);
export type VenueOutageTrigger = z.infer<typeof VenueOutageTriggerSchema>;

export const VenueOutageEventSchema = z.object({
  id: z.string(),
  venue: VenueKindSchema,
  adapterId: z.string().nullable(),
  trigger: VenueOutageTriggerSchema,
  /** Human-readable reason captured at trip time. */
  reason: z.string(),
  /** True while the outage is open; false once the venue recovers. */
  open: z.boolean(),
  /** Optional kill-switch event id if this outage tripped the switch. */
  killSwitchEventId: z.string().nullable(),
  /** Optional governance anomaly id if this outage raised an anomaly. */
  anomalyId: z.string().nullable(),
  startedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type VenueOutageEvent = z.infer<typeof VenueOutageEventSchema>;

export const VenueOutageEventsListSchema = z.object({
  events: z.array(VenueOutageEventSchema),
  total: z.number().int().nonnegative(),
});
export type VenueOutageEventsList = z.infer<
  typeof VenueOutageEventsListSchema
>;

export const VenueOutageFilterSchema = z.object({
  venue: VenueKindSchema.optional(),
  adapterId: z.string().optional(),
  open: z.boolean().optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type VenueOutageFilter = z.infer<typeof VenueOutageFilterSchema>;

// ──────────────────────────── registry summary ───────────────────────

/**
 * Aggregated per-venue state the `/ops/venues` page surfaces at the top of
 * the view. `quorum` records how many healthy venues the operator currently
 * has across all connected adapters.
 */
export const VenueRegistryRowSchema = z.object({
  venue: VenueKindSchema,
  adapterId: z.string().nullable(),
  status: BrokerAdapterStatusSchema,
  latencyP95Ms: z.number().nonnegative().nullable(),
  errorRate: z.number().min(0).max(1),
  outageOpen: z.boolean(),
  lastReportAt: z.string().datetime().nullable(),
});
export type VenueRegistryRow = z.infer<typeof VenueRegistryRowSchema>;

export const VenueRegistryQuorumSchema = z.object({
  total: z.number().int().nonnegative(),
  healthy: z.number().int().nonnegative(),
  degraded: z.number().int().nonnegative(),
  down: z.number().int().nonnegative(),
});
export type VenueRegistryQuorum = z.infer<typeof VenueRegistryQuorumSchema>;

export const VenueRegistrySummarySchema = z.object({
  venues: z.array(VenueRegistryRowSchema),
  quorum: VenueRegistryQuorumSchema,
  openOutages: z.number().int().nonnegative(),
  observedAt: z.string().datetime(),
});
export type VenueRegistrySummary = z.infer<typeof VenueRegistrySummarySchema>;
