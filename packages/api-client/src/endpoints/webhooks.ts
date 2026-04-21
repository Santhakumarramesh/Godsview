import type {
  CreateWebhookRequest,
  UpdateWebhookRequest,
  Webhook,
  WebhookCreateResponse,
  WebhookList,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface WebhookEndpoints {
  list: () => Promise<WebhookList>;
  create: (payload: CreateWebhookRequest) => Promise<WebhookCreateResponse>;
  update: (id: string, patch: UpdateWebhookRequest) => Promise<Webhook>;
  deactivate: (id: string) => Promise<Webhook>;
  rotateSecret: (id: string) => Promise<WebhookCreateResponse>;
}

export function webhookEndpoints(client: ApiClient): WebhookEndpoints {
  return {
    list: () => client.get<WebhookList>("/admin/webhooks"),
    create: (payload) =>
      client.post<WebhookCreateResponse>("/admin/webhooks", payload),
    update: (id, patch) =>
      client.patch<Webhook>(`/admin/webhooks/${encodeURIComponent(id)}`, patch),
    deactivate: (id) =>
      client.delete<Webhook>(`/admin/webhooks/${encodeURIComponent(id)}`),
    rotateSecret: (id) =>
      client.post<WebhookCreateResponse>(
        `/admin/webhooks/${encodeURIComponent(id)}/rotate-secret`,
      ),
  };
}
