/**
 * Execution + risk primitives — the Phase 4 surface.
 *
 * Phase 3 shipped a paper-mode execution gate as a deterministic pure
 * predicate. Phase 4 promotes that gate to a live-capable pipeline:
 *
 *   Setup  ─┐
 *           ├──►  LiveGateInput  ──►  evaluate_live_gate()  ──►  GateDecision
 *   Risk ───┤                                                       │
 *   Equity ─┘                                                       ▼
 *                                                             BrokerRequest
 *                                                                   │
 *                                                                   ▼
 *                                                            BrokerFill (Alpaca)
 *                                                                   │
 *                                                                   ▼
 *                                                               Position
 *
 * The existing `PaperTrade` in `./setups.ts` is preserved as-is. The
 * Phase 4 additions here sit alongside it:
 *
 *   * `RiskBudget`        — per-account daily / per-symbol / correlation caps
 *   * `AccountEquity`     — live broker equity + realised + open PnL snapshot
 *   * `Position`          — one canonical row per open symbol position
 *   * `BrokerRequest`     — the order the gate hands to the broker adapter
 *   * `BrokerFill`        — one execution (partial or terminal) from broker
 *   * `LiveGateInput`     — the snapshot the live gate consumes
 *   * `GateRejectionReason` — enumerated reason surface (paper + live union)
 *   * `LiveTrade`         — live sibling of `PaperTrade`
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string.
 *   * Prices + sizes are `number` (doubles). Fixed-point envelope
 *     reserved for Phase 9+ (same rule as `./orderflow.ts`).
 *   * camelCase over the wire — the backend Pydantic v2 models use
 *     `populate_by_name=True` with matching aliases.
 *   * Every detector event carries a deterministic `id` so the audit
 *     log + recall engine can reference it without re-hashing.
 */
import { z } from "zod";
import { DirectionSchema } from "./market.js";

// ──────────────────────────── execution mode ─────────────────────────────

/**
 * Which side of the execution bus the operator is driving.
 *
 *   * `paper` — Phase 3 behaviour: no broker call; fills simulated.
 *   * `live`  — Phase 4 behaviour: broker call gated by risk engine.
 */
