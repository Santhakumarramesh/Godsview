/**
 * @gv/api-client — typed client for GodsView v2 control_plane + downstream services.
 *
 * Phase 0 surface: client factory, auth endpoints, feature-flag endpoints,
 * system-config endpoints, health endpoint. Subsequent phases extend this
 * via OpenAPI codegen (see `pnpm --filter @gv/api-client run codegen`).
 */
export * from "./client.js";
export * from "./endpoints/auth.js";
export * from "./endpoints/feature-flags.js";
export * from "./endpoints/system-config.js";
export * from "./endpoints/health.js";
export * from "./endpoints/users.js";
export * from "./endpoints/api-keys.js";
export * from "./endpoints/webhooks.js";
export * from "./endpoints/mcp.js";
export * from "./endpoints/audit.js";
export * from "./endpoints/ops.js";
export * from "./endpoints/settings.js";
export * from "./endpoints/market.js";
export * from "./endpoints/structure.js";
export * from "./endpoints/tv-ingest.js";
export * from "./endpoints/orderflow.js";
export * from "./endpoints/setups.js";
export * from "./endpoints/execution.js";
export * from "./endpoints/quant-lab.js";
export * from "./endpoints/recall.js";
export * from "./endpoints/learning.js";
