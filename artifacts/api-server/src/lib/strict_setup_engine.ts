import type { AlpacaBar } from "./alpaca";
import type { OrderBookSnapshot } from "./market/types";
import { normalizeMarketSymbol } from "./market/symbols";

export type StrictGateReason =
  | "symbol_not_supported"
  | "insufficient_bars"
  | "setup_not_detected"
  | "bad_session"
  | "news_lockout"
  | "orderbook_unavailable"
  | "low_liquidity"
  | "spread_too_wide";

export interface StrictSetupGates {
  sessionValid: boolean;
  newsClear: boolean;
  orderbookAvailable: boolean;
  liquidityValid: boolean;
  spreadValid: boolean;
}

export interface StrictSweepReclaimDecision {
  setup: "sweep_reclaim_v1";
  symbol: string;
  supported: boolean;
  detected: boolean;
  tradeAllowed: boolean;
  direction: "long" | "short" | null;
  session: "asian" | "london" | "new_york" | "ny_overlap";
  timestamp: string | null;
  entryPrice: number | null;
  invalidationPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  blockedReasons: StrictGateReason[];
  gates: StrictSetupGates;
  diagnostics: {
    lookbackHigh: number | null;
    lookbackLow: number | null;
    sweepWickRatio: number | null;
    atr14: number | null;
    spreadBps: number | null;
    topBookNotionalUsd: number | null;
  };
}

export interface StrictSweepReclaimOptions {
  minLookbackBars?: number;
  minSweepWickRatio?: number;
  minTopBookNotionalUsd?: number;
  maxSpreadBps?: number;
  rrTarget?: number;
  requireOrderbook?: boolean;
  allowAsianSession?: boolean;
  newsLockoutActive?: boolean;
}

const SUPPORTED_SYMBOLS = new Set<string>(["BTCUSD", "ETHUSD"]);

function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function computeATR14(bars: AlpacaBar[]): number {
  if (bars.length < 2) return 0;
  const lookback = bars.slice(-15);
  const trs: number[] = [];
  for (let i = 1; i < lookback.length; i++) {
    const bar = lookback[i]!;
    const prevClose = lookback[i - 1]!.Close;
    const tr = Math.max(
      bar.High - bar.Low,
      Math.abs(bar.High - prevClose),
      Math.abs(bar.Low - prevClose),
    );
    trs.push(tr);
  }
  if (!trs.length) return 0;
  return trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
}

function detectSession(timestamp: string): StrictSweepReclaimDecision["session"] {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 13 && hour < 16) return "ny_overlap";
  if (hour >= 7 && hour < 13) return "london";
  if (hour >= 13 && hour < 22) return "new_york";
  return "asian";
}

function computeOrderbookLiquidity(snapshot: OrderBookSnapshot | null): {
  available: boolean;
  spreadBps: number | null;
  topBookNotionalUsd: number | null;
} {
  if (!snapshot || !snapshot.bids.length || !snapshot.asks.length) {
    return { available: false, spreadBps: null, topBookNotionalUsd: null };
  }

  const depth = 10;
  const bids = snapshot.bids.slice(0, depth);
  const asks = snapshot.asks.slice(0, depth);
  const bestBid = bids[0]!.price;
  const bestAsk = asks[0]!.price;
  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : 0;
  const topSize = bids.reduce((sum, level) => sum + level.size, 0) + asks.reduce((sum, level) => sum + level.size, 0);
  const topBookNotionalUsd = topSize * mid;

  return {
    available: true,
    spreadBps,
    topBookNotionalUsd,
  };
}

