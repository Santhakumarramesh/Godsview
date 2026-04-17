import { getAccount, getBars, getTypedPositions, type AlpacaPosition } from "./alpaca";
import { emergencyLiquidateAll, type LiquidationResult } from "./emergency_liquidator";
import { logger } from "./logger";
import { getRiskEngineSnapshot, isKillSwitchActive, setKillSwitchActive } from "./risk_engine";

export type PortfolioRiskState = "NORMAL" | "ELEVATED" | "CRITICAL" | "HALT";

export interface CorrelatedPair {
  symbol_a: string;
  symbol_b: string;
  correlation: number;
}

export interface PortfolioRiskPosition {
  symbol: string;
  side: string;
  qty: number;
  market_value: number;
  weight: number;
}

export interface PortfolioRiskSnapshot {
  generated_at: string;
  account_equity: number;
  peak_equity: number;
  drawdown_pct: number;
  one_day_var_usd: number;
  one_day_var_pct: number;
  var_confidence: number;
  avg_pair_correlation: number;
  max_pair_correlation: number;
  correlated_pairs: CorrelatedPair[];
  open_positions: PortfolioRiskPosition[];
  limits: {
    max_drawdown_pct: number;
    max_var_pct: number;
    max_avg_correlation: number;
    max_pair_correlation: number;
  };
  breaches: string[];
  risk_state: PortfolioRiskState;
  candidate_symbol: string | null;
  candidate_max_correlation: number;
}

export interface ExecutionRiskGate {
  allowed: boolean;
  action: "ALLOW" | "REDUCE" | "BLOCK" | "HALT";
  reasons: string[];
  size_multiplier: number;
  snapshot: PortfolioRiskSnapshot;
}

export interface EmergencyStopResult {
  kill_switch: boolean;
  triggered_at: string;
  reason: string;
  liquidation: LiquidationResult | null;
  risk: PortfolioRiskSnapshot;
}

const CACHE_TTL_MS = 20_000;
const LOOKBACK_BARS = Math.max(40, Math.min(300, Number(process.env.GODSVIEW_VAR_LOOKBACK_BARS ?? 120)));
const VAR_CONFIDENCE = Math.max(0.90, Math.min(0.999, Number(process.env.GODSVIEW_VAR_CONFIDENCE ?? 0.95)));

let _peakEquity = 0;
let _lastSnapshot: PortfolioRiskSnapshot | null = null;
let _lastSnapshotTs = 0;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toFinite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function zScore(confidence: number): number {
  if (confidence >= 0.995) return 2.58;
  if (confidence >= 0.99) return 2.33;
  if (confidence >= 0.975) return 1.96;
  if (confidence >= 0.95) return 1.65;
  return 1.28;
}

function getClose(bar: any): number {
  return toFinite(bar?.Close ?? bar?.close ?? bar?.c, 0);
}

function returnsFromCloses(closes: number[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev > 0 && curr > 0) {
      ret.push(Math.log(curr / prev));
    }
  }
  return ret;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 12) return 0;
  const aSlice = a.slice(-n);
  const bSlice = b.slice(-n);
  const meanA = aSlice.reduce((s, v) => s + v, 0) / n;
  const meanB = bSlice.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = aSlice[i] - meanA;
    const db = bSlice[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA <= 0 || varB <= 0) return 0;
  return Math.max(-1, Math.min(1, cov / Math.sqrt(varA * varB)));
}

async function getEquity(): Promise<number> {
  try {
    const account = await getAccount();
    if (typeof account === "object" && account !== null && "equity" in account) {
      return Math.max(0, toFinite((account as Record<string, unknown>).equity, 0));
    }
  } catch (err) {
    logger.warn({ err }, "[risk-guard] failed to fetch account equity");
  }
  return 0;
}

async function loadReturns(symbols: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const bars = await getBars(symbol, "15Min", LOOKBACK_BARS + 1);
      const closes = bars.map((bar) => getClose(bar)).filter((v) => v > 0);
      const ret = returnsFromCloses(closes);
      if (ret.length >= 12) {
        result.set(symbol, ret);
      }
    } catch (err) {
      logger.warn({ err, symbol }, "[risk-guard] failed to load bars for symbol");
    }
  }));
  return result;
}

function correlationStats(symbols: string[], returnsMap: Map<string, number[]>): {
  avgAbs: number;
  maxAbs: number;
  pairs: CorrelatedPair[];
} {
  const pairs: CorrelatedPair[] = [];
  let sumAbs = 0;
  let count = 0;
  let maxAbs = 0;

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = returnsMap.get(symbols[i]);
      const b = returnsMap.get(symbols[j]);
      if (!a || !b) continue;
      const corr = pearson(a, b);
      const abs = Math.abs(corr);
      sumAbs += abs;
      count += 1;
      maxAbs = Math.max(maxAbs, abs);
      pairs.push({
        symbol_a: symbols[i],
        symbol_b: symbols[j],
        correlation: Number(corr.toFixed(4)),
      });
    }
  }

  const avgAbs = count > 0 ? sumAbs / count : 0;
  return { avgAbs, maxAbs, pairs };
}

