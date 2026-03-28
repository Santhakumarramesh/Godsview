// Alpaca client supporting both Trading API (PK/AK keys) and Broker API (CK keys)
// Broker API uses Basic auth; Trading API uses APCA header auth

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
  throw new Error("ALPACA_API_KEY and ALPACA_SECRET_KEY must be set");
}

const KEY_ID = process.env.ALPACA_API_KEY!;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY!;

// CK = Broker API key, PK = Paper Trading, AK = Live Trading
const isBrokerKey = KEY_ID.startsWith("CK");
const isPaperKey = KEY_ID.startsWith("PK");

const BROKER_BASE = "https://broker-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";
const PAPER_BASE = "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

function getTradeBase() {
  if (isBrokerKey) return BROKER_BASE;
  if (isPaperKey) return PAPER_BASE;
  return LIVE_BASE;
}

function getHeaders(): Record<string, string> {
  if (isBrokerKey) {
    const encoded = Buffer.from(`${KEY_ID}:${SECRET_KEY}`).toString("base64");
    return {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
  return {
    "APCA-API-KEY-ID": KEY_ID,
    "APCA-API-SECRET-KEY": SECRET_KEY,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function alpacaFetch(url: string, options: RequestInit = {}): Promise<unknown> {
  const resp = await fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers as Record<string, string> ?? {}) },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Alpaca API ${resp.status}: ${body}`);
  }
  return resp.json();
}

export type AlpacaBar = {
  t: string;   // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number;
  // Normalised aliases (populated after fetch)
  Timestamp: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
  VWAP?: number;
};

export type AlpacaTimeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day";

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
  const params = new URLSearchParams({
    timeframe,
    limit: String(Math.min(limit, 1000)),
    adjustment: "raw",
    feed: "iex",
  });
  if (start) params.set("start", start);
  if (end) params.set("end", end);

  const url = `${DATA_BASE}/v2/stocks/${symbol}/bars?${params}`;
  const data = await alpacaFetch(url) as { bars: Record<string, unknown>[] };
  return (data.bars ?? []).map(normaliseBar);
}

export async function getLatestBar(symbol: string): Promise<AlpacaBar | null> {
  try {
    const url = `${DATA_BASE}/v2/stocks/${symbol}/bars/latest?feed=iex`;
    const data = await alpacaFetch(url) as { bar: Record<string, unknown> };
    return data.bar ? normaliseBar(data.bar) : null;
  } catch {
    return null;
  }
}

export async function getAccount(): Promise<unknown> {
  const base = getTradeBase();
  if (isBrokerKey) {
    return alpacaFetch(`${base}/v1/accounts`);
  }
  return alpacaFetch(`${base}/v2/account`);
}

export async function getPositions(): Promise<unknown> {
  const base = getTradeBase();
  if (isBrokerKey) {
    return { message: "Positions require a specific account_id with Broker API" };
  }
  return alpacaFetch(`${base}/v2/positions`);
}

export { isBrokerKey, isPaperKey };
