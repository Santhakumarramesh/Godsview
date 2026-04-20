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
  autonomyEndpoints,
  backtestEndpoints,
  brokerAdapterEndpoints,
  brokerBindingEndpoints,
  brokerEndpoints,
  brokerHealthEndpoints,
  calibrationEndpoints,
  dataTruthEndpoints,
  experimentEndpoints,
  featureFlagEndpoints,
  governanceAnomalyEndpoints,
  governanceApprovalEndpoints,
  governanceApprovalPolicyEndpoints,
  governanceTrustEndpoints,
  healthEndpoints,
  killSwitchEndpoints,
  learningEndpoints,
  liveExecutionEndpoints,
  liveTradeEndpoints,
  marketEndpoints,
  mcpEndpoints,
  mobileInboxEndpoints,
  opsEndpoints,
  orderflowEndpoints,
  portfolioAccountsEndpoints,
  portfolioAllocationEndpoints,
  portfolioExposureEndpoints,
  portfolioPnlEndpoints,
  promotionEndpoints,
  quantReplayEndpoints,
  rankingEndpoints,
  rebalanceIntentEndpoints,
  rebalancePlanEndpoints,
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
  venueLatencyEndpoints,
  venueOutageEndpoints,
  venueRegistryEndpoints,
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
  // Phase 6 — Portfolio Intelligence
  portfolio: {
    accounts: portfolioAccountsEndpoints(apiClient),
    exposure: portfolioExposureEndpoints(apiClient),
    allocation: portfolioAllocationEndpoints(apiClient),
    pnl: portfolioPnlEndpoints(apiClient),
  },
  // Phase 6 — Governance
  governance: {
    approvals: governanceApprovalEndpoints(apiClient),
    policies: governanceApprovalPolicyEndpoints(apiClient),
    anomalies: governanceAnomalyEndpoints(apiClient),
    trust: governanceTrustEndpoints(apiClient),
  },
  // Phase 6 — Autonomy + kill switch
  autonomy: autonomyEndpoints(apiClient),
  killSwitch: killSwitchEndpoints(apiClient),
  // Phase 7 — Multi-broker registry
  brokers: {
    adapters: brokerAdapterEndpoints(apiClient),
    bindings: brokerBindingEndpoints(apiClient),
    health: brokerHealthEndpoints(apiClient),
  },
  // Phase 7 — Portfolio rebalance
  rebalance: {
    plans: rebalancePlanEndpoints(apiClient),
    intents: rebalanceIntentEndpoints(apiClient),
  },
  // Phase 7 — Venue latency + outages
  venue: {
    latency: venueLatencyEndpoints(apiClient),
    outages: venueOutageEndpoints(apiClient),
    registry: venueRegistryEndpoints(apiClient),
  },
  // Phase 7 — Mobile operator inbox
  mobileInbox: mobileInboxEndpoints(apiClient),
};
