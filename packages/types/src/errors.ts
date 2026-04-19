import { z } from "zod";

/**
 * Canonical error envelope returned by every GodsView v2 service.
 * See docs/blueprint/reference/API_SURFACE.md §"Error envelope".
 *
 * - `code` is a machine-stable identifier (snake_case).
 * - `correlation_id` is propagated from the inbound request.
 * - `details[]` carries field-level validation diagnostics when relevant.
 */
export const ErrorDetailSchema = z.object({
  path: z.string(),
  issue: z.string(),
  value: z.unknown().optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    correlation_id: z.string().min(1),
    details: z.array(ErrorDetailSchema).optional(),
    hint: z.string().optional(),
    docs: z.string().url().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const ERROR_CODES = {
  validation: "validation_error",
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  notFound: "not_found",
  conflict: "conflict",
  rateLimited: "rate_limited",
  upstreamUnavailable: "upstream_unavailable",
  internal: "internal_error",
  killSwitch: "kill_switch_engaged",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
