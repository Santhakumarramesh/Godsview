/**
 * market/index.ts — Phase 2 Market Data Foundation Export Hub
 *
 * Central export point for all market data infrastructure modules:
 * - Normalized schemas for cross-provider compatibility
 * - Data quality analysis and validation
 * - Provider health management and automatic failover
 * - Timestamp synchronization and market hours detection
 * - Replay storage for backtesting and analysis
 * - LRU cache layer for hot data
 */

// ─── Normalized Schema Module ─────────────────────────────────────────────────
export {
  DataSource,
  NormalizedBarSchema,
  NormalizedQuoteSchema,
  NormalizedTradeSchema,
  validateBar,
  validateQuote,
  validateTrade,
  isValidBar,
  isValidQuote,
  isValidTrade,
} from "./normalized_schema";
export type {
  NormalizedBar,
  NormalizedQuote,
  NormalizedTrade,
  ValidatedBar,
  ValidatedQuote,
  ValidatedTrade,
} from "./normalized_schema";

// ─── Data Quality Module ───────────────────────────────────────────────────────
export {
  analyzeBarQuality,
  analyzeSeriesQuality,
  formatQualityReport,
  createQualityConfig,
  getDefaultQualityConfig,
} from "./data_quality";
export type {
  QualityIssueSeverity,
  QualityIssue,
  BarQualityAnalysis,
  QualityReport,
  QualityConfig,
} from "./data_quality";

// ─── Provider Failover Module ──────────────────────────────────────────────────
export {
  recordSuccess,
  recordFailure,
  getProviderHealth,
  getAllProviderHealth,
  getNextHealthyProvider,
  evaluateFailover,
  performFailover,
  getCurrentProvider,
  setCurrentProvider,
  getLastFailover,
  updateFailoverConfig,
  getFailoverConfig,
  resetHealthMetrics,
  getFailoverStatus,
  probeRecovery,
} from "./provider_failover";
export type {
  ProviderHealth,
  FailoverDecision,
  FailoverConfig,
  FailoverStatus,
} from "./provider_failover";

// ─── Timestamp Synchronization Module ──────────────────────────────────────────
export {
  parseISOTimestamp,
  formatUTCISO,
  normalizeTimestamp,
  syncTimestampBatch,
  validateTemporalOrder,
  fromUnixMs,
  fromUnixSeconds,
  toUnixMs,
  nowUTC,
  addMinutes,
  diffSeconds,
  isDuringMarketHours,
  isTradingDay,
  getMarketSession,
} from "./timestamp_sync";
export type {
  MarketSession,
  SyncResult,
  BatchSyncResult,
} from "./timestamp_sync";

// ─── Replay Storage Module ─────────────────────────────────────────────────────
export {
  storeBar,
  getBarsInRange,
  getLatestBar,
  getAllBars,
  storeTrade,
  getTradesInRange,
  storeSnapshot,
  getLatestSnapshot,
  getSnapshotNear,
  getSnapshotsInRange,
  getStorageMetrics,
  clearSymbol,
  clearAll,
  pruneAll,
  updateConfig as updateStorageConfig,
  getConfig as getStorageConfig,
  startAutoFlush,
  stopAutoFlush,
  flush,
  getTotalStored,
} from "./replay_storage";
export type {
  OrderBookLevel,
  OrderBookSnapshot,
  StorageMetrics,
  CompressionStats,
  ReplayStorageConfig,
} from "./replay_storage";

// ─── Cache Layer Module ────────────────────────────────────────────────────────
export {
  get as cacheGet,
  set as cacheSet,
  has as cacheHas,
  del as cacheDel,
  clear as cacheClear,
  size as cacheSize,
  getMetrics as getCacheMetrics,
  getDetailedMetrics as getCacheDetailedMetrics,
  warmCache,
  warmConfiguredSymbols,
  updateConfig as updateCacheConfig,
  getConfig as getCacheConfig,
  setSizeLimits,
  setDefaultTtl,
  evictByPolicy,
} from "./cache_layer";
export type {
  CacheMetrics,
  CacheConfig,
  EvictionPolicy,
  CacheWarmerFn,
} from "./cache_layer";

// ─── Data Normalizer Module (Phase 5) ──────────────────────────────────────
export {
  DataNormalizer,
  dataNormalizer,
  DataIssueType,
} from "./data_normalizer";
export type {
  NormalizedOrderBook,
  NormalizedTrade as DataNormalizerTrade,
  IssuesSeverity,
  DataIssue,
  CleanedData,
  AlignedData,
} from "./data_normalizer";

// ─── Feed Manager Module (Phase 5) ────────────────────────────────────────
export {
  FeedManager,
  feedManager,
  ProviderStatus,
} from "./feed_manager";
export type {
  ProviderHealth as FeedProviderHealth,
  DataProvider,
  PriceSnapshot,
  FeedHealthReport,
  LatencyReport,
  DegradationAction,
} from "./feed_manager";

// ─── Execution Simulator Module (Phase 5) ────────────────────────────────
export {
  ExecutionSimulator,
  executionSimulator,
} from "./execution_simulator";
export type {
  Order,
  MarketState,
  Fill,
  ExecutionResult,
  OrderBookModel,
  TransactionCosts,
  ExecutionStats,
  ExecutionQualityReport,
} from "./execution_simulator";

// ─── Replay Store Module (Phase 5) ────────────────────────────────────────
export {
  ReplayStore,
  replayStore,
  DecisionType,
} from "./replay_store";
export type {
  DecisionSnapshot,
  WhatIfScenario,
  WhatIfResult,
  ReplayStoreStats,
} from "./replay_store";

// ─── Existing Market Modules ──────────────────────────────────────────────────
export type {
  PriceLevel,
  OrderBookSnapshot as OrderBookSnapshotLegacy,
  OrderBookUpdate,
  LiquidityZone,
  MicrostructureSnapshot,
  OrderBookListener,
} from "./types";

export { normalizeMarketSymbol, toAlpacaSlash } from "./symbols";
