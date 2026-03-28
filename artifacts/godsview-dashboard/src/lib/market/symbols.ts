const QUOTES = ["USDT", "USDC", "USD", "EUR", "GBP", "JPY", "BTC", "ETH"];

export const DEFAULT_WATCH_SYMBOLS = [
  "BTCUSD",
  "ETHUSD",
  "SOLUSD",
  "AVAXUSD",
  "DOGEUSD",
  "ADAUSD",
  "LINKUSD",
  "XRPUSD",
];

export function normalizeMarketSymbol(raw: string, fallback = "BTCUSD"): string {
  const normalized = String(raw ?? "")
    .trim()
    .toUpperCase()
    .split(":")
    .pop()
    ?.replace(/[^A-Z0-9/]/g, "") ?? "";

  if (!normalized) return fallback;
  if (normalized.includes("/")) return normalized.replace("/", "");
  return normalized;
}

export function toAlpacaSymbol(raw: string): string {
  const symbol = normalizeMarketSymbol(raw);

  if (symbol === "MES" || symbol === "MES1") return "SPY";
  if (symbol === "MNQ" || symbol === "MNQ1") return "QQQ";
  if (symbol.endsWith("USDT")) return `${symbol.slice(0, -4)}USD`;
  return symbol;
}

export function isCryptoSymbol(raw: string): boolean {
  const symbol = toAlpacaSymbol(raw);
  return symbol.endsWith("USD") || symbol.endsWith("USDT") || symbol.endsWith("USDC");
}

export function toTvSymbol(raw: string): string {
  const symbol = String(raw ?? "").trim().toUpperCase();
  if (!symbol) return "COINBASE:BTCUSD";
  if (symbol.includes(":")) return symbol;

  const normalized = normalizeMarketSymbol(symbol);
  if (normalized === "MES" || normalized === "MES1") return "CME_MINI:MES1!";
  if (normalized === "MNQ" || normalized === "MNQ1") return "CME_MINI:MNQ1!";

  if (normalized.endsWith("USDT")) return `BINANCE:${normalized}`;
  if (normalized.endsWith("USD")) return `COINBASE:${normalized}`;
  if (/^[A-Z]{1,5}$/.test(normalized)) return `NASDAQ:${normalized}`;

  for (const quote of QUOTES) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return `CRYPTOCAP:${normalized}`;
    }
  }

  return normalized;
}

export function toDisplaySymbol(raw: string): string {
  const symbol = normalizeMarketSymbol(raw);
  if (symbol.endsWith("USD") && symbol.length > 3) return symbol.slice(0, -3);
  return symbol;
}
