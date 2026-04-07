/**
 * Phase 97 — TradingView MCP Integration
 *
 * Complete pipeline: TradingView webhook → Signal Ingestion →
 * MCP Enrichment & Scoring → Decision → Execution/Backtest
 */

// Types
export {
  TradingViewWebhookSchema,
  StandardSignalSchema,
  EnrichmentContextSchema,
  SignalScoreSchema,
  MCPDecisionSchema,
  BacktestSignalSchema,
  MCPPipelineConfigSchema,
} from "./types.js";
export type {
  TradingViewWebhook,
  StandardSignal,
  EnrichmentContext,
  SignalScore,
  MCPDecision,
  BacktestSignal,
  MCPPipelineConfig,
} from "./types.js";

// Signal Ingestion
export { SignalIngestion } from "./signal_ingestion.js";
export type { IngestionStats } from "./signal_ingestion.js";

// MCP Processor
export { MCPProcessor } from "./mcp_processor.js";
export type { DataProvider, MemoryProvider, RiskProvider } from "./mcp_processor.js";

// Backtest Bridge
export { MCPBacktester } from "./backtest_bridge.js";
export type {
  MCPBacktestConfig, MCPBacktestResult,
  SignalLogEntry, MCPComparison,
} from "./backtest_bridge.js";