export const ExecutionModeSchema = z.enum(["paper", "live"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

// ──────────────────────────── risk envelope ──────────────────────────────

/**
 * Account-wide risk envelope. Loaded once per account from
 * `system_config.execution.risk.*` and fed to the live gate unchanged.
 *
 * The live gate rejects a request that would breach *any* cap. Defaults
 * are the Phase 4 launch values; operators can tighten any knob at any
 * time via `PATCH /v1/system-config`.
 */
export const RiskBudgetSchema = z.object({
  /**
   * Hard ceiling on per-trade risk as a fraction of account equity.
   * 0.005 = 0.5% of equity, a common prop-firm starting point.
   */
  maxRiskPerTradeR: z.number().positive().max(0.1),
  /**
   * Daily realised-loss drawdown cap as a fraction of start-of-day equity.
   * Trips the day-kill switch which rejects every new live approval.
   */
  maxDailyDrawdownR: z.number().positive().max(0.25),
  /**
   * Max number of simultaneously open *live* positions across the book.
   * Complements (does not replace) the per-symbol paper-gate cap.
   */
  maxOpenPositions: z.number().int().positive().max(200),
  /**
   * Max sum of notional exposure across positions whose symbols share a
   * correlation class (e.g. NQ + ES). `1.0` means "one full equity unit
   * of correlated gross exposure".
   */
  maxCorrelatedExposure: z.number().positive().max(5),
  /**
   * Gross notional exposure ceiling across *all* open positions as a
   * fraction of equity. 2.0 = up to 2x equity gross.
   */
  maxGrossExposure: z.number().positive().max(10),
});
export type RiskBudget = z.infer<typeof RiskBudgetSchema>;

/** Live broker equity snapshot — the numerator of every risk ratio. */
export const AccountEquitySchema = z.object({
  /** ISO-8601 UTC observation time. */
  observedAt: z.string().datetime(),
  /** Cash + marketable positions, marked to market. */
  totalEquity: z.number().nonnegative(),
  /** Equity at the session open — the daily drawdown baseline. */
  startOfDayEquity: z.number().nonnegative(),
  /** Realised PnL booked today. Negative on a losing day. */
  realizedPnL: z.number(),
  /** Open-position mark-to-market PnL. */
  unrealizedPnL: z.number(),
  /** Amount posted as margin on open positions. */
  marginUsed: z.number().nonnegative(),
  /** Equity currently free for new positions (= totalEquity - marginUsed). */
  buyingPower: z.number().nonnegative(),
});
export type AccountEquity = z.infer<typeof AccountEquitySchema>;

// ──────────────────────────── positions ──────────────────────────────────

export const PositionStatusSchema = z.enum(["open", "closed"]);
export type PositionStatus = z.infer<typeof PositionStatusSchema>;

/**
 * One live-broker position. Mirrors Alpaca's position schema but
 * normalised so the UI + risk engine can consume every broker we
 * eventually connect through a single shape.
 */
export const PositionSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  symbolId: z.string().min(1),
  direction: DirectionSchema,
  /** Signed quantity: positive = long, negative = short. */
  qty: z.number(),
  avgEntryPrice: z.number().positive(),
  /** Current mark — always from the broker, never the detector cache. */
  markPrice: z.number().positive(),
  unrealizedPnL: z.number(),
  status: PositionStatusSchema,
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  /** Optional link back to the setup that opened this position. */
  setupId: z.string().min(1).nullable(),
  /** Optional link back to the live trade row. */
  liveTradeId: z.string().min(1).nullable(),
});
export type Position = z.infer<typeof PositionSchema>;

// ──────────────────────────── broker adapter ─────────────────────────────

export const OrderTypeSchema = z.enum([
  "market",
  "limit",
  "stop",
  "stop_limit",
  "bracket",
]);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const TimeInForceSchema = z.enum(["day", "gtc", "ioc", "fok"]);
export type TimeInForce = z.infer<typeof TimeInForceSchema>;

/**
 * Canonical order envelope handed from the live gate to the broker adapter.
 * The adapter is responsible for mapping this shape onto the broker's
 * native REST/WebSocket schema.
 */
export const BrokerRequestSchema = z.object({
  /** Idempotency key — adapter rejects duplicates within the TTL. */
  clientOrderId: z.string().min(1).max(128),
  accountId: z.string().min(1),
  symbolId: z.string().min(1),
  direction: DirectionSchema,
  qty: z.number().positive(),
  type: OrderTypeSchema,
  timeInForce: TimeInForceSchema,
  /** Required for limit / stop / stop_limit / bracket. */
  limitPrice: z.number().positive().optional(),
  /** Required for stop / stop_limit / bracket. */
  stopPrice: z.number().positive().optional(),
  /** For bracket orders — the profit target. */
  takeProfitPrice: z.number().positive().optional(),
  /** For bracket orders — the protective stop. */
  stopLossPrice: z.number().positive().optional(),
  /** Optional link back to the setup that generated this request. */
  setupId: z.string().min(1).optional(),
  /** Free-form note stored on the audit log + the live trade row. */
  note: z.string().max(500).optional(),
});
export type BrokerRequest = z.infer<typeof BrokerRequestSchema>;

export const BrokerFillStatusSchema = z.enum([
  "accepted",
  "partially_filled",
  "filled",
  "canceled",
  "rejected",
  "expired",
]);
export type BrokerFillStatus = z.infer<typeof BrokerFillStatusSchema>;

/**
 * One broker execution report. A single `BrokerRequest` can produce many
 * `BrokerFill`s (partials) — the adapter stores each one and the live
 * trade row rolls them up.
 */
