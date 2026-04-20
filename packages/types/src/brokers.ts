/**
 * Multi-broker expansion primitives — Phase 7 surface.
 *
 * Phase 4 wired Alpaca (paper + live) through a single-kind adapter. Phase 7
 * promotes the adapter to a *registry*: every broker connection is stored
 * as a `BrokerAdapter` row, every (adapter, account) pair is stored as a
 * `BrokerAccountBinding`, and every adapter exposes a unified
 * `BrokerHealthSnapshot` so the live gate can quorum-check across vendors:
 *
 *   BrokerAdapter (alpaca_paper, alpaca_live, ib_paper, ib_live, …)
 *         │
 *         ├──►  BrokerAccountBinding (adapterId + accountId + role)
 *         │
 *         └──►  BrokerHealthSnapshot (status + latency + probe history)
 *
 * A failing adapter is *not* allowed to fill live orders; the portfolio
 * rebalancer + autonomy FSM both consult the latest health snapshot before
 * routing. Anomaly detectors (Phase 7 PR5) can auto-demote a strategy or
 * auto-trip the kill-switch when an adapter enters the `down` status.
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * Adapter config is vendor-specific and held in `system_config.brokers.*`;
 *     wire payloads carry only the non-secret projection (host, venue, role).
 *   * Secrets never leave the server — `apiKeyMasked` is the UI surface.
 */
import { z } from "zod";

// ──────────────────────────── adapter kinds ──────────────────────────

/**
 * Canonical broker adapter kind. Paper variants use the same wire protocol
 * as their live counterparts but are routed to sandbox endpoints and are
 * allowed to fill regardless of kill-switch state (paper bypasses the
 * live gate). Adding a vendor is a schema migration + registry entry.
 */
export const BrokerAdapterKindSchema = z.enum([
  "alpaca_paper",
  "alpaca_live",
  "ib_paper",
  "ib_live",
]);
export type BrokerAdapterKind = z.infer<typeof BrokerAdapterKindSchema>;

/**
 * Execution role an adapter plays. `primary` adapters take live order
 * flow; `secondary` adapters mirror intents for shadow accounting;
 * `paper` adapters are strictly sandboxed.
 */
export const BrokerAdapterRoleSchema = z.enum([
  "primary",
  "secondary",
  "paper",
]);
export type BrokerAdapterRole = z.infer<typeof BrokerAdapterRoleSchema>;

export const BrokerAdapterStatusSchema = z.enum([
  "healthy",
  "degraded",
  "down",
  "unknown",
]);
export type BrokerAdapterStatus = z.infer<typeof BrokerAdapterStatusSchema>;

// ──────────────────────────── adapter rows ───────────────────────────

/**
 * Registry row for one connected broker adapter. `apiKeyMasked` is the
 * last-4 projection surfaced to the UI; the full key lives server-side
 * in `system_config.brokers.<adapterId>.credentials`.
 */
