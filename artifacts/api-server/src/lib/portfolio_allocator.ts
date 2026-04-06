import { db, siDecisionsTable, tradesTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getStrategyAllocationForSignal } from "./strategy_allocator";
import { persistWrite, persistRead, persistAppend } from "./persistent_store";
import { logger } from "./logger";

export interface PortfolioAllocatorPolicy {
  account_equity: number;
  max_total_risk_pct: number;
  max_positions: number;
  max_new_allocations: number;
  max_symbol_exposure_pct: number;
  min_expected_value: number;
  min_risk_pct_per_trade: number;
  max_risk_pct_per_trade: number;
}

export interface PortfolioOpportunity {
  decision_id: number;
  symbol: string;
  setup_type: string;
  regime: string;
  direction: string;
  strategy_id: string;
  approved: boolean;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  suggested_qty: number;
  win_probability: number;
  final_quality: number;
  edge_score: number;
  kelly_fraction: number;
  confluence_score: number;
  expected_value: number;
  rr_ratio: number;
  recency_score: number;
  base_score: number;
  adjusted_score: number;
  strategy_multiplier: number;
  recommended_risk_pct: number;
  created_at: string;
}

export interface PortfolioExposureSnapshot {
  open_positions: number;
  long_positions: number;
  short_positions: number;
  gross_notional_usd: number;
  net_notional_usd: number;
  open_risk_usd: number;
  open_risk_pct: number;
  by_symbol: Array<{ symbol: string; notional_usd: number; pct_of_equity: number }>;
}

export interface PortfolioAllocationEntry {
  decision_id: number;
  symbol: string;
  setup_type: string;
  regime: string;
  direction: string;
  strategy_id: string;
  score: number;
  expected_value: number;
  risk_pct: number;
  risk_usd: number;
  notional_usd: number;
  quantity: number;
  rationale: string[];
}

export interface PortfolioAllocatorSnapshot {
  generated_at: string;
  cycle_reason: string;
  policy: PortfolioAllocatorPolicy;
  exposure: PortfolioExposureSnapshot;
  opportunities: PortfolioOpportunity[];
  allocations: PortfolioAllocationEntry[];
  blocked: Array<{ decision_id: number; symbol: string; reason: string }>;
  available_risk_pct: number;
  available_risk_usd: number;
}

let _latestSnapshot: PortfolioAllocatorSnapshot | null = null;

function parseNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Validate allocation constraints
 */
export function validateAllocationConstraints(policy: PortfolioAllocatorPolicy): string[] {
  const errors: string[] = [];

  if (policy.max_total_risk_pct < 0 || policy.max_total_risk_pct > 1) {
    errors.push(`max_total_risk_pct must be in [0, 1], got ${policy.max_total_risk_pct}`);
  }
  if (policy.max_symbol_exposure_pct < 0 || policy.max_symbol_exposure_pct > 1) {
    errors.push(`max_symbol_exposure_pct must be in [0, 1], got ${policy.max_symbol_exposure_pct}`);
  }
  if (policy.min_risk_pct_per_trade < 0 || policy.min_risk_pct_per_trade > 1) {
    errors.push(`min_risk_pct_per_trade must be in [0, 1], got ${policy.min_risk_pct_per_trade}`);
  }
  if (policy.max_risk_pct_per_trade < 0 || policy.max_risk_pct_per_trade > 1) {
    errors.push(`max_risk_pct_per_trade must be in [0, 1], got ${policy.max_risk_pct_per_trade}`);
  }
  if (policy.min_risk_pct_per_trade > policy.max_risk_pct_per_trade) {
    errors.push("min_risk_pct_per_trade must be <= max_risk_pct_per_trade");
  }
  if (policy.max_positions <= 0) {
    errors.push(`max_positions must be positive, got ${policy.max_positions}`);
  }
  if (policy.account_equity <= 0) {
    errors.push(`account_equity must be positive, got ${policy.account_equity}`);
  }

  return errors;
}

/**
 * Correlation guard — warn if highly correlated positions exceed threshold
 */
