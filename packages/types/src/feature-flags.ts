import { z } from "zod";

/**
 * Feature flags and the deterministic safety floor.
 *
 * Per blueprint Decision #4 (deterministic safety floor): every agent
 * proposal is gated by these flags + risk engine + promotion FSM +
 * kill switch + calibration drift before being sent to the broker.
 */
export const FeatureFlagSchema = z.object({
  key: z.string().regex(/^[a-z0-9._-]+$/, "must be lowercase dotted slug"),
  enabled: z.boolean(),
  description: z.string(),
  scope: z.enum(["global", "user", "strategy", "symbol"]).default("global"),
  scopeRef: z.string().nullable().default(null),
  updatedAt: z.string().datetime(),
  updatedBy: z.string(),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

/** Curated set of flag keys recognized by Phase 0 control_plane. */
export const KNOWN_FLAGS = [
  "auth.mfa.required",
  "execution.kill_switch",
  "execution.allow_live",
  "intelligence.allow_autonomous",
  "ui.show_v2_command_center",
] as const;

export type KnownFlag = (typeof KNOWN_FLAGS)[number];
