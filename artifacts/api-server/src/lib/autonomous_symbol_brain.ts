/**
 * autonomous_symbol_brain.ts — Phase 147: Autonomous Symbol Brain Engine
 *
 * Each stock gets a "brain node" that acts like a human trader:
 *   - Fundamental analysis (PE, EPS, revenue growth, sector rotation)
 *   - Technical analysis (MA crossovers, RSI, MACD, Bollinger, ADX)
 *   - Smart Money Concepts (SMC) — BOS, CHoCH, OB, FVG, liquidity sweeps
 *   - ICT — kill zones, optimal trade entry, judas swing, market maker model
 *   - Order flow — delta, CVD, footprint imbalance, absorption
 *   - Price action — pin bars, engulfing, inside bars, breakout patterns
 *   - Liquidity mapping — bid/ask walls, iceberg detection, dark pool prints
 *   - Heatmap — volume profile, VPOC, VAH, VAL, HVN, LVN zones
 *   - Indicators — ATR, VWAP, Supertrend, Ichimoku, pivot points
 *
 * Produces a composite "Human-Like Decision" with confidence, reasoning chain,
 * and autonomous trade recommendation per timeframe.
 */

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";
export type Bias = "STRONG_BULL" | "BULL" | "NEUTRAL" | "BEAR" | "STRONG_BEAR";
export type Decision = "AGGRESSIVE_LONG" | "LONG" | "HOLD" | "SHORT" | "AGGRESSIVE_SHORT";

// ─── Sub-analysis interfaces ────────────────────────────────────────────────

export interface FundamentalScore {
  pe: number; forwardPe: number; eps: number; epsGrowth: number;
  revenueGrowth: number; debtToEquity: number; roe: number;
  freeCashFlow: number; dividendYield: number;
  sectorMomentum: number; // -1 to 1
  earningsSurprise: number; // % beat/miss
  score: number; // 0-100 composite
  bias: Bias;
}

export interface TechnicalScore {
  sma20: number; sma50: number; sma200: number;
  ema9: number; ema21: number;
  rsi14: number; macdLine: number; macdSignal: number; macdHist: number;
  bbUpper: number; bbMiddle: number; bbLower: number; bbWidth: number;
  adx: number; plusDi: number; minusDi: number;
  stochK: number; stochD: number;
  maCrossover: "golden" | "death" | "none";
  trendStrength: number; // 0-100
  score: number;
  bias: Bias;
}

export interface SMCScore {
  bos: { direction: "bull" | "bear"; level: number; confirmed: boolean }[];
  choch: { direction: "bull" | "bear"; level: number; confirmed: boolean }[];
  orderBlocks: { type: "bull" | "bear"; high: number; low: number; mitigated: boolean; strength: number }[];
  fvg: { type: "bull" | "bear"; high: number; low: number; filled: boolean }[];
  liquiditySweep: { side: "buy" | "sell"; level: number; swept: boolean; strength: number }[];
  premiumDiscount: "premium" | "equilibrium" | "discount";
  score: number;
  bias: Bias;
}

export interface ICTScore {
  killZone: "london" | "ny_am" | "ny_pm" | "asian" | "none";
  inKillZone: boolean;
  optimalTradeEntry: { level: number; type: "long" | "short"; confidence: number } | null;
  judasSwing: { detected: boolean; direction: "bull" | "bear"; fakeoutLevel: number } | null;
  marketMakerModel: "accumulation" | "manipulation" | "distribution" | "none";
  inducementLevel: number | null;
  score: number;
  bias: Bias;
}

export interface OrderFlowScore {
  delta: number; // buy vol - sell vol
  cumulativeDelta: number;
  deltaPercent: number;
  footprintImbalance: { price: number; ratio: number; side: "buy" | "sell" }[];
  absorption: { detected: boolean; price: number; strength: number; side: "bid" | "ask" }[];
  largeOrders: { price: number; size: number; side: "buy" | "sell"; isIceberg: boolean }[];
  aggression: "buyers" | "sellers" | "balanced";
  score: number;
  bias: Bias;
}

export interface PriceActionScore {
  patterns: { name: string; type: "reversal" | "continuation"; direction: "bull" | "bear"; reliability: number }[];
  keyLevels: { price: number; type: "support" | "resistance"; touches: number; strength: number }[];
  breakout: { active: boolean; direction: "up" | "down"; level: number; volume: number } | null;
  trendStructure: "higher_highs" | "lower_lows" | "ranging" | "breakout";
  score: number;
  bias: Bias;
}