export function correlationGuard(allocations: PortfolioAllocationEntry[]): {
  passed: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Group by potential correlations (simplified: check sector-like groupings)
  // In a real system, you'd calculate actual correlation matrix
  const highCorrelationPairs: { [key: string]: string[] } = {
    tech: ["AAPL", "MSFT", "GOOGL", "META", "NVDA", "TSLA"],
    banking: ["JPM", "BAC", "WFC", "GS", "MS"],
    energy: ["XOM", "CVX", "COP", "MPC"],
  };

  // Check for correlated positions with combined weight > 40%
  for (const [, symbols] of Object.entries(highCorrelationPairs)) {
    const matching = allocations.filter((a) => symbols.includes(a.symbol));
    if (matching.length >= 2) {
      const combinedWeight = matching.reduce((sum, a) => sum + (a.risk_pct * 100), 0);
      if (combinedWeight > 40) {
        warnings.push(
          `Correlated cluster (${matching.map((a) => a.symbol).join(", ")}) has combined weight ${combinedWeight.toFixed(1)}% > 40%`,
        );
      }
    }
  }

  // Check individual correlations > 0.8 (simplified placeholder)
  for (let i = 0; i < allocations.length; i++) {
    for (let j = i + 1; j < allocations.length; j++) {
      const a = allocations[i];
      const b = allocations[j];
      // Simplified check: same regime or strategy are likely correlated
      if (a.regime === b.regime && a.strategy_id === b.strategy_id) {
        const combined = (a.risk_pct + b.risk_pct) * 100;
        if (combined > 40) {
          warnings.push(
            `${a.symbol} and ${b.symbol} share regime/strategy with combined weight ${combined.toFixed(1)}% > 40%`,
          );
        }
      }
    }
  }

  return {
    passed: warnings.length === 0,
    warnings,
  };
}

function strategyId(setupType: string, regime: string, symbol: string): string {
  const normalizeToken = (token: string): string => {
    const normalized = token
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized || "*";
  };
  return `${normalizeToken(setupType)}::${normalizeToken(regime)}::${normalizeSymbol(symbol) || "*"}`;
}

function policyFromEnv(): PortfolioAllocatorPolicy {
  const equity = Math.max(1_000, parseNum(process.env.BRAIN_ACCOUNT_EQUITY, 100_000));
  return {
    account_equity: equity,
    max_total_risk_pct: clamp(parseNum(process.env.PORTFOLIO_ALLOCATOR_MAX_TOTAL_RISK_PCT, 0.12), 0.02, 0.5),
    max_positions: Math.max(1, Math.min(30, Math.round(parseNum(process.env.BRAIN_MAX_POSITIONS, 8)))),
    max_new_allocations: Math.max(1, Math.min(20, Math.round(parseNum(process.env.PORTFOLIO_ALLOCATOR_MAX_NEW, 6)))),
    max_symbol_exposure_pct: clamp(parseNum(process.env.PORTFOLIO_ALLOCATOR_MAX_SYMBOL_EXPOSURE_PCT, 0.2), 0.05, 0.6),
    min_expected_value: parseNum(process.env.PORTFOLIO_ALLOCATOR_MIN_EV, 0.05),
    min_risk_pct_per_trade: clamp(parseNum(process.env.PORTFOLIO_ALLOCATOR_MIN_RISK_PCT, 0.0035), 0.001, 0.05),
    max_risk_pct_per_trade: clamp(parseNum(process.env.PORTFOLIO_ALLOCATOR_MAX_RISK_PCT, 0.02), 0.003, 0.08),
  };
}

async function loadOpenTrades(): Promise<Array<{
  symbol: string;
  direction: string;
  qty: number;
  entry: number;
  stop: number;
  regime: string;
}>> {
  const rows = await db
    .select({
      instrument: tradesTable.instrument,
      direction: tradesTable.direction,
      quantity: tradesTable.quantity,
      entry_price: tradesTable.entry_price,
      stop_loss: tradesTable.stop_loss,
      regime: tradesTable.regime,
    })
    .from(tradesTable)
    .where(eq(tradesTable.outcome, "open"))
    .orderBy(desc(tradesTable.created_at))
    .limit(300);

  return rows.map((row: {
    instrument: string | null;
    direction: string | null;
    quantity: unknown;
    entry_price: unknown;
    stop_loss: unknown;
    regime: string | null;
  }) => ({
    symbol: normalizeSymbol(row.instrument),
    direction: String(row.direction ?? "long").toLowerCase(),
    qty: Math.max(0, parseNum(row.quantity)),
    entry: Math.max(0, parseNum(row.entry_price)),
    stop: Math.max(0, parseNum(row.stop_loss)),
    regime: String(row.regime ?? "unknown"),
  })).filter((row: { symbol: string }) => row.symbol);
}

