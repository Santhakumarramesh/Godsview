import type {
  ApiKey,
  ApiKeyCreateResponse,
  ApiKeyList,
  CreateApiKeyRequest,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface ApiKeyEndpoints {
  list: () => Promise<ApiKeyList>;
  create: (payload: CreateApiKeyRequest) => Promise<ApiKeyCreateResponse>;
  revoke: (id: string) => Promise<ApiKey>;
}

export function apiKeyEndpoints(client: ApiClient): ApiKeyEndpoints {
  return {
    list: () => client.get<ApiKeyList>("/admin/api-keys"),
    create: (payload) =>
      client.post<ApiKeyCreateResponse>("/admin/api-keys", payload),
    revoke: (id) =>
      client.delete<ApiKey>(`/admin/api-keys/${encodeURIComponent(id)}`),
  };
}
