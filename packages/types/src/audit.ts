import { z } from "zod";

/**
 * Audit log envelope. Every state-changing API call MUST emit one.
 * Persisted via control_plane.audit_log + replicated to S3 via Phase 1.
 */
export const AuditEventSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  actor: z.object({
    userId: z.string().nullable(),
    email: z.string().email().nullable(),
    sourceIp: z.string().nullable(),
    userAgent: z.string().nullable(),
  }),
  action: z.string(),
  resource: z.object({
    type: z.string(),
    id: z.string().nullable(),
  }),
  outcome: z.enum(["success", "denied", "error"]),
  correlationId: z.string(),
  details: z.record(z.unknown()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
