import { Router, type IRouter, type Request, type Response } from "express";
import { claudeVeto, isClaudeAvailable, type ClaudeVetoResult, type SetupContext } from "../lib/claude";
import { getBars, getBarsHistorical, getLatestBar, getLatestTrade, getAccount, getPositions, hasValidTradingKey, isBrokerKey, placeOrder, getOrders, cancelOrder, cancelAllOrders, closePosition, getTypedPositions, calcPositionSize, type AlpacaBar, type AlpacaTimeframe, type PlaceOrderRequest } from "../lib/alpaca";
import { alpacaStream, type TickListener } from "../lib/alpaca_stream";
import {
  buildRecallFeatures,
  detectAbsorptionReversal,
  detectSweepReclaim,
  detectContinuationPullback,
  detectCVDDivergence,
  detectBreakoutFailure,
  scoreRecall,
  computeFinalQuality,
  computeTPSL,
  computeATR,
  checkForwardOutcome,
  applyNoTradeFilters,
  getQualityThreshold,
  detectRegime,
  buildChartOverlay,
  type SetupType,
  type SetupCooldowns,
  type RecallFeatures,
} from "../lib/strategy_engine";
import { getModelStatus, predictWinProbability } from "../lib/ml_model";
import { db, accuracyResultsTable, marketBarsTable, signalsTable } from "@workspace/db";
import { DEFAULT_SETUPS, isSetupType } from "@workspace/strategy-core";
import { eq, desc, and, count, sql, inArray, gte } from "drizzle-orm";

const router: IRouter = Router();
const LIVE_TRADING_ENABLED = String(process.env.GODSVIEW_ENABLE_LIVE_TRADING ?? "").toLowerCase() === "true";
const OPERATOR_TOKEN = (process.env.GODSVIEW_OPERATOR_TOKEN ?? "").trim();
type AccuracyResultRow = typeof accuracyResultsTable.$inferSelect;

const SUPPORTED_SYMBOLS: Record<string, string> = {
  MES: "SPY",
  MNQ: "QQQ",
  MES1: "SPY",
  MNQ1: "QQQ",
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
};

const BAR_TIMEFRAME_MS: Record<AlpacaTimeframe, number> = {
  "1Min": 60_000,
  "5Min": 5 * 60_000,
  "15Min": 15 * 60_000,
  "1Hour": 60 * 60_000,
  "1Day": 24 * 60 * 60_000,
};

function isAlpacaRateLimitError(error: unknown): boolean {
  const message = String(error ?? "");
  return message.includes("Alpaca API 429") || message.toLowerCase().includes("too many requests");
}

function delayMs(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBarsFromCacheStore(
  symbol: string,
  timeframe: AlpacaTimeframe,
  limit: number
): Promise<AlpacaBar[]> {
  if (!(timeframe === "1Min" || timeframe === "5Min" || timeframe === "15Min")) {
    return [];
  }

  const lookbackMs = Math.min(
    Math.max(BAR_TIMEFRAME_MS[timeframe] * Math.max(limit + 20, 120), 60 * 60_000),
    48 * 60 * 60_000
  );
  const minBarTime = new Date(Date.now() - lookbackMs);

  const rows = await db
    .select()
    .from(marketBarsTable)
    .where(
      and(
        eq(marketBarsTable.symbol, symbol),
        eq(marketBarsTable.timeframe, timeframe),
        gte(marketBarsTable.bar_time, minBarTime),
      ),
    )
    .orderBy(desc(marketBarsTable.bar_time))
    .limit(limit);

  if (!rows.length) return [];

  const normalized: AlpacaBar[] = [];
  for (const row of [...rows].reverse()) {
    const timestamp = new Date(row.bar_time).toISOString();
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = Number(row.volume);
    const vwapRaw = row.vwap === null || row.vwap === undefined ? null : Number(row.vwap);
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) {
      continue;
    }
    const vwap = vwapRaw !== null && Number.isFinite(vwapRaw) ? vwapRaw : undefined;
    normalized.push({
      t: timestamp,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
      vw: vwap,
      Timestamp: timestamp,
      Open: open,
      High: high,
      Low: low,
      Close: close,
      Volume: volume,
      VWAP: vwap,
    });
  }
  return normalized;
}

async function getBarsWithRateLimitFallback(
  symbol: string,
  timeframe: AlpacaTimeframe,
  limit: number,
  options?: {
    req?: Request;
    start?: string;
    end?: string;
  }
): Promise<AlpacaBar[]> {
  try {
    return await getBars(symbol, timeframe, limit, options?.start, options?.end);
  } catch (error) {
    if (!isAlpacaRateLimitError(error)) throw error;
    await delayMs(550);
    try {
      const reducedLimit = Math.max(Math.min(limit, 150), Math.floor(limit * 0.75));
      return await getBars(symbol, timeframe, reducedLimit, options?.start, options?.end);
    } catch (retryError) {
      if (!isAlpacaRateLimitError(retryError)) throw retryError;
      if (options?.start || options?.end) {
        throw retryError;
      }
      const cachedBars = await readBarsFromCacheStore(symbol, timeframe, limit);
      if (cachedBars.length >= Math.min(limit, timeframe === "1Min" ? 80 : 40)) {
        options?.req?.log.warn(
          { symbol, timeframe, requestedBars: limit, fallbackBars: cachedBars.length },
          "alpaca 429 fallback to cached market_bars",
        );
        return cachedBars;
      }
      throw retryError;
    }
  }
}

function toAlpacaSymbol(instrument: string): string {
  const normalized = instrument
    .trim()
    .toUpperCase()
    .split(":")
    .pop()
    ?.replace(/[^A-Z0-9]/g, "") ?? "";

  if (!normalized) return "BTCUSD";
  if (SUPPORTED_SYMBOLS[normalized]) return SUPPORTED_SYMBOLS[normalized];
  const rootSymbol = normalized.replace(/[0-9]+$/g, "");
  if (rootSymbol && SUPPORTED_SYMBOLS[rootSymbol]) return SUPPORTED_SYMBOLS[rootSymbol];
  if (normalized.endsWith("USDT")) return `${normalized.slice(0, -4)}USD`;
  return normalized;
}

function normalizeIndicatorHint(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) return "";
  if (normalized.includes("macd")) return "macd";
  if (normalized.includes("rsi")) return "rsi";
  if (normalized.includes("bollinger") || normalized === "bb" || normalized.startsWith("bb_")) return "bollinger";
  if (normalized.includes("ema") || normalized.includes("moving_average")) return "ema";
  if (normalized.includes("stoch")) return "stoch";
  if (normalized.includes("supertrend")) return "supertrend";
  if (normalized.includes("volume")) return "volume";
  return normalized;
}

function parseIndicatorHints(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  const candidates = [body.indicators, body.indicator_hints, body.studies];
  const rawHints: string[] = [];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") rawHints.push(item);
      }
      continue;
    }
    if (typeof value === "string") {
      rawHints.push(...value.split(",").map((v) => v.trim()).filter(Boolean));
    }
  }

  const deduped = new Set<string>();
  for (const hint of rawHints) {
    const normalized = normalizeIndicatorHint(hint);
    if (normalized) deduped.add(normalized);
  }
  return Array.from(deduped).slice(0, 32);
}

function getProvidedOperatorToken(req: Request): string | null {
  const fromHeader = req.header("x-godsview-token")?.trim();
  if (fromHeader) return fromHeader;

  const authHeader = req.header("authorization")?.trim();
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const bearer = authHeader.slice("bearer ".length).trim();
    return bearer || null;
  }
  return null;
}

function ensureTradingWriteAccess(req: Request, res: Response): boolean {
  if (!LIVE_TRADING_ENABLED) {
    res.status(403).json({
      error: "trading_disabled",
      message: "Trading write actions are disabled by server policy. Set GODSVIEW_ENABLE_LIVE_TRADING=true to enable.",
    });
    return false;
  }

  if (!OPERATOR_TOKEN) {
    req.log.error("Trading write attempted but GODSVIEW_OPERATOR_TOKEN is not configured");
    res.status(503).json({
      error: "operator_token_not_configured",
      message: "Server is missing GODSVIEW_OPERATOR_TOKEN; refusing trading write actions.",
    });
    return false;
  }

  const provided = getProvidedOperatorToken(req);
  if (!provided || provided !== OPERATOR_TOKEN) {
    res.status(401).json({
      error: "unauthorized",
      message: "Missing or invalid operator token.",
    });
    return false;
  }

  return true;
}

