import { z } from "zod";

/**
 * Wire shape returned by GET /admin/audit/events. Distinct from the
 * legacy `AuditEvent` schema in audit.ts which uses a nested actor +
 * resource envelope. The new admin surface mirrors the DB columns
 * directly so the dashboard can render without an extra mapping step.
 */
export const AuditEventRowSchema = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  actorUserId: z.string().nullable(),
  actorEmail: z.string().email().nullable(),
  sourceIp: z.string().nullable(),
  userAgent: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  outcome: z.string(),
  correlationId: z.string(),
  details: z.record(z.unknown()).default({}),
});
export type AuditEventRow = z.infer<typeof AuditEventRowSchema>;

export const AuditEventListSchema = z.object({
  events: z.array(AuditEventRowSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable().optional(),
});
export type AuditEventList = z.infer<typeof AuditEventListSchema>;

export const AuditEventQuerySchema = z.object({
  action: z.string().optional(),
  actorUserId: z.string().optional(),
  resourceType: z.string().optional(),
  outcome: z.string().optional(),
  fromTs: z.string().datetime().optional(),
  toTs: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  beforeId: z.string().optional(),
});
export type AuditEventQuery = z.infer<typeof AuditEventQuerySchema>;

export const AuditExportSchema = z.object({
  id: z.string(),
  requestedBy: z.string(),
  format: z.enum(["csv", "jsonl"]),
  filters: z.record(z.unknown()),
  status: z.enum(["pending", "running", "ready", "failed"]),
  rowCount: z.number().int().nullable(),
  artifactKey: z.string().nullable(),
  error: z.string().nullable(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  downloadUrl: z.string().nullable().optional(),
});
export type AuditExport = z.infer<typeof AuditExportSchema>;

export const AuditExportListSchema = z.object({
  exports: z.array(AuditExportSchema),
  total: z.number().int().nonnegative(),
});
export type AuditExportList = z.infer<typeof AuditExportListSchema>;

export const CreateAuditExportRequestSchema = z.object({
  format: z.enum(["csv", "jsonl"]).default("csv"),
  filters: AuditEventQuerySchema.partial().default({}),
});
export type CreateAuditExportRequest = z.infer<typeof CreateAuditExportRequestSchema>;
