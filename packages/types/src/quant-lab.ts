/**
 * Quant Lab primitives — the Phase 5 surface.
 *
 * Phase 4 closed the live execution loop. Phase 5 feeds that loop with
 * *research*: strategies are authored, versioned, simulated, ranked, and
 * promoted through an auditable pipeline before they ever touch a live
 * account. The lab is deterministic — given the same frozen market data
 * and the same strategy config, a backtest or replay is bit-identical.
 *
 *   Strategy ──► StrategyVersion ──► BacktestRun ──► Metrics
 *                    │                                  │
 *                    │                                  ▼
 *                    ▼                             StrategyRanking  (A|B|C)
 *               Experiment                              │
 *                    │                                  ▼
 *                    └────────────────►  PromotionPipeline (experimental
 *                                        → paper → assisted_live
 *                                        → autonomous)
 *
 * Replay is the "time-travel" sibling of backtest: candle-by-candle
 * playback against a frozen setup detector, producing a stream of
 * ReplayFrame snapshots the operator can step through. Phase 4 already
 * shipped a minimal ReplayFrame in ./execution.ts; the richer version
 * here extends it with a full decision envelope + hypothetical PnL.
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * Money is `number` (doubles). R-multiples are unitless numbers.
 *   * Every entity has a deterministic id so audit + recall can reference
 *     it without re-hashing.
 */
import { z } from "zod";
import { DirectionSchema, TimeframeSchema } from "./market.js";
import { SetupTypeSchema } from "./setups.js";

// ──────────────────────────── strategies ─────────────────────────────────

/**
 * Tier classification for a strategy. Drives which execution modes the
 * promotion pipeline will accept for it.
 *
 *   * A — live-eligible. All gates passing. Positive expectancy over
 *         a statistically meaningful window, calibrated confidence.
 *   * B — paper-only. Expectancy positive but sample size too small
 *         or variance too high to risk capital.
 *   * C — experimental. Still being shaped; never leaves the lab.
 */
export const StrategyTierSchema = z.enum(["A", "B", "C"]);
export type StrategyTier = z.infer<typeof StrategyTierSchema>;

/**
 * Promotion state of a strategy. Mirrors the pipeline FSM on the server
 * (see services/control_plane/app/quant/promotion_fsm.py).
 *
 *   experimental → paper → assisted_live → autonomous
 *
 * Any state can auto-demote back to `experimental` on degradation. A
 * promotion only proceeds if the underlying tier supports it (A-tier to
 * assisted_live + autonomous, B-tier capped at paper).
 */
export const PromotionStateSchema = z.enum([
  "experimental",
  "paper",
  "assisted_live",
  "autonomous",
  "retired",
]);
export type PromotionState = z.infer<typeof PromotionStateSchema>;

/**
 * Human-readable handle for a strategy. A strategy groups many
 * StrategyVersion rows; only one version is "active" at any time.
 */
export const StrategySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  /** Which canonical setup family this strategy plays. */
  setupType: SetupTypeSchema,
  /** Single source of truth for the *current* tier. */
  tier: StrategyTierSchema,
  /** Current promotion state — authoritative. */
  promotionState: PromotionStateSchema,
  /** The StrategyVersion id that is currently canonical. */
  activeVersionId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdByUserId: z.string().min(1),
});
export type Strategy = z.infer<typeof StrategySchema>;

/**
 * One immutable version of a strategy's configuration. Any change to
 * entry/exit/filters creates a new version. Old versions never mutate
 * so backtests + live trades keep reproducible provenance.
 */