type BacktestTraceBar = {
  time: number;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type OrderBlockTrace = {
  time: number;
  ts: string;
  side: "bullish" | "bearish";
  low: number;
  high: number;
  mid: number;
  strength: number;
};

type PositionTrace = {
  entry_time: string;
  exit_time: string | null;
  direction: "long" | "short";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  outcome: "win" | "loss" | "open";
  pnl_dollars: number;
  bars_to_outcome: number;
  is_fake_entry: boolean;
  fake_entry_reason: string | null;
  claude_verdict?: "APPROVED" | "VETOED" | "CAUTION";
  claude_score?: number;
  claude_confidence?: number;
  final_quality: number;
  final_quality_with_claude?: number;
  regime: string;
  ml_probability: number;
};

type ClaudeHistoricalReview = {
  result_index: number;
  entry_time: string;
  direction: "long" | "short";
  verdict: "APPROVED" | "VETOED" | "CAUTION";
  confidence: number;
  claude_score: number;
  reasoning: string;
  key_factors: string[];
  latency_ms: number;
};

function toTraceBars(bars: AlpacaBar[]): BacktestTraceBar[] {
  return bars.map((bar) => ({
    time: Math.floor(new Date(bar.Timestamp).getTime() / 1000),
    ts: bar.Timestamp,
    open: Number(bar.Open),
    high: Number(bar.High),
    low: Number(bar.Low),
    close: Number(bar.Close),
    volume: Number(bar.Volume),
  }));
}

function detectOrderBlocks(bars: AlpacaBar[]): OrderBlockTrace[] {
  if (bars.length < 8) return [];

  const avgVolume = bars.reduce((sum, bar) => sum + bar.Volume, 0) / bars.length;
  const blocks: OrderBlockTrace[] = [];

  for (let i = 2; i < bars.length - 2; i++) {
    const prev = bars[i - 1];
    const bar = bars[i];
    const next = bars[i + 1];
    const next2 = bars[i + 2];

    const barRange = Math.max(bar.High - bar.Low, 0.000001);
    const bodySize = Math.abs(bar.Close - bar.Open);
    const bodyRatio = bodySize / barRange;
    const volStrength = avgVolume > 0 ? bar.Volume / avgVolume : 1;

    const isBullishBlock =
      bar.Close < bar.Open &&
      next.Close > next.Open &&
      next2.Close > next2.Open &&
      next.Close > bar.High &&
      volStrength > 1.05;

    const isBearishBlock =
      bar.Close > bar.Open &&
      next.Close < next.Open &&
      next2.Close < next2.Open &&
      next.Close < bar.Low &&
      volStrength > 1.05;

    if (!isBullishBlock && !isBearishBlock) continue;

    const low = Math.min(bar.Low, prev.Low);
    const high = Math.max(bar.High, prev.High);
    const strength = Math.min(1, volStrength * 0.5 + (1 - bodyRatio) * 0.5);

    blocks.push({
      time: Math.floor(new Date(bar.Timestamp).getTime() / 1000),
      ts: bar.Timestamp,
      side: isBullishBlock ? "bullish" : "bearish",
      low,
      high,
      mid: (low + high) / 2,
      strength: Math.round(strength * 1000) / 1000,
    });
  }

  return blocks.slice(-250);
}

function detectFakeEntry(
  direction: "long" | "short",
  entryPrice: number,
  atr: number,
  forwardBars: AlpacaBar[]
): { isFakeEntry: boolean; reason: string | null; adverseMovePct: number } {
  if (forwardBars.length === 0 || entryPrice <= 0) {
    return { isFakeEntry: false, reason: null, adverseMovePct: 0 };
  }

  const earlyBars = forwardBars.slice(0, 4);
  const adverseMoves = earlyBars.map((bar) =>
    direction === "long"
      ? Math.max(0, entryPrice - bar.Low)
      : Math.max(0, bar.High - entryPrice)
  );

  const bestFavorable = earlyBars.map((bar) =>
    direction === "long"
      ? Math.max(0, bar.High - entryPrice)
      : Math.max(0, entryPrice - bar.Low)
  );

  const maxAdverse = Math.max(...adverseMoves);
  const maxFavorable = Math.max(...bestFavorable);
  const adversePct = entryPrice > 0 ? (maxAdverse / entryPrice) * 100 : 0;
  const atrRatio = atr > 0 ? maxAdverse / atr : 0;

  if (atrRatio > 0.8 && maxFavorable < maxAdverse * 0.35) {
    return { isFakeEntry: true, reason: "early_adverse_move", adverseMovePct: adversePct };
  }
  if (atrRatio > 0.55 && maxFavorable < maxAdverse * 0.25) {
    return { isFakeEntry: true, reason: "no_follow_through", adverseMovePct: adversePct };
  }

  return { isFakeEntry: false, reason: null, adverseMovePct: adversePct };
}

// ─── In-memory cache for candle data (reduces Alpaca API calls) ──────────────
const candleCache = new Map<string, { bars: unknown[]; fetchedAt: number }>();
const CANDLE_CACHE_TTL = 1500; // 1.5 seconds — keeps data fresh for 3s chart REST polls

// ─── GET /api/alpaca/candles — OHLCV bars for candlestick chart ───────────────
router.get("/alpaca/candles", async (req, res) => {
  const symbol = String(req.query.symbol ?? "BTCUSD");
  const VALID_TF: AlpacaTimeframe[] = ["1Min", "5Min", "15Min", "1Hour", "1Day"];
  const rawTf = String(req.query.timeframe ?? "5Min");
  const timeframe: AlpacaTimeframe = VALID_TF.includes(rawTf as AlpacaTimeframe) ? (rawTf as AlpacaTimeframe) : "5Min";
  const limit = Math.min(parseInt(String(req.query.limit ?? "200"), 10), 500);

  const cacheKey = `${symbol}:${timeframe}:${limit}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL) {
    res.setHeader("X-Cache", "HIT");
    res.json({ symbol, timeframe, bars: cached.bars, fetched_at: new Date(cached.fetchedAt).toISOString() });
    return;
  }

  try {
    const alpacaSym = toAlpacaSymbol(symbol);
    // Fetch candles going back enough to fill the chart
    const hoursBack = timeframe === "1Min" ? 4 : timeframe === "5Min" ? 24 : timeframe === "15Min" ? 72 : timeframe === "1Hour" ? 30 * 24 : 365 * 24;
    const start = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString().slice(0, 10);
    const bars = await getBarsWithRateLimitFallback(alpacaSym, timeframe, limit, { req, start });

    // Normalise to lightweight-charts format { time, open, high, low, close, volume }
    const formatted = bars
      .sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime())
      .map((b) => ({
        time: Math.floor(new Date(b.Timestamp).getTime() / 1000) as number,
        open: b.Open,
        high: b.High,
        low: b.Low,
        close: b.Close,
        volume: b.Volume,
      }));

    candleCache.set(cacheKey, { bars: formatted, fetchedAt: Date.now() });
    res.setHeader("X-Cache", "MISS");
    res.json({ symbol, timeframe, bars: formatted, fetched_at: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch candles");
    res.status(500).json({ error: "candle_fetch_failed", message: String(err) });
  }
});

// ─── GET /api/alpaca/stream — SSE real-time price stream (WebSocket-backed) ───
// Uses AlpacaStreamManager: Alpaca WebSocket (trades + quotes) for sub-100ms latency.
// Start stream manager once on module load
alpacaStream.start();

// ─── GET /api/alpaca/stream-status — diagnostic: show stream manager state ───
router.get("/alpaca/stream-status", (_req, res) => {
  res.json(alpacaStream.status());
});

router.get("/alpaca/stream", (req, res) => {
  const timeframe = String(req.query.timeframe ?? "5Min");
  const symbolsQuery = String(req.query.symbols ?? "");
  const fallbackSymbol = String(req.query.symbol ?? "");
  const rawSymbols = symbolsQuery || fallbackSymbol || "BTCUSD";
  const symbols = Array.from(
    new Set(
      rawSymbols
        .split(",")
        .map((raw) => toAlpacaSymbol(raw))
        .map((raw) => raw.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, 24);

  if (symbols.length === 0) {
    symbols.push("BTCUSD");
  }

  // SSE headers — X-Accel-Buffering: no disables nginx/proxy buffering
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders();

  const send = (data: string) => {
    try {
      res.write(data);
      // Force flush — bypasses Node.js stream buffering
      if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
        (res as unknown as { flush: () => void }).flush();
      }
    } catch { /* client gone */ }
  };

  send(`: connected\n\n`);

  const listeners = new Map<string, TickListener>();
  for (const symbol of symbols) {
    const listener: TickListener = (payload) => {
      send(`data: ${JSON.stringify(payload)}\n\n`);
    };
    listeners.set(symbol, listener);
    alpacaStream.subscribe(symbol, timeframe, listener);
  }

  send(`event: stream-info\ndata: ${JSON.stringify({ type: "stream-info", symbols, timeframe })}\n\n`);

  // Heartbeat every 10s to keep proxies alive and detect stale connections
  const heartbeat = setInterval(() => send(": ping\n\n"), 10_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    for (const [symbol, listener] of listeners) {
      alpacaStream.unsubscribe(symbol, timeframe, listener);
    }
  });
});

// ─── GET /api/alpaca/ticker — live prices for multiple symbols ────────────────
// Polls Alpaca latest bar + 24h change. No auth required for crypto.
// ── Ticker cache (avoid Alpaca 429 rate limits) ─────────────────────────────
const _tickerCache: Map<string, { data: any; ts: number }> = new Map();
const _tickerDailyRefCache: Map<string, { data: { prevClose: number | null; high: number | null; low: number | null; volume: number | null }; ts: number }> = new Map();
const TICKER_CACHE_TTL = clampEnvInt("TICKER_CACHE_TTL_MS", 2_500, 800, 15_000);
const TICKER_DAILY_REF_TTL = clampEnvInt("TICKER_DAILY_REF_TTL_MS", 90_000, 15_000, 15 * 60_000);
const _tickerInFlight: Map<string, Promise<{ tickers: unknown[]; fetched_at: string }>> = new Map();

function clampEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function getTickerDailyReference(symbol: string): Promise<{
  prevClose: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${symbol}:${today}`;
  const cached = _tickerDailyRefCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TICKER_DAILY_REF_TTL) {
    return cached.data;
  }

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dailyBars = await getBarsWithRateLimitFallback(symbol, "1Day", 10, { start: fiveDaysAgo }).catch(
    () => [] as AlpacaBar[],
  );
  const sortedBars = [...dailyBars].sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());
  const closedBars = sortedBars.filter((b) => b.Timestamp.slice(0, 10) < today);
  const prevClose = closedBars.length > 0 ? closedBars[closedBars.length - 1]!.Close : null;

  const todayBar = sortedBars.find((b) => b.Timestamp.slice(0, 10) === today) ?? sortedBars[sortedBars.length - 1];
  const reference = {
    prevClose,
    high: todayBar?.High ?? null,
    low: todayBar?.Low ?? null,
    volume: todayBar?.Volume ?? null,
  };
  _tickerDailyRefCache.set(cacheKey, { data: reference, ts: Date.now() });
  return reference;
}

router.get("/alpaca/ticker", async (req, res) => {
  const symbolsParam = String(req.query.symbols ?? "BTCUSD,ETHUSD");
  const cacheKey = symbolsParam;
  const cached = _tickerCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TICKER_CACHE_TTL) {
    res.setHeader("X-Cache", "HIT");
    res.json(cached.data);
    return;
  }

  const inFlight = _tickerInFlight.get(cacheKey);
  if (inFlight) {
    try {
      const payload = await inFlight;
      res.setHeader("X-Cache", "INFLIGHT");
      res.json(payload);
      return;
    } catch {
      // If inflight request failed, continue and create a fresh request.
    }
  }

  const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean);

  const loadPromise: Promise<{ tickers: unknown[]; fetched_at: string }> = (async () => {
    const results = await Promise.allSettled(
      symbols.map(async (sym) => {
        const alpacaSym = toAlpacaSymbol(sym);
        const [trade, dailyRef] = await Promise.all([
          getLatestTrade(alpacaSym),
          getTickerDailyReference(alpacaSym),
        ]);

        if (!trade) return { symbol: sym, error: "no_data" };

        const price = trade.price;
        const prevClose = dailyRef.prevClose;
        const high = dailyRef.high ?? price;
        const low = dailyRef.low ?? price;
        const volume = dailyRef.volume ?? 0;

        const change = prevClose ? price - prevClose : 0;
        const changePct = prevClose ? (change / prevClose) * 100 : 0;

        return {
          symbol: sym,
          price,
          change: Math.round(change * 100) / 100,
          change_pct: Math.round(changePct * 100) / 100,
          high,
          low,
          volume,
          timestamp: trade.timestamp,
          direction: change >= 0 ? "up" : "down",
        };
      }),
    );

    const tickers = results.map((r) => (r.status === "fulfilled" ? r.value : { error: "fetch_failed" }));
    const payload = { tickers, fetched_at: new Date().toISOString() };
    _tickerCache.set(cacheKey, { data: payload, ts: Date.now() });
    return payload;
  })();

  _tickerInFlight.set(cacheKey, loadPromise);
  try {
    const payload = await loadPromise;
    res.setHeader("X-Cache", "MISS");
    res.json(payload);
  } finally {
    _tickerInFlight.delete(cacheKey);
  }
});

