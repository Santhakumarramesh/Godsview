/**
 * Mobile operator inbox primitives — Phase 7 surface.
 *
 * The read-only mobile inbox is the thin surface a roaming operator uses
 * to keep eyes on the system between desktop sessions. It *never* mutates
 * state — every row is a pointer into a first-class governance object
 * that must be actioned on desktop:
 *
 *   MobileInboxItem ──►  deepLink ──►  /governance/approvals/<id>
 *                                      /governance/anomalies/<id>
 *                                      /execution/killswitch
 *                                      /portfolio/drawdown
 *                                      /portfolio/rebalance/<id>
 *
 * The feed is cursor-paginated and filtered by `kind + severity`; the
 * server ranks new items by the underlying object's freshness and the
 * operator's subscription matrix (Phase 7 PR6 config). Push notifications
 * are delivered out-of-band (APNs / FCM) and carry the same deep link.
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * `deepLink` is a relative path into the desktop app (e.g.
 *     "/governance/approvals/approval_123"); clients prepend the
 *     configured base URL when rendering.
 *   * Items are idempotent — the feed re-emits the same `id` while the
 *     underlying object remains actionable, and retires the `id` once
 *     the object is resolved.
 */
import { z } from "zod";

// ──────────────────────────── taxonomy ───────────────────────────────

/**
 * Kind of object an inbox item points at. The UI renders each kind with
 * its own icon + summary line; the server filters on this enum.
 */
export const MobileInboxItemKindSchema = z.enum([
  "approval",
  "anomaly",
  "kill_switch",
  "drawdown",
  "rebalance",
  "broker_outage",
  "venue_outage",
  "autonomy_change",
  "governance_decision",
]);
export type MobileInboxItemKind = z.infer<typeof MobileInboxItemKindSchema>;

export const MobileInboxSeveritySchema = z.enum([
  "info",
  "warn",
  "critical",
]);
export type MobileInboxSeverity = z.infer<typeof MobileInboxSeveritySchema>;

export const MobileInboxStatusSchema = z.enum([
  "open",
  "acknowledged",
  "resolved",
]);
export type MobileInboxStatus = z.infer<typeof MobileInboxStatusSchema>;

// ──────────────────────────── item rows ──────────────────────────────

/**
 * One inbox row. The server is the source of truth for `status`; the
 * mobile client renders the row as-is and cannot mutate it. `subjectKey`
 * is the first-class object id (approval id, anomaly id, plan id, …) so
 * the desktop UI can deep-link directly to the detail drawer.
 */
export const MobileInboxItemSchema = z.object({
  id: z.string(),
  kind: MobileInboxItemKindSchema,
  severity: MobileInboxSeveritySchema,
  status: MobileInboxStatusSchema,
  title: z.string(),
  summary: z.string(),
  /** First-class object id this row points at. */
  subjectKey: z.string(),
  /** Secondary key (e.g. strategyId on an anomaly). Null if unused. */
  subjectSecondaryKey: z.string().nullable(),
  /** Relative URL into the desktop app. */
  deepLink: z.string(),
  /** Optional structured badges the mobile UI renders inline. */
  badges: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** Null while `status === "open"`. */
  acknowledgedAt: z.string().datetime().nullable(),
  /** Null until the underlying object resolves. */
  resolvedAt: z.string().datetime().nullable(),
});
export type MobileInboxItem = z.infer<typeof MobileInboxItemSchema>;

// ──────────────────────────── pagination ────────────────────────────

export const MobileInboxListSchema = z.object({
  items: z.array(MobileInboxItemSchema),
  /** Cursor for the next page; null when the feed is exhausted. */
  nextCursor: z.string().nullable(),
  /** Total across the filter window; the UI only uses this for badges. */
  total: z.number().int().nonnegative(),
  /** Unread count (status = "open") across the filter window. */
  unread: z.number().int().nonnegative(),
  /** Server-time at which the page was assembled. */
  observedAt: z.string().datetime(),
});
export type MobileInboxList = z.infer<typeof MobileInboxListSchema>;

export const MobileInboxFilterSchema = z.object({
  kind: MobileInboxItemKindSchema.optional(),
  severity: MobileInboxSeveritySchema.optional(),
  status: MobileInboxStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type MobileInboxFilter = z.infer<typeof MobileInboxFilterSchema>;

// ──────────────────────────── acknowledgement ─────────────────────────

/**
 * Acknowledge a row — the only mutation the mobile client performs. The
 * server flips `status` to `acknowledged` and records a row in
 * `mobile_inbox_ack_events` for audit.
 */
export const MobileInboxAckRequestSchema = z.object({
  id: z.string(),
  note: z.string().min(0).max(280).optional(),
});
export type MobileInboxAckRequest = z.infer<
  typeof MobileInboxAckRequestSchema
>;

// ──────────────────────────── summary card ───────────────────────────

/**
 * Thin summary the mobile dashboard renders above the feed. The counts
 * are derived from the full inbox (not the paginated page).
 */
export const MobileInboxSummarySchema = z.object({
  open: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  warn: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
  /** Most recent `observedAt` across the operator's subscription. */
  observedAt: z.string().datetime(),
  /** True if the server throttled the feed (e.g. > 1k open items). */
  throttled: z.boolean(),
});
export type MobileInboxSummary = z.infer<typeof MobileInboxSummarySchema>;
