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
