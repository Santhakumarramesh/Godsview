import { z } from "zod";

// ─── SLOs ─────────────────────────────────────────────────────────
export const SloSchema = z.object({
  id: z.string(),
  key: z.string(),
  description: z.string(),
  target: z.string(),
  windowSeconds: z.number().int().positive(),
  ownerTeam: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Slo = z.infer<typeof SloSchema>;

export const SloListSchema = z.object({
  slos: z.array(SloSchema),
  total: z.number().int().nonnegative(),
});
export type SloList = z.infer<typeof SloListSchema>;

export const CreateSloRequestSchema = z.object({
  key: z.string().min(1),
  description: z.string().default(""),
  target: z.string().min(1),
  windowSeconds: z.number().int().positive(),
  ownerTeam: z.string().default("platform"),
});
export type CreateSloRequest = z.infer<typeof CreateSloRequestSchema>;

// ─── Alerts ───────────────────────────────────────────────────────
export const AlertSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertStatusSchema = z.enum(["open", "acknowledged", "resolved"]);
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

export const AlertSchema = z.object({
  id: z.string(),
  sloKey: z.string().nullable(),
  severity: AlertSeveritySchema,
  status: AlertStatusSchema,
  title: z.string(),
  description: z.string(),
  runbookUrl: z.string().nullable(),
  openedAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedBy: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  details: z.record(z.unknown()),
});
export type Alert = z.infer<typeof AlertSchema>;

export const AlertListSchema = z.object({
  alerts: z.array(AlertSchema),
  total: z.number().int().nonnegative(),
});
export type AlertList = z.infer<typeof AlertListSchema>;

// ─── Incidents ────────────────────────────────────────────────────
export const IncidentStatusSchema = z.enum([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  severity: AlertSeveritySchema,
  status: IncidentStatusSchema,
  summary: z.string(),
  postmortemUrl: z.string().nullable(),
  openedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  ownerUserId: z.string().nullable(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const IncidentListSchema = z.object({
  incidents: z.array(IncidentSchema),
  total: z.number().int().nonnegative(),
});
export type IncidentList = z.infer<typeof IncidentListSchema>;

// ─── Deployments ──────────────────────────────────────────────────
export const DeploymentSchema = z.object({
  id: z.string(),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  status: z.string(),
  initiator: z.string().nullable(),
  commitSha: z.string().nullable(),
  rollbackOf: z.string().nullable(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export const DeploymentListSchema = z.object({
  deployments: z.array(DeploymentSchema),
  total: z.number().int().nonnegative(),
});
export type DeploymentList = z.infer<typeof DeploymentListSchema>;

// ─── Latency ──────────────────────────────────────────────────────
export const LatencyBucketSchema = z.object({
  p50Ms: z.number(),
  p95Ms: z.number(),
  p99Ms: z.number(),
  sampleCount: z.number().int(),
  bucketStart: z.string().datetime(),
});
export type LatencyBucket = z.infer<typeof LatencyBucketSchema>;

export const LatencySeriesSchema = z.object({
  service: z.string(),
  operation: z.string(),
  windowSeconds: z.number().int().positive(),
  buckets: z.array(LatencyBucketSchema),
});
export type LatencySeries = z.infer<typeof LatencySeriesSchema>;

// ─── Logs ─────────────────────────────────────────────────────────
export const LogLevelSchema = z.enum(["debug", "info", "warning", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogLineSchema = z.object({
  timestamp: z.string().datetime(),
  level: LogLevelSchema,
  source: z.string(),
  message: z.string(),
  correlationId: z.string().nullable(),
  actorEmail: z.string().nullable(),
});
export type LogLine = z.infer<typeof LogLineSchema>;

export const LogTailSchema = z.object({
  lines: z.array(LogLineSchema),
  total: z.number().int().nonnegative(),
});
export type LogTail = z.infer<typeof LogTailSchema>;