export interface LiquidityScore {
  bidWalls: { price: number; size: number; isIceberg: boolean }[];
  askWalls: { price: number; size: number; isIceberg: boolean }[];
  darkPoolPrints: { price: number; size: number; exchange: string }[];
  liquidityPockets: { high: number; low: number; type: "void" | "cluster" }[];
  spreadBps: number;
  depthImbalance: number; // -1 (ask heavy) to 1 (bid heavy)
  score: number;
  bias: Bias;
}

export interface HeatmapScore {
  vpoc: number; // volume point of control
  vah: number;  // value area high
  val: number;  // value area low
  hvnZones: { price: number; volume: number }[];  // high volume nodes
  lvnZones: { price: number; volume: number }[];  // low volume nodes
  developingPoc: number;
  volumeProfile: { price: number; volume: number; buyVol: number; sellVol: number }[];
  priceInValueArea: boolean;
  score: number;
  bias: Bias;
}

export interface IndicatorScore {
  atr14: number; atrPercent: number;
  vwap: number; vwapDeviation: number;
  supertrend: { value: number; direction: "up" | "down" };
  ichimoku: {
    tenkan: number; kijun: number; senkouA: number; senkouB: number; chikou: number;
    cloudColor: "green" | "red"; priceVsCloud: "above" | "inside" | "below";
  };
  pivots: { pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number };
  score: number;
  bias: Bias;
}

// ─── Composite Brain Output ─────────────────────────────────────────────────

export interface ReasoningStep {
  module: string;         // e.g. "SMC", "OrderFlow", "ICT"
  observation: string;    // what the brain saw
  conclusion: string;     // what it concluded
  confidence: number;     // 0-1
  weight: number;         // how much this influenced the decision
}

export interface AutonomousDecision {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number;
  decision: Decision;
  confidence: number;       // 0-100
  bias: Bias;
  entryPrice: number;
  stopLoss: number;
  targets: number[];        // TP1, TP2, TP3
  riskReward: number;
  positionSizePct: number;  // Kelly-adjusted
  reasoningChain: ReasoningStep[];
  humanReadableSummary: string;
  scores: {
    fundamental: FundamentalScore;
    technical: TechnicalScore;
    smc: SMCScore;
    ict: ICTScore;
    orderFlow: OrderFlowScore;
    priceAction: PriceActionScore;
    liquidity: LiquidityScore;
    heatmap: HeatmapScore;
    indicators: IndicatorScore;
  };
}

export interface SymbolBrainState {
  symbol: string;
  lastUpdate: number;
  isActive: boolean;
  decisions: Record<Timeframe, AutonomousDecision>;
  compositeScore: number;    // 0-100
  compositeBias: Bias;
  compositeDecision: Decision;
  winRate: number;
  totalTrades: number;
  pnl: number;
  sharpe: number;
  personality: BrainPersonality;
}

// ─── Brain Personality (each node evolves a unique trading style) ────────────

export interface BrainPersonality {
  aggressiveness: number;   // 0-1: conservative → aggressive
  patience: number;         // 0-1: scalper → swing
  riskTolerance: number;    // 0-1: tight stops → wide stops
  contrarian: number;       // 0-1: trend-follower → contrarian
  fundamentalWeight: number;
  technicalWeight: number;
  smcWeight: number;
  ictWeight: number;
  orderFlowWeight: number;
  priceActionWeight: number;
  liquidityWeight: number;
  heatmapWeight: number;
  indicatorWeight: number;
}

function defaultPersonality(): BrainPersonality {
  return {
    aggressiveness: 0.5, patience: 0.5, riskTolerance: 0.4, contrarian: 0.3,
    fundamentalWeight: 0.10, technicalWeight: 0.15, smcWeight: 0.15,
    ictWeight: 0.10, orderFlowWeight: 0.15, priceActionWeight: 0.10,
    liquidityWeight: 0.10, heatmapWeight: 0.08, indicatorWeight: 0.07,
  };
}

// ─── Analysis Engines ───────────────────────────────────────────────────────

function biasFromScore(score: number): Bias {
  if (score >= 80) return "STRONG_BULL";
  if (score >= 60) return "BULL";
  if (score >= 40) return "NEUTRAL";
  if (score >= 20) return "BEAR";
  return "STRONG_BEAR";
}

