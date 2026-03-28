import Alpaca from "@alpacahq/alpaca-trade-api";

if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_SECRET_KEY) {
  throw new Error("ALPACA_API_KEY and ALPACA_SECRET_KEY must be set");
}

// Paper keys start with "PK", live keys start with "AK" or "CK"
const isPaperKey = process.env.ALPACA_API_KEY?.startsWith("PK");

export const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: isPaperKey ?? true,
  feed: "iex",
});

export type AlpacaBar = {
  Timestamp: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
  VWAP?: number;
  TradeCount?: number;
};

export type AlpacaTimeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day";

export async function getBars(
  symbol: string,
  timeframe: AlpacaTimeframe,
  limit: number = 100,
  start?: string,
  end?: string
): Promise<AlpacaBar[]> {
  const params: Record<string, string | number> = {
    timeframe,
    limit,
    adjustment: "raw",
    feed: "iex",
  };
  if (start) params.start = start;
  if (end) params.end = end;

  const resp = await alpaca.getBarsV2(symbol, params);
  const bars: AlpacaBar[] = [];
  for await (const bar of resp) {
    bars.push(bar as AlpacaBar);
  }
  return bars;
}

export async function getLatestBar(symbol: string): Promise<AlpacaBar | null> {
  try {
    const resp = await alpaca.getLatestBar(symbol);
    return resp as AlpacaBar;
  } catch {
    return null;
  }
}

export async function getAccount() {
  return alpaca.getAccount();
}

export async function getPositions() {
  return alpaca.getPositions();
}
