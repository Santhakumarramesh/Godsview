/**
 * Execution Layer — Phases 96 + 103
 *
 * Phase 96: Broker bridge, portfolio tracking, risk management
 * Phase 103: Execution engine, position manager, smart order router
 */

// ── Phase 96 ────────────────────────────────────────────────────────────────
export { BrokerBridge } from "./broker_bridge.js";
export type {
  OrderSide, OrderType, OrderTimeInForce, OrderStatus, PositionSide,
  BrokerCredentials, BrokerOrder, BrokerPosition, AccountState,
  OrderRequest, FillEvent, BrokerBridgeEvents,
} from "./broker_bridge.js";

export { PortfolioTracker } from "./portfolio_tracker.js";
export type {
  PortfolioPosition, PortfolioSnapshot, ExposureMetrics,
  PerformanceMetrics, RiskMetrics, TradeRecord,
} from "./portfolio_tracker.js";

export { RiskManager } from "./risk_manager.js";
export type {
  RiskLimits, PositionSizeRequest, PositionSizeResult,
  RiskCheckResult, RiskCheck, CircuitBreakerState,
} from "./risk_manager.js";

// ── Phase 103 ───────────────────────────────────────────────────────────────
export { ExecutionEngine } from "./execution_engine.js";
export type { ExecutionConfig, ExecutionReport } from "./execution_engine.js";

export { PositionManager } from "./position_manager.js";
export type { Position, PositionUpdate, ClosedPosition } from "./position_manager.js";

export { SmartOrderRouter } from "./smart_router.js";
export type { RouterConfig, VenueConfig, RoutingStrategy, RouteDecision, RouteLeg, VenueHealth } from "./smart_router.js";