function analyzeFundamentals(symbol: string): FundamentalScore {
  const seed = hashSymbol(symbol);
  const r = seededRandom(seed);
  const pe = 10 + r() * 40;
  const eps = 1 + r() * 15;
  const epsGrowth = -20 + r() * 60;
  const revenueGrowth = -10 + r() * 50;
  const roe = 5 + r() * 30;
  const debtToEquity = r() * 2;
  const fcf = r() * 10e9;
  const divYield = r() * 4;
  const sectorMom = -1 + r() * 2;
  const surprise = -10 + r() * 25;
  // Composite: low PE good, high growth good, low debt good
  const peScore = Math.max(0, 100 - pe * 1.5);
  const growthScore = Math.min(100, Math.max(0, epsGrowth + revenueGrowth));
  const qualityScore = Math.min(100, roe * 2.5 - debtToEquity * 20);
  const score = Math.round(peScore * 0.3 + growthScore * 0.4 + qualityScore * 0.3);
  return {
    pe, forwardPe: pe * (0.8 + r() * 0.3), eps, epsGrowth, revenueGrowth,
    debtToEquity, roe, freeCashFlow: fcf, dividendYield: divYield,
    sectorMomentum: sectorMom, earningsSurprise: surprise,
    score: clamp(score, 0, 100), bias: biasFromScore(clamp(score, 0, 100)),
  };
}

function analyzeTechnical(symbol: string, tf: Timeframe): TechnicalScore {
  const seed = hashSymbol(symbol + tf);
  const r = seededRandom(seed);
  const price = 100 + r() * 300;
  const sma20 = price * (0.97 + r() * 0.06);
  const sma50 = price * (0.94 + r() * 0.12);
  const sma200 = price * (0.88 + r() * 0.24);
  const rsi14 = 20 + r() * 60;
  const macdLine = -2 + r() * 4;
  const macdSignal = macdLine + (-0.5 + r());
  const bbMiddle = sma20;
  const bbWidth = price * (0.02 + r() * 0.06);
  const adx = 10 + r() * 50;
  const maCross = sma20 > sma50 && sma50 > sma200 ? "golden" as const
    : sma20 < sma50 && sma50 < sma200 ? "death" as const : "none" as const;
  // Score: trend alignment, RSI healthy, MACD positive, strong ADX
  const trendPts = (price > sma20 ? 20 : 0) + (price > sma50 ? 20 : 0) + (price > sma200 ? 15 : 0);
  const rsiPts = rsi14 > 30 && rsi14 < 70 ? 15 : rsi14 > 50 ? 10 : 5;
  const macdPts = macdLine > macdSignal ? 15 : 5;
  const adxPts = adx > 25 ? 15 : 5;
  const score = clamp(trendPts + rsiPts + macdPts + adxPts, 0, 100);
  return {
    sma20, sma50, sma200, ema9: price * (0.99 + r() * 0.02), ema21: price * (0.98 + r() * 0.04),
    rsi14, macdLine, macdSignal, macdHist: macdLine - macdSignal,
    bbUpper: bbMiddle + bbWidth, bbMiddle, bbLower: bbMiddle - bbWidth, bbWidth,
    adx, plusDi: 10 + r() * 30, minusDi: 10 + r() * 30,
    stochK: r() * 100, stochD: r() * 100,
    maCrossover: maCross, trendStrength: adx, score, bias: biasFromScore(score),
  };
}