export const BrokerAdapterSchema = z.object({
  id: z.string(),
  kind: BrokerAdapterKindSchema,
  role: BrokerAdapterRoleSchema,
  displayName: z.string(),
  /** Host + venue the adapter targets, e.g. "api.alpaca.markets". */
  host: z.string(),
  /** Masked projection of the active API key (e.g. "••••1234"). */
  apiKeyMasked: z.string().nullable(),
  /** Latest status snapshot id, for drilldown into probe history. */
  latestSnapshotId: z.string().nullable(),
  status: BrokerAdapterStatusSchema,
  /** True if the adapter may route live orders right now. */
  liveEnabled: z.boolean(),
  /** True if the adapter should be probed by the health cron. */
  probeEnabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BrokerAdapter = z.infer<typeof BrokerAdapterSchema>;

export const BrokerAdaptersListSchema = z.object({
  adapters: z.array(BrokerAdapterSchema),
});
export type BrokerAdaptersList = z.infer<typeof BrokerAdaptersListSchema>;

export const BrokerAdapterRegisterRequestSchema = z.object({
  kind: BrokerAdapterKindSchema,
  role: BrokerAdapterRoleSchema,
  displayName: z.string().min(1).max(120),
  host: z.string().min(1).max(253),
  /**
   * API credential blob. Server stores the secret and returns only the
   * masked projection; the raw value must never echo back over the wire.
   */
  apiKey: z.string().min(1).max(512),
  apiSecret: z.string().min(1).max(1024).nullable().optional(),
  liveEnabled: z.boolean().optional(),
  probeEnabled: z.boolean().optional(),
});
export type BrokerAdapterRegisterRequest = z.infer<
  typeof BrokerAdapterRegisterRequestSchema
>;

export const BrokerAdapterUpdateRequestSchema = z.object({
  role: BrokerAdapterRoleSchema.optional(),
  displayName: z.string().min(1).max(120).optional(),
  liveEnabled: z.boolean().optional(),
  probeEnabled: z.boolean().optional(),
  reason: z.string().min(3).max(280),
});
export type BrokerAdapterUpdateRequest = z.infer<
  typeof BrokerAdapterUpdateRequestSchema
>;

// ──────────────────────────── account bindings ───────────────────────

/**
 * One row per (adapter, broker-account-id) pair. The portfolio engine
 * rolls up positions across bindings that share an `accountId`; the live
 * gate uses the binding to pick an adapter when a strategy fires.
 */
export const BrokerAccountBindingSchema = z.object({
  id: z.string(),
  adapterId: z.string(),
  /** Internal GodsView account id this binding belongs to. */
  accountId: z.string(),
  /** Vendor-supplied account identifier (e.g. Alpaca account UUID). */
  externalAccountId: z.string(),
  displayName: z.string(),
  role: BrokerAdapterRoleSchema,
  /** True when live intents may route via this binding. */
  enabled: z.boolean(),
  /** Soft weight for adapter selection when multiple bindings qualify. */
  weight: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BrokerAccountBinding = z.infer<typeof BrokerAccountBindingSchema>;

export const BrokerAccountBindingsListSchema = z.object({
  bindings: z.array(BrokerAccountBindingSchema),
});
export type BrokerAccountBindingsList = z.infer<
  typeof BrokerAccountBindingsListSchema
>;

export const BrokerAccountBindingRequestSchema = z.object({
  adapterId: z.string(),
  accountId: z.string(),
  externalAccountId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(120),
  role: BrokerAdapterRoleSchema,
  weight: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
});
export type BrokerAccountBindingRequest = z.infer<
  typeof BrokerAccountBindingRequestSchema
>;

// ──────────────────────────── health snapshots ───────────────────────

/**
 * Rolling health snapshot for a broker adapter. The probe cron writes one
 * row per adapter per minute; the live gate reads the most-recent row.
 * Latency columns are wire-level p50/p95/p99 in milliseconds over the
 * `sampleCount` probes that fed this snapshot.
 */
export const BrokerHealthSnapshotSchema = z.object({
  id: z.string(),
  adapterId: z.string(),
  status: BrokerAdapterStatusSchema,
  /** Most recent probe result — null if the probe window saw no traffic. */
  lastProbeAt: z.string().datetime().nullable(),
  /** Probes that populated this snapshot. */
  sampleCount: z.number().int().nonnegative(),
  latencyP50Ms: z.number().nonnegative().nullable(),
  latencyP95Ms: z.number().nonnegative().nullable(),
  latencyP99Ms: z.number().nonnegative().nullable(),
  /** Rolling error rate across `sampleCount` probes (0.0 – 1.0). */
  errorRate: z.number().min(0).max(1),
  /** Human-readable reason captured at snapshot time. */
  notes: z.string().nullable(),
  observedAt: z.string().datetime(),
});
export type BrokerHealthSnapshot = z.infer<typeof BrokerHealthSnapshotSchema>;

export const BrokerHealthSnapshotsListSchema = z.object({
  snapshots: z.array(BrokerHealthSnapshotSchema),
  total: z.number().int().nonnegative(),
});
export type BrokerHealthSnapshotsList = z.infer<
  typeof BrokerHealthSnapshotsListSchema
>;

export const BrokerHealthFilterSchema = z.object({
  adapterId: z.string().optional(),
  status: BrokerAdapterStatusSchema.optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type BrokerHealthFilter = z.infer<typeof BrokerHealthFilterSchema>;

// ──────────────────────────── registry summary ───────────────────────

/**
 * Aggregated adapter registry state — what the `/admin/brokers` page
 * needs at a glance. `quorum` records how many primary adapters are
 * currently healthy; the live gate requires `quorum.healthy >= 1`.
 */
export const BrokerRegistryQuorumSchema = z.object({
  total: z.number().int().nonnegative(),
  healthy: z.number().int().nonnegative(),
  degraded: z.number().int().nonnegative(),
  down: z.number().int().nonnegative(),
});
export type BrokerRegistryQuorum = z.infer<typeof BrokerRegistryQuorumSchema>;

export const BrokerRegistrySummarySchema = z.object({
  adapters: z.array(BrokerAdapterSchema),
  quorum: BrokerRegistryQuorumSchema,
  /** True if at least one primary adapter is healthy. */
  liveRoutable: z.boolean(),
  observedAt: z.string().datetime(),
});
export type BrokerRegistrySummary = z.infer<typeof BrokerRegistrySummarySchema>;
