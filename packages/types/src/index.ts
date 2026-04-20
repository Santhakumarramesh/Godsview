/**
 * @gv/types — shared domain types and zod schemas for GodsView v2.
 *
 * Phase 0 surface: identity envelope (User, Role), error envelope
 * (ErrorEnvelope), feature flag, system config, audit event.
 * Subsequent phases extend this module with signal, strategy, backtest,
 * order, fill, calibration, promotion, alert, screenshot domains.
 *
 * Phase 7 adds the launch-scale surface: multi-broker adapter registry,
 * portfolio rebalance plans + intents, venue latency + outage tracking,
 * and the mobile operator inbox.
 *
 * All types must have a corresponding zod schema so wire payloads can be
 * validated. Always export both the schema (camelCase Schema suffix)
 * and the inferred type (PascalCase).
 */

export * from "./identity.js";
export * from "./errors.js";
export * from "./feature-flags.js";
export * from "./audit.js";
export * from "./audit-events.js";
export * from "./system-config.js";
export * from "./users.js";
export * from "./api-keys.js";
export * from "./webhooks.js";
export * from "./mcp.js";
export * from "./ops.js";
export * from "./settings.js";
export * from "./market.js";
export * from "./structure.js";
export * from "./signals.js";
export * from "./orderflow.js";
export * from "./setups.js";
export * from "./execution.js";
export * from "./quant-lab.js";
export * from "./recall.js";
export * from "./learning.js";
export * from "./portfolio.js";
export * from "./governance.js";
export * from "./autonomy.js";
export * from "./brokers.js";
export * from "./rebalance.js";
export * from "./venue.js";
export * from "./mobile.js";