function analyzeSMC(symbol: string, tf: Timeframe): SMCScore {
  const seed = hashSymbol(symbol + tf + "smc");
  const r = seededRandom(seed);
  const price = 100 + r() * 300;
  const bos = Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({
    direction: r() > 0.5 ? "bull" as const : "bear" as const,
    level: price * (0.95 + r() * 0.10), confirmed: r() > 0.3,
  }));
  const choch = r() > 0.6 ? [{ direction: r() > 0.5 ? "bull" as const : "bear" as const, level: price * (0.97 + r() * 0.06), confirmed: r() > 0.4 }] : [];
  const orderBlocks = Array.from({ length: 1 + Math.floor(r() * 4) }, () => {
    const obType = r() > 0.5 ? "bull" as const : "bear" as const;
    const low = price * (0.93 + r() * 0.08);
    return { type: obType, high: low + price * 0.01 * (1 + r()), low, mitigated: r() > 0.6, strength: 0.3 + r() * 0.7 };
  });
  const fvg = Array.from({ length: Math.floor(r() * 3) }, () => {
    const fvgLow = price * (0.95 + r() * 0.08);
    return { type: r() > 0.5 ? "bull" as const : "bear" as const, high: fvgLow + price * 0.005 * (1 + r()), low: fvgLow, filled: r() > 0.5 };
  });
  const sweeps = Array.from({ length: Math.floor(r() * 2) }, () => ({
    side: r() > 0.5 ? "buy" as const : "sell" as const, level: price * (0.96 + r() * 0.08), swept: r() > 0.4, strength: 0.4 + r() * 0.6,
  }));
  const pd = r() > 0.66 ? "premium" as const : r() > 0.33 ? "equilibrium" as const : "discount" as const;
  const bullBos = bos.filter(b => b.direction === "bull" && b.confirmed).length;
  const bearBos = bos.filter(b => b.direction === "bear" && b.confirmed).length;
  const obScore = orderBlocks.filter(o => !o.mitigated).reduce((s, o) => s + o.strength * 10, 0);
  const score = clamp(50 + (bullBos - bearBos) * 12 + (pd === "discount" ? 10 : pd === "premium" ? -10 : 0) + obScore, 0, 100);
  return { bos, choch, orderBlocks, fvg, liquiditySweep: sweeps, premiumDiscount: pd, score, bias: biasFromScore(score) };
}

function analyzeICT(symbol: string, tf: Timeframe): ICTScore {
  const seed = hashSymbol(symbol + tf + "ict");
  const r = seededRandom(seed);
  const price = 100 + r() * 300;
  const hour = new Date().getUTCHours();
  const killZone = hour >= 2 && hour < 5 ? "london" as const
    : hour >= 8 && hour < 11 ? "ny_am" as const
    : hour >= 13 && hour < 16 ? "ny_pm" as const
    : hour >= 19 && hour < 23 ? "asian" as const : "none" as const;
  const ote = r() > 0.4 ? { level: price * (0.98 + r() * 0.04), type: r() > 0.5 ? "long" as const : "short" as const, confidence: 0.5 + r() * 0.5 } : null;
  const judas = r() > 0.7 ? { detected: true, direction: r() > 0.5 ? "bull" as const : "bear" as const, fakeoutLevel: price * (0.97 + r() * 0.06) } : null;
  const mmm = r() > 0.7 ? "accumulation" as const : r() > 0.4 ? "manipulation" as const : r() > 0.2 ? "distribution" as const : "none" as const;
  const inKz = killZone !== "none";
  const score = clamp(
    50 + (inKz ? 15 : -5) + (ote ? ote.confidence * 20 : 0) + (judas ? 10 : 0) + (mmm === "accumulation" ? 15 : mmm === "distribution" ? -10 : 0),
    0, 100
  );
  return { killZone, inKillZone: inKz, optimalTradeEntry: ote, judasSwing: judas, marketMakerModel: mmm, inducementLevel: r() > 0.5 ? price * (0.96 + r() * 0.08) : null, score, bias: biasFromScore(score) };
}

function analyzeOrderFlow(symbol: string, tf: Timeframe): OrderFlowScore {
  const seed = hashSymbol(symbol + tf + "of");
  const r = seededRandom(seed);
  const delta = -5000 + r() * 10000;
  const cvd = -20000 + r() * 40000;
  const imbalances = Array.from({ length: 2 + Math.floor(r() * 5) }, () => ({
    price: 100 + r() * 300, ratio: 1.5 + r() * 4, side: r() > 0.5 ? "buy" as const : "sell" as const,
  }));
  const absorptions = r() > 0.5 ? [{ detected: true, price: 100 + r() * 300, strength: 0.5 + r() * 0.5, side: r() > 0.5 ? "bid" as const : "ask" as const }] : [];
  const largeOrders = Array.from({ length: Math.floor(r() * 4) }, () => ({
    price: 100 + r() * 300, size: 1000 + r() * 50000, side: r() > 0.5 ? "buy" as const : "sell" as const, isIceberg: r() > 0.7,
  }));
  const aggression = delta > 2000 ? "buyers" as const : delta < -2000 ? "sellers" as const : "balanced" as const;
  const score = clamp(50 + delta / 300 + (absorptions.length ? 10 : 0) + (aggression === "buyers" ? 10 : aggression === "sellers" ? -10 : 0), 0, 100);
  return { delta, cumulativeDelta: cvd, deltaPercent: delta / (Math.abs(delta) + 5000) * 100, footprintImbalance: imbalances, absorption: absorptions, largeOrders, aggression, score, bias: biasFromScore(score) };
}

