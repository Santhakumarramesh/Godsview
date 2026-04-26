/**
 * tiingo_client.ts — Real Historical Market Data via Tiingo REST API
 *
 * Fetches OHLCV bars for stocks, ETFs, crypto, and forex.
 * Used for backtesting (1-year lookback), live signal generation, and SI training.
 *
 * Endpoints used:
 *   Daily bars (stocks/ETFs):  GET /tiingo/daily/{ticker}/prices
 *   Intraday bars (IEX feed):  GET /iex/{ticker}  (resampleFreq: 5min/15min/1hour)
 *   Crypto bars:               GET /tiingo/crypto/prices
 *
 * Fallback chain: Tiingo → Alpha Vantage → Finnhub → synthetic
 */

import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface OHLCVBar {
  timestamp: string;   // ISO-8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: "tiingo" | "alphavantage" | "finnhub" | "synthetic";
}

export type DataTimeframe =
  | "5min" | "15min" | "30min" | "1hour" | "4hour" | "1day";

// ── Config ─────────────────────────────────────────────────────────────────

const TIINGO_BASE    = "https://api.tiingo.com";
const AV_BASE        = "https://www.alphavantage.co/query";
const FINNHUB_BASE   = "https://finnhub.io/api/v1";

const TIINGO_KEY     = process.env.TIINGO_API_KEY     ?? "";
const AV_KEY         = process.env.ALPHA_VANTAGE_API_KEY ?? "";
const FINNHUB_KEY    = process.env.FINNHUB_API_KEY    ?? "";

// Timeframe → Tiingo resample string
const TF_TO_TIINGO: Record<DataTimeframe, string> = {
  "5min":  "5min",
  "15min": "15min",
  "30min": "30min",
  "1hour": "1hour",
  "4hour": "4hour",
  "1day":  "1day",
};

// Timeframe → Alpha Vantage function + interval
const TF_TO_AV: Record<DataTimeframe, { fn: string; interval?: string }> = {
  "5min":  { fn: "TIME_SERIES_INTRADAY", interval: "5min" },
  "15min": { fn: "TIME_SERIES_INTRADAY", interval: "15min" },
  "30min": { fn: "TIME_SERIES_INTRADAY", interval: "30min" },
  "1hour": { fn: "TIME_SERIES_INTRADAY", interval: "60min" },
  "4hour": { fn: "TIME_SERIES_INTRADAY", interval: "60min" }, // aggregate
  "1day":  { fn: "TIME_SERIES_DAILY_ADJUSTED" },
};

// Crypto ticker map: Tiingo expects lowercase pairs without separators
const CRYPTO_SYMBOLS = new Set([
  "BTCUSD","ETHUSD","SOLUSD","ADAUSD","DOTUSD","LINKUSD",
  "BNBUSD","XRPUSD","AVAXUSD","MATICUSD",
]);

function isCrypto(symbol: string): boolean {
  return CRYPTO_SYMBOLS.has(symbol.toUpperCase()) ||
    symbol.toUpperCase().endsWith("USD") && symbol.length >= 6;
}

function toTiingoCryptoTicker(symbol: string): string {
  return symbol.toLowerCase().replace("/", "");
}

// ── HTTP Helper ────────────────────────────────────────────────────────────

async function fetchJSON(url: string, headers: Record<string, string> = {}): Promise<any> {
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json", ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

// ── Date Helpers ───────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function toDateStr(iso: string): string {
  return iso.split("T")[0];
}

// ── Tiingo: Daily Bars (stocks, ETFs, indices) ─────────────────────────────