// ─── GET /api/alpaca/account ──────────────────────────────────────────────────
router.get("/alpaca/account", async (req, res) => {
  try {
    const account = await getAccount() as Record<string, string | number | boolean | null>;
    const accountNumber = String(account.account_number ?? "");
    const isPaper = accountNumber.startsWith("PA");

    res.json({
      status: account.status ?? null,
      crypto_status: account.crypto_status ?? null,
      currency: account.currency ?? "USD",
      buying_power: String(account.buying_power ?? "0"),
      cash: String(account.cash ?? "0"),
      portfolio_value: String(account.portfolio_value ?? account.equity ?? "0"),
      equity: String(account.equity ?? "0"),
      trading_blocked: Boolean(account.trading_blocked),
      account_blocked: Boolean(account.account_blocked),
      shorting_enabled: Boolean(account.shorting_enabled),
      options_trading_level: account.options_trading_level ?? null,
      is_paper: isPaper,
      mode: isPaper ? "paper" : "live",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get Alpaca account");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch account" });
  }
});

// ─── GET /api/alpaca/positions ────────────────────────────────────────────────
router.get("/alpaca/positions", async (req, res) => {
  try {
    const positions = await getPositions();
    res.json(positions);
  } catch (err) {
    req.log.error({ err }, "Failed to get Alpaca positions");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch positions" });
  }
});

// ─── POST /api/alpaca/orders — place a new order ─────────────────────────────
router.post("/alpaca/orders", async (req, res) => {
  try {
    if (!ensureTradingWriteAccess(req, res)) return;
    if (!hasValidTradingKey) {
      res.status(403).json({ error: "no_trading_key", message: "Trading API keys (PK/AK) required. Paper keys from app.alpaca.markets." });
      return;
    }
    const orderReq: PlaceOrderRequest = {
      symbol: String(req.body.symbol ?? "BTCUSD"),
      side: req.body.side,
      type: req.body.type ?? "market",
      time_in_force: req.body.time_in_force ?? "gtc",
    };
    if (req.body.qty !== undefined) orderReq.qty = Number(req.body.qty);
    if (req.body.notional !== undefined) orderReq.notional = Number(req.body.notional);
    if (req.body.limit_price !== undefined) orderReq.limit_price = Number(req.body.limit_price);
    if (req.body.stop_price !== undefined) orderReq.stop_price = Number(req.body.stop_price);
    if (req.body.stop_loss_price !== undefined) orderReq.stop_loss_price = Number(req.body.stop_loss_price);
    if (req.body.take_profit_price !== undefined) orderReq.take_profit_price = Number(req.body.take_profit_price);

    const order = await placeOrder(orderReq);
    req.log.info({ order_id: order.id, symbol: order.symbol, side: order.side }, "Order placed");
    res.json({ success: true, order });
  } catch (err) {
    req.log.error({ err }, "Failed to place order");
    res.status(500).json({ error: "order_failed", message: String(err) });
  }
});

// ─── GET /api/alpaca/orders — list open/recent orders ────────────────────────
router.get("/alpaca/orders", async (req, res) => {
  try {
    if (!hasValidTradingKey) {
      res.json({ orders: [], message: "Trading API keys required" });
      return;
    }
    const status = (req.query.status as "open" | "closed" | "all") ?? "open";
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const orders = await getOrders(status, limit);
    res.json({ orders, fetched_at: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch orders");
    res.status(500).json({ error: "orders_fetch_failed", message: String(err) });
  }
});

// ─── DELETE /api/alpaca/orders/:id — cancel a specific order ─────────────────
router.delete("/alpaca/orders/:id", async (req, res) => {
  try {
    if (!ensureTradingWriteAccess(req, res)) return;
    if (!hasValidTradingKey) { res.status(403).json({ error: "no_trading_key" }); return; }
    const result = await cancelOrder(req.params.id);
    res.json({ success: true, result });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel order");
    res.status(500).json({ error: "cancel_failed", message: String(err) });
  }
});

// ─── DELETE /api/alpaca/orders — cancel all open orders ──────────────────────
router.delete("/alpaca/orders", async (req, res) => {
  try {
    if (!ensureTradingWriteAccess(req, res)) return;
    if (!hasValidTradingKey) { res.status(403).json({ error: "no_trading_key" }); return; }
    const result = await cancelAllOrders();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: "cancel_all_failed", message: String(err) });
  }
});

// ─── GET /api/alpaca/positions/live — typed positions with P&L ───────────────
router.get("/alpaca/positions/live", async (req, res) => {
  try {
    const positions = await getTypedPositions();
    res.json({ positions, fetched_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "positions_fetch_failed", message: String(err) });
  }
});

// ─── DELETE /api/alpaca/positions/:symbol — close a position ─────────────────
router.delete("/alpaca/positions/:symbol", async (req, res) => {
  try {
    if (!ensureTradingWriteAccess(req, res)) return;
    if (!hasValidTradingKey) { res.status(403).json({ error: "no_trading_key" }); return; }
    const result = await closePosition(req.params.symbol);
    res.json({ success: true, result });
  } catch (err) {
    req.log.error({ err }, "Failed to close position");
    res.status(500).json({ error: "close_failed", message: String(err) });
  }
});

// ─── GET /api/alpaca/size — position size calculator ─────────────────────────
router.get("/alpaca/size", async (req, res) => {
  try {
    const equity = Number(req.query.equity ?? 10000);
    const riskPct = Number(req.query.risk_pct ?? 0.01);
    const entry = Number(req.query.entry ?? 0);
    const stopLoss = Number(req.query.stop_loss ?? 0);
    if (!entry || !stopLoss) {
      res.status(400).json({ error: "entry and stop_loss required" });
      return;
    }
    const qty = calcPositionSize(equity, riskPct, entry, stopLoss);
    const riskDollars = equity * riskPct;
    res.json({ qty, risk_dollars: riskDollars, entry, stop_loss: stopLoss, equity, risk_pct: riskPct });
  } catch (err) {
    res.status(500).json({ error: "size_calc_failed", message: String(err) });
  }
});

// ─── GET /api/alpaca/bars ─────────────────────────────────────────────────────
router.get("/alpaca/bars", async (req, res) => {
  try {
    const symbol = String(req.query.symbol ?? "BTCUSD");
    const timeframe = (req.query.timeframe as string) ?? "5Min";
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);
    const bars = await getBarsWithRateLimitFallback(
      symbol,
      timeframe as "1Min" | "5Min" | "15Min" | "1Hour" | "1Day",
      limit,
      { req },
    );
    res.json({ symbol, timeframe, bars });
  } catch (err) {
    req.log.error({ err }, "Failed to get bars");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch bars" });
  }
});