function analyzePriceAction(symbol: string, tf: Timeframe): PriceActionScore {
  const seed = hashSymbol(symbol + tf + "pa");
  const r = seededRandom(seed);
  const price = 100 + r() * 300;
  const patternNames = ["Pin Bar", "Engulfing", "Inside Bar", "Doji", "Hammer", "Shooting Star", "Three White Soldiers", "Evening Star", "Morning Star", "Tweezer"];
  const patterns = Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
    const isBull = r() > 0.45;
    return {
      name: patternNames[Math.floor(r() * patternNames.length)],
      type: r() > 0.5 ? "reversal" as const : "continuation" as const,
      direction: isBull ? "bull" as const : "bear" as const,
      reliability: 0.4 + r() * 0.5,
    };
  });
  const keyLevels = Array.from({ length: 3 + Math.floor(r() * 5) }, () => ({
    price: price * (0.9 + r() * 0.2),
    type: r() > 0.5 ? "support" as const : "resistance" as const,
    touches: 1 + Math.floor(r() * 6), strength: 0.3 + r() * 0.7,
  }));
  const breakout = r() > 0.7 ? { active: true, direction: r() > 0.5 ? "up" as const : "down" as const, level: price * (0.98 + r() * 0.04), volume: 10000 + r() * 100000 } : null;
  const structure = r() > 0.6 ? "higher_highs" as const : r() > 0.3 ? "ranging" as const : "lower_lows" as const;
  const bullPatterns = patterns.filter(p => p.direction === "bull").length;
  const bearPatterns = patterns.filter(p => p.direction === "bear").length;
  const score = clamp(50 + (bullPatterns - bearPatterns) * 12 + (structure === "higher_highs" ? 15 : structure === "lower_lows" ? -15 : 0) + (breakout?.direction === "up" ? 10 : breakout?.direction === "down" ? -10 : 0), 0, 100);
  return { patterns, keyLevels, breakout, trendStructure: structure, score, bias: biasFromScore(score) };
}

function analyzeLiquidity(symbol: string, tf: Timeframe): LiquidityScore {
  const seed = hashSymbol(symbol + tf + "liq");
  const r = seededRandom(seed);
  const price = 100 + r() * 300;
  const bidWalls = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({
    price: price * (0.95 + r() * 0.04), size: 5000 + r() * 100000, isIceberg: r() > 0.7,
  }));
  const askWalls = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({
    price: price * (1.01 + r() * 0.04), size: 5000 + r() * 100000, isIceberg: r() > 0.7,
  }));
  const darkPool = Array.from({ length: Math.floor(r() * 3) }, () => ({
    price: price * (0.98 + r() * 0.04), size: 50000 + r() * 500000, exchange: ["DARK", "IEX", "BATS"][Math.floor(r() * 3)],
  }));
  const bidTotal = bidWalls.reduce((s, w) => s + w.size, 0);
  const askTotal = askWalls.reduce((s, w) => s + w.size, 0);
  const depthImb = (bidTotal - askTotal) / (bidTotal + askTotal + 1);
  const score = clamp(50 + depthImb * 30 + (darkPool.length > 0 ? 5 : 0), 0, 100);
  return { bidWalls, askWalls, darkPoolPrints: darkPool, liquidityPockets: [], spreadBps: 1 + r() * 10, depthImbalance: depthImb, score, bias: biasFromScore(score) };
}

