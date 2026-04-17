/**
 * macro_feed.ts — Live Market Data → MacroBiasInput + SentimentInput
 *
 * Fetches real market data from Alpaca to populate the YoungTraderWealth
 * Layer 0 + Layer 0.5 engine inputs automatically.
 *
 * Proxies used (all tradeable via Alpaca):
 *   DXY slope      → UUP ETF (Invesco DB US Dollar Index Bullish Fund)
 *   VIX level      → VIXY ETF (ProShares VIX Short-Term Futures, price ≈ VIX proxy)
 *   CPI momentum   → stored from last FOMC/CPI release (updated manually or via webhook)
 *   Rate diff      → crypto: funding rate; equity/forex: user-supplied
 *   Retail ratio   → crypto bias derived from Alpaca bar imbalance + funding signal
 *   Funding rate   → from Alpaca crypto perpetual bar data (approximated via momentum)
 *   CVD net        → computed from crypto OHLCV (close > open = buy, else sell)
 *   OI change      → approximated from volume acceleration (rising vol in up-trend = OI buildup)
 */

import { logger } from "./logger";
import type { MacroBiasInput } from "./macro_bias_engine";
import type { SentimentInput } from "./sentiment_engine";
import { getBars, isAlpacaAuthFailureError } from "./alpaca";
import { getCpiMomentum, getFedFundsRateBps, fetchFredMacroSnapshot, type FredMacroSnapshot } from "./providers/fred_client.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveMacroSnapshot {
  macroBiasInput: MacroBiasInput;
  sentimentInput: SentimentInput;
  fredSnapshot: FredMacroSnapshot | null;
  fetchedAt: string;  dataQuality: "full" | "partial" | "stale";
  sources: Record<string, string>;
}

interface OhlcvBar {
  t: string;  // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function toOhlcvBar(bar: {
  t?: string;
  Timestamp?: string;
  o?: number;
  Open?: number;
  h?: number;
  High?: number;
  l?: number;
  Low?: number;
  c?: number;
  Close?: number;
  v?: number;
  Volume?: number;
}): OhlcvBar {
  return {
    t: String(bar.t ?? bar.Timestamp ?? new Date().toISOString()),
    o: Number(bar.o ?? bar.Open ?? 0),    h: Number(bar.h ?? bar.High ?? 0),
    l: Number(bar.l ?? bar.Low ?? 0),
    c: Number(bar.c ?? bar.Close ?? 0),
    v: Number(bar.v ?? bar.Volume ?? 0),
  };
}

// ─── Bar fetching helpers ──────────────────────────────────────────────────────

/**
 * Fetch last `limit` daily bars for a stock ticker.
 * Returns empty array on any failure (graceful degradation).
 */
async function fetchBars(symbol: string, limit: number): Promise<OhlcvBar[]> {
  try {
    const bars = await getBars(symbol, "1Day", limit);
    return bars.slice(-limit).map(toOhlcvBar);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (isAlpacaAuthFailureError(err)) {
      logger.debug(`[macro_feed] fetchBars ${symbol} skipped: ${errMsg}`);
      return [];
    }
    logger.warn(`[macro_feed] fetchBars ${symbol} failed: ${errMsg}`);
    return [];
  }
}

/**
 * Fetch last `limit` 1-minute crypto bars for a crypto symbol. */
async function fetchCryptoBars(symbol: string, limit: number): Promise<OhlcvBar[]> {
  try {
    const bars = await getBars(symbol, "1Min", limit);
    return bars.slice(-limit).map(toOhlcvBar);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (isAlpacaAuthFailureError(err)) {
      logger.debug(`[macro_feed] fetchCryptoBars ${symbol} skipped: ${errMsg}`);
      return [];
    }
    logger.warn(`[macro_feed] fetchCryptoBars ${symbol} failed: ${errMsg}`);
    return [];
  }
}

// ─── Individual data fetchers ──────────────────────────────────────────────────

/**
 * Compute DXY slope from UUP ETF daily bars.
 * Uses linear regression slope over the last 20 days, normalised to per-bar return.
 * Returns 0 if data unavailable.
 */
