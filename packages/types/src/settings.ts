import { z } from "zod";
import { RoleSchema } from "./identity.js";

export const ProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  roles: z.array(RoleSchema),
  mfaEnabled: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const UpdateProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    mfaEnabled: z.boolean().optional(),
  })
  .strict();
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const PreferencesSchema = z.object({
  preferences: z.record(z.unknown()),
  updatedAt: z.string().datetime().nullable(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const SelfApiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type SelfApiToken = z.infer<typeof SelfApiTokenSchema>;

export const SelfApiTokenListSchema = z.object({
  tokens: z.array(SelfApiTokenSchema),
  total: z.number().int().nonnegative(),
});
export type SelfApiTokenList = z.infer<typeof SelfApiTokenListSchema>;

export const SelfApiTokenCreateResponseSchema = SelfApiTokenSchema.extend({
  plaintext: z.string().min(10),
});
export type SelfApiTokenCreateResponse = z.infer<
  typeof SelfApiTokenCreateResponseSchema
>;

export const CreateSelfApiTokenRequestSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string()).default([]),
});
export type CreateSelfApiTokenRequest = z.infer<
  typeof CreateSelfApiTokenRequestSchema
>;