export function evaluateStrictSweepReclaim(
  symbol: string,
  bars1m: AlpacaBar[],
  orderbookSnapshot: OrderBookSnapshot | null,
  options: StrictSweepReclaimOptions = {},
): StrictSweepReclaimDecision {
  const normalizedSymbol = normalizeMarketSymbol(symbol);
  const minLookbackBars = Math.max(12, Math.floor(clampPositive(options.minLookbackBars ?? 20, 20)));
  const minSweepWickRatio = clampPositive(options.minSweepWickRatio ?? 0.35, 0.35);
  const minTopBookNotionalUsd = clampPositive(options.minTopBookNotionalUsd ?? 200_000, 200_000);
  const maxSpreadBps = clampPositive(options.maxSpreadBps ?? 15, 15);
  const rrTarget = clampPositive(options.rrTarget ?? 2, 2);
  const requireOrderbook = options.requireOrderbook ?? true;
  const allowAsianSession = options.allowAsianSession ?? false;
  const newsLockoutActive = options.newsLockoutActive ?? false;

  const defaultSession: StrictSweepReclaimDecision["session"] = "asian";
  const defaultGates: StrictSetupGates = {
    sessionValid: false,
    newsClear: !newsLockoutActive,
    orderbookAvailable: false,
    liquidityValid: false,
    spreadValid: false,
  };

  if (!SUPPORTED_SYMBOLS.has(normalizedSymbol)) {
    return {
      setup: "sweep_reclaim_v1",
      symbol: normalizedSymbol,
      supported: false,
      detected: false,
      tradeAllowed: false,
      direction: null,
      session: defaultSession,
      timestamp: null,
      entryPrice: null,
      invalidationPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      blockedReasons: ["symbol_not_supported"],
      gates: defaultGates,
      diagnostics: {
        lookbackHigh: null,
        lookbackLow: null,
        sweepWickRatio: null,
        atr14: null,
        spreadBps: null,
        topBookNotionalUsd: null,
      },
    };
  }

  if (bars1m.length < minLookbackBars + 2) {
    return {
      setup: "sweep_reclaim_v1",
      symbol: normalizedSymbol,
      supported: true,
      detected: false,
      tradeAllowed: false,
      direction: null,
      session: defaultSession,
      timestamp: null,
      entryPrice: null,
      invalidationPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      blockedReasons: ["insufficient_bars"],
      gates: defaultGates,
      diagnostics: {
        lookbackHigh: null,
        lookbackLow: null,
        sweepWickRatio: null,
        atr14: null,
        spreadBps: null,
        topBookNotionalUsd: null,
      },
    };
  }

  const sweepBar = bars1m[bars1m.length - 2]!;
  const reclaimBar = bars1m[bars1m.length - 1]!;
  const lookbackWindow = bars1m.slice(-(minLookbackBars + 2), -2);
  const lookbackHigh = Math.max(...lookbackWindow.map((bar) => bar.High));
  const lookbackLow = Math.min(...lookbackWindow.map((bar) => bar.Low));

  const sweepRange = Math.max(sweepBar.High - sweepBar.Low, 0.0000001);
  const lowerWick = Math.max(0, Math.min(sweepBar.Open, sweepBar.Close) - sweepBar.Low);
  const upperWick = Math.max(0, sweepBar.High - Math.max(sweepBar.Open, sweepBar.Close));
  const lowerWickRatio = lowerWick / sweepRange;
  const upperWickRatio = upperWick / sweepRange;

  const bullSweep = sweepBar.Low < lookbackLow &&
    lowerWickRatio >= minSweepWickRatio &&
    reclaimBar.Close > lookbackLow &&
    reclaimBar.Close > reclaimBar.Open;

  const bearSweep = sweepBar.High > lookbackHigh &&
    upperWickRatio >= minSweepWickRatio &&
    reclaimBar.Close < lookbackHigh &&
    reclaimBar.Close < reclaimBar.Open;

  let direction: "long" | "short" | null = null;
  let sweepWickRatio: number | null = null;
  if (bullSweep && !bearSweep) {
    direction = "long";
    sweepWickRatio = lowerWickRatio;
  } else if (bearSweep && !bullSweep) {
    direction = "short";
    sweepWickRatio = upperWickRatio;
  } else if (bullSweep && bearSweep) {
    direction = lowerWickRatio >= upperWickRatio ? "long" : "short";
    sweepWickRatio = direction === "long" ? lowerWickRatio : upperWickRatio;
  }

  const detected = direction !== null;
  const session = detectSession(reclaimBar.Timestamp);
  const sessionValid = allowAsianSession ? true : session !== "asian";
  const newsClear = !newsLockoutActive;

  const liq = computeOrderbookLiquidity(orderbookSnapshot);
  const orderbookAvailable = liq.available;
  const liquidityValid = liq.topBookNotionalUsd !== null && liq.topBookNotionalUsd >= minTopBookNotionalUsd;
  const spreadValid = liq.spreadBps !== null && liq.spreadBps <= maxSpreadBps;

  let entryPrice: number | null = null;
  let invalidationPrice: number | null = null;
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;
  let riskReward: number | null = null;
  const atr14 = computeATR14(bars1m);

  if (detected) {
    entryPrice = reclaimBar.Close;
    const atrBuffer = Math.max(atr14 * 0.12, entryPrice * 0.0005);
    if (direction === "long") {
      invalidationPrice = sweepBar.Low - atrBuffer;
      stopLoss = invalidationPrice;
      const risk = Math.max(entryPrice - invalidationPrice, entryPrice * 0.0005);
      takeProfit = entryPrice + risk * rrTarget;
      riskReward = risk > 0 ? (takeProfit - entryPrice) / risk : null;
    } else {
      invalidationPrice = sweepBar.High + atrBuffer;
      stopLoss = invalidationPrice;
      const risk = Math.max(invalidationPrice - entryPrice, entryPrice * 0.0005);
      takeProfit = entryPrice - risk * rrTarget;
      riskReward = risk > 0 ? (entryPrice - takeProfit) / risk : null;
    }
  }

  const blockedReasons: StrictGateReason[] = [];
  if (!detected) blockedReasons.push("setup_not_detected");
  if (!sessionValid) blockedReasons.push("bad_session");
  if (!newsClear) blockedReasons.push("news_lockout");
  if (!orderbookAvailable && requireOrderbook) blockedReasons.push("orderbook_unavailable");
  if (orderbookAvailable && !liquidityValid) blockedReasons.push("low_liquidity");
  if (orderbookAvailable && !spreadValid) blockedReasons.push("spread_too_wide");

  const gates: StrictSetupGates = {
    sessionValid,
    newsClear,
    orderbookAvailable,
    liquidityValid,
    spreadValid,
  };

  return {
    setup: "sweep_reclaim_v1",
    symbol: normalizedSymbol,
    supported: true,
    detected,
    tradeAllowed: blockedReasons.length === 0,
    direction,
    session,
    timestamp: reclaimBar.Timestamp,
    entryPrice,
    invalidationPrice,
    stopLoss,
    takeProfit,
    riskReward,
    blockedReasons,
    gates,
    diagnostics: {
      lookbackHigh,
      lookbackLow,
      sweepWickRatio,
      atr14: Number.isFinite(atr14) ? atr14 : null,
      spreadBps: liq.spreadBps,
      topBookNotionalUsd: liq.topBookNotionalUsd,
    },
  };
}