export const StrategyVersionSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  /** Monotone integer; bumps on every new version. */
  version: z.number().int().positive(),
  /** Entry-side rules (filter expressions + setup requirements). */
  entry: z.object({
    setupType: SetupTypeSchema,
    timeframes: z.array(TimeframeSchema).min(1),
    direction: DirectionSchema.optional(),
    minConfidence: z.number().min(0).max(1).default(0.5),
    /** Arbitrary JSON filter payload (regime, session, etc). */
    filters: z.record(z.string(), z.any()).default({}),
  }),
  /** Exit-side rules (take-profit / stop-loss adjustment). */
  exit: z.object({
    stopStyle: z.enum(["structure", "atr", "fixed_r"]).default("structure"),
    takeProfitRR: z.number().positive().max(20).default(2),
    /** If true, allow the engine to trail once R reaches the threshold. */
    trailAfterR: z.number().positive().max(20).nullable().default(null),
  }),
  /** Sizing envelope (per-trade risk + per-account caps). */
  sizing: z.object({
    perTradeR: z.number().positive().max(0.1).default(0.005),
    maxConcurrent: z.number().int().positive().max(200).default(5),
  }),
  /** Frozen commit hash of the detector + risk engine at version time. */
  codeHash: z.string().min(1),
  createdAt: z.string().datetime(),
  createdByUserId: z.string().min(1),
  notes: z.string().max(2000).default(""),
});
export type StrategyVersion = z.infer<typeof StrategyVersionSchema>;

// ──────────────────────────── metrics ────────────────────────────────────

/**
 * Canonical strategy performance envelope. Computed once on every
 * BacktestRun completion and stored alongside it. Also the summary
 * shape served to the rankings UI.
 */
export const BacktestMetricsSchema = z.object({
  totalTrades: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  scratches: z.number().int().nonnegative(),
  /** wins / totalTrades — undefined when totalTrades == 0. */
  winRate: z.number().min(0).max(1),
  /** sum(winR) / |sum(lossR)| — ∞ when no losses, 0 when no wins. */
  profitFactor: z.number().nonnegative(),
  /** mean(pnlR) across all trades. */
  expectancyR: z.number(),
  /** Sharpe ratio on per-trade R series, annualised by sqrt(tradesPerYear). */
  sharpe: z.number(),
  /** Sortino on downside-only deviation. */
  sortino: z.number(),
  /** Peak-to-trough R drawdown (negative). */
  maxDrawdownR: z.number(),
  /** Max favourable excursion mean (R). */
  meanMAER: z.number(),
  /** Max adverse excursion mean (R). */
  meanMFER: z.number(),
  /** Cumulative realised R across all trades. */
  totalR: z.number(),
  /** Calendar-time window covered. */
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
});
export type BacktestMetrics = z.infer<typeof BacktestMetricsSchema>;

// ──────────────────────────── backtests ──────────────────────────────────

export const BacktestStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type BacktestStatus = z.infer<typeof BacktestStatusSchema>;

/**
 * Parameters that drive a BacktestRun. Frozen at enqueue-time so reruns
 * are bit-identical.
 */
export const BacktestRequestSchema = z.object({
  strategyVersionId: z.string().min(1),
  symbolIds: z.array(z.string().min(1)).min(1).max(200),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  /** Commission + slippage model. */
  frictionBps: z.number().nonnegative().max(200).default(5),
  /** Simulated broker latency (ms) applied to every fill. */
  latencyMs: z.number().int().nonnegative().max(10_000).default(100),
  /** Starting account equity (currency units). */
  startingEquity: z.number().positive().default(100_000),
  /** Optional random seed for reproducible ties. */
  seed: z.number().int().nonnegative().default(0),
});
export type BacktestRequest = z.infer<typeof BacktestRequestSchema>;

export const BacktestRunSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  strategyVersionId: z.string().min(1),
  request: BacktestRequestSchema,
  status: BacktestStatusSchema,
  /** Populated once status == "completed". */
  metrics: BacktestMetricsSchema.nullable(),
  /** Human-readable error if status == "failed". */
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().min(1),
});
export type BacktestRun = z.infer<typeof BacktestRunSchema>;

/** One simulated trade inside a BacktestRun. Compact by design. */
export const BacktestTradeSchema = z.object({
  id: z.string().min(1),
  backtestId: z.string().min(1),
  symbolId: z.string().min(1),
  direction: DirectionSchema,
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  sizeR: z.number().positive(),
  pnlR: z.number(),
  pnlDollars: z.number(),
  outcome: z.enum(["win", "loss", "scratch"]),
  mfeR: z.number(),
  maeR: z.number(),
});
export type BacktestTrade = z.infer<typeof BacktestTradeSchema>;

/** One point on the equity curve. Sampled per trade close. */
export const BacktestEquityPointSchema = z.object({
  ts: z.string().datetime(),
  equity: z.number(),
  cumulativeR: z.number(),
  drawdownR: z.number(),
});
export type BacktestEquityPoint = z.infer<typeof BacktestEquityPointSchema>;

