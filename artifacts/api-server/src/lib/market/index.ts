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
  NormalizedBar,
  NormalizedQuote,
  NormalizedTrade,
  DataSourceSchema,
  NormalizedBarSchema,
  NormalizedQuoteSchema,
  NormalizedTradeSchema,
  validateBar,
  validateQuote,
  validateTrade,
  isValidBar,
  isValidQuote,
  isValidTrade,
  type ValidatedBar,
  type ValidatedQuote,
  type ValidatedTrade,
} from "./normalized_schema";

// ─── Data Quality Module ───────────────────────────────────────────────────────
export {
  QualityIssueSeverity,
  QualityIssue,
  BarQualityAnalysis,
  QualityReport,
  QualityConfig,
  analyzeBarQuality,
  analyzeSeriesQuality,
  formatQualityReport,
  createQualityConfig,
  getDefaultQualityConfig,
} from "./data_quality";

// ─── Provider Failover Module ──────────────────────────────────────────────────
export {
  ProviderHealth,
  FailoverDecision,
  FailoverConfig,
  FailoverStatus,
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

// ─── Timestamp Synchronization Module ──────────────────────────────────────────
export {
  MarketSession,
  SyncResult,
  BatchSyncResult,
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

// ─── Replay Storage Module ─────────────────────────────────────────────────────
export {
  OrderBookLevel,
  OrderBookSnapshot,
  StorageMetrics,
  CompressionStats,
  ReplayStorageConfig,
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

// ─── Cache Layer Module ────────────────────────────────────────────────────────
export {
  CacheMetrics,
  CacheConfig,
  EvictionPolicy,
  CacheWarmerFn,
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
  flushExpired,
  getStatistics as getCacheStatistics,
  resetMetrics as resetCacheMetrics,
} from "./cache_layer";

// ─── Data Normalizer Module (Phase 5) ──────────────────────────────────────
export {
  DataNormalizer,
  NormalizedOrderBook,
  NormalizedTrade as DataNormalizerTrade,
  DataIssueType,
  type IssuesSeverity,
  type DataIssue,
  type CleanedData,
  type AlignedData,
} from "./data_normalizer";

// ─── Feed Manager Module (Phase 5) ────────────────────────────────────────
export {
  FeedManager,
  ProviderStatus,
  type ProviderHealth,
  type DataProvider,
  type PriceSnapshot,
  type FeedHealthReport,
  type LatencyReport,
  type DegradationAction,
} from "./feed_manager";

// ─── Execution Simulator Module (Phase 5) ────────────────────────────────
export {
  ExecutionSimulator,
  type Order,
  type MarketState,
  type Fill,
  type ExecutionResult,
  type OrderBookModel,
  type TransactionCosts,
  type ExecutionStats,
  type ExecutionQualityReport,
} from "./execution_simulator";

// ─── Replay Store Module (Phase 5) ────────────────────────────────────────
export {
  ReplayStore,
  DecisionType,
  type DecisionSnapshot,
  type WhatIfScenario,
  type WhatIfResult,
  type ReplayStoreStats,
} from "./replay_store";

// ─── Existing Market Modules ──────────────────────────────────────────────────
export {
  PriceLevel,
  OrderBookSnapshot as OrderBookSnapshotLegacy,
  OrderBookUpdate,
  LiquidityZone,
  MicrostructureSnapshot,
  OrderBookListener,
} from "./types";

export { symbols, normalizeMarketSymbol, toAlpacaSlash } from "./symbols";