// ─── POST /api/alpaca/analyze — regime-aware live setup scan ──────────────────
router.post("/alpaca/analyze", async (req, res) => {
  try {
    const instrument = String(req.body.instrument ?? "BTCUSDT");
    const indicatorHints = parseIndicatorHints(req.body);
    const rawSetups: unknown[] = Array.isArray(req.body.setups) ? req.body.setups : DEFAULT_SETUPS;
    const parsedSetups: SetupType[] = rawSetups
      .map((value) => String(value ?? "").trim())
      .filter((value): value is SetupType => isSetupType(value));
    const setups: SetupType[] = parsedSetups.length > 0 ? Array.from(new Set(parsedSetups)) : DEFAULT_SETUPS;
    const cooldowns: SetupCooldowns = req.body.cooldowns ?? {};
    const alpacaSymbol = toAlpacaSymbol(instrument);

    // Fetch deeper bar history for better recall engine context
    // 200 × 1m = 3h 20m · 100 × 5m = 8h 20m · 60 × 15m = 15h
    const [bars1m, bars5m, bars15m] = await Promise.all([
      getBarsWithRateLimitFallback(alpacaSymbol, "1Min", 200, { req }),
      getBarsWithRateLimitFallback(alpacaSymbol, "5Min", 100, { req }),
      getBarsWithRateLimitFallback(alpacaSymbol, "15Min", 60, { req }),
    ]);

    // Asynchronously cache bars to DB (fire-and-forget — never blocks the scan)
    setImmediate(async () => {
      try {
        const toInsert = [
          ...bars1m.slice(-50).map((b) => ({ symbol: alpacaSymbol, timeframe: "1Min", bar_time: new Date(b.Timestamp), open: String(b.Open), high: String(b.High), low: String(b.Low), close: String(b.Close), volume: String(b.Volume), vwap: b.VWAP ? String(b.VWAP) : null })),
          ...bars5m.slice(-20).map((b) => ({ symbol: alpacaSymbol, timeframe: "5Min", bar_time: new Date(b.Timestamp), open: String(b.Open), high: String(b.High), low: String(b.Low), close: String(b.Close), volume: String(b.Volume), vwap: b.VWAP ? String(b.VWAP) : null })),
          ...bars15m.slice(-10).map((b) => ({ symbol: alpacaSymbol, timeframe: "15Min", bar_time: new Date(b.Timestamp), open: String(b.Open), high: String(b.High), low: String(b.Low), close: String(b.Close), volume: String(b.Volume), vwap: b.VWAP ? String(b.VWAP) : null })),
        ];
        await db.insert(marketBarsTable).values(toInsert).onConflictDoNothing();
      } catch { /* non-fatal — caching only */ }
    });

    if (bars1m.length < 20) {
      res.status(400).json({ error: "insufficient_data", message: "Not enough bars. Market may be closed." });
      return;
    }

    const recall = buildRecallFeatures(bars1m, bars5m, indicatorHints);
    const lastBar = bars1m[bars1m.length - 1];
    const atr = computeATR(bars1m);
    const entryPrice = Number(lastBar.Close);
    const regime = recall.regime;

    const detectedSetups = [];
    const blockedSetups = [];

    for (const setup of setups) {
      // Apply no-trade filters first
      const noTrade = applyNoTradeFilters(bars1m, recall, setup, cooldowns);
      if (noTrade.blocked) {
        blockedSetups.push({ setup_type: setup, reason: noTrade.reason });
        continue;
      }

      let result: { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number };
      if (setup === "absorption_reversal") {
        result = detectAbsorptionReversal(bars1m, bars5m, recall);
      } else if (setup === "sweep_reclaim") {
        result = detectSweepReclaim(bars1m, bars5m, recall);
      } else if (setup === "cvd_divergence") {
        result = detectCVDDivergence(bars1m, bars5m, recall);
      } else if (setup === "breakout_failure") {
        result = detectBreakoutFailure(bars1m, bars5m, recall);
      } else {
        result = detectContinuationPullback(bars1m, bars5m, recall);
      }

      if (!result.detected) continue;

      const recallScore = scoreRecall(recall, setup, result.direction);
      const finalQuality = computeFinalQuality(result.structure, result.orderFlow, recallScore, {
        recall,
        direction: result.direction,
        setup_type: setup,
      });
      const threshold = getQualityThreshold(regime, setup);
      const meetsThreshold = finalQuality >= threshold;

      const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, result.direction, atr, regime);

      const overlay = buildChartOverlay(
        setup, instrument, result.direction, result.structure, result.orderFlow,
        recall, finalQuality, threshold, entryPrice, stopLoss, takeProfit, lastBar.Timestamp
      );

      detectedSetups.push({
        instrument,
        alpaca_symbol: alpacaSymbol,
        setup_type: setup,
        bar_time: lastBar.Timestamp,
        direction: result.direction,
        structure_score: result.structure,
        order_flow_score: result.orderFlow,
        recall_score: recallScore,
        final_quality: finalQuality,
        quality_threshold: threshold,
        meets_threshold: meetsThreshold,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        tp_ticks: tpTicks,
        sl_ticks: slTicks,
        sk: recall.sk,
        cvd: recall.cvd,
        recall_features: recall,
        overlay,
        last_bar: lastBar,
        atr,
      });
    }

    // ── Claude Reasoning Veto Layer (Layer 6) ────────────────────────────────
    // Run all veto calls in parallel — never blocks if key is absent
    const claudeResults: ClaudeVetoResult[] = await Promise.all(
      detectedSetups.map((s) =>
        claudeVeto({
          instrument:            s.instrument,
          setup_type:            s.setup_type,
          direction:             s.direction,
          structure_score:       s.structure_score,
          order_flow_score:      s.order_flow_score,
          recall_score:          s.recall_score,
          final_quality:         s.final_quality,
          quality_threshold:     s.quality_threshold,
          entry_price:           s.entry_price,
          stop_loss:             s.stop_loss,
          take_profit:           s.take_profit,
          regime:                s.recall_features.regime,
          sk_bias:               s.recall_features.sk.bias,
          sk_in_zone:            s.recall_features.sk.in_zone,
          sk_sequence_stage:     s.recall_features.sk.sequence_stage,
          sk_correction_complete:s.recall_features.sk.correction_complete,
          cvd_slope:             s.recall_features.cvd.cvd_slope,
          cvd_divergence:        s.recall_features.cvd.cvd_divergence,
          buy_volume_ratio:      s.recall_features.cvd.buy_volume_ratio,
          wick_ratio:            s.recall_features.wick_ratio_5m,
          momentum_1m:           s.recall_features.momentum_1m,
          trend_slope_5m:        s.recall_features.trend_slope_5m,
          atr_pct:               s.recall_features.atr_pct,
          consec_bullish:        s.recall_features.consec_bullish,
          consec_bearish:        s.recall_features.consec_bearish,
        })
      )
    );

    // Enrich detected setups with Claude verdicts
    const enrichedSetups = detectedSetups.map((s, i) => {
      const cv = claudeResults[i];
      // Claude can escalate or downgrade meets_threshold
      const claudeApproved = cv.verdict === "APPROVED" || cv.verdict === "CAUTION";
      return {
        ...s,
        claude: {
          verdict:      cv.verdict,
          confidence:   cv.confidence,
          claude_score: cv.claude_score,
          reasoning:    cv.reasoning,
          key_factors:  cv.key_factors,
          latency_ms:   cv.latency_ms,
        },
        // Re-weight final quality with Claude score (10% weight)
        final_quality_with_claude: Math.min(0.9999,
          s.final_quality * 0.90 + cv.claude_score * 0.10
        ),
        // A setup is high-conviction only if it passes ALL layers including Claude
        meets_threshold: s.meets_threshold && claudeApproved,
      };
    });

    // Persist detected setups to signals table so Mission Control can count them
    if (enrichedSetups.length > 0) {
      const hour = new Date().getUTCHours();
      const session = hour >= 13 && hour < 22 ? "NY" : hour >= 7 && hour < 13 ? "London" : "Asian";
      try {
        await db.insert(signalsTable).values(
          enrichedSetups.map((s) => {
            const mlProb = Math.min(0.9999, predictWinProbability({ structure_score: s.structure_score, order_flow_score: s.order_flow_score, recall_score: s.recall_score, final_quality: s.final_quality_with_claude, setup_type: s.setup_type, regime: s.recall_features?.regime ?? "ranging", direction: s.direction }).probability);
            return {
              instrument:    s.instrument,
              setup_type:    s.setup_type,
              status:        s.meets_threshold ? "active" : "pending",
              structure_score:   s.structure_score.toFixed(4),
              order_flow_score:  s.order_flow_score.toFixed(4),
              recall_score:      s.recall_score.toFixed(4),
              ml_probability:    mlProb.toFixed(4),
              claude_score:      s.claude.claude_score.toFixed(4),
              final_quality:     s.final_quality_with_claude.toFixed(4),
              entry_price:       s.entry_price.toFixed(4),
              stop_loss:         s.stop_loss.toFixed(4),
              take_profit:       s.take_profit.toFixed(4),
              regime:            s.recall_features.regime,
              session,
            };
          })
        );
      } catch (dbErr) {
        req.log.warn({ dbErr }, "Failed to persist signals to DB (non-fatal)");
      }
    }

    res.json({
      instrument,
      alpaca_symbol: alpacaSymbol,
      indicator_hints: recall.indicator_hints,
      analyzed_at: new Date().toISOString(),
      regime,
      regime_label:     regime.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      bars_analyzed:    { "1m": bars1m.length, "5m": bars5m.length, "15m": bars15m.length },
      recall_features:  recall,
      setups_detected:  enrichedSetups.length,
      setups_blocked:   blockedSetups,
      setups:           enrichedSetups,
      high_conviction:  enrichedSetups.filter((s) => s.meets_threshold),
      claude_active:    isClaudeAvailable(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to analyze market");
    res.status(500).json({ error: "analysis_error", message: String(err) });
  }
});

function runSetupDetector(
  setup: SetupType,
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (setup === "absorption_reversal") return detectAbsorptionReversal(bars1m, bars5m, recall);
  if (setup === "sweep_reclaim") return detectSweepReclaim(bars1m, bars5m, recall);
  if (setup === "cvd_divergence") return detectCVDDivergence(bars1m, bars5m, recall);
  if (setup === "breakout_failure") return detectBreakoutFailure(bars1m, bars5m, recall);
  return detectContinuationPullback(bars1m, bars5m, recall);
}

// ─── POST /api/alpaca/backtest — walk-forward on recent bars ──────────────────
router.post("/alpaca/backtest", async (req, res) => {
  try {
    const instrument = String(req.body.instrument ?? "BTCUSDT");
    const indicatorHints = parseIndicatorHints(req.body);
    const setup: SetupType = req.body.setup_type ?? "absorption_reversal";
    const days = Math.min(Math.max(Number(req.body.days ?? 5), 1), 60);
    const includeClaudeHistory = String(req.body.include_claude_history ?? "true").toLowerCase() !== "false";
    const claudeHistoryMax = Math.min(Math.max(Number(req.body.claude_history_max ?? 40), 0), 120);
    const forwardBarsSetting = Math.min(Math.max(Number(req.body.forward_bars ?? 20), 10), 80);
    const alpacaSymbol = toAlpacaSymbol(instrument);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const endDate = new Date().toISOString();
    const maxBars1m = Math.min(Math.max(Number(req.body.max_bars_1m ?? days * 24 * 60 + 500), 2000), 50000);
    const maxBars5m = Math.min(Math.max(Number(req.body.max_bars_5m ?? days * 24 * 12 + 200), 600), 20000);

    const [bars1mRaw, bars5mRaw] = await Promise.all([
      getBarsHistorical(alpacaSymbol, "1Min", startDate.toISOString(), endDate, maxBars1m),
      getBarsHistorical(alpacaSymbol, "5Min", startDate.toISOString(), endDate, maxBars5m),
    ]);
    const bars1m = [...bars1mRaw].sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());
    const bars5m = [...bars5mRaw].sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());

    if (bars1m.length < 40) {
      res.status(400).json({ error: "insufficient_data", message: "Not enough historical data." });
      return;
    }

    const traceBars = toTraceBars(bars1m);
    const orderBlocks = detectOrderBlocks(bars1m);
    const results: Array<{
      bar_time: string;
      entry_price: number;
      direction: "long" | "short";
      structure_score: number;
      order_flow_score: number;
      recall_score: number;
      ml_probability: number;
      final_quality: number;
      final_quality_with_claude?: number;
      claude_verdict?: "APPROVED" | "VETOED" | "CAUTION";
      claude_score?: number;
      claude_confidence?: number;
      quality_threshold: number;
      meets_threshold: boolean;
      regime: string;
      tp: number;
      sl: number;
      tp_ticks: number;
      sl_ticks: number;
      outcome: "win" | "loss" | "open";
      hit_tp: boolean;
      bars_to_outcome: number;
      pnl_dollars: number;
      is_fake_entry: boolean;
      fake_entry_reason: string | null;
      adverse_move_pct: number;
    }> = [];
    const positionTrace: PositionTrace[] = [];
    const claudeCandidates: Array<{
      result_index: number;
      entry_time: string;
      direction: "long" | "short";
      context: SetupContext;
      rank_score: number;
    }> = [];
    const WINDOW_1M = 30;
    const FORWARD_BARS = forwardBarsSetting;
    const bars1mTimes = bars1m.map((bar) => new Date(bar.Timestamp).getTime());
    const bars5mTimes = bars5m.map((bar) => new Date(bar.Timestamp).getTime());
    let bars5mCursor = -1;

    for (let i = WINDOW_1M; i < bars1m.length - FORWARD_BARS; i++) {
      const window1m = bars1m.slice(i - WINDOW_1M, i);
      const windowTime = bars1mTimes[i];
      while (bars5mCursor + 1 < bars5mTimes.length && bars5mTimes[bars5mCursor + 1] <= windowTime) {
        bars5mCursor++;
      }
      if (bars5mCursor < 4) continue;
      const start5m = Math.max(0, bars5mCursor - 19);
      const closest5m = bars5m.slice(start5m, bars5mCursor + 1);
      if (closest5m.length < 5) continue;

      const recall = buildRecallFeatures(window1m, closest5m, indicatorHints);
      // replayMode: true — permissive backtest (no session/cooldown/spread gates, wide ATR cap)
      // Equivalent to RiskConfig replay overrides: max_spread_atr=99, require_session_active=False
      const noTrade = applyNoTradeFilters(window1m, recall, setup, { replayMode: true });
      if (noTrade.blocked) continue;

      const detected = runSetupDetector(setup, window1m, closest5m, recall);

      if (!detected.detected) continue;

      const entryBar = bars1m[i];
      const entryPrice = Number(entryBar.Close);
      const atr = computeATR(window1m);
      const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, detected.direction, atr, recall.regime);

      const forwardBars = bars1m.slice(i + 1, i + 1 + FORWARD_BARS);
      const outcome = checkForwardOutcome(entryPrice, detected.direction, takeProfit, stopLoss, forwardBars);
      const fakeEntry = detectFakeEntry(detected.direction, entryPrice, atr, forwardBars);

      const recallScore = scoreRecall(recall, setup, detected.direction);
      const finalQuality = computeFinalQuality(detected.structure, detected.orderFlow, recallScore, {
        recall,
        direction: detected.direction,
        setup_type: setup,
      });
      const threshold = getQualityThreshold(recall.regime, setup);
      const mlProbability = Math.min(1, predictWinProbability({ structure_score: detected.structure, order_flow_score: detected.orderFlow, recall_score: recallScore, final_quality: finalQuality, setup_type: setup, regime: recall.regime, direction: detected.direction }).probability);

      // Dollar P&L: tick_size derived from price level (crypto: BTC ~$5/tick, ETH ~$1/tick)
      const tickValue = entryPrice > 10000 ? 5 : entryPrice > 1000 ? 1 : 0.25;
      const pnlDollars = outcome.outcome === "win"
        ? tpTicks * tickValue
        : outcome.outcome === "loss"
        ? -(slTicks * tickValue)
        : 0;
      const exitIndex = outcome.outcome === "open"
        ? null
        : Math.min(i + Math.max(outcome.barsChecked, 1), bars1m.length - 1);
      const resultIndex = results.length;
      results.push({
        bar_time: entryBar.Timestamp,
        entry_price: entryPrice,
        direction: detected.direction,
        structure_score: detected.structure,
        order_flow_score: detected.orderFlow,
        recall_score: recallScore,
        ml_probability: mlProbability,
        final_quality: finalQuality,
        quality_threshold: threshold,
        meets_threshold: finalQuality >= threshold,
        regime: recall.regime,
        tp: takeProfit,
        sl: stopLoss,
        tp_ticks: tpTicks,
        sl_ticks: slTicks,
        outcome: outcome.outcome,
        hit_tp: outcome.hitTP,
        bars_to_outcome: outcome.barsChecked,
        pnl_dollars: pnlDollars,
        is_fake_entry: fakeEntry.isFakeEntry,
        fake_entry_reason: fakeEntry.reason,
        adverse_move_pct: fakeEntry.adverseMovePct,
      });
      positionTrace.push({
        entry_time: entryBar.Timestamp,
        exit_time: exitIndex === null ? null : bars1m[exitIndex]?.Timestamp ?? null,
        direction: detected.direction,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        outcome: outcome.outcome,
        pnl_dollars: pnlDollars,
        bars_to_outcome: outcome.barsChecked,
        is_fake_entry: fakeEntry.isFakeEntry,
        fake_entry_reason: fakeEntry.reason,
        final_quality: finalQuality,
        regime: recall.regime,
        ml_probability: mlProbability,
      });
      if (includeClaudeHistory) {
        claudeCandidates.push({
          result_index: resultIndex,
          entry_time: entryBar.Timestamp,
          direction: detected.direction,
          rank_score: finalQuality * 0.65 + recallScore * 0.2 + (1 - Math.min(fakeEntry.adverseMovePct / 3, 1)) * 0.15,
          context: {
            instrument,
            setup_type: setup,
            direction: detected.direction,
            structure_score: detected.structure,
            order_flow_score: detected.orderFlow,
            recall_score: recallScore,
            final_quality: finalQuality,
            quality_threshold: threshold,
            entry_price: entryPrice,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            regime: recall.regime,
            sk_bias: recall.sk.bias,
            sk_in_zone: recall.sk.in_zone,
            sk_sequence_stage: recall.sk.sequence_stage,
            sk_correction_complete: recall.sk.correction_complete,
            cvd_slope: recall.cvd.cvd_slope,
            cvd_divergence: recall.cvd.cvd_divergence,
            buy_volume_ratio: recall.cvd.buy_volume_ratio,
            wick_ratio: recall.wick_ratio_5m,
            momentum_1m: recall.momentum_1m,
            trend_slope_5m: recall.trend_slope_5m,
            atr_pct: recall.atr_pct,
            consec_bullish: recall.consec_bullish,
            consec_bearish: recall.consec_bearish,
          },
        });
      }
    }

    const claudeReviews: ClaudeHistoricalReview[] = [];
    if (includeClaudeHistory && claudeCandidates.length > 0 && claudeHistoryMax > 0) {
      const reviewTargets = [...claudeCandidates]
        .sort((a, b) => b.rank_score - a.rank_score)
        .slice(0, claudeHistoryMax);
      const reviewed = await Promise.all(
        reviewTargets.map(async (candidate) => ({
          candidate,
          review: await claudeVeto(candidate.context),
        }))
      );
      for (const item of reviewed) {
        const target = results[item.candidate.result_index];
        const position = positionTrace[item.candidate.result_index];
        if (target) {
          target.claude_verdict = item.review.verdict;
          target.claude_score = item.review.claude_score;
          target.claude_confidence = item.review.confidence;
          target.final_quality_with_claude = Math.min(0.9999, target.final_quality * 0.90 + item.review.claude_score * 0.10);
        }
        if (position) {
          position.claude_verdict = item.review.verdict;
          position.claude_score = item.review.claude_score;
          position.claude_confidence = item.review.confidence;
          position.final_quality_with_claude = Math.min(0.9999, position.final_quality * 0.90 + item.review.claude_score * 0.10);
        }
        claudeReviews.push({
          result_index: item.candidate.result_index,
          entry_time: item.candidate.entry_time,
          direction: item.candidate.direction,
          verdict: item.review.verdict,
          confidence: item.review.confidence,
          claude_score: item.review.claude_score,
          reasoning: item.review.reasoning,
          key_factors: item.review.key_factors,
          latency_ms: item.review.latency_ms,
        });
      }
    }

    if (results.length > 0) {
      await db.insert(accuracyResultsTable).values(
        results.map((r) => ({
          symbol: alpacaSymbol,
          setup_type: setup,
          timeframe: "1Min",
          bar_time: new Date(r.bar_time),
          signal_detected: "true",
          structure_score: String(r.structure_score.toFixed(4)),
          order_flow_score: String(r.order_flow_score.toFixed(4)),
          recall_score: String(r.recall_score.toFixed(4)),
          final_quality: String(r.final_quality.toFixed(4)),
          outcome: r.outcome,
          tp_ticks: r.tp_ticks,
          sl_ticks: r.sl_ticks,
          hit_tp: String(r.hit_tp),
          forward_bars_checked: r.bars_to_outcome,
          regime: r.regime,
          direction: r.direction,
        }))
      );
    }

    const closed = results.filter((r) => r.outcome !== "open");
    const wins = closed.filter((r) => r.outcome === "win");
    const losses = closed.filter((r) => r.outcome === "loss");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const avgQuality = results.length > 0 ? results.reduce((s, r) => s + r.final_quality, 0) / results.length : 0;
    const grossWin = wins.reduce((s, r) => s + r.tp_ticks, 0);
    const grossLoss = losses.reduce((s, r) => s + r.sl_ticks, 0);
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
    const expectancy = closed.length > 0
      ? (winRate * (wins.length > 0 ? grossWin / wins.length : 0)) -
        ((1 - winRate) * (losses.length > 0 ? grossLoss / losses.length : 0))
      : 0;
    // Dollar P&L summary
    const grossPnlDollars = results.reduce((s, r) => s + r.pnl_dollars, 0);
    const avgWinDollars = wins.length > 0 ? wins.reduce((s, r) => s + r.pnl_dollars, 0) / wins.length : 0;
    const avgLossDollars = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r.pnl_dollars, 0) / losses.length) : 0;
    const expectancyDollars = closed.length > 0
      ? (winRate * avgWinDollars) - ((1 - winRate) * avgLossDollars)
      : 0;
    // Equity curve (cumulative P&L per closed trade)
    let cumulativePnl = 0;
    const equityCurve = closed.map((r) => {
      cumulativePnl += r.pnl_dollars;
      return { date: r.bar_time.slice(0, 10), pnl: r.pnl_dollars, equity: Math.round(cumulativePnl * 100) / 100 };
    });
    const fakeEntries = results.filter((r) => r.is_fake_entry);
    const fakeClosed = fakeEntries.filter((r) => r.outcome !== "open");
    const fakeLosses = fakeClosed.filter((r) => r.outcome === "loss");
    const claudeReviewed = results.filter((r) => r.claude_verdict);
    const claudeClosed = claudeReviewed.filter((r) => r.outcome !== "open");
    const claudeWins = claudeClosed.filter((r) => r.outcome === "win");
    const traceFakeEntries = positionTrace.filter((p) => p.is_fake_entry);

    const hq = results.filter((r) => r.meets_threshold);
    const hqClosed = hq.filter((r) => r.outcome !== "open");
    const hqWins = hqClosed.filter((r) => r.outcome === "win");

    // By regime breakdown
    const byRegime: Record<string, { wins: number; total: number }> = {};
    for (const r of closed) {
      if (!byRegime[r.regime]) byRegime[r.regime] = { wins: 0, total: 0 };
      byRegime[r.regime].total++;
      if (r.outcome === "win") byRegime[r.regime].wins++;
    }

    res.json({
      instrument,
      alpaca_symbol: alpacaSymbol,
      indicator_hints: indicatorHints,
      setup_type: setup,
      days_analyzed: days,
      bars_scanned: bars1m.length,
      total_signals: results.length,
      closed_signals: closed.length,
      wins: wins.length,
      losses: losses.length,
      win_rate: winRate,
      history_range: { start: startDate.toISOString(), end: endDate },
      profit_factor: profitFactor,
      expectancy_ticks: expectancy,
      expectancy_dollars: Math.round(expectancyDollars * 100) / 100,
      gross_pnl_dollars: Math.round(grossPnlDollars * 100) / 100,
      avg_win_dollars: Math.round(avgWinDollars * 100) / 100,
      avg_loss_dollars: Math.round(avgLossDollars * 100) / 100,
      avg_final_quality: avgQuality,
      fake_entries: fakeEntries.length,
      fake_entry_rate: results.length > 0 ? fakeEntries.length / results.length : 0,
      fake_entry_loss_rate: fakeClosed.length > 0 ? fakeLosses.length / fakeClosed.length : 0,
      claude_reviewed_signals: claudeReviewed.length,
      claude_win_rate: claudeClosed.length > 0 ? claudeWins.length / claudeClosed.length : 0,
      high_conviction_signals: hq.length,
      high_conviction_win_rate: hqClosed.length > 0 ? hqWins.length / hqClosed.length : 0,
      equity_curve: equityCurve,
      by_regime: Object.entries(byRegime).map(([regime, d]) => ({
        regime,
        total: d.total,
        wins: d.wins,
        win_rate: d.total > 0 ? d.wins / d.total : 0,
      })),
      results: results.slice(-200).reverse(),
      backtest_trace: {
        bars: traceBars,
        order_blocks: orderBlocks,
        positions: positionTrace,
        fake_entries: traceFakeEntries,
        claude_reviews: claudeReviews,
        claude_reviewed_signals: claudeReviews.length,
        claude_backtest_enabled: includeClaudeHistory,
      },
      saved_to_db: results.length,
    });
  } catch (err) {
    req.log.error({ err }, "Backtest failed");
    res.status(500).json({ error: "backtest_error", message: String(err) });
  }
});

