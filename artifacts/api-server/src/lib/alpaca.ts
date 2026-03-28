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

// ─── Order Placement ─────────────────────────────────────────────────────────

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "gtc" | "ioc" | "fok" | "day";

export type PlaceOrderRequest = {
  symbol: string;           // e.g. "BTCUSD" or "ETHUSD"
  qty?: number;             // number of units (use qty OR notional)
  notional?: number;        // dollar amount (use qty OR notional)
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  limit_price?: number;     // required for limit/stop_limit
  stop_price?: number;      // required for stop/stop_limit
  stop_loss_price?: number; // bracket stop-loss stop price
  take_profit_price?: number; // bracket take-profit limit price
};

export type AlpacaOrder = {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string;
  notional: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  side: string;
  type: string;
  status: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  order_class: string;
};

export type AlpacaPosition = {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  qty_available: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
};

async function alpacaPost(url: string, body: unknown): Promise<unknown> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...tradingHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Alpaca ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function alpacaDelete(url: string): Promise<unknown> {
  const resp = await fetch(url, {
    method: "DELETE",
    headers: tradingHeaders(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Alpaca DELETE ${resp.status}: ${text}`);
  }
  // 204 No Content on success
  if (resp.status === 204) return { success: true };
  return resp.json();
}

export async function placeOrder(req: PlaceOrderRequest): Promise<AlpacaOrder> {
  if (!hasValidTradingKey) {
    throw new Error("Trading API keys required to place orders. Generate PK/AK keys from app.alpaca.markets.");
  }

  const base = isPaperKey ? PAPER_BASE : LIVE_BASE;
  const symbol = toCryptoSlash(req.symbol);

  const body: Record<string, unknown> = {
    symbol,
    side: req.side,
    type: req.type,
    time_in_force: req.time_in_force,
  };

  if (req.qty !== undefined) body.qty = String(req.qty);
  else if (req.notional !== undefined) body.notional = String(req.notional);

  if (req.limit_price !== undefined) body.limit_price = String(req.limit_price);
  if (req.stop_price !== undefined) body.stop_price = String(req.stop_price);

  // Bracket order (stop-loss + take-profit attached)
  if (req.stop_loss_price !== undefined || req.take_profit_price !== undefined) {
    body.order_class = "bracket";
    if (req.stop_loss_price !== undefined) {
      body.stop_loss = { stop_price: String(req.stop_loss_price) };
    }
    if (req.take_profit_price !== undefined) {
      body.take_profit = { limit_price: String(req.take_profit_price) };
    }
  }

  return alpacaPost(`${base}/v2/orders`, body) as Promise<AlpacaOrder>;
}

export async function getOrders(status: "open" | "closed" | "all" = "open", limit = 50): Promise<AlpacaOrder[]> {
  if (!hasValidTradingKey) return [];
  const base = isPaperKey ? PAPER_BASE : LIVE_BASE;
  const params = new URLSearchParams({ status, limit: String(limit) });
  const data = await alpacaFetch(`${base}/v2/orders?${params}`, true);
  return (data as AlpacaOrder[]) ?? [];
}

export async function cancelOrder(orderId: string): Promise<unknown> {
  if (!hasValidTradingKey) throw new Error("Trading API keys required.");
  const base = isPaperKey ? PAPER_BASE : LIVE_BASE;
  return alpacaDelete(`${base}/v2/orders/${orderId}`);
}

export async function cancelAllOrders(): Promise<unknown> {
  if (!hasValidTradingKey) throw new Error("Trading API keys required.");
  const base = isPaperKey ? PAPER_BASE : LIVE_BASE;
  return alpacaDelete(`${base}/v2/orders`);
}

export async function closePosition(symbol: string): Promise<unknown> {
  if (!hasValidTradingKey) throw new Error("Trading API keys required.");
  const base = isPaperKey ? PAPER_BASE : LIVE_BASE;
  const alpacaSymbol = toCryptoSlash(symbol).replace("/", "%2F");
  return alpacaDelete(`${base}/v2/positions/${alpacaSymbol}`);
}

export async function getTypedPositions(): Promise<AlpacaPosition[]> {
  if (!hasValidTradingKey) return [];
  const base = isPaperKey ? PAPER_BASE : LIVE_BASE;
  const data = await alpacaFetch(`${base}/v2/positions`, true);
  return (data as AlpacaPosition[]) ?? [];
}

/**
 * Calculate position size based on risk parameters.
 * @param equity   - Account equity in dollars
 * @param riskPct  - Risk per trade as decimal (e.g. 0.01 = 1%)
 * @param entry    - Entry price
 * @param stopLoss - Stop-loss price
 * @returns qty (units to buy/sell)
 */
export function calcPositionSize(equity: number, riskPct: number, entry: number, stopLoss: number): number {
  const riskDollars = equity * riskPct;
  const riskPerUnit = Math.abs(entry - stopLoss);
  if (riskPerUnit <= 0) return 0;
  const qty = riskDollars / riskPerUnit;
  // Round to 6 decimal places (crypto precision)
  return Math.round(qty * 1e6) / 1e6;
}

export { isBrokerKey, isPaperKey, hasValidTradingKey };
