/**
 * Phase 97 — TradingView MCP Types
 *
 * Canonical types for TradingView webhook signals, MCP processing pipeline,
 * and the intelligence layer that sits between chart signals and execution.
 */
import { z } from "zod";

// ── Raw TradingView Webhook Payload ─────────────────────────────────────────

export const TradingViewWebhookSchema = z.object({
  /** Symbol ticker, e.g. "AAPL", "SPY" */
  symbol: z.string().min(1),
  /** Signal type from Pine Script */
  signal: z.enum([
    "breakout", "breakdown", "reversal_long", "reversal_short",
    "pullback_long", "pullback_short", "squeeze_fire",
    "divergence_bull", "divergence_bear", "vwap_reclaim",
    "order_block_entry", "fvg_fill", "sweep_reclaim",
    "opening_range_breakout", "custom",
  ]),
  /** Timeframe the signal was generated on */
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  /** Price at signal generation */
  price: z.number().positive(),
  /** Unix timestamp (seconds) */
  timestamp: z.number().int(),
  /** Direction hint from Pine Script */
  direction: z.enum(["long", "short", "neutral"]).default("neutral"),
  /** Optional: stop loss price from Pine Script */
  stop_loss: z.number().positive().optional(),
  /** Optional: take profit price from Pine Script */
  take_profit: z.number().positive().optional(),
  /** Optional: strategy-specific metadata */
  meta: z.record(z.string(), z.unknown()).optional(),
  /** Optional: Pine Script strategy name */
  strategy_name: z.string().optional(),
  /** Optional: alert message text */
  message: z.string().optional(),
  /** Secret key for authentication */
  passphrase: z.string().optional(),
});

export type TradingViewWebhook = z.infer<typeof TradingViewWebhookSchema>;

// ── Standardized Internal Signal ────────────────────────────────────────────

export const StandardSignalSchema = z.object({
  /** Unique signal ID */
  id: z.string(),
  /** Source of the signal */
  source: z.enum(["tradingview", "internal", "manual", "backtest"]),
  /** Original raw payload */
  rawPayload: z.unknown(),
  /** Normalized fields */
  symbol: z.string(),
  direction: z.enum(["long", "short", "none"]),
  signalType: z.string(),
  timeframe: z.string(),
  price: z.number(),
  stopLoss: z.number().nullable(),
  takeProfit: z.number().nullable(),
  timestamp: z.date(),
  strategyName: z.string().nullable(),
  /** Processing state */
  status: z.enum([
    "received", "validating", "enriching", "scoring",
    "decided", "approved", "rejected", "expired", "executed",
  ]),
  /** When the signal was received by GodsView */
  receivedAt: z.date(),
  /** Processing latency in ms */
  processingMs: z.number().default(0),
});

export type StandardSignal = z.infer<typeof StandardSignalSchema>;

// ── MCP Enrichment Context ──────────────────────────────────────────────────

export const EnrichmentContextSchema = z.object({
  signalId: z.string(),
  symbol: z.string(),
  ts: z.date(),

  // Market microstructure (from Phase 93 Data Engine)
  orderBook: z.object({
    midpoint: z.number(),
    spread: z.number(),
    spreadBps: z.number(),
    imbalanceRatio: z.number(),
    microPressure: z.number(),
    bidDepth: z.number(),
    askDepth: z.number(),
  }).nullable(),

  // Volume delta (from Phase 93)
  volumeDelta: z.object({
    delta: z.number(),
    cumulativeDelta: z.number(),
    deltaPercent: z.number(),
    aggressiveBuyPct: z.number(),
    aggressiveSellPct: z.number(),
  }).nullable(),

  // Macro context
  macro: z.object({
    vix: z.number().nullable(),
    dxy: z.number().nullable(),
    us10y: z.number().nullable(),
    spyChange: z.number().nullable(),
  }),

  // Sentiment
  sentiment: z.object({
    newsScore: z.number(),
    socialScore: z.number(),
    overallSentiment: z.enum(["bullish", "bearish", "neutral"]),
  }),

  // Current regime
  regime: z.enum(["risk_on", "risk_off", "neutral", "high_vol", "low_vol"]),
  session: z.enum(["premarket", "open", "midday", "power_hour", "after_hours", "closed"]),

  // Historical memory (from Phase 95 Learning)
  memory: z.object({
    similarSetupWinRate: z.number().nullable(),
    similarSetupProfitFactor: z.number().nullable(),
    sampleSize: z.number(),
    lastSimilarOutcome: z.enum(["win", "loss", "breakeven"]).nullable(),
    avgHoldBars: z.number().nullable(),
  }),

  // Data quality
  dataQuality: z.object({
    sourcesActive: z.number(),
    sourcesTotal: z.number(),
    overallScore: z.number(),
  }),
});

