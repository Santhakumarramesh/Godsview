/**
 * Configured singleton ApiClient bound to the web app's environment.
 *
 * The base URL points at /api/v1, which next.config.mjs rewrites to the
 * FastAPI control plane. This keeps browser CORS surface area at zero.
 */

import {
  ApiClient,
  apiKeyEndpoints,
  auditEndpoints,
  authEndpoints,
  featureFlagEndpoints,
  healthEndpoints,
  mcpEndpoints,
  opsEndpoints,
  settingsEndpoints,
  systemConfigEndpoints,
  userEndpoints,
  webhookEndpoints,
} from "@gv/api-client";

const baseUrl =
  process.env.NEXT_PUBLIC_GODSVIEW_API_BASE?.replace(/\/+$/, "") || "/api/v1";

let tokenGetter: () => string | null = () => null;

export const apiClient = new ApiClient({
  baseUrl,
  getAccessToken: () => tokenGetter(),
});

export const api = {
  client: apiClient,
  setAccessTokenGetter(getter: () => string | null): void {
    tokenGetter = getter;
  },
  auth: authEndpoints(apiClient),
  flags: featureFlagEndpoints(apiClient),
  systemConfig: systemConfigEndpoints(apiClient),
  health: healthEndpoints(apiClient),
  users: userEndpoints(apiClient),
  apiKeys: apiKeyEndpoints(apiClient),
  webhooks: webhookEndpoints(apiClient),
  mcp: mcpEndpoints(apiClient),
  audit: auditEndpoints(apiClient),
  ops: opsEndpoints(apiClient),
  settings: settingsEndpoints(apiClient),
};
