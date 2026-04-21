import type { SystemConfigEntry } from "@gv/types";
import type { ApiClient } from "../client.js";

export interface SystemConfigEndpoints {
  list: () => Promise<{ entries: SystemConfigEntry[] }>;
  get: (key: string) => Promise<SystemConfigEntry>;
  upsert: (key: string, value: unknown, description?: string) => Promise<SystemConfigEntry>;
  delete: (key: string) => Promise<void>;
}

export function systemConfigEndpoints(client: ApiClient): SystemConfigEndpoints {
  return {
    list: () => client.get<{ entries: SystemConfigEntry[] }>("/admin/system/config"),
    get: (key) => client.get<SystemConfigEntry>(`/admin/system/config/${encodeURIComponent(key)}`),
    upsert: (key, value, description) =>
      client.put<SystemConfigEntry>(`/admin/system/config/${encodeURIComponent(key)}`, {
        value,
        description,
      }),
    delete: (key) => client.delete<void>(`/admin/system/config/${encodeURIComponent(key)}`),
  };
}