// ─── POST /api/alpaca/backtest-batch — multi-symbol, multi-setup learning ───
router.post("/alpaca/backtest-batch", async (req, res) => {
  try {
    const rawSymbols = req.body.symbols;
    const parsedSymbols: unknown[] = Array.isArray(rawSymbols)
      ? rawSymbols
      : typeof rawSymbols === "string"
      ? rawSymbols.split(",")
      : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "MES", "MNQ"];
    const uniqueSymbols = Array.from(
      new Set(
        parsedSymbols
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      )
    ).slice(0, 12);

    const rawSetups: unknown[] = Array.isArray(req.body.setups) ? req.body.setups : DEFAULT_SETUPS;
    const setups = rawSetups
      .map((value) => String(value ?? "").trim())
      .filter((value): value is SetupType => isSetupType(value));
    const setupList: SetupType[] = setups.length > 0 ? Array.from(new Set(setups)) : DEFAULT_SETUPS;

    const days = Math.min(Math.max(Number(req.body.days ?? 5), 1), 60);
    const indicatorHints = parseIndicatorHints(req.body);
    const forwardBarsSetting = Math.min(Math.max(Number(req.body.forward_bars ?? 20), 10), 80);
    const includeClaudeHistory = String(req.body.include_claude_history ?? "false").toLowerCase() === "true";
    const claudeSamplePerSetup = Math.min(Math.max(Number(req.body.claude_sample_per_setup ?? 6), 0), 30);
    const maxBars1m = Math.min(Math.max(Number(req.body.max_bars_1m ?? days * 24 * 60 + 500), 2000), 50000);
    const maxBars5m = Math.min(Math.max(Number(req.body.max_bars_5m ?? days * 24 * 12 + 200), 600), 20000);

    type BatchSetupSummary = {
      setup_type: SetupType;
      total_signals: number;
      closed_signals: number;
      wins: number;
      losses: number;
      win_rate: number;
      profit_factor: number;
      gross_pnl_dollars: number;
      expectancy_dollars: number;
      fake_entries: number;
      fake_entry_rate: number;
      high_conviction_signals: number;
      high_conviction_win_rate: number;
      claude_reviewed: number;
      claude_approved_rate: number;
      rank_score: number;
    };
    type BatchSymbolSummary = {
      instrument: string;
      alpaca_symbol: string;
      status: "ok" | "insufficient_data";
      bars_scanned: number;
      setup_summaries: BatchSetupSummary[];
      best_setup: BatchSetupSummary | null;
    };

    const startedAt = Date.now();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startIso = startDate.toISOString();
    const endIso = new Date().toISOString();

    const symbolSummaries: BatchSymbolSummary[] = [];
    let aggregateSignals = 0;
    let aggregateClosed = 0;
    let aggregateWins = 0;
    let aggregateLosses = 0;
    let aggregatePnl = 0;
    let aggregateFakeEntries = 0;
    let aggregateClaudeReviewed = 0;
    let aggregateHighConviction = 0;

    for (const instrument of uniqueSymbols) {
      const alpacaSymbol = toAlpacaSymbol(instrument);
      const [bars1mRaw, bars5mRaw] = await Promise.all([
        getBarsHistorical(alpacaSymbol, "1Min", startIso, endIso, maxBars1m),
        getBarsHistorical(alpacaSymbol, "5Min", startIso, endIso, maxBars5m),
      ]);
      const bars1m = [...bars1mRaw].sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());
      const bars5m = [...bars5mRaw].sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());

      if (bars1m.length < 40 || bars5m.length < 10) {
        symbolSummaries.push({
          instrument,
          alpaca_symbol: alpacaSymbol,
          status: "insufficient_data",
          bars_scanned: bars1m.length,
          setup_summaries: [],
          best_setup: null,
        });
        continue;
      }

      const bars1mTimes = bars1m.map((bar) => new Date(bar.Timestamp).getTime());
      const bars5mTimes = bars5m.map((bar) => new Date(bar.Timestamp).getTime());
      const setupSummaries: BatchSetupSummary[] = [];

      for (const setup of setupList) {
        const results: Array<{
          entry_time: string;
          direction: "long" | "short";
          final_quality: number;
          meets_threshold: boolean;
          outcome: "win" | "loss" | "open";
          tp_ticks: number;
          sl_ticks: number;
          pnl_dollars: number;
          is_fake_entry: boolean;
          regime: string;
        }> = [];
        const claudeCandidates: Array<{ rank: number; context: SetupContext }> = [];

        const WINDOW_1M = 30;
        const FORWARD_BARS = forwardBarsSetting;
        let bars5mCursor = -1;

        for (let i = WINDOW_1M; i < bars1m.length - FORWARD_BARS; i++) {
          const window1m = bars1m.slice(i - WINDOW_1M, i);
          const windowTime = bars1mTimes[i];
          while (bars5mCursor + 1 < bars5mTimes.length && bars5mTimes[bars5mCursor + 1] <= windowTime) {
            bars5mCursor++;
          }
          if (bars5mCursor < 4) continue;

          const start5m = Math.max(0, bars5mCursor - 19);
          const closest5m = bars5m.slice(start5m, bars5mCursor + 1);
          if (closest5m.length < 5) continue;

          const recall = buildRecallFeatures(window1m, closest5m, indicatorHints);
          const noTrade = applyNoTradeFilters(window1m, recall, setup, { replayMode: true });
          if (noTrade.blocked) continue;

          const detected = runSetupDetector(setup, window1m, closest5m, recall);
          if (!detected.detected) continue;

          const entryBar = bars1m[i];
          const entryPrice = Number(entryBar.Close);
          const atr = computeATR(window1m);
          const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, detected.direction, atr, recall.regime);

          const forwardBars = bars1m.slice(i + 1, i + 1 + FORWARD_BARS);
          const outcome = checkForwardOutcome(entryPrice, detected.direction, takeProfit, stopLoss, forwardBars);
          const fakeEntry = detectFakeEntry(detected.direction, entryPrice, atr, forwardBars);

          const recallScore = scoreRecall(recall, setup, detected.direction);
          const finalQuality = computeFinalQuality(detected.structure, detected.orderFlow, recallScore, {
            recall,
            direction: detected.direction,
            setup_type: setup,
          });
          const threshold = getQualityThreshold(recall.regime, setup);

          const tickValue = entryPrice > 10000 ? 5 : entryPrice > 1000 ? 1 : 0.25;
          const pnlDollars = outcome.outcome === "win"
            ? tpTicks * tickValue
            : outcome.outcome === "loss"
            ? -(slTicks * tickValue)
            : 0;

          results.push({
            entry_time: entryBar.Timestamp,
            direction: detected.direction,
            final_quality: finalQuality,
            meets_threshold: finalQuality >= threshold,
            outcome: outcome.outcome,
            tp_ticks: tpTicks,
            sl_ticks: slTicks,
            pnl_dollars: pnlDollars,
            is_fake_entry: fakeEntry.isFakeEntry,
            regime: recall.regime,
          });

          if (includeClaudeHistory) {
            claudeCandidates.push({
              rank:
                finalQuality * 0.55 +
                (1 - recall.fake_entry_risk) * 0.25 +
                (1 - Math.min(fakeEntry.adverseMovePct / 2.5, 1)) * 0.2,
              context: {
                instrument,
                setup_type: setup,
                direction: detected.direction,
                structure_score: detected.structure,
                order_flow_score: detected.orderFlow,
                recall_score: recallScore,
                final_quality: finalQuality,
                quality_threshold: threshold,
                entry_price: entryPrice,
                stop_loss: stopLoss,
                take_profit: takeProfit,
                regime: recall.regime,
                sk_bias: recall.sk.bias,
                sk_in_zone: recall.sk.in_zone,
                sk_sequence_stage: recall.sk.sequence_stage,
                sk_correction_complete: recall.sk.correction_complete,
                cvd_slope: recall.cvd.cvd_slope,
                cvd_divergence: recall.cvd.cvd_divergence,
                buy_volume_ratio: recall.cvd.buy_volume_ratio,
                wick_ratio: recall.wick_ratio_5m,
                momentum_1m: recall.momentum_1m,
                trend_slope_5m: recall.trend_slope_5m,
                atr_pct: recall.atr_pct,
                consec_bullish: recall.consec_bullish,
                consec_bearish: recall.consec_bearish,
              },
            });
          }
        }

        const closed = results.filter((result) => result.outcome !== "open");
        const wins = closed.filter((result) => result.outcome === "win");
        const losses = closed.filter((result) => result.outcome === "loss");
        const winRate = closed.length > 0 ? wins.length / closed.length : 0;
        const grossWinTicks = wins.reduce((sum, result) => sum + result.tp_ticks, 0);
        const grossLossTicks = losses.reduce((sum, result) => sum + result.sl_ticks, 0);
        const profitFactor = grossLossTicks > 0 ? grossWinTicks / grossLossTicks : grossWinTicks > 0 ? 999 : 0;
        const grossPnlDollars = results.reduce((sum, result) => sum + result.pnl_dollars, 0);
        const avgWinDollars = wins.length > 0 ? wins.reduce((sum, result) => sum + result.pnl_dollars, 0) / wins.length : 0;
        const avgLossDollars = losses.length > 0 ? Math.abs(losses.reduce((sum, result) => sum + result.pnl_dollars, 0) / losses.length) : 0;
        const expectancyDollars = closed.length > 0 ? (winRate * avgWinDollars) - ((1 - winRate) * avgLossDollars) : 0;
        const fakeEntries = results.filter((result) => result.is_fake_entry);
        const highConviction = results.filter((result) => result.meets_threshold);
        const highConvictionClosed = highConviction.filter((result) => result.outcome !== "open");
        const highConvictionWins = highConvictionClosed.filter((result) => result.outcome === "win");
        const highConvictionWinRate = highConvictionClosed.length > 0 ? highConvictionWins.length / highConvictionClosed.length : 0;
        const fakeEntryRate = results.length > 0 ? fakeEntries.length / results.length : 0;

        let claudeReviewed = 0;
        let claudeApprovedRate = 0;
        if (includeClaudeHistory && claudeSamplePerSetup > 0 && claudeCandidates.length > 0) {
          const reviewTargets = [...claudeCandidates]
            .sort((a, b) => b.rank - a.rank)
            .slice(0, claudeSamplePerSetup);
          const reviews = await Promise.all(reviewTargets.map((target) => claudeVeto(target.context)));
          claudeReviewed = reviews.length;
          const approved = reviews.filter((review) => review.verdict === "APPROVED" || review.verdict === "CAUTION").length;
          claudeApprovedRate = claudeReviewed > 0 ? approved / claudeReviewed : 0;
        }

        const rankScore =
          expectancyDollars * 0.45 +
          winRate * 18 +
          (1 - fakeEntryRate) * 9 +
          highConvictionWinRate * 8 +
          Math.log(results.length + 1) * 2;

        setupSummaries.push({
          setup_type: setup,
          total_signals: results.length,
          closed_signals: closed.length,
          wins: wins.length,
          losses: losses.length,
          win_rate: winRate,
          profit_factor: profitFactor,
          gross_pnl_dollars: Math.round(grossPnlDollars * 100) / 100,
          expectancy_dollars: Math.round(expectancyDollars * 100) / 100,
          fake_entries: fakeEntries.length,
          fake_entry_rate: fakeEntryRate,
          high_conviction_signals: highConviction.length,
          high_conviction_win_rate: highConvictionWinRate,
          claude_reviewed: claudeReviewed,
          claude_approved_rate: claudeApprovedRate,
          rank_score: Math.round(rankScore * 1000) / 1000,
        } satisfies BatchSetupSummary);

        aggregateSignals += results.length;
        aggregateClosed += closed.length;
        aggregateWins += wins.length;
        aggregateLosses += losses.length;
        aggregatePnl += grossPnlDollars;
        aggregateFakeEntries += fakeEntries.length;
        aggregateClaudeReviewed += claudeReviewed;
        aggregateHighConviction += highConviction.length;
      }

      const orderedSetups = [...setupSummaries].sort(
        (a, b) => Number((b.rank_score as number) ?? 0) - Number((a.rank_score as number) ?? 0)
      );
      const bestSetup = orderedSetups.length > 0 ? orderedSetups[0] : null;

      symbolSummaries.push({
        instrument,
        alpaca_symbol: alpacaSymbol,
        status: "ok",
        bars_scanned: bars1m.length,
        setup_summaries: orderedSetups,
        best_setup: bestSetup,
      });
    }

    res.json({
      symbols_requested: uniqueSymbols,
      setups_requested: setupList,
      days_analyzed: days,
      history_range: { start: startIso, end: endIso },
      indicator_hints: indicatorHints,
      claude_enabled: includeClaudeHistory,
      generated_at: new Date().toISOString(),
      runtime_ms: Date.now() - startedAt,
      symbol_summaries: symbolSummaries,
      aggregate: {
        symbols_completed: symbolSummaries.filter((summary) => summary.status === "ok").length,
        symbols_failed: symbolSummaries.filter((summary) => summary.status !== "ok").length,
        total_signals: aggregateSignals,
        closed_signals: aggregateClosed,
        wins: aggregateWins,
        losses: aggregateLosses,
        win_rate: aggregateClosed > 0 ? aggregateWins / aggregateClosed : 0,
        gross_pnl_dollars: Math.round(aggregatePnl * 100) / 100,
        fake_entries: aggregateFakeEntries,
        fake_entry_rate: aggregateSignals > 0 ? aggregateFakeEntries / aggregateSignals : 0,
        claude_reviewed_signals: aggregateClaudeReviewed,
        high_conviction_signals: aggregateHighConviction,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Batch backtest failed");
    res.status(500).json({ error: "batch_backtest_error", message: String(err) });
  }
});