export const BrokerFillSchema = z.object({
  id: z.string().min(1),
  clientOrderId: z.string().min(1),
  brokerOrderId: z.string().min(1),
  symbolId: z.string().min(1),
  direction: DirectionSchema,
  /** Signed fill qty — positive = long side, negative = closing/flipping. */
  filledQty: z.number(),
  avgFillPrice: z.number().positive().nullable(),
  status: BrokerFillStatusSchema,
  /** Commission in account currency. Never negative. */
  commission: z.number().nonnegative().default(0),
  /** Slippage vs. gate's expected entryRef. */
  slippage: z.number().nullable(),
  observedAt: z.string().datetime(),
  /** Optional broker-side error code for rejected/expired fills. */
  errorCode: z.string().max(64).optional(),
  errorMessage: z.string().max(500).optional(),
});
export type BrokerFill = z.infer<typeof BrokerFillSchema>;

// ──────────────────────────── live gate surface ──────────────────────────

/**
 * The union of every rejection reason the paper gate (Phase 3) and the
 * live gate (Phase 4) can emit. Frontend localisation + audit bucketing
 * pin against this closed enum.
 *
 * Keep this list in lockstep with
 *   * `services/control_plane/app/execution/gate.py :: GateReason` (paper)
 *   * `services/control_plane/app/execution/live_gate.py :: LiveGateReason`
 */
export const GateRejectionReasonSchema = z.enum([
  // paper gate (Phase 3) — unchanged
  "approved",
  "kill_switch_active",
  "live_disallowed",
  "setup_not_detected",
  "setup_expired",
  "size_multiplier_out_of_range",
  "confidence_below_threshold",
  "per_symbol_cap_exceeded",
  "global_cap_exceeded",
  "duplicate_active_trade",
  // live gate (Phase 4) — additive
  "live_disabled",
  "broker_unavailable",
  "risk_budget_missing",
  "daily_drawdown_breached",
  "max_open_positions_breached",
  "correlation_cap_breached",
  "gross_exposure_breached",
  "insufficient_buying_power",
  "risk_per_trade_breached",
  "stale_equity_snapshot",
]);
export type GateRejectionReason = z.infer<typeof GateRejectionReasonSchema>;

/**
 * Input snapshot consumed by `evaluate_live_gate`. Mirrors the paper
 * gate's `GateInput` but adds the risk + broker context.
 *
 * The caller is responsible for loading every field — the gate stays
 * pure (no I/O, deterministic, trivially unit-testable).
 */
export const LiveGateInputSchema = z.object({
  mode: ExecutionModeSchema,
  sizeMultiplier: z.number().positive(),

  // setup snapshot (same as paper gate)
  setupStatus: z.string().min(1),
  setupConfidence: z.number().min(0).max(1),
  setupExpiresAt: z.string().datetime().nullable(),
  setupHasActiveLiveTrade: z.boolean(),

  // runtime flags + counters (same as paper gate)
  killSwitchActive: z.boolean(),
  activeTradesForSymbol: z.number().int().nonnegative(),
  activeTradesGlobal: z.number().int().nonnegative(),

  // Phase 4 — additive
  liveEnabled: z.boolean(),
  brokerAvailable: z.boolean(),
  equity: AccountEquitySchema.nullable(),
  risk: RiskBudgetSchema.nullable(),
  /** Planned $-risk = |entry - SL| * qty. */
  plannedTradeRiskDollars: z.number().nonnegative(),
  /** Planned $-notional = entry * qty. */
  plannedTradeNotional: z.number().nonnegative(),
  /** Sum of |qty * mark| across open positions. */
  currentGrossExposure: z.number().nonnegative(),
  /** Sum of |qty * mark| across open positions in the same correlation class. */
  correlatedGrossExposure: z.number().nonnegative(),
  openPositionsCount: z.number().int().nonnegative(),

  /** Freshness gate — live gate rejects if equity is older than this many seconds. */
  equityAgeSeconds: z.number().int().nonnegative().nullable(),

  now: z.string().datetime(),
});
export type LiveGateInput = z.infer<typeof LiveGateInputSchema>;

