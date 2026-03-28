// Alpaca market data client
// Crypto: free endpoint, no auth required (v1beta3/crypto/us/bars)
// Stocks: requires Trading API keys (PK/AK prefix) with APCA header auth
// Broker keys (CK prefix) do NOT have market data access

const KEY_ID = process.env.ALPACA_API_KEY ?? "";
const SECRET_KEY = process.env.ALPACA_SECRET_KEY ?? "";

const isBrokerKey = KEY_ID.startsWith("CK");
const isPaperKey = KEY_ID.startsWith("PK");
const hasValidTradingKey = KEY_ID.startsWith("PK") || KEY_ID.startsWith("AK");

const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";
const CRYPTO_BASE = "https://data.alpaca.markets/v1beta3/crypto/us";

// Crypto symbol set (Alpaca uses slash format: BTC/USD)
const CRYPTO_SYMBOLS = new Set(["BTCUSD", "ETHUSD", "BTC/USD", "ETH/USD"]);
function isCryptoSymbol(symbol: string) {
  return CRYPTO_SYMBOLS.has(symbol) || symbol.includes("/");
}
function toCryptoSlash(symbol: string) {
  // Convert BTCUSD → BTC/USD
  if (symbol === "BTCUSD") return "BTC/USD";
  if (symbol === "ETHUSD") return "ETH/USD";
  return symbol;
}

function tradingHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": KEY_ID,
    "APCA-API-SECRET-KEY": SECRET_KEY,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function alpacaFetch(url: string, withAuth = true): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (withAuth && KEY_ID) Object.assign(headers, tradingHeaders());

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Alpaca API ${resp.status}: ${body}`);
  }
  return resp.json();
}

export type AlpacaBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number;
  Timestamp: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
  VWAP?: number;
};

export type AlpacaTimeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day";

// Alpaca timeframe → crypto API timeframe string
const TF_MAP: Record<AlpacaTimeframe, string> = {
  "1Min": "1Min",
  "5Min": "5Min",
  "15Min": "15Min",
  "1Hour": "1Hour",
  "1Day": "1Day",
};

function normaliseBar(b: Record<string, unknown>): AlpacaBar {
  return {
    t: b.t as string,
    o: b.o as number,
    h: b.h as number,
    l: b.l as number,
    c: b.c as number,
    v: b.v as number,
    vw: b.vw as number | undefined,
    n: b.n as number | undefined,
    Timestamp: b.t as string,
    Open: b.o as number,
    High: b.h as number,
    Low: b.l as number,
    Close: b.c as number,
    Volume: b.v as number,
    VWAP: b.vw as number | undefined,
  };
}

export async function getBars(
  symbol: string,
  timeframe: AlpacaTimeframe,
  limit: number = 100,
  start?: string,
  end?: string
): Promise<AlpacaBar[]> {
  const safeLimit = Math.min(limit, 1000);

  if (isCryptoSymbol(symbol)) {
    const cryptoSymbol = toCryptoSlash(symbol);
    const params = new URLSearchParams({
      symbols: cryptoSymbol,
      timeframe: TF_MAP[timeframe],
      limit: String(safeLimit),
    });
    if (start) params.set("start", start);
    if (end) params.set("end", end);

    const url = `${CRYPTO_BASE}/bars?${params}`;
    const data = await alpacaFetch(url, false) as { bars: Record<string, Record<string, unknown>[]> };
    const barsArr = data.bars?.[cryptoSymbol] ?? [];
    return barsArr.map(normaliseBar);
  }

  if (!hasValidTradingKey) {
    throw new Error(
      "Stock market data requires Trading API keys (starting with PK or AK). " +
      "Please generate keys from app.alpaca.markets → API Keys."
    );
  }

  const params = new URLSearchParams({
    timeframe,
    limit: String(safeLimit),
    adjustment: "raw",
    feed: "iex",
  });
  if (start) params.set("start", start);
  if (end) params.set("end", end);

  const url = `${DATA_BASE}/v2/stocks/${symbol}/bars?${params}`;
  const data = await alpacaFetch(url, true) as { bars: Record<string, unknown>[] };
  return (data.bars ?? []).map(normaliseBar);
}

// Paginated historical fetch — collects ALL bars across multiple API pages
// Used for multi-year recall building
export async function getBarsHistorical(
  symbol: string,
  timeframe: AlpacaTimeframe,
  start: string,
  end: string,
  maxBars: number = 50000
): Promise<AlpacaBar[]> {
  const allBars: AlpacaBar[] = [];
  let pageToken: string | null = null;
  const PAGE_SIZE = 1000;

  if (!isCryptoSymbol(symbol)) {
    // For stocks: single page call (limited by Trading key availability)
    return getBars(symbol, timeframe, Math.min(maxBars, 10000), start, end);
  }

  const cryptoSymbol = toCryptoSlash(symbol);

  while (allBars.length < maxBars) {
    const params = new URLSearchParams({
      symbols: cryptoSymbol,
      timeframe: TF_MAP[timeframe],
      limit: String(PAGE_SIZE),
      start,
      end,
    });
    if (pageToken) params.set("page_token", pageToken);

    const url = `${CRYPTO_BASE}/bars?${params}`;
    const data = await alpacaFetch(url, false) as {
      bars: Record<string, Record<string, unknown>[]>;
      next_page_token: string | null;
    };

    const page = (data.bars?.[cryptoSymbol] ?? []).map(normaliseBar);
    allBars.push(...page);

    if (!data.next_page_token || page.length === 0) break;
    pageToken = data.next_page_token;

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 120));
  }

  // Sort chronologically
  allBars.sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());
  return allBars;
}

export async function getLatestTrade(symbol: string): Promise<{ price: number; timestamp: string } | null> {
  try {
    if (isCryptoSymbol(symbol)) {
      const cryptoSymbol = toCryptoSlash(symbol);
      const params = new URLSearchParams({ symbols: cryptoSymbol });
      const url = `${CRYPTO_BASE}/latest/trades?${params}`;
      const data = await alpacaFetch(url, false) as { trades: Record<string, { p: number; t: string }> };
      const trade = data.trades?.[cryptoSymbol];
      return trade ? { price: trade.p, timestamp: trade.t } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getLatestBar(symbol: string): Promise<AlpacaBar | null> {
  try {
    if (isCryptoSymbol(symbol)) {
      const cryptoSymbol = toCryptoSlash(symbol);
      const params = new URLSearchParams({ symbols: cryptoSymbol });
      const url = `${CRYPTO_BASE}/latest/bars?${params}`;
      const data = await alpacaFetch(url, false) as { bars: Record<string, Record<string, unknown>> };
      const bar = data.bars?.[cryptoSymbol];
      return bar ? normaliseBar(bar) : null;
    }

    if (!hasValidTradingKey) return null;
    const url = `${DATA_BASE}/v2/stocks/${symbol}/bars/latest?feed=iex`;
    const data = await alpacaFetch(url, true) as { bar: Record<string, unknown> };
    return data.bar ? normaliseBar(data.bar) : null;
  } catch {
    return null;
  }
}

export async function getAccount(): Promise<unknown> {
  if (!KEY_ID) {
    return { error: "No API key configured" };
  }
  if (isBrokerKey) {
    return {
      error: "broker_key",
      message: "Broker API keys (CK...) do not have trading account access. Please generate Trading API keys from app.alpaca.markets.",
    };
  }
  const base = isPaperKey ? PAPER_BASE : LIVE_BASE;
  return alpacaFetch(`${base}/v2/account`, true);
}

export async function getPositions(): Promise<unknown> {
  if (!hasValidTradingKey) {
    return { error: "Trading API keys required for positions" };
  }
  const base = isPaperKey ? PAPER_BASE : LIVE_BASE;
  return alpacaFetch(`${base}/v2/positions`, true);
}

export { isBrokerKey, isPaperKey, hasValidTradingKey };