function weightedPortfolioReturns(
  positions: Array<{ symbol: string; side: string; marketValueAbs: number }>,
  returnsMap: Map<string, number[]>,
): number[] {
  const usable = positions.filter((p) => (returnsMap.get(p.symbol)?.length ?? 0) >= 12);
  if (usable.length === 0) return [];

  const total = usable.reduce((s, p) => s + p.marketValueAbs, 0);
  if (total <= 0) return [];

  const minLen = usable.reduce((m, p) => Math.min(m, returnsMap.get(p.symbol)!.length), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(minLen) || minLen < 12) return [];

  const series = new Array(minLen).fill(0) as number[];
  for (const position of usable) {
    const returns = returnsMap.get(position.symbol)!;
    const slice = returns.slice(-minLen);
    const weight = position.marketValueAbs / total;
    const sign = String(position.side).toLowerCase() === "short" ? -1 : 1;
    for (let i = 0; i < minLen; i++) {
      series[i] += sign * weight * slice[i];
    }
  }

  return series;
}

function classifyRiskState(breaches: string[]): PortfolioRiskState {
  if (breaches.includes("drawdown_limit") || breaches.includes("var_limit")) {
    return "HALT";
  }
  if (breaches.length >= 2) {
    return "CRITICAL";
  }
  if (breaches.length === 1) {
    return "ELEVATED";
  }
  return "NORMAL";
}

export async function evaluatePortfolioRisk(options?: {
  candidateSymbol?: string;
  forceRefresh?: boolean;
  autoHalt?: boolean;
}): Promise<PortfolioRiskSnapshot> {
  const candidateSymbol = String(options?.candidateSymbol ?? "").trim().toUpperCase() || null;

  if (!options?.forceRefresh && !candidateSymbol && _lastSnapshot && Date.now() - _lastSnapshotTs < CACHE_TTL_MS) {
    return _lastSnapshot;
  }

  const riskConfig = getRiskEngineSnapshot().config;
  const limits = {
    max_drawdown_pct: clamp01(toFinite(riskConfig.maxDrawdownPct, 0.15)),
    max_var_pct: clamp01(toFinite(riskConfig.maxPortfolioVarPct, 0.02)),
    max_avg_correlation: clamp01(toFinite(riskConfig.maxPortfolioCorrelation, 0.7)),
    max_pair_correlation: clamp01(toFinite(riskConfig.maxPairCorrelation, 0.9)),
  };

  const [rawPositions, equity] = await Promise.all([
    getTypedPositions().catch(() => [] as AlpacaPosition[]),
    getEquity(),
  ]);

  if (equity > _peakEquity) {
    _peakEquity = equity;
  } else if (_peakEquity <= 0) {
    _peakEquity = equity;
  }

  const positions = rawPositions
    .map((p) => {
      const qty = Math.abs(toFinite(p.qty, 0));
      const marketValueAbs = Math.abs(toFinite(p.market_value, 0));
      return {
        symbol: String(p.symbol ?? "").toUpperCase(),
        side: String(p.side ?? "long").toLowerCase(),
        qty,
        marketValueAbs,
      };
    })
    .filter((p) => p.symbol.length > 0 && p.qty > 0);

  const totalMarketValueAbs = positions.reduce((s, p) => s + p.marketValueAbs, 0);
  const positionView: PortfolioRiskPosition[] = positions.map((p) => ({
    symbol: p.symbol,
    side: p.side,
    qty: Number(p.qty.toFixed(6)),
    market_value: Number(p.marketValueAbs.toFixed(2)),
    weight: totalMarketValueAbs > 0 ? Number((p.marketValueAbs / totalMarketValueAbs).toFixed(4)) : 0,
  }));

  const allSymbols = [...new Set([
    ...positions.map((p) => p.symbol),
    ...(candidateSymbol ? [candidateSymbol] : []),
  ])];
  const returnsMap = await loadReturns(allSymbols);

  const openSymbols = positions.map((p) => p.symbol);
  const corrStats = correlationStats(openSymbols, returnsMap);

  let candidateMaxCorrelation = 0;
  if (candidateSymbol && !openSymbols.includes(candidateSymbol)) {
    const candidateReturns = returnsMap.get(candidateSymbol);
    if (candidateReturns) {
      for (const symbol of openSymbols) {
        const existing = returnsMap.get(symbol);
        if (!existing) continue;
        candidateMaxCorrelation = Math.max(candidateMaxCorrelation, Math.abs(pearson(candidateReturns, existing)));
      }
    }
  }

  const portfolioRet = weightedPortfolioReturns(positions, returnsMap);
  const portfolioSigma = stdDev(portfolioRet);
  const varPct = Math.max(0, zScore(VAR_CONFIDENCE) * portfolioSigma);
  const varUsd = varPct * Math.max(equity, 0);

  const drawdownPct = _peakEquity > 0 && equity > 0
    ? Math.max(0, (_peakEquity - equity) / _peakEquity)
    : 0;

  const breaches: string[] = [];
  if (drawdownPct >= limits.max_drawdown_pct) breaches.push("drawdown_limit");
  if (varPct >= limits.max_var_pct) breaches.push("var_limit");
  if (corrStats.avgAbs >= limits.max_avg_correlation && openSymbols.length >= 3) breaches.push("avg_correlation_limit");
  if (corrStats.maxAbs >= limits.max_pair_correlation && openSymbols.length >= 2) breaches.push("pair_correlation_limit");
  if (candidateMaxCorrelation >= limits.max_pair_correlation && candidateSymbol) breaches.push("candidate_correlation_limit");

  const riskState = classifyRiskState(breaches);
  const snapshot: PortfolioRiskSnapshot = {
    generated_at: new Date().toISOString(),
    account_equity: Number(equity.toFixed(2)),
    peak_equity: Number(_peakEquity.toFixed(2)),
    drawdown_pct: Number(drawdownPct.toFixed(6)),
    one_day_var_usd: Number(varUsd.toFixed(2)),
    one_day_var_pct: Number(varPct.toFixed(6)),
    var_confidence: VAR_CONFIDENCE,
    avg_pair_correlation: Number(corrStats.avgAbs.toFixed(6)),
    max_pair_correlation: Number(corrStats.maxAbs.toFixed(6)),
    correlated_pairs: corrStats.pairs,
    open_positions: positionView,
    limits,
    breaches,
    risk_state: riskState,
    candidate_symbol: candidateSymbol,
    candidate_max_correlation: Number(candidateMaxCorrelation.toFixed(6)),
  };

  _lastSnapshot = snapshot;
  _lastSnapshotTs = Date.now();

  if (options?.autoHalt && riskState === "HALT" && !isKillSwitchActive()) {
    setKillSwitchActive(true);
    logger.fatal({ breaches, snapshot }, "[risk-guard] HALT triggered — kill switch enabled");
  }

  return snapshot;
}