async function loadPendingDecisions(): Promise<Array<{
  id: number;
  symbol: string;
  setup_type: string;
  regime: string;
  direction: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  suggested_qty: number;
  win_probability: number;
  final_quality: number;
  edge_score: number;
  kelly_fraction: number;
  confluence_score: number;
  approved: boolean;
  created_at: Date;
}>> {
  const rows = await db
    .select({
      id: siDecisionsTable.id,
      symbol: siDecisionsTable.symbol,
      setup_type: siDecisionsTable.setup_type,
      regime: siDecisionsTable.regime,
      direction: siDecisionsTable.direction,
      entry_price: siDecisionsTable.entry_price,
      stop_loss: siDecisionsTable.stop_loss,
      take_profit: siDecisionsTable.take_profit,
      suggested_qty: siDecisionsTable.suggested_qty,
      win_probability: siDecisionsTable.win_probability,
      final_quality: siDecisionsTable.final_quality,
      edge_score: siDecisionsTable.edge_score,
      kelly_fraction: siDecisionsTable.kelly_fraction,
      confluence_score: siDecisionsTable.confluence_score,
      approved: siDecisionsTable.approved,
      created_at: siDecisionsTable.created_at,
    })
    .from(siDecisionsTable)
    .where(
      and(
        eq(siDecisionsTable.approved, true),
        isNull(siDecisionsTable.outcome),
      ),
    )
    .orderBy(desc(siDecisionsTable.created_at))
    .limit(600);

  const seen = new Set<number>();
  const deduped: Array<{
    id: number;
    symbol: string;
    setup_type: string;
    regime: string;
    direction: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    suggested_qty: number;
    win_probability: number;
    final_quality: number;
    edge_score: number;
    kelly_fraction: number;
    confluence_score: number;
    approved: boolean;
    created_at: Date;
  }> = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    deduped.push({
      id: row.id,
      symbol,
      setup_type: String(row.setup_type ?? "unknown"),
      regime: String(row.regime ?? "mixed"),
      direction: String(row.direction ?? "long").toLowerCase(),
      entry_price: parseNum(row.entry_price),
      stop_loss: parseNum(row.stop_loss),
      take_profit: parseNum(row.take_profit),
      suggested_qty: Math.max(0, Math.round(parseNum(row.suggested_qty))),
      win_probability: clamp(parseNum(row.win_probability)),
      final_quality: clamp(parseNum(row.final_quality)),
      edge_score: clamp(parseNum(row.edge_score)),
      kelly_fraction: clamp(parseNum(row.kelly_fraction), 0, 1.5),
      confluence_score: clamp(parseNum(row.confluence_score) > 1 ? parseNum(row.confluence_score) / 100 : parseNum(row.confluence_score)),
      approved: Boolean(row.approved),
      created_at: row.created_at ?? new Date(0),
    });
  }

  return deduped;
}

function buildExposure(policy: PortfolioAllocatorPolicy, openTrades: Array<{
  symbol: string;
  direction: string;
  qty: number;
  entry: number;
  stop: number;
  regime: string;
}>): PortfolioExposureSnapshot {
  let longPositions = 0;
  let shortPositions = 0;
  let grossNotional = 0;
  let netNotional = 0;
  let openRiskUsd = 0;
  const bySymbolMap = new Map<string, number>();

  for (const trade of openTrades) {
    const notional = Math.max(0, trade.entry * trade.qty);
    const signed = trade.direction === "short" ? -notional : notional;
    const stopDistance = Math.abs(trade.entry - trade.stop);
    const risk = stopDistance * trade.qty;

    grossNotional += Math.abs(signed);
    netNotional += signed;
    openRiskUsd += risk;

    if (trade.direction === "short") shortPositions += 1;
    else longPositions += 1;

    bySymbolMap.set(trade.symbol, (bySymbolMap.get(trade.symbol) ?? 0) + Math.abs(signed));
  }

  const bySymbol = Array.from(bySymbolMap.entries())
    .map(([symbol, notional]) => ({
      symbol,
      notional_usd: Number(notional.toFixed(2)),
      pct_of_equity: Number((notional / policy.account_equity).toFixed(4)),
    }))
    .sort((a, b) => b.notional_usd - a.notional_usd);

  return {
    open_positions: openTrades.length,
    long_positions: longPositions,
    short_positions: shortPositions,
    gross_notional_usd: Number(grossNotional.toFixed(2)),
    net_notional_usd: Number(netNotional.toFixed(2)),
    open_risk_usd: Number(openRiskUsd.toFixed(2)),
    open_risk_pct: Number((openRiskUsd / policy.account_equity).toFixed(4)),
    by_symbol: bySymbol,
  };
}

