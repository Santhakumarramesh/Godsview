import { z } from "zod";

export const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  ownerUserId: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ApiKeyListSchema = z.object({
  apiKeys: z.array(ApiKeySchema),
  total: z.number().int().nonnegative(),
});
export type ApiKeyList = z.infer<typeof ApiKeyListSchema>;

export const ApiKeyCreateResponseSchema = ApiKeySchema.extend({
  plaintext: z.string().min(10),
});
export type ApiKeyCreateResponse = z.infer<typeof ApiKeyCreateResponseSchema>;

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string()).default([]),
  ownerUserId: z.string().optional(),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;