// ─── POST /api/alpaca/recall-build — multi-year historical recall ─────────────
// Fetches paginated historical bars (up to 2 years) and runs full walk-forward
// to build the accuracy recall database.
router.post("/alpaca/recall-build", async (req, res) => {
  try {
    const rawSymbols: string[] = req.body.symbols ?? ["BTCUSD", "ETHUSD"];
    const symbols = Array.from(
      new Set(
        rawSymbols
          .map((symbol) => toAlpacaSymbol(String(symbol ?? "")))
          .filter((symbol) => symbol.length > 0)
      )
    );
    const timeframe = (req.body.timeframe ?? "15Min") as "5Min" | "15Min" | "1Hour";
    const yearsBack = Math.min(Number(req.body.years ?? 1), 2);
    const indicatorHints = parseIndicatorHints(req.body);
    const setupTypes: SetupType[] = DEFAULT_SETUPS;

    const end = new Date().toISOString();
    const start = new Date();
    start.setFullYear(start.getFullYear() - yearsBack);
    const startStr = start.toISOString();

    const summary: Record<string, unknown> = {};
    let totalSaved = 0;

    for (const symbol of symbols) {
      req.log.info({ symbol, timeframe, yearsBack }, "Starting recall build");

      const bars = await getBarsHistorical(symbol, timeframe, startStr, end, 50000);

      if (bars.length < 50) {
        summary[symbol] = { error: "insufficient_data", bars: bars.length };
        continue;
      }

      // Use 15-min bars as "fast" and 1-hour equivalent (every 4th) as "slow"
      const slowBars = bars.filter((_, i) => i % 4 === 0);
      const WINDOW = 30;
      const FORWARD = 20;
      const results = [];

      for (let i = WINDOW; i < bars.length - FORWARD; i++) {
        const window = bars.slice(i - WINDOW, i);
        const windowTime = new Date(bars[i].Timestamp).getTime();
        const slowContext = slowBars.filter((b) => new Date(b.Timestamp).getTime() <= windowTime).slice(-20);
        if (slowContext.length < 5) continue;

        const recall = buildRecallFeatures(window, slowContext, indicatorHints);
        const atr = computeATR(window);
        const entryBar = bars[i];
        const entryPrice = entryBar.Close;

        for (const setup of setupTypes) {
          // replayMode: true — skip live-only gates (session, cooldown, spread, CVD strict gate)
          const noTrade = applyNoTradeFilters(window, recall, setup, { replayMode: true });
          if (noTrade.blocked) continue;

          const detected = runSetupDetector(setup, window, slowContext, recall);

          if (!detected.detected) continue;

          const recallScore = scoreRecall(recall, setup, detected.direction);
          const finalQuality = computeFinalQuality(detected.structure, detected.orderFlow, recallScore, {
            recall,
            direction: detected.direction,
            setup_type: setup,
          });
          const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, detected.direction, atr, recall.regime);
          const forwardBars = bars.slice(i, i + FORWARD);
          const outcome = checkForwardOutcome(entryPrice, detected.direction, takeProfit, stopLoss, forwardBars);

          results.push({
            symbol,
            setup_type: setup,
            timeframe,
            bar_time: new Date(entryBar.Timestamp),
            signal_detected: "true",
            structure_score: String(detected.structure.toFixed(4)),
            order_flow_score: String(detected.orderFlow.toFixed(4)),
            recall_score: String(recallScore.toFixed(4)),
            final_quality: String(finalQuality.toFixed(4)),
            outcome: outcome.outcome,
            tp_ticks: tpTicks,
            sl_ticks: slTicks,
            hit_tp: String(outcome.hitTP),
            forward_bars_checked: outcome.barsChecked,
            regime: recall.regime,
            direction: detected.direction,
          });
        }
      }

      // Batch insert in chunks of 500
      const CHUNK = 500;
      for (let i = 0; i < results.length; i += CHUNK) {
        await db.insert(accuracyResultsTable).values(results.slice(i, i + CHUNK));
      }

      totalSaved += results.length;

      const closed = results.filter((r) => r.outcome !== "open");
      const wins = closed.filter((r) => r.outcome === "win");
      const bySetup: Record<string, { wins: number; total: number }> = {};
      for (const r of closed) {
        if (!bySetup[r.setup_type]) bySetup[r.setup_type] = { wins: 0, total: 0 };
        bySetup[r.setup_type].total++;
        if (r.outcome === "win") bySetup[r.setup_type].wins++;
      }

      summary[symbol] = {
        bars_fetched: bars.length,
        signals_detected: results.length,
        closed: closed.length,
        wins: wins.length,
        win_rate: closed.length > 0 ? (wins.length / closed.length).toFixed(3) : "0",
        by_setup: Object.entries(bySetup).map(([s, d]) => ({
          setup: s,
          total: d.total,
          wins: d.wins,
          win_rate: d.total > 0 ? (d.wins / d.total).toFixed(3) : "0",
        })),
        date_range: { start: startStr, end },
        timeframe,
      };
    }

    res.json({
      status: "complete",
      symbols_processed: symbols.length,
      total_records_saved: totalSaved,
      years_back: yearsBack,
      indicator_hints: indicatorHints,
      summary,
    });
  } catch (err) {
    req.log.error({ err }, "Recall build failed");
    res.status(500).json({ error: "recall_build_error", message: String(err) });
  }
});