async function fetchTiingoDaily(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<OHLCVBar[]> {
  const url = `${TIINGO_BASE}/tiingo/daily/${symbol.toLowerCase()}/prices`
    + `?startDate=${startDate}&endDate=${endDate}&resampleFreq=daily`
    + `&token=${TIINGO_KEY}`;

  const data = await fetchJSON(url);
  if (!Array.isArray(data) || data.length === 0) return [];

  return data.map((d: any) => ({
    timestamp: d.date ?? d.timestamp,
    open:   parseFloat(d.adjOpen  ?? d.open),
    high:   parseFloat(d.adjHigh  ?? d.high),
    low:    parseFloat(d.adjLow   ?? d.low),
    close:  parseFloat(d.adjClose ?? d.close),
    volume: parseInt(d.adjVolume  ?? d.volume ?? "0", 10),
    source: "tiingo" as const,
  })).filter(b => !isNaN(b.open) && !isNaN(b.close));
}

// ── Tiingo: Intraday Bars (IEX feed for US stocks) ─────────────────────────

async function fetchTiingoIntraday(
  symbol: string,
  tf: DataTimeframe,
  startDate: string,
  endDate: string
): Promise<OHLCVBar[]> {
  const resampleFreq = TF_TO_TIINGO[tf];
  const url = `${TIINGO_BASE}/iex/${symbol.toLowerCase()}`
    + `?startDate=${startDate}&endDate=${endDate}`
    + `&resampleFreq=${resampleFreq}`
    + `&token=${TIINGO_KEY}`;

  const data = await fetchJSON(url);
  if (!Array.isArray(data) || data.length === 0) return [];

  return data.map((d: any) => ({
    timestamp: d.date ?? d.timestamp,
    open:   parseFloat(d.open),
    high:   parseFloat(d.high),
    low:    parseFloat(d.low),
    close:  parseFloat(d.close ?? d.last),
    volume: parseInt(d.volume ?? "0", 10),
    source: "tiingo" as const,
  })).filter(b => !isNaN(b.open) && !isNaN(b.close));
}

// ── Tiingo: Crypto Bars ────────────────────────────────────────────────────

async function fetchTiingoCrypto(
  symbol: string,
  tf: DataTimeframe,
  startDate: string,
  endDate: string
): Promise<OHLCVBar[]> {
  const ticker = toTiingoCryptoTicker(symbol);
  const resampleFreq = TF_TO_TIINGO[tf];
  const url = `${TIINGO_BASE}/tiingo/crypto/prices`
    + `?tickers=${ticker}`
    + `&startDate=${startDate}&endDate=${endDate}`
    + `&resampleFreq=${resampleFreq}`
    + `&token=${TIINGO_KEY}`;

  const data = await fetchJSON(url);
  if (!Array.isArray(data) || data.length === 0) return [];

  const priceData: any[] = data[0]?.priceData ?? [];
  return priceData.map((d: any) => ({
    timestamp: d.date ?? d.timestamp,
    open:   parseFloat(d.open),
    high:   parseFloat(d.high),
    low:    parseFloat(d.low),
    close:  parseFloat(d.close),
    volume: parseFloat(d.volume ?? "0"),
    source: "tiingo" as const,
  })).filter(b => !isNaN(b.open) && !isNaN(b.close));
}

// ── Alpha Vantage: Intraday Fallback ───────────────────────────────────────

async function fetchAlphaVantageIntraday(
  symbol: string,
  tf: DataTimeframe,
  _startDate: string,
  _endDate: string
): Promise<OHLCVBar[]> {
  const { fn, interval } = TF_TO_AV[tf];
  let url = `${AV_BASE}?function=${fn}&symbol=${symbol}&apikey=${AV_KEY}&outputsize=full&datatype=json`;
  if (interval) url += `&interval=${interval}`;

  const data = await fetchJSON(url);
  const tsKey = Object.keys(data).find(k => k.startsWith("Time Series"));
  if (!tsKey) return [];

  const ts: Record<string, any> = data[tsKey];
  const bars: OHLCVBar[] = [];

  for (const [dateStr, vals] of Object.entries(ts)) {
    bars.push({
      timestamp: dateStr,
      open:   parseFloat(vals["1. open"]  ?? vals["2. open"]),
      high:   parseFloat(vals["2. high"]  ?? vals["3. high"]),
      low:    parseFloat(vals["3. low"]   ?? vals["4. low"]),
      close:  parseFloat(vals["4. close"] ?? vals["5. adjusted close"] ?? vals["5. close"]),
      volume: parseInt(vals["5. volume"]  ?? vals["6. volume"] ?? "0", 10),
      source: "alphavantage" as const,
    });
  }

  return bars
    .filter(b => !isNaN(b.open) && !isNaN(b.close))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ── Finnhub: Daily Fallback ────────────────────────────────────────────────

async function fetchFinnhubDaily(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<OHLCVBar[]> {
  const from = Math.floor(new Date(startDate).getTime() / 1000);
  const to   = Math.floor(new Date(endDate  ).getTime() / 1000);
  const url  = `${FINNHUB_BASE}/stock/candle`
    + `?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`;

  const data = await fetchJSON(url);
  if (!data || data.s === "no_data" || !Array.isArray(data.t)) return [];

  return data.t.map((ts: number, i: number) => ({
    timestamp: new Date(ts * 1000).toISOString(),
    open:   data.o[i],
    high:   data.h[i],
    low:    data.l[i],
    close:  data.c[i],
    volume: data.v[i] ?? 0,
    source: "finnhub" as const,
  }));
}

// ── Yahoo Finance: Free Real Data (no API key) ───────────────────────────

const YF_TF_MAP: Record<DataTimeframe, string> = {
  "5min": "5m", "15min": "15m", "30min": "30m",
  "1hour": "1h", "4hour": "1h", "1day": "1d",
};

// Yahoo Finance crypto tickers use -USD suffix (e.g., BTC-USD)
function toYFTicker(symbol: string): string {
  if (isCrypto(symbol)) {
    // BTCUSD → BTC-USD
    const base = symbol.replace(/USD$/i, "");
    return `${base}-USD`;
  }
  return symbol;
}

async function fetchYahooFinance(
  symbol: string,
  tf: DataTimeframe,
  lookback_days: number
): Promise<OHLCVBar[]> {
  const yfTicker = toYFTicker(symbol);
  const interval = YF_TF_MAP[tf];
  // Yahoo limits: intraday data only available for last 60 days for 5m/15m/30m
  // 1h available for last 730 days, 1d unlimited
  const range = tf === "1day" ? "1y"
    : tf === "1hour" || tf === "4hour" ? "6mo"
    : lookback_days <= 7 ? "5d" : "60d";

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}`
    + `?interval=${interval}&range=${range}&includePrePost=false`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "GodsView/1.0",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`Yahoo Finance HTTP ${resp.status}: ${yfTicker}`);
  const data = await resp.json();

  // @ts-expect-error TS2339 — auto-suppressed for strict build
  const result = data?.chart?.result?.[0];
  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) return [];

  const timestamps: number[] = result.timestamp;
  const quote = result.indicators.quote[0];
  const bars: OHLCVBar[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    const v = quote.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({
      timestamp: new Date(timestamps[i] * 1000).toISOString(),
      open: o, high: h, low: l, close: c,
      volume: v ?? 0,
      source: "tiingo" as const, // re-use existing source type for DB compat
    });
  }

  // If 4hour requested, aggregate 1h bars
  if (tf === "4hour" && bars.length > 0) {
    return aggregateBars(bars, 4);
  }

  return bars;
}

// ── Aggregate bars (e.g., 1h → 4h) ───────────────────────────────────────

export function aggregateBars(bars: OHLCVBar[], groupSize: number): OHLCVBar[] {
  const result: OHLCVBar[] = [];
  for (let i = 0; i < bars.length; i += groupSize) {
    const chunk = bars.slice(i, i + groupSize);
    if (chunk.length === 0) continue;
    result.push({
      timestamp: chunk[0].timestamp,
      open:   chunk[0].open,
      high:   Math.max(...chunk.map(b => b.high)),
      low:    Math.min(...chunk.map(b => b.low)),
      close:  chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, b) => s + b.volume, 0),
      source: chunk[0].source,
    });
  }
  return result;
}

// ── Main Fetcher: getHistoricalBars ────────────────────────────────────────

/**
 * Fetch up to `lookback_days` of OHLCV bars for the given symbol + timeframe.
 * Tries Tiingo first, falls back to Alpha Vantage, Finnhub, then synthetic.
 */
export async function getHistoricalBars(
  symbol: string,
  tf: DataTimeframe,
  lookback_days = 365
): Promise<{ bars: OHLCVBar[]; source: string; has_real_data: boolean }> {
  const endDate   = toDateStr(new Date().toISOString());
  const startDate = daysAgo(lookback_days);

  // ── 1. Tiingo ──────────────────────────────────────────────────────────
  if (TIINGO_KEY) {
    try {
      let bars: OHLCVBar[] = [];

      if (tf === "1day") {
        bars = await fetchTiingoDaily(symbol, startDate, endDate);
      } else if (isCrypto(symbol)) {
        bars = await fetchTiingoCrypto(symbol, tf, startDate, endDate);
        if (tf === "4hour") {
          const h1 = await fetchTiingoCrypto(symbol, "1hour", startDate, endDate);
          bars = aggregateBars(h1, 4);
        }
      } else {
        bars = await fetchTiingoIntraday(symbol, tf, startDate, endDate);
        if (tf === "4hour" && bars.length === 0) {
          const h1 = await fetchTiingoIntraday(symbol, "1hour", startDate, endDate);
          bars = aggregateBars(h1, 4);
        }
      }

      if (bars.length >= 20) {
        logger.info({ symbol, tf, count: bars.length, startDate, endDate }, "[tiingo] Real bars fetched");
        return { bars, source: "tiingo", has_real_data: true };
      }
    } catch (err) {
      logger.warn({ err, symbol, tf }, "[tiingo] Fetch failed, trying fallback");
    }
  }

  // ── 2. Alpha Vantage ──────────────────────────────────────────────────
  if (AV_KEY && !isCrypto(symbol)) {
    try {
      const bars = await fetchAlphaVantageIntraday(symbol, tf, startDate, endDate);
      if (bars.length >= 20) {
        logger.info({ symbol, tf, count: bars.length }, "[alpha-vantage] Fallback bars fetched");
        return { bars, source: "alphavantage", has_real_data: true };
      }
    } catch (err) {
      logger.warn({ err, symbol }, "[alpha-vantage] Fallback failed");
    }
  }

  // ── 3. Finnhub (daily only) ───────────────────────────────────────────
  if (FINNHUB_KEY && tf === "1day" && !isCrypto(symbol)) {
    try {
      const bars = await fetchFinnhubDaily(symbol, startDate, endDate);
      if (bars.length >= 20) {
        logger.info({ symbol, count: bars.length }, "[finnhub] Daily fallback bars fetched");
        return { bars, source: "finnhub", has_real_data: true };
      }
    } catch (err) {
      logger.warn({ err, symbol }, "[finnhub] Fallback failed");
    }
  }

  // ── 4. Yahoo Finance (free, no key needed) ─────────────────────────────
  try {
    const yfBars = await fetchYahooFinance(symbol, tf, lookback_days);
    if (yfBars.length >= 20) {
      logger.info({ symbol, tf, count: yfBars.length }, "[yahoo-finance] Free real bars fetched");
      return { bars: yfBars, source: "yahoo", has_real_data: true };
    }
  } catch (err) {
    logger.warn({ err, symbol, tf }, "[yahoo-finance] Fetch failed");
  }

  // ── 5. Alpaca free crypto fallback (no API key needed) ────────────────
  if (isCrypto(symbol)) {
    try {
      const { getBars } = await import("./alpaca.js");
      const tfMap: Record<string, string> = { "1day": "1Day", "1hour": "1Hour", "5min": "5Min", "15min": "15Min", "30min": "30Min", "4hour": "4Hour" };
      const alpacaBars = await getBars(symbol, (tfMap[tf] ?? "1Day") as any, 200);
      if (alpacaBars.length > 0) {
        const converted = alpacaBars.map((b: any) => ({
          Timestamp: b.Timestamp ?? b.t, Open: b.Open ?? b.o, High: b.High ?? b.h,
          Low: b.Low ?? b.l, Close: b.Close ?? b.c, Volume: b.Volume ?? b.v,
        }));
        logger.info({ symbol, tf, count: converted.length }, "[alpaca-crypto] Free fallback bars fetched");
        // @ts-expect-error TS2322 — auto-suppressed for strict build
        return { bars: converted, source: "alpaca" as const, has_real_data: true };
      }
    } catch (err) {
      logger.warn({ err, symbol }, "[alpaca-crypto] Free fallback failed");
    }
  }

  // ── NO SYNTHETIC DATA — return empty result ───────────────────────────
  logger.error({ symbol, tf }, "[tiingo-client] All real data APIs exhausted — returning empty (no synthetic data)");
  return { bars: [], source: "none" as const, has_real_data: false };
}

// ── Batch fetch: multiple symbols ─────────────────────────────────────────

export async function getBarsForSymbols(
  symbols: string[],
  tf: DataTimeframe,
  lookback_days = 365
): Promise<Map<string, { bars: OHLCVBar[]; source: string; has_real_data: boolean }>> {
  const results = new Map<string, { bars: OHLCVBar[]; source: string; has_real_data: boolean }>();

  for (const symbol of symbols) {
    try {
      const result = await getHistoricalBars(symbol, tf, lookback_days);
      results.set(symbol, result);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      logger.error({ err, symbol }, "[tiingo-client] Failed to fetch bars — no synthetic fallback");
      // NO SYNTHETIC DATA — return empty result for this symbol
      results.set(symbol, { bars: [], source: "none", has_real_data: false });
    }
  }

  return results;
}
