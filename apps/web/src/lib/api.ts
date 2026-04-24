/**
 * Configured singleton ApiClient bound to the web app's environment.
 *
 * The base URL points at /api/v1, which next.config.mjs rewrites to the
 * FastAPI control plane (or the Node API server in unified mode).
 * This keeps browser CORS surface area at zero.
 *
 * ALL endpoint groups are wired — every sidebar page can call its backend.
 */

import {
  ApiClient,
  authEndpoints,
  featureFlagEndpoints,
  healthEndpoints,
  systemConfigEndpoints,
  marketEndpoints,
  scannerEndpoints,
  featureEndpoints,
  flowEndpoints,
  tradingviewEndpoints,
  backtestEndpoints,
  memoryEndpoints,
  executionEndpoints,
  riskEndpoints,
  portfolioEndpoints,
  mlEndpoints,
  auditEndpoints,
  brainEndpoints,
  mcpEndpoints,
  opsEndpoints,
  settingsEndpoints,
  userEndpoints,
  webhookEndpoints,
  apiKeyEndpoints,
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

  // ── Auth & System ─────────────────────────────────────────────────────────
  auth: authEndpoints(apiClient),
  flags: featureFlagEndpoints(apiClient),
  systemConfig: systemConfigEndpoints(apiClient),
  health: healthEndpoints(apiClient),

  // ── Market Discovery & Scanning ───────────────────────────────────────────
  market: marketEndpoints(apiClient),
  scanner: scannerEndpoints(apiClient),
  features: featureEndpoints(apiClient),

  // ── Order Flow / Microstructure ───────────────────────────────────────────
  flow: flowEndpoints(apiClient),

  // ── TradingView MCP / Bridge ──────────────────────────────────────────────
  tradingview: tradingviewEndpoints(apiClient),

  // ── Quant Lab / Backtesting ───────────────────────────────────────────────
  backtest: backtestEndpoints(apiClient),

  // ── Memory / Recall / Learning ────────────────────────────────────────────
  memory: memoryEndpoints(apiClient),

  // ── Execution ─────────────────────────────────────────────────────────────
  execution: executionEndpoints(apiClient),

  // ── Risk ──────────────────────────────────────────────────────────────────
  risk: riskEndpoints(apiClient),

  // ── Portfolio ─────────────────────────────────────────────────────────────
  portfolio: portfolioEndpoints(apiClient),

  // ── ML / Intelligence ─────────────────────────────────────────────────────
  ml: mlEndpoints(apiClient),

  // ── Audit / Governance ────────────────────────────────────────────────────
  audit: auditEndpoints(apiClient),

  // ── Brain Hologram ────────────────────────────────────────────────────────
  brain: brainEndpoints(apiClient),

  // ── Admin / Operator ──────────────────────────────────────────────────────
  mcp: mcpEndpoints(apiClient),
  ops: opsEndpoints(apiClient),
  settings: settingsEndpoints(apiClient),
  users: userEndpoints(apiClient),
  webhooks: webhookEndpoints(apiClient),
  apiKeys: apiKeyEndpoints(apiClient),
};
