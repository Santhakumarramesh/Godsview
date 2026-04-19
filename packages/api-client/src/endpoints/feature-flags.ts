import type { FeatureFlag } from "@gv/types";
import type { ApiClient } from "../client.js";

export interface FeatureFlagEndpoints {
  list: () => Promise<{ flags: FeatureFlag[] }>;
  get: (key: string) => Promise<FeatureFlag>;
  update: (key: string, patch: { enabled?: boolean; description?: string }) => Promise<FeatureFlag>;
}

export function featureFlagEndpoints(client: ApiClient): FeatureFlagEndpoints {
  return {
    list: () => client.get<{ flags: FeatureFlag[] }>("/admin/flags"),
    get: (key) => client.get<FeatureFlag>(`/admin/flags/${encodeURIComponent(key)}`),
    update: (key, patch) =>
      client.patch<FeatureFlag>(`/admin/flags/${encodeURIComponent(key)}`, patch),
  };
}