function buildOpportunities(
  decisions: Array<{
    id: number;
    symbol: string;
    setup_type: string;
    regime: string;
    direction: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    suggested_qty: number;
    win_probability: number;
    final_quality: number;
    edge_score: number;
    kelly_fraction: number;
    confluence_score: number;
    approved: boolean;
    created_at: Date;
  }>,
  policy: PortfolioAllocatorPolicy,
): PortfolioOpportunity[] {
  return decisions
    .map((decision) => {
      const stopDistance = Math.max(0.0001, Math.abs(decision.entry_price - decision.stop_loss));
      const rewardDistance = Math.max(0.0001, Math.abs(decision.take_profit - decision.entry_price));
      const rr = rewardDistance / stopDistance;
      const expectedValue = decision.win_probability * rr - (1 - decision.win_probability);
      const ageMinutes = Math.max(0, (Date.now() - decision.created_at.getTime()) / 60_000);
      const recencyScore = clamp(Math.exp(-ageMinutes / 180));

      const strategy = getStrategyAllocationForSignal({
        setup_type: decision.setup_type,
        regime: decision.regime,
        symbol: decision.symbol,
      });

      const baseScore = clamp(
        0.34 * decision.final_quality +
          0.24 * decision.win_probability +
          0.16 * decision.edge_score +
          0.12 * decision.kelly_fraction +
          0.08 * decision.confluence_score +
          0.06 * recencyScore,
      );

      const adjustedScore = clamp(baseScore * strategy.multiplier);
      const riskPct = clamp(
        Math.max(policy.min_risk_pct_per_trade, strategy.risk_budget_pct * adjustedScore),
        policy.min_risk_pct_per_trade,
        policy.max_risk_pct_per_trade,
      );

      return {
        decision_id: decision.id,
        symbol: decision.symbol,
        setup_type: decision.setup_type,
        regime: decision.regime,
        direction: decision.direction,
        strategy_id: strategyId(decision.setup_type, decision.regime, decision.symbol),
        approved: decision.approved,
        entry_price: Number(decision.entry_price.toFixed(6)),
        stop_loss: Number(decision.stop_loss.toFixed(6)),
        take_profit: Number(decision.take_profit.toFixed(6)),
        suggested_qty: decision.suggested_qty,
        win_probability: Number(decision.win_probability.toFixed(4)),
        final_quality: Number(decision.final_quality.toFixed(4)),
        edge_score: Number(decision.edge_score.toFixed(4)),
        kelly_fraction: Number(decision.kelly_fraction.toFixed(4)),
        confluence_score: Number(decision.confluence_score.toFixed(4)),
        expected_value: Number(expectedValue.toFixed(4)),
        rr_ratio: Number(rr.toFixed(4)),
        recency_score: Number(recencyScore.toFixed(4)),
        base_score: Number(baseScore.toFixed(4)),
        adjusted_score: Number(adjustedScore.toFixed(4)),
        strategy_multiplier: Number(strategy.multiplier.toFixed(4)),
        recommended_risk_pct: Number(riskPct.toFixed(4)),
        created_at: decision.created_at.toISOString(),
      } satisfies PortfolioOpportunity;
    })
    .sort((a, b) => {
      const scoreA = a.adjusted_score + a.expected_value * 0.25;
      const scoreB = b.adjusted_score + b.expected_value * 0.25;
      return scoreB - scoreA;
    });
}

