/**
 * @gv/types — shared domain types and zod schemas for GodsView v2.
 *
 * Phase 0 surface: identity envelope (User, Role), error envelope
 * (ErrorEnvelope), feature flag, system config, audit event.
 * Subsequent phases extend this module with signal, strategy, backtest,
 * order, fill, calibration, promotion, alert, screenshot domains.
 *
 * All types must have a corresponding zod schema so wire payloads can be
 * validated. Always export both the schema (camelCase Schema suffix)
 * and the inferred type (PascalCase).
 */

export * from "./identity.js";
export * from "./errors.js";
export * from "./feature-flags.js";
export * from "./audit.js";
export * from "./system-config.js";
export * from "./brain.js";
export * from "./market.js";
export * from "./structure.js";
export * from "./tradingview.js";
export * from "./orderflow.js";
export * from "./execution.js";
export * from "./portfolio.js";
export * from "./memory.js";
export * from "./quant.js";