// ──────────────────────────── replay ─────────────────────────────────────

/**
 * A single tick in a quant-lab replay run. Extends the lightweight
 * Phase 4 ReplayFrame (see ./execution.ts) with a decision envelope +
 * hypothetical PnL — the "what would GodsView do here?" shape.
 *
 * Named QuantReplayFrame deliberately so the Phase 4 ReplayFrame keeps
 * its simpler tick shape for the /execution/replay cursor.
 */
export const QuantReplayFrameSchema = z.object({
  id: z.string().min(1),
  replayRunId: z.string().min(1),
  ts: z.string().datetime(),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  bar: z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number().nonnegative(),
  }),
  /** Compact structure verdict at this frame. */
  structure: z.object({
    trend: z.enum(["bullish", "bearish", "neutral"]),
    bos: z.boolean(),
    choch: z.boolean(),
    liquidityEvent: z.enum(["sweep_high", "sweep_low", "none"]),
  }),
  /** Order-flow posture (lightweight projection). */
  orderFlow: z.object({
    delta: z.number(),
    imbalance: z.enum(["buy", "sell", "balanced"]),
    absorption: z.boolean(),
  }),
  /** Decision the detector + gate would make at this exact frame. */
  decision: z.object({
    action: z.enum(["none", "enter_long", "enter_short", "exit"]),
    setupId: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    reasoning: z.string(),
  }),
  /** If we entered at this frame, cumulative R from here to now. */
  hypotheticalPnLR: z.number().nullable(),
});
export type QuantReplayFrame = z.infer<typeof QuantReplayFrameSchema>;

export const ReplayStatusSchema = z.enum([
  "queued",
  "streaming",
  "completed",
  "failed",
  "cancelled",
]);
export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;

export const ReplayRunRequestSchema = z.object({
  /** Either a specific setup to centre the replay on … */
  setupId: z.string().min(1).optional(),
  /** … or an ad-hoc symbol + window. At least one must be set. */
  symbolId: z.string().min(1).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  tf: TimeframeSchema,
  /** Milliseconds of wall-clock delay between frames (0 = as-fast-as-possible). */
  stepMs: z.number().int().nonnegative().max(60_000).default(0),
  /** If true, evaluate the live gate on each frame's hypothetical setup. */
  withLiveGate: z.boolean().default(false),
});
export type ReplayRunRequest = z.infer<typeof ReplayRunRequestSchema>;

export const ReplayRunSchema = z.object({
  id: z.string().min(1),
  request: ReplayRunRequestSchema,
  status: ReplayStatusSchema,
  totalFrames: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().min(1),
});
export type ReplayRun = z.infer<typeof ReplayRunSchema>;

// ──────────────────────────── experiments ────────────────────────────────

/**
 * A comparison grouping of BacktestRuns. An experiment freezes the
 * hypothesis ("does raising minConfidence from 0.6 to 0.7 improve
 * expectancy in trending regimes?") and collects the runs that answer
 * it. Ties + promotion recommendations flow from here.
 */
export const ExperimentStatusSchema = z.enum([
  "draft",
  "running",
  "completed",
  "cancelled",
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const ExperimentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  hypothesis: z.string().max(2000).default(""),
  strategyId: z.string().min(1),
  /** Backtest run ids included in this experiment. */
  backtestIds: z.array(z.string().min(1)).default([]),
  status: ExperimentStatusSchema,
  /** Winning backtest id, if the experiment has reached a verdict. */
  winningBacktestId: z.string().nullable(),
  /** Short narrative verdict written by the learning agent. */
  verdict: z.string().max(2000).default(""),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdByUserId: z.string().min(1),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

// ──────────────────────────── rankings + promotion ──────────────────────

/**
 * A point-in-time snapshot of a strategy's ranking. Recomputed nightly
 * (or on-demand) from the last N trades (live) or backtests (lab-only).
 */
export const StrategyRankingSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  tier: StrategyTierSchema,
  /** 0..1 composite score driving the tier decision. */
  compositeScore: z.number().min(0).max(1),
  /** Best BacktestMetrics seen in the eval window. */
  bestMetrics: BacktestMetricsSchema.nullable(),
  /** Live metrics over the eval window (null if no live fills). */
  liveMetrics: BacktestMetricsSchema.nullable(),
  /** Ranked position within the peer group (1 = best). */
  rank: z.number().int().positive(),
  /** Short narrative explaining the tier. */
  rationale: z.string().max(2000).default(""),
  rankedAt: z.string().datetime(),
});
export type StrategyRanking = z.infer<typeof StrategyRankingSchema>;