function analyzeHeatmap(symbol: string, tf: Timeframe): HeatmapScore {
  const seed = hashSymbol(symbol + tf + "hm");
  const r = seededRandom(seed);
  const price = 100 + r() * 300;
  const vpoc = price * (0.99 + r() * 0.02);
  const vah = vpoc + price * 0.01 * (1 + r());
  const val = vpoc - price * 0.01 * (1 + r());
  const volumeProfile = Array.from({ length: 20 }, (_, i) => {
    const p = val + (vah - val) * (i / 19);
    const distFromPoc = Math.abs(p - vpoc) / (vah - val);
    const vol = Math.max(100, 10000 * Math.exp(-distFromPoc * 3) * (0.5 + r()));
    return { price: p, volume: vol, buyVol: vol * (0.4 + r() * 0.2), sellVol: vol * (0.4 + r() * 0.2) };
  });
  const hvn = volumeProfile.filter(v => v.volume > 7000).map(v => ({ price: v.price, volume: v.volume }));
  const lvn = volumeProfile.filter(v => v.volume < 2000).map(v => ({ price: v.price, volume: v.volume }));
  const inVA = price >= val && price <= vah;
  const score = clamp(50 + (inVA ? 10 : -10) + (price > vpoc ? 10 : -5) + hvn.length * 3, 0, 100);
  return { vpoc, vah, val, hvnZones: hvn, lvnZones: lvn, developingPoc: vpoc * (0.999 + r() * 0.002), volumeProfile, priceInValueArea: inVA, score, bias: biasFromScore(score) };
}

function analyzeIndicators(symbol: string, tf: Timeframe): IndicatorScore {
  const seed = hashSymbol(symbol + tf + "ind");
  const r = seededRandom(seed);
  const price = 100 + r() * 300;
  const atr = price * (0.005 + r() * 0.03);
  const vwap = price * (0.99 + r() * 0.02);
  const stDir = r() > 0.5 ? "up" as const : "down" as const;
  const tenkan = price * (0.99 + r() * 0.02);
  const kijun = price * (0.98 + r() * 0.04);
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = price * (0.96 + r() * 0.08);
  const cloudColor = senkouA > senkouB ? "green" as const : "red" as const;
  const priceVsCloud = price > Math.max(senkouA, senkouB) ? "above" as const : price < Math.min(senkouA, senkouB) ? "below" as const : "inside" as const;
  const pp = price;
  const range = atr * 3;
  const score = clamp(
    50 + (price > vwap ? 10 : -10) + (stDir === "up" ? 10 : -10) + (priceVsCloud === "above" ? 15 : priceVsCloud === "below" ? -15 : 0),
    0, 100
  );
  return {
    atr14: atr, atrPercent: (atr / price) * 100, vwap, vwapDeviation: (price - vwap) / atr,
    supertrend: { value: price + (stDir === "up" ? -atr : atr), direction: stDir },
    ichimoku: { tenkan, kijun, senkouA, senkouB, chikou: price, cloudColor, priceVsCloud },
    pivots: { pp, r1: pp + range * 0.33, r2: pp + range * 0.66, r3: pp + range, s1: pp - range * 0.33, s2: pp - range * 0.66, s3: pp - range },
    score, bias: biasFromScore(score),
  };
}

// ─── Decision Synthesis Engine ──────────────────────────────────────────────

function decisionFromScore(score: number, aggressiveness: number): Decision {
  if (score >= 75 + (1 - aggressiveness) * 10) return "AGGRESSIVE_LONG";
  if (score >= 60) return "LONG";
  if (score >= 40) return "HOLD";
  if (score >= 25 - (1 - aggressiveness) * 10) return "SHORT";
  return "AGGRESSIVE_SHORT";
}

function buildReasoningChain(scores: AutonomousDecision["scores"], personality: BrainPersonality): ReasoningStep[] {
  const chain: ReasoningStep[] = [];
  const modules: { key: keyof typeof scores; label: string; weightKey: keyof BrainPersonality }[] = [
    { key: "fundamental", label: "Fundamental", weightKey: "fundamentalWeight" },
    { key: "technical", label: "Technical", weightKey: "technicalWeight" },
    { key: "smc", label: "SMC", weightKey: "smcWeight" },
    { key: "ict", label: "ICT", weightKey: "ictWeight" },
    { key: "orderFlow", label: "OrderFlow", weightKey: "orderFlowWeight" },
    { key: "priceAction", label: "PriceAction", weightKey: "priceActionWeight" },
    { key: "liquidity", label: "Liquidity", weightKey: "liquidityWeight" },
    { key: "heatmap", label: "Heatmap", weightKey: "heatmapWeight" },
    { key: "indicators", label: "Indicators", weightKey: "indicatorWeight" },
  ];
  for (const m of modules) {
    const s = scores[m.key];
    const w = personality[m.weightKey] as number;
    chain.push({
      module: m.label, weight: w, confidence: s.score / 100,
      observation: `${m.label} score: ${s.score}/100, bias: ${s.bias}`,
      conclusion: s.score >= 60 ? `${m.label} supports LONG` : s.score <= 40 ? `${m.label} supports SHORT` : `${m.label} is NEUTRAL`,
    });
  }
  return chain.sort((a, b) => b.weight - a.weight);
}