function allocate(
  opportunities: PortfolioOpportunity[],
  exposure: PortfolioExposureSnapshot,
  policy: PortfolioAllocatorPolicy,
): {
  allocations: PortfolioAllocationEntry[];
  blocked: Array<{ decision_id: number; symbol: string; reason: string }>;
  availableRiskPct: number;
} {
  const allocations: PortfolioAllocationEntry[] = [];
  const blocked: Array<{ decision_id: number; symbol: string; reason: string }> = [];

  const symbolExposure = new Map<string, number>();
  for (const row of exposure.by_symbol) {
    symbolExposure.set(row.symbol, row.pct_of_equity);
  }

  const openSymbols = new Set(exposure.by_symbol.map((row) => row.symbol));
  const openSlots = Math.max(0, policy.max_positions - exposure.open_positions);
  const maxNew = Math.min(policy.max_new_allocations, openSlots);

  let availableRiskPct = Math.max(0, policy.max_total_risk_pct - exposure.open_risk_pct);

  if (availableRiskPct <= policy.min_risk_pct_per_trade || maxNew <= 0) {
    return { allocations, blocked, availableRiskPct };
  }

  for (const opportunity of opportunities) {
    if (allocations.length >= maxNew) break;

    if (opportunity.expected_value < policy.min_expected_value) {
      blocked.push({ decision_id: opportunity.decision_id, symbol: opportunity.symbol, reason: "expected_value_below_threshold" });
      continue;
    }

    if (openSymbols.has(opportunity.symbol)) {
      blocked.push({ decision_id: opportunity.decision_id, symbol: opportunity.symbol, reason: "symbol_already_open" });
      continue;
    }

    const symbolExp = symbolExposure.get(opportunity.symbol) ?? 0;
    const desiredNotional = opportunity.entry_price * Math.max(1, opportunity.suggested_qty);
    const desiredExposurePct = desiredNotional / policy.account_equity;

    if (symbolExp + desiredExposurePct > policy.max_symbol_exposure_pct) {
      blocked.push({ decision_id: opportunity.decision_id, symbol: opportunity.symbol, reason: "symbol_exposure_limit" });
      continue;
    }

    const requestedRisk = clamp(
      opportunity.recommended_risk_pct,
      policy.min_risk_pct_per_trade,
      policy.max_risk_pct_per_trade,
    );

    if (requestedRisk > availableRiskPct) {
      if (availableRiskPct < policy.min_risk_pct_per_trade) {
        blocked.push({ decision_id: opportunity.decision_id, symbol: opportunity.symbol, reason: "risk_budget_exhausted" });
        continue;
      }
    }

    const riskPct = Math.min(requestedRisk, availableRiskPct);
    const riskUsd = riskPct * policy.account_equity;
    const stopDistance = Math.max(0.0001, Math.abs(opportunity.entry_price - opportunity.stop_loss));
    const qtyFromRisk = Math.max(1, Math.floor(riskUsd / stopDistance));
    const quantity = Math.max(1, Math.min(qtyFromRisk, opportunity.suggested_qty || qtyFromRisk));
    const notional = quantity * opportunity.entry_price;

    allocations.push({
      decision_id: opportunity.decision_id,
      symbol: opportunity.symbol,
      setup_type: opportunity.setup_type,
      regime: opportunity.regime,
      direction: opportunity.direction,
      strategy_id: opportunity.strategy_id,
      score: opportunity.adjusted_score,
      expected_value: opportunity.expected_value,
      risk_pct: Number(riskPct.toFixed(4)),
      risk_usd: Number((riskPct * policy.account_equity).toFixed(2)),
      notional_usd: Number(notional.toFixed(2)),
      quantity,
      rationale: [
        `score=${opportunity.adjusted_score.toFixed(3)}`,
        `ev=${opportunity.expected_value.toFixed(3)}`,
        `risk=${(riskPct * 100).toFixed(2)}%`,
      ],
    });

    availableRiskPct = Math.max(0, availableRiskPct - riskPct);
    symbolExposure.set(opportunity.symbol, symbolExp + notional / policy.account_equity);
  }

  return {
    allocations,
    blocked,
    availableRiskPct,
  };
}

export async function computePortfolioAllocatorSnapshot(reason = "manual"): Promise<PortfolioAllocatorSnapshot> {
  const policy = policyFromEnv();
  const [openTrades, pendingDecisions] = await Promise.all([loadOpenTrades(), loadPendingDecisions()]);

  // Validate allocation constraints
  const validationErrors = validateAllocationConstraints(policy);
  if (validationErrors.length > 0) {
    logger.warn({ errors: validationErrors }, "Portfolio allocator policy validation failed");
  }

  const exposure = buildExposure(policy, openTrades);
  const opportunities = buildOpportunities(pendingDecisions, policy);
  const allocation = allocate(opportunities, exposure, policy);

  const snapshot: PortfolioAllocatorSnapshot = {
    generated_at: new Date().toISOString(),
    cycle_reason: reason,
    policy,
    exposure,
    opportunities,
    allocations: allocation.allocations,
    blocked: allocation.blocked,
    available_risk_pct: Number(allocation.availableRiskPct.toFixed(4)),
    available_risk_usd: Number((allocation.availableRiskPct * policy.account_equity).toFixed(2)),
  };

  // Persist allocation snapshot
  try {
    persistAppend("allocation_snapshots", snapshot, 1000);
  } catch (err) {
    logger.warn({ err }, "Failed to persist allocation snapshot");
  }

  // Check correlation guard
  const correlationCheck = correlationGuard(allocation.allocations);
  if (!correlationCheck.passed) {
    logger.warn({ warnings: correlationCheck.warnings }, "Correlation guard warnings");
  }

  _latestSnapshot = snapshot;
  return snapshot;
}

export async function getPortfolioAllocatorSnapshot(): Promise<PortfolioAllocatorSnapshot> {
  if (_latestSnapshot) return _latestSnapshot;
  return computePortfolioAllocatorSnapshot("bootstrap");
}

export function getCachedPortfolioAllocatorSnapshot(): PortfolioAllocatorSnapshot | null {
  return _latestSnapshot;
}
