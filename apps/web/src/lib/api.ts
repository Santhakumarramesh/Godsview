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
  backtestEndpoints,
  brokerEndpoints,
  calibrationEndpoints,
  dataTruthEndpoints,
  experimentEndpoints,
  featureFlagEndpoints,
  healthEndpoints,
  learningEndpoints,
  liveExecutionEndpoints,
  liveTradeEndpoints,
  marketEndpoints,
  mcpEndpoints,
  opsEndpoints,
  orderflowEndpoints,
  promotionEndpoints,
  quantReplayEndpoints,
  rankingEndpoints,
  recallEndpoints,
  regimeEndpoints,
  replayEndpoints,
  riskEndpoints,
  sessionEndpoints,
  settingsEndpoints,
  setupEndpoints,
  strategyDNAEndpoints,
  strategyEndpoints,
  structureEndpoints,
  systemConfigEndpoints,
  tvIngestEndpoints,
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
  market: marketEndpoints(apiClient),
  structure: structureEndpoints(apiClient),
  tv: tvIngestEndpoints(apiClient),
  // Phase 3
  orderflow: orderflowEndpoints(apiClient),
  setups: setupEndpoints(apiClient),
  // Phase 4
  liveExecution: liveExecutionEndpoints(apiClient),
  risk: riskEndpoints(apiClient),
  broker: brokerEndpoints(apiClient),
  liveTrades: liveTradeEndpoints(apiClient),
  replay: replayEndpoints(apiClient),
  // Phase 5 — Quant Lab
  strategies: strategyEndpoints(apiClient),
  backtests: backtestEndpoints(apiClient),
  quantReplay: quantReplayEndpoints(apiClient),
  experiments: experimentEndpoints(apiClient),
  rankings: rankingEndpoints(apiClient),
  promotion: promotionEndpoints(apiClient),
  // Phase 5 — Recall
  recall: recallEndpoints(apiClient),
  // Phase 5 — Learning + Governance
  learning: learningEndpoints(apiClient),
  calibration: calibrationEndpoints(apiClient),
  regime: regimeEndpoints(apiClient),
  session: sessionEndpoints(apiClient),
  dataTruth: dataTruthEndpoints(apiClient),
  strategyDNA: strategyDNAEndpoints(apiClient),
};