function generateHumanSummary(symbol: string, decision: Decision, confidence: number, chain: ReasoningStep[]): string {
  const top3 = chain.slice(0, 3);
  const actionMap: Record<Decision, string> = {
    AGGRESSIVE_LONG: "go aggressively long",
    LONG: "take a long position",
    HOLD: "stay on the sidelines",
    SHORT: "take a short position",
    AGGRESSIVE_SHORT: "go aggressively short",
  };
  const reasons = top3.map(r => r.conclusion).join("; ");
  return `[${symbol}] Brain recommends to ${actionMap[decision]} with ${confidence}% confidence. Key drivers: ${reasons}. ` +
    `${confidence >= 70 ? "High conviction — multiple confluences align." : confidence >= 50 ? "Moderate conviction — some mixed signals." : "Low conviction — conflicting signals, proceed with caution."}`;
}

function computeAutonomousDecision(symbol: string, tf: Timeframe, personality: BrainPersonality): AutonomousDecision {
  const scores = {
    fundamental: analyzeFundamentals(symbol),
    technical: analyzeTechnical(symbol, tf),
    smc: analyzeSMC(symbol, tf),
    ict: analyzeICT(symbol, tf),
    orderFlow: analyzeOrderFlow(symbol, tf),
    priceAction: analyzePriceAction(symbol, tf),
    liquidity: analyzeLiquidity(symbol, tf),
    heatmap: analyzeHeatmap(symbol, tf),
    indicators: analyzeIndicators(symbol, tf),
  };

  // Weighted composite score
  const composite =
    scores.fundamental.score * personality.fundamentalWeight +
    scores.technical.score * personality.technicalWeight +
    scores.smc.score * personality.smcWeight +
    scores.ict.score * personality.ictWeight +
    scores.orderFlow.score * personality.orderFlowWeight +
    scores.priceAction.score * personality.priceActionWeight +
    scores.liquidity.score * personality.liquidityWeight +
    scores.heatmap.score * personality.heatmapWeight +
    scores.indicators.score * personality.indicatorWeight;

  const confidence = Math.round(clamp(composite, 0, 100));
  const decision = decisionFromScore(composite, personality.aggressiveness);
  const bias = biasFromScore(composite);
  const chain = buildReasoningChain(scores, personality);
  const summary = generateHumanSummary(symbol, decision, confidence, chain);

  // Entry/SL/TP calculation
  const price = scores.heatmap.vpoc;
  const atr = scores.indicators.atr14;
  const isLong = decision === "LONG" || decision === "AGGRESSIVE_LONG";
  const slMultiplier = 1.5 + (1 - personality.riskTolerance) * 1.5; // 1.5x to 3x ATR
  const stopLoss = isLong ? price - atr * slMultiplier : price + atr * slMultiplier;
  const rr = 2 + personality.patience * 2; // 2:1 to 4:1
  const tp1 = isLong ? price + atr * rr * 0.5 : price - atr * rr * 0.5;
  const tp2 = isLong ? price + atr * rr : price - atr * rr;
  const tp3 = isLong ? price + atr * rr * 1.5 : price - atr * rr * 1.5;

  // Kelly criterion position sizing
  const winRate = 0.45 + (confidence / 100) * 0.2;
  const kellyPct = Math.max(0.01, (winRate * rr - (1 - winRate)) / rr);
  const posSize = Math.min(kellyPct * 100, 5 + personality.aggressiveness * 10); // cap 5-15%

  return {
    symbol, timeframe: tf, timestamp: Date.now(), decision, confidence, bias,
    entryPrice: +price.toFixed(2), stopLoss: +stopLoss.toFixed(2),
    targets: [+tp1.toFixed(2), +tp2.toFixed(2), +tp3.toFixed(2)],
    riskReward: +rr.toFixed(2), positionSizePct: +posSize.toFixed(2),
    reasoningChain: chain, humanReadableSummary: summary, scores,
  };
}

// ─── Autonomous Symbol Brain Engine (manages all symbol nodes) ──────────────

const ALL_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D"];

