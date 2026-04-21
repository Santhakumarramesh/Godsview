import { z } from "zod";

/**
 * System config: small KV store managed by admin UI.
 * Distinct from feature flags because values may be strings/JSON.
 */
export const SystemConfigEntrySchema = z.object({
  key: z.string().regex(/^[a-z0-9._-]+$/),
  value: z.unknown(),
  description: z.string(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string(),
});
export type SystemConfigEntry = z.infer<typeof SystemConfigEntrySchema>;