export const GateDecisionSchema = z.object({
  approved: z.boolean(),
  reason: GateRejectionReasonSchema,
  detail: z.string(),
});
export type GateDecision = z.infer<typeof GateDecisionSchema>;

// ──────────────────────────── live trade envelope ────────────────────────

export const LiveTradeStatusSchema = z.enum([
  "pending_submit",
  "submitted",
  "partially_filled",
  "filled",
  "won",
  "lost",
  "scratched",
  "cancelled",
  "rejected",
]);
export type LiveTradeStatus = z.infer<typeof LiveTradeStatusSchema>;

/**
 * Live sibling of `PaperTrade`. Adds the broker round-trip fields +
 * realised PnL in dollars (paper-mode tracks only R-multiples).
 */
export const LiveTradeSchema = z.object({
  id: z.string().min(1),
  setupId: z.string().min(1),
  symbolId: z.string().min(1),
  accountId: z.string().min(1),
  direction: DirectionSchema,
  entryRef: z.number(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  sizeMultiplier: z.number().positive(),
  /** Actual qty the risk engine sized. */
  qty: z.number().positive(),
  status: LiveTradeStatusSchema,
  clientOrderId: z.string().min(1),
  brokerOrderId: z.string().min(1).nullable(),
  approvedAt: z.string().datetime(),
  approvedByUserId: z.string().min(1),
  submittedAt: z.string().datetime().nullable(),
  filledAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  avgFillPrice: z.number().positive().nullable(),
  filledQty: z.number().default(0),
  commission: z.number().nonnegative().default(0),
  realizedPnLDollars: z.number().nullable(),
  pnlR: z.number().nullable(),
  note: z.string().max(500).optional(),
});
export type LiveTrade = z.infer<typeof LiveTradeSchema>;

export const LiveTradeFilterSchema = z.object({
  symbolId: z.string().optional(),
  setupId: z.string().optional(),
  accountId: z.string().optional(),
  direction: DirectionSchema.optional(),
  status: LiveTradeStatusSchema.optional(),
  fromTs: z.string().datetime().optional(),
  toTs: z.string().datetime().optional(),
  /** Pagination — server uses offset + limit, not cursor. */
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type LiveTradeFilter = z.infer<typeof LiveTradeFilterSchema>;

/**
 * Response envelope from ``GET /v1/live-trades`` — mirrors
 * ``LiveTradesListOut`` in ``services/control_plane/app/routes/live_trades.py``.
 */
export const LiveTradesListOutSchema = z.object({
  trades: z.array(LiveTradeSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type LiveTradesListOut = z.infer<typeof LiveTradesListOutSchema>;

// ──────────────────────────── preview / approve envelopes ────────────────

/**
 * Sizing projection returned by the live-gate dry-run + approve-live
 * paths. Mirrors ``LiveSizingDto`` on the server.
 */
export const LiveSizingSchema = z.object({
  qty: z.number(),
  notional: z.number(),
  dollarRisk: z.number(),
  rRisk: z.number(),
});
export type LiveSizing = z.infer<typeof LiveSizingSchema>;

/**
 * Risk projection returned alongside sizing. Mirrors
 * ``LiveRiskProjectionDto`` on the server.
 */
export const LiveRiskProjectionSchema = z.object({
  projectedGross: z.number(),
  projectedCorrelated: z.number(),
  drawdownR: z.number(),
});
export type LiveRiskProjection = z.infer<typeof LiveRiskProjectionSchema>;

/**
 * Optional per-call risk override. Admins can tighten (never loosen)
 * the effective budget for a single preview / approve.
 */
export const OverrideRiskSchema = z.object({
  maxDollarRisk: z.number().nonnegative().optional(),
  maxGrossExposure: z.number().nonnegative().optional(),
  maxCorrelatedExposure: z.number().nonnegative().optional(),
});
export type OverrideRisk = z.infer<typeof OverrideRiskSchema>;

/**
 * Request body for POST /v1/execution/live/preview. Mirrors
 * ``LivePreviewIn`` on the server.
 */
export const LivePreviewInSchema = z.object({
  setupId: z.string().min(1),
  accountId: z.string().min(1),
  mode: ExecutionModeSchema.default("live"),
  overrideRisk: OverrideRiskSchema.optional(),
});
export type LivePreviewIn = z.infer<typeof LivePreviewInSchema>;

/**
 * Response body for POST /v1/execution/live/preview. Mirrors
 * ``LivePreviewOut`` on the server — the "dry-run" envelope.
 */
export const LivePreviewOutSchema = z.object({
  approved: z.boolean(),
  reason: z.string(),
  detail: z.string(),
  sizing: LiveSizingSchema.nullable().optional(),
  risk: LiveRiskProjectionSchema.nullable().optional(),
});
export type LivePreviewOut = z.infer<typeof LivePreviewOutSchema>;

/**
 * Response body for POST /v1/setups/:id/approve-live. Mirrors
 * ``LiveApprovalOut`` on the server. On reject, ``liveTrade`` is
 * null; on approve, it carries the freshly-minted live trade row.
 */
export const LiveApprovalOutSchema = z.object({
  approved: z.boolean(),
  reason: z.string(),
  detail: z.string(),
  liveTrade: LiveTradeSchema.nullable().optional(),
});
export type LiveApprovalOut = z.infer<typeof LiveApprovalOutSchema>;

// ──────────────────────────── broker list envelopes ──────────────────────

/**
 * Response envelope from ``GET /v1/broker/positions``. Mirrors
 * ``BrokerPositionsOut`` on the server.
 */
export const BrokerPositionsOutSchema = z.object({
  accountId: z.string(),
  mode: ExecutionModeSchema,
  positions: z.array(PositionSchema),
  observedAt: z.string().datetime(),
});
export type BrokerPositionsOut = z.infer<typeof BrokerPositionsOutSchema>;

/**
 * Response envelope from ``GET /v1/broker/fills``. Mirrors
 * ``BrokerFillsOut`` on the server.
 */
export const BrokerFillsOutSchema = z.object({
  accountId: z.string(),
  provider: z.string(),
  mode: ExecutionModeSchema,
  fills: z.array(BrokerFillSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type BrokerFillsOut = z.infer<typeof BrokerFillsOutSchema>;

// ──────────────────────────── replay envelope ────────────────────────────

/**
 * A compact snapshot of everything the Phase 4 replay surface needs to
 * render one tick of a historical trade: the bar, the order-flow state,
 * the setup (if any), and any active position. Emitted by the replay
 * cursor endpoint and consumed by `/execution/replay`.
 */
export const ReplayFrameSchema = z.object({
  t: z.string().datetime(),
  symbolId: z.string().min(1),
  /** The OHLCV of the current bar for the replay TF. */
  bar: z.object({
    o: z.number(),
    h: z.number(),
    l: z.number(),
    c: z.number(),
    v: z.number().nonnegative(),
  }),
  /** Aggregate delta so far for this bar. */
  cumulativeDelta: z.number(),
  /** Structure verdict at this tick. */
  structureVerdict: z.enum(["bullish", "bearish", "mixed", "ranging"]).nullable(),
  /** The setup row if one was active at this tick. */
  setupId: z.string().min(1).nullable(),
  /** The live trade row if one was open at this tick. */
  liveTradeId: z.string().min(1).nullable(),
});
export type ReplayFrame = z.infer<typeof ReplayFrameSchema>;