export async function evaluateExecutionRisk(candidateSymbol?: string): Promise<ExecutionRiskGate> {
  const snapshot = await evaluatePortfolioRisk({
    candidateSymbol,
    forceRefresh: true,
    autoHalt: true,
  });

  if (isKillSwitchActive()) {
    return {
      allowed: false,
      action: "HALT",
      reasons: ["kill_switch_active", ...snapshot.breaches],
      size_multiplier: 0,
      snapshot,
    };
  }

  if (snapshot.risk_state === "HALT") {
    return {
      allowed: false,
      action: "HALT",
      reasons: snapshot.breaches.length > 0 ? snapshot.breaches : ["portfolio_halt"],
      size_multiplier: 0,
      snapshot,
    };
  }

  if (snapshot.breaches.includes("candidate_correlation_limit")) {
    return {
      allowed: false,
      action: "BLOCK",
      reasons: ["candidate_correlation_limit"],
      size_multiplier: 0,
      snapshot,
    };
  }

  if (snapshot.risk_state === "CRITICAL") {
    return {
      allowed: false,
      action: "BLOCK",
      reasons: snapshot.breaches.length > 0 ? snapshot.breaches : ["portfolio_risk_critical"],
      size_multiplier: 0,
      snapshot,
    };
  }

  if (snapshot.risk_state === "ELEVATED") {
    return {
      allowed: true,
      action: "REDUCE",
      reasons: snapshot.breaches,
      size_multiplier: 0.5,
      snapshot,
    };
  }

  return {
    allowed: true,
    action: "ALLOW",
    reasons: [],
    size_multiplier: 1,
    snapshot,
  };
}

export async function triggerEmergencyStopAll(reason: string): Promise<EmergencyStopResult> {
  const why = String(reason || "manual_emergency_stop_all");
  setKillSwitchActive(true);

  let liquidation: LiquidationResult | null = null;
  try {
    liquidation = await emergencyLiquidateAll(why);
  } catch (err) {
    logger.error({ err }, "[risk-guard] emergency liquidation failed");
  }

  const risk = await evaluatePortfolioRisk({ forceRefresh: true });
  return {
    kill_switch: true,
    triggered_at: new Date().toISOString(),
    reason: why,
    liquidation,
    risk,
  };
}

export function getLatestPortfolioRiskSnapshot(): PortfolioRiskSnapshot | null {
  return _lastSnapshot;
}

export function resetPortfolioRiskPeak(peakEquity?: number): void {
  _peakEquity = Math.max(0, toFinite(peakEquity, 0));
  _lastSnapshot = null;
  _lastSnapshotTs = 0;
}
