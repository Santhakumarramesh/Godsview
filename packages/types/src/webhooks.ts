import { z } from "zod";

export const WebhookSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  scopes: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  lastDeliveredAt: z.string().datetime().nullable(),
});
export type Webhook = z.infer<typeof WebhookSchema>;

export const WebhookCreateResponseSchema = WebhookSchema.extend({
  secret: z.string().min(10),
});
export type WebhookCreateResponse = z.infer<typeof WebhookCreateResponseSchema>;

export const WebhookListSchema = z.object({
  webhooks: z.array(WebhookSchema),
  total: z.number().int().nonnegative(),
});
export type WebhookList = z.infer<typeof WebhookListSchema>;

export const CreateWebhookRequestSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  scopes: z.array(z.string()).default([]),
});
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;

export const UpdateWebhookRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    scopes: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequestSchema>;