/**
 * One promotion/demotion audit event. Immutable; the FSM is enforced on
 * the server (services/control_plane/app/quant/promotion_fsm.py).
 */
export const PromotionEventSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  fromState: PromotionStateSchema,
  toState: PromotionStateSchema,
  reason: z.string().max(2000),
  /** Operator who triggered a manual transition; null for auto-demotion. */
  triggeredByUserId: z.string().nullable(),
  automated: z.boolean(),
  occurredAt: z.string().datetime(),
});
export type PromotionEvent = z.infer<typeof PromotionEventSchema>;

export const PromotionRequestSchema = z.object({
  targetState: PromotionStateSchema,
  reason: z.string().min(1).max(2000),
});
export type PromotionRequest = z.infer<typeof PromotionRequestSchema>;

// ──────────────────────────── list envelopes ────────────────────────────

export const StrategyFilterSchema = z.object({
  tier: StrategyTierSchema.optional(),
  promotionState: PromotionStateSchema.optional(),
  setupType: SetupTypeSchema.optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type StrategyFilter = z.infer<typeof StrategyFilterSchema>;

export const BacktestFilterSchema = z.object({
  strategyId: z.string().optional(),
  status: BacktestStatusSchema.optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type BacktestFilter = z.infer<typeof BacktestFilterSchema>;

export const ExperimentFilterSchema = z.object({
  strategyId: z.string().optional(),
  status: ExperimentStatusSchema.optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type ExperimentFilter = z.infer<typeof ExperimentFilterSchema>;

export const StrategiesListOutSchema = z.object({
  strategies: z.array(StrategySchema),
  total: z.number().int().nonnegative(),
});
export type StrategiesListOut = z.infer<typeof StrategiesListOutSchema>;

export const BacktestsListOutSchema = z.object({
  runs: z.array(BacktestRunSchema),
  total: z.number().int().nonnegative(),
});
export type BacktestsListOut = z.infer<typeof BacktestsListOutSchema>;

export const BacktestTradesOutSchema = z.object({
  backtestId: z.string().min(1),
  trades: z.array(BacktestTradeSchema),
  total: z.number().int().nonnegative(),
});
export type BacktestTradesOut = z.infer<typeof BacktestTradesOutSchema>;

export const BacktestEquityOutSchema = z.object({
  backtestId: z.string().min(1),
  points: z.array(BacktestEquityPointSchema),
});
export type BacktestEquityOut = z.infer<typeof BacktestEquityOutSchema>;

export const ReplayRunsListOutSchema = z.object({
  runs: z.array(ReplayRunSchema),
  total: z.number().int().nonnegative(),
});
export type ReplayRunsListOut = z.infer<typeof ReplayRunsListOutSchema>;

export const QuantReplayFramesOutSchema = z.object({
  replayRunId: z.string().min(1),
  frames: z.array(QuantReplayFrameSchema),
  total: z.number().int().nonnegative(),
});
export type QuantReplayFramesOut = z.infer<typeof QuantReplayFramesOutSchema>;

export const ExperimentsListOutSchema = z.object({
  experiments: z.array(ExperimentSchema),
  total: z.number().int().nonnegative(),
});
export type ExperimentsListOut = z.infer<typeof ExperimentsListOutSchema>;

export const RankingsListOutSchema = z.object({
  rankings: z.array(StrategyRankingSchema),
  generatedAt: z.string().datetime(),
});
export type RankingsListOut = z.infer<typeof RankingsListOutSchema>;

export const PromotionEventsListOutSchema = z.object({
  strategyId: z.string().min(1),
  events: z.array(PromotionEventSchema),
});
export type PromotionEventsListOut = z.infer<typeof PromotionEventsListOutSchema>;