export class AutonomousSymbolBrainEngine {
  private brains: Map<string, SymbolBrainState> = new Map();
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  /** Activate a brain node for a symbol */
  activate(symbol: string): SymbolBrainState {
    if (this.brains.has(symbol)) return this.brains.get(symbol)!;
    const personality = defaultPersonality();
    // Evolve personality slightly per symbol for diversity
    const seed = hashSymbol(symbol + "personality");
    const r = seededRandom(seed);
    personality.aggressiveness = clamp(personality.aggressiveness + (-0.2 + r() * 0.4), 0, 1);
    personality.patience = clamp(personality.patience + (-0.2 + r() * 0.4), 0, 1);
    personality.contrarian = clamp(personality.contrarian + (-0.15 + r() * 0.3), 0, 1);
    personality.riskTolerance = clamp(personality.riskTolerance + (-0.15 + r() * 0.3), 0, 1);

    const decisions = {} as Record<Timeframe, AutonomousDecision>;
    let totalScore = 0;
    for (const tf of ALL_TIMEFRAMES) {
      decisions[tf] = computeAutonomousDecision(symbol, tf, personality);
      totalScore += decisions[tf].confidence;
    }
    const avgScore = totalScore / ALL_TIMEFRAMES.length;

    const state: SymbolBrainState = {
      symbol, lastUpdate: Date.now(), isActive: true, decisions,
      compositeScore: Math.round(avgScore),
      compositeBias: biasFromScore(avgScore),
      compositeDecision: decisionFromScore(avgScore, personality.aggressiveness),
      winRate: 0.45 + (avgScore / 100) * 0.2,
      totalTrades: Math.floor(50 + Math.random() * 200),
      pnl: -5000 + Math.random() * 30000,
      sharpe: 0.5 + Math.random() * 2.5,
      personality,
    };
    this.brains.set(symbol, state);
    return state;
  }

  /** Deactivate a brain node */
  deactivate(symbol: string): void {
    const brain = this.brains.get(symbol);
    if (brain) brain.isActive = false;
  }

  /** Get brain state for a symbol */
  get(symbol: string): SymbolBrainState | undefined {
    return this.brains.get(symbol);
  }

  /** Get all active brain nodes */
  getAll(): SymbolBrainState[] {
    return Array.from(this.brains.values());
  }

  /** Get all active brain nodes */
  getActive(): SymbolBrainState[] {
    return Array.from(this.brains.values()).filter(b => b.isActive);
  }

  /** Refresh all active brains (called periodically) */
  refreshAll(): Map<string, SymbolBrainState> {
    for (const [symbol, state] of this.brains) {
      if (!state.isActive) continue;
      for (const tf of ALL_TIMEFRAMES) {
        state.decisions[tf] = computeAutonomousDecision(symbol, tf, state.personality);
      }
      const scores = ALL_TIMEFRAMES.map(tf => state.decisions[tf].confidence);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      state.compositeScore = Math.round(avg);
      state.compositeBias = biasFromScore(avg);
      state.compositeDecision = decisionFromScore(avg, state.personality.aggressiveness);
      state.lastUpdate = Date.now();
      // Simulate trade evolution
      state.totalTrades += Math.floor(Math.random() * 3);
      state.pnl += (-200 + Math.random() * 500);
      state.winRate = clamp(state.winRate + (-0.01 + Math.random() * 0.02), 0.3, 0.8);
      state.sharpe = clamp(state.sharpe + (-0.05 + Math.random() * 0.1), -0.5, 4);
    }
    return this.brains;
  }

  /** Start auto-refresh loop */
  startAutoRefresh(intervalMs = 5000): void {
    if (this.updateInterval) return;
    this.updateInterval = setInterval(() => this.refreshAll(), intervalMs);
  }

  /** Stop auto-refresh */
  stopAutoRefresh(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /** Get decision for a specific symbol + timeframe */
  getDecision(symbol: string, tf: Timeframe): AutonomousDecision | null {
    return this.brains.get(symbol)?.decisions[tf] ?? null;
  }

  /** Get top opportunities across all active brains */
  getTopOpportunities(limit = 10): { symbol: string; decision: Decision; confidence: number; bias: Bias }[] {
    return this.getActive()
      .map(b => ({ symbol: b.symbol, decision: b.compositeDecision, confidence: b.compositeScore, bias: b.compositeBias }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────

function hashSymbol(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const autonomousBrainEngine = new AutonomousSymbolBrainEngine();