export type EnrichmentContext = z.infer<typeof EnrichmentContextSchema>;

// ── MCP Signal Score ────────────────────────────────────────────────────────

export const SignalScoreSchema = z.object({
  signalId: z.string(),

  /** Individual layer scores (0-1) */
  structureScore: z.number(),
  orderflowScore: z.number(),
  contextScore: z.number(),
  memoryScore: z.number(),
  sentimentScore: z.number(),
  dataQualityScore: z.number(),

  /** Composite scores */
  confirmationScore: z.number(), // weighted average of all layers
  confidenceScore: z.number(),   // adjusted for data quality and sample size

  /** Signal-specific scoring */
  signalAlignmentScore: z.number(), // does market data confirm the TV signal?
  riskRewardScore: z.number(),       // quality of stop/target placement

  /** Overall grade */
  grade: z.enum(["A+", "A", "B+", "B", "C", "D", "F"]),
  overallScore: z.number(),  // 0-100

  /** Score breakdown explanation */
  explanation: z.string(),
  warnings: z.array(z.string()),
  boosters: z.array(z.string()),
});

export type SignalScore = z.infer<typeof SignalScoreSchema>;

// ── MCP Decision ────────────────────────────────────────────────────────────

export const MCPDecisionSchema = z.object({
  signalId: z.string(),
  symbol: z.string(),
  timestamp: z.date(),

  /** Final decision */
  action: z.enum(["approve", "reject", "wait", "modify"]),
  direction: z.enum(["long", "short", "none"]),

  /** If approved — execution parameters */
  entryPrice: z.number().nullable(),
  stopLoss: z.number().nullable(),
  takeProfit: z.number().nullable(),
  positionSize: z.number().nullable(),
  riskDollars: z.number().nullable(),
  riskPercent: z.number().nullable(),

  /** If modified — what changed from original signal */
  modifications: z.array(z.object({
    field: z.string(),
    original: z.number().nullable(),
    modified: z.number(),
    reason: z.string(),
  })),

  /** Reasoning */
  confidence: z.number(),
  score: SignalScoreSchema,
  enrichment: EnrichmentContextSchema,
  thesis: z.string(),
  rejectionReasons: z.array(z.string()),

  /** Processing metadata */
  processingMs: z.number(),
  pipelineVersion: z.string(),
});

export type MCPDecision = z.infer<typeof MCPDecisionSchema>;

// ── Backtest Signal Replay ──────────────────────────────────────────────────

export const BacktestSignalSchema = z.object({
  /** Original TV signal or synthetic signal */
  signal: StandardSignalSchema,
  /** Market state at signal time (for enrichment during replay) */
  marketState: z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
    vwap: z.number(),
  }),
  /** Pre-computed enrichment (or null to compute live) */
  enrichment: EnrichmentContextSchema.nullable(),
});

export type BacktestSignal = z.infer<typeof BacktestSignalSchema>;

// ── Pipeline Configuration ──────────────────────────────────────────────────

export const MCPPipelineConfigSchema = z.object({
  /** Webhook authentication passphrase */
  webhookPassphrase: z.string().default(""),
  /** Minimum confirmation score to approve */
  minConfirmationScore: z.number().default(0.60),
  /** Minimum data quality score to proceed */
  minDataQualityScore: z.number().default(0.40),
  /** Maximum signal age in seconds before expiry */
  maxSignalAgeSec: z.number().default(300),
  /** Require order flow confirmation */
  requireOrderFlowConfirmation: z.boolean().default(true),
  /** Require MTF alignment */
  requireMTFAlignment: z.boolean().default(false),
  /** Auto-adjust stops based on market structure */
  autoAdjustStops: z.boolean().default(true),
  /** Risk per trade as % of equity */
  riskPerTradePct: z.number().default(1.0),
  /** Maximum concurrent signals processing */
  maxConcurrentSignals: z.number().default(10),
  /** Layer weights for composite scoring */
  weights: z.object({
    structure: z.number().default(0.25),
    orderflow: z.number().default(0.25),
    context: z.number().default(0.15),
    memory: z.number().default(0.15),
    sentiment: z.number().default(0.10),
    dataQuality: z.number().default(0.10),
  }).default({}),
  /** Regime-specific overrides */
  regimeOverrides: z.record(z.string(), z.object({
    minConfirmationScore: z.number().optional(),
    riskMultiplier: z.number().optional(),
    blocked: z.boolean().optional(),
  })).default({}),
});

export type MCPPipelineConfig = z.infer<typeof MCPPipelineConfigSchema>;