// ─── GET /api/alpaca/accuracy — historical accuracy from DB ──────────────────
router.get("/alpaca/accuracy", async (req, res) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const setup = req.query.setup_type as string | undefined;

    const conditions = [];
    if (symbol) conditions.push(eq(accuracyResultsTable.symbol, symbol));
    if (setup) conditions.push(eq(accuracyResultsTable.setup_type, setup));

    const rows: AccuracyResultRow[] = await db
      .select()
      .from(accuracyResultsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(accuracyResultsTable.created_at))
      .limit(1000);

    const closed = rows.filter((r) => r.outcome !== "open" && r.outcome !== null);
    const wins = closed.filter((r) => r.outcome === "win");
    const losses = closed.filter((r) => r.outcome === "loss");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const grossWin = wins.reduce((s, r) => s + (r.tp_ticks ?? 0), 0);
    const grossLoss = losses.reduce((s, r) => s + (r.sl_ticks ?? 0), 0);
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

    const bySetup: Record<string, { wins: number; total: number; sumQuality: number }> = {};
    for (const r of closed) {
      const k = r.setup_type;
      if (!bySetup[k]) bySetup[k] = { wins: 0, total: 0, sumQuality: 0 };
      bySetup[k].total++;
      bySetup[k].sumQuality += Number(r.final_quality);
      if (r.outcome === "win") bySetup[k].wins++;
    }

    const bySymbol: Record<string, { wins: number; total: number }> = {};
    for (const r of closed) {
      const k = r.symbol;
      if (!bySymbol[k]) bySymbol[k] = { wins: 0, total: 0 };
      bySymbol[k].total++;
      if (r.outcome === "win") bySymbol[k].wins++;
    }

    const byRegime: Record<string, { wins: number; total: number; sumQuality: number }> = {};
    for (const r of closed) {
      const k = r.regime ?? "unknown";
      if (!byRegime[k]) byRegime[k] = { wins: 0, total: 0, sumQuality: 0 };
      byRegime[k].total++;
      byRegime[k].sumQuality += Number(r.final_quality);
      if (r.outcome === "win") byRegime[k].wins++;
    }

    // Expectancy per setup (in ticks)
    const expectancyBySetup: Record<string, number> = {};
    for (const [st, d] of Object.entries(bySetup)) {
      const setupClosed = closed.filter((r: AccuracyResultRow) => r.setup_type === st);
      const setupWins = setupClosed.filter((r: AccuracyResultRow) => r.outcome === "win");
      const setupLosses = setupClosed.filter((r: AccuracyResultRow) => r.outcome === "loss");
      const wr = d.total > 0 ? d.wins / d.total : 0;
      const avgWinTicks = setupWins.length > 0 ? setupWins.reduce((s, r) => s + (r.tp_ticks ?? 0), 0) / setupWins.length : 0;
      const avgLossTicks = setupLosses.length > 0 ? setupLosses.reduce((s, r) => s + (r.sl_ticks ?? 0), 0) / setupLosses.length : 0;
      expectancyBySetup[st] = wr * avgWinTicks - (1 - wr) * avgLossTicks;
    }

    res.json({
      total_records: rows.length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      win_rate: winRate,
      profit_factor: profitFactor,
      by_setup: Object.entries(bySetup).map(([setup_type, d]) => ({
        setup_type,
        total: d.total,
        wins: d.wins,
        win_rate: d.total > 0 ? d.wins / d.total : 0,
        avg_quality: d.total > 0 ? d.sumQuality / d.total : 0,
        expectancy_ticks: Math.round((expectancyBySetup[setup_type] ?? 0) * 10) / 10,
      })),
      by_symbol: Object.entries(bySymbol).map(([sym, d]) => ({
        symbol: sym,
        total: d.total,
        wins: d.wins,
        win_rate: d.total > 0 ? d.wins / d.total : 0,
      })),
      by_regime: Object.entries(byRegime).map(([regime, d]) => ({
        regime,
        total: d.total,
        wins: d.wins,
        win_rate: d.total > 0 ? d.wins / d.total : 0,
        avg_quality: d.total > 0 ? d.sumQuality / d.total : 0,
      })).sort((a, b) => b.total - a.total),
      recent: rows.slice(0, 50),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get accuracy");
    res.status(500).json({ error: "accuracy_error", message: String(err) });
  }
});