async function fetchDxySlope(): Promise<{ slope: number; source: string }> {
  const bars = await fetchBars("UUP", 22);
  if (bars.length < 10) return { slope: 0, source: "unavailable" };

  const prices = bars.map(b => b.c);
  const n = prices.length;  const xMean = (n - 1) / 2;
  const yMean = prices.reduce((a, b) => a + b, 0) / n;

  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (prices[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den > 0 ? num / den / yMean : 0; // normalise as fractional per bar
  return { slope: Math.max(-0.05, Math.min(0.05, slope * 5)), source: "UUP ETF daily" };
}

/**
 * Fetch VIX level from VIXY ETF close price.
 * VIXY is not a perfect VIX replica but correlates well for regime detection.
 * Maps VIXY price ~16-50 → VIX ~15-80.
 */
async function fetchVixLevel(): Promise<{ vix: number; source: string }> {
  const bars = await fetchBars("VIXY", 3);
  if (bars.length === 0) return { vix: 20, source: "unavailable — using default 20" };

  const vixyPrice = bars[bars.length - 1].c;
  // Empirical mapping: VIXY ≈ 0.4 * VIX at the time (very rough)
  const vixEstimate = Math.max(10, Math.min(80, vixyPrice * 2.5));
  return { vix: vixEstimate, source: `VIXY ETF (${vixyPrice.toFixed(2)} × 2.5)` };
}

/**
 * Compute CVD net from recent crypto bars.
 * Approximation: if close > open → buy bar, else sell bar. * CVD net = Σ (bullish_vol - bearish_vol) over window.
 */
async function fetchCryptoCvd(symbol: string, window = 60): Promise<{ cvdNet: number; oiChange: number; source: string }> {
  const bars = await fetchCryptoBars(symbol, window);
  if (bars.length === 0) return { cvdNet: 0, oiChange: 0, source: "unavailable" };

  let cvdNet = 0;
  for (const b of bars) {
    const isBull = b.c >= b.o;
    cvdNet += isBull ? b.v : -b.v;
  }

  // OI proxy: volume acceleration in the second half vs first half
  const mid = Math.floor(bars.length / 2);
  const volFirst  = bars.slice(0, mid).reduce((s, b) => s + b.v, 0);
  const volSecond = bars.slice(mid).reduce((s, b) => s + b.v, 0);
  const oiChange = volFirst > 0 ? (volSecond - volFirst) / volFirst : 0;

  // Scale CVD net by typical bar size to get dollar equivalent (rough)
  const avgClose = bars.reduce((s, b) => s + b.c, 0) / bars.length;
  const cvdDollar = cvdNet * avgClose;

  return {
    cvdNet: cvdDollar,
    oiChange: Math.max(-0.5, Math.min(0.5, oiChange)),
    source: `${symbol} last ${bars.length} 1min bars`,
  };
}

/** * Estimate funding rate from price trend momentum.
 * A strongly trending-up market with accelerating volume = positive funding proxy.
 * For crypto perpetuals, funding rate tracks the premium/discount.
 * Alpaca doesn't expose raw funding data, so we derive from momentum.
 */
async function fetchFundingRateProxy(symbol: string): Promise<{ fundingRate: number; source: string }> {
  const bars = await fetchCryptoBars(symbol, 30);
  if (bars.length < 10) return { fundingRate: 0, source: "unavailable" };

  const prices = bars.map(b => b.c);
  const pctChange = (prices[prices.length - 1] - prices[0]) / prices[0];

  // In crypto, when price rises sharply, longs pile in and funding goes positive
  // Typical 8h funding ≈ 0.01% per 1% price move (very approximate)
  const fundingProxy = Math.max(-0.002, Math.min(0.002, pctChange * 0.002));
  return { fundingRate: fundingProxy, source: `${symbol} momentum proxy` };
}

/**
 * Compute retail long ratio proxy from recent price action.
 * When price has been trending up and volume is high, retail tends to be long-crowded.
 * This is a rough proxy using: price trend + volume vs avg.
 */
async function fetchRetailLongRatioProxy(symbol: string): Promise<{ ratio: number; priceTrendSlope: number; source: string }> {
  const bars = await fetchCryptoBars(symbol, 60);
  if (bars.length < 20) return { ratio: 0.5, priceTrendSlope: 0, source: "unavailable — using 0.5" };

  const prices = bars.map(b => b.c);
  const n = prices.length;
  const xMean = (n - 1) / 2;  const yMean = prices.reduce((a, b) => a + b, 0) / n;

  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (prices[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den > 0 ? (num / den) / yMean : 0;

  // Bull market + volume spike = retail pile-in = higher long ratio
  const avgVol = bars.slice(0, n - 10).reduce((s, b) => s + b.v, 0) / (n - 10);
  const recentVol = bars.slice(-10).reduce((s, b) => s + b.v, 0) / 10;
  const volRatio = avgVol > 0 ? recentVol / avgVol : 1;

  // Base retail ratio is 0.5; nudge it based on trend + volume
  const trendNudge = Math.max(-0.2, Math.min(0.2, slope * 100));
  const volNudge   = slope > 0 && volRatio > 1.3 ? 0.08 : (slope < 0 && volRatio > 1.3 ? -0.05 : 0);
  const ratio = Math.max(0.1, Math.min(0.9, 0.5 + trendNudge + volNudge));

  return {
    ratio,
    priceTrendSlope: Math.max(-0.05, Math.min(0.05, slope)),
    source: `${symbol} trend+vol proxy`,
  };
}

// ─── Master snapshot builder ───────────────────────────────────────────────────

/**
 * Fetches all live data sources and returns a complete snapshot for both * MacroBiasInput (Layer 0) and SentimentInput (Layer 0.5).
 *
 * Asset class is fixed to "crypto" for now (primary use case).
 * Pass intendedDirection from the caller — it doesn't affect data fetching.
 */
export async function fetchLiveMacroSnapshot(
  intendedDirection: "long" | "short" = "long",
  cryptoSymbol = "BTC/USD",
  assetClass: MacroBiasInput["assetClass"] = "crypto",
): Promise<LiveMacroSnapshot> {
  const fetchedAt = new Date().toISOString();
  const sources: Record<string, string> = {};

  logger.info(`[macro_feed] Fetching live macro snapshot for ${cryptoSymbol} / ${assetClass}`);

  // Run all fetches concurrently
  const [dxy, vix, cvdData, funding, retail] = await Promise.all([
    fetchDxySlope(),
    fetchVixLevel(),
    fetchCryptoCvd(cryptoSymbol, 60),
    fetchFundingRateProxy(cryptoSymbol),
    fetchRetailLongRatioProxy(cryptoSymbol),
  ]);

  sources["dxy"]     = dxy.source;
  sources["vix"]     = vix.source;
  sources["cvd"]     = cvdData.source;
  sources["funding"] = funding.source;
  sources["retail"]  = retail.source;
  // CPI momentum — fetch from FRED API (real data), fall back to env var, then 0
  let cpiMomentum = 0;
  try {
    const fredCpi = await getCpiMomentum();
    cpiMomentum = fredCpi.value;
    sources["cpi"] = fredCpi.source;
  } catch {
    cpiMomentum = parseFloat(process.env.MACRO_CPI_MOMENTUM ?? "0");
    sources["cpi"] = process.env.MACRO_CPI_MOMENTUM
      ? `env fallback MACRO_CPI_MOMENTUM=${cpiMomentum}`
      : "unavailable — using 0";
  }

  // Rate differential: use FRED Fed Funds rate if available, else funding proxy
  let rateDifferentialBps = Math.round(funding.fundingRate * 100_000);
  try {
    const fredRate = await getFedFundsRateBps();
    if (fredRate.bps > 0) {
      rateDifferentialBps = fredRate.bps;
      sources["rateDiff"] = fredRate.source;
    } else {
      sources["rateDiff"] = `funding proxy (${funding.fundingRate.toFixed(5)})`;
    }
  } catch {
    sources["rateDiff"] = `funding proxy fallback (${funding.fundingRate.toFixed(5)})`;
  }

  // Macro risk score: proxy from VIX + DXY combined stress  const vixStress = Math.max(0, (vix.vix - 20) / 60); // 0 at VIX=20, 1 at VIX=80
  const dxyStress = dxy.slope > 0 ? dxy.slope * 5 : 0;
  const macroRiskScore = Math.min(0.95, (vixStress * 0.7 + dxyStress * 0.3));
  sources["macroRiskScore"] = `VIX stress × 0.7 + DXY stress × 0.3`;

  const dataQuality: LiveMacroSnapshot["dataQuality"] =
    dxy.source === "unavailable" && vix.source.includes("unavailable")
      ? "stale"
      : dxy.source === "unavailable" || vix.source.includes("unavailable")
      ? "partial"
      : "full";

  const macroBiasInput: MacroBiasInput = {
    dxySlope: dxy.slope,
    rateDifferentialBps,
    cpiMomentum,
    vixLevel: vix.vix,
    macroRiskScore,
    assetClass,
    intendedDirection,
  };

  const sentimentInput: SentimentInput = {
    retailLongRatio: retail.ratio,
    priceTrendSlope: retail.priceTrendSlope,
    cvdNet: cvdData.cvdNet,
    openInterestChange: cvdData.oiChange,
    fundingRate: funding.fundingRate,
    intendedDirection,
    assetClass,  };

  // Fetch full FRED snapshot (cached 6h, non-blocking)
  let fredSnapshot: FredMacroSnapshot | null = null;
  try {
    fredSnapshot = await fetchFredMacroSnapshot();
    sources["fred"] = `quality=${fredSnapshot.quality}, risk=${fredSnapshot.macro_risk}`;
  } catch (err) {
    logger.debug({ err }, "[macro_feed] FRED snapshot fetch failed — non-critical");
    sources["fred"] = "unavailable";
  }

  logger.info(
    `[macro_feed] Snapshot complete — quality: ${dataQuality}, VIX: ${vix.vix.toFixed(1)}, DXY slope: ${dxy.slope.toFixed(4)}, FRED: ${fredSnapshot?.quality ?? "n/a"}`
  );

  return { macroBiasInput, sentimentInput, fredSnapshot, fetchedAt, dataQuality, sources };
}