// ─── Diagnostics bar cache (prevent 429 from repeated getBars calls) ─────────
let _diagBarsCache: { bars1m: AlpacaBar[]; bars5m: AlpacaBar[]; ts: number } = { bars1m: [], bars5m: [], ts: 0 };
const DIAG_BARS_TTL = 30_000; // 30 seconds — matches frontend polling interval

async function getCachedDiagBars(): Promise<{ bars1m: AlpacaBar[]; bars5m: AlpacaBar[] }> {
  if (Date.now() - _diagBarsCache.ts < DIAG_BARS_TTL) {
    return { bars1m: _diagBarsCache.bars1m, bars5m: _diagBarsCache.bars5m };
  }
  const [bars1m, bars5m] = await Promise.all([
    getBarsWithRateLimitFallback("BTCUSD", "1Min", 5).catch(() => [] as AlpacaBar[]),
    getBarsWithRateLimitFallback("BTCUSD", "5Min", 40).catch(() => [] as AlpacaBar[]),
  ]);
  _diagBarsCache = { bars1m, bars5m, ts: Date.now() };
  return { bars1m, bars5m };
}

// ─── GET /api/system/diagnostics ─────────────────────────────────────────────
router.get("/system/diagnostics", async (req, res) => {
  const layers: Record<string, { status: "live" | "degraded" | "offline"; detail: string }> = {};

  // Fetch bars once (cached) for both data-feed and strategy-engine checks
  let bars1m: AlpacaBar[] = [];
  let bars5m: AlpacaBar[] = [];
  try {
    const cached = await getCachedDiagBars();
    bars1m = cached.bars1m;
    bars5m = cached.bars5m;
  } catch (_) {
    // handled per-layer below
  }

  // Layer 1: Data Feed (Alpaca crypto — always available)
  try {
    layers.data_feed = bars1m.length > 0
      ? { status: "live", detail: `Crypto feed active — ${bars1m.length} bars returned` }
      : { status: "degraded", detail: "Feed responded but returned no bars" };
  } catch (e) {
    layers.data_feed = { status: "offline", detail: String(e) };
  }

  // Layer 2: Trading API (stocks)
  layers.trading_api = hasValidTradingKey
    ? { status: "live", detail: "Trading API keys present (PK/AK)" }
    : isBrokerKey
    ? { status: "degraded", detail: "Broker API keys detected — stock data unavailable, use Trading API keys" }
    : { status: "offline", detail: "No API keys configured" };

  // Layer 3: Strategy Engine (uses cached 5m bars)
  try {
    if (bars5m.length >= 20) {
      const recall = buildRecallFeatures(bars5m, bars5m.slice(-20));
      const regime = detectRegime(bars5m);
      layers.strategy_engine = {
        status: "live",
        detail: `Regime detection: ${regime} · Recall features: ${Object.keys(recall).length} features`,
      };
    } else {
      layers.strategy_engine = { status: "degraded", detail: bars5m.length === 0 ? "Alpaca feed unavailable" : "Not enough bars for full engine" };
    }
  } catch (e) {
    layers.strategy_engine = { status: "offline", detail: String(e) };
  }

  // Layer 4: Database
  try {
    const [accCount] = await db.select({ count: count() }).from(accuracyResultsTable);
    layers.database = { status: "live", detail: `PostgreSQL connected · ${accCount.count} accuracy records` };
  } catch (e) {
    layers.database = { status: "offline", detail: String(e) };
  }

  // Layer 5: Recall / Accuracy DB
  try {
    const recent: AccuracyResultRow[] = await db
      .select()
      .from(accuracyResultsTable)
      .orderBy(desc(accuracyResultsTable.created_at))
      .limit(200);

    const closed = recent.filter((r) => r.outcome !== "open" && r.outcome !== null);
    const wins = closed.filter((r) => r.outcome === "win");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const [total] = await db.select({ count: count() }).from(accuracyResultsTable);

    layers.recall_engine = {
      status: total.count > 0 ? "live" : "degraded",
      detail: total.count > 0
        ? `${total.count} total records · Recent win rate: ${(winRate * 100).toFixed(1)}% (${closed.length} closed)`
        : "No recall data yet — run 'Build Recall' to populate",
    };
  } catch (e) {
    layers.recall_engine = { status: "offline", detail: String(e) };
  }

  // Layer 6: ML Model — trained logistic regression or heuristic fallback
  const mlStatus = getModelStatus();
  layers.ml_model = {
    status: mlStatus.status === "active" ? "live" : "degraded",
    detail: mlStatus.message,
  };

  layers.claude_reasoning = isClaudeAvailable()
    ? {
        status: "live",
        detail: "Claude 3.5 Haiku — contextual veto active · Reasoning all high-conviction setups",
      }
    : {
        status: "degraded",
        detail: "Claude layer inactive — integrate Anthropic key to enable contextual veto",
      };

  const allStatuses = Object.values(layers).map((l) => l.status);
  const systemStatus =
    allStatuses.every((s) => s === "live")
      ? "healthy"
      : allStatuses.some((s) => s === "offline")
      ? "degraded"
      : "partial";

  res.json({
    system_status: systemStatus,
    timestamp: new Date().toISOString(),
    layers,
    recommendations: [
      ...(!hasValidTradingKey ? ["Add Trading API keys (PK/AK) from app.alpaca.markets to unlock stock data"] : []),
      ...(layers.recall_engine.status === "degraded" ? ["Run 'Build Recall' to populate accuracy database with historical data"] : []),
      ...(layers.ml_model.status !== "live" ? ["Train ML model on recall data to upgrade scoring from heuristic to learned"] : []),
      ...(layers.claude_reasoning.status !== "live" ? ["Add ANTHROPIC_API_KEY to enable Claude reasoning veto layer"] : []),
    ],
  });
});

export default router;
