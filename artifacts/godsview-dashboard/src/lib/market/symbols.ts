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

export type AssetClass = "crypto" | "forex" | "futures" | "stocks";

export type SidebarWatchItem = {
  id: string;
  label: string;
  assetClass: AssetClass;
  apiSymbol: string;
  tvSymbol: string;
};

export const SIDEBAR_SECTION_ORDER: AssetClass[] = [
  "crypto",
  "forex",
  "futures",
  "stocks",
];

export const SIDEBAR_WATCHLIST: SidebarWatchItem[] = [
  // Crypto
  { id: "crypto-btc", label: "BTC/USD", assetClass: "crypto", apiSymbol: "BTCUSD", tvSymbol: "COINBASE:BTCUSD" },
  { id: "crypto-eth", label: "ETH/USD", assetClass: "crypto", apiSymbol: "ETHUSD", tvSymbol: "COINBASE:ETHUSD" },
  { id: "crypto-sol", label: "SOL/USD", assetClass: "crypto", apiSymbol: "SOLUSD", tvSymbol: "COINBASE:SOLUSD" },
  { id: "crypto-avax", label: "AVAX/USD", assetClass: "crypto", apiSymbol: "AVAXUSD", tvSymbol: "COINBASE:AVAXUSD" },
  { id: "crypto-doge", label: "DOGE/USD", assetClass: "crypto", apiSymbol: "DOGEUSD", tvSymbol: "COINBASE:DOGEUSD" },
  { id: "crypto-ada", label: "ADA/USD", assetClass: "crypto", apiSymbol: "ADAUSD", tvSymbol: "COINBASE:ADAUSD" },

  // Forex proxies (stock ETFs)
  { id: "fx-eurusd", label: "EUR/USD", assetClass: "forex", apiSymbol: "FXE", tvSymbol: "AMEX:FXE" },
  { id: "fx-gbpusd", label: "GBP/USD", assetClass: "forex", apiSymbol: "FXB", tvSymbol: "AMEX:FXB" },
  { id: "fx-usdjpy", label: "USD/JPY", assetClass: "forex", apiSymbol: "FXY", tvSymbol: "AMEX:FXY" },
  { id: "fx-audusd", label: "AUD/USD", assetClass: "forex", apiSymbol: "FXA", tvSymbol: "AMEX:FXA" },

  // Futures proxies
  { id: "fut-mes", label: "MES (SPY)", assetClass: "futures", apiSymbol: "SPY", tvSymbol: "CME_MINI:MES1!" },
  { id: "fut-mnq", label: "MNQ (QQQ)", assetClass: "futures", apiSymbol: "QQQ", tvSymbol: "CME_MINI:MNQ1!" },
  { id: "fut-mym", label: "MYM (DIA)", assetClass: "futures", apiSymbol: "DIA", tvSymbol: "CBOT_MINI:YM1!" },
  { id: "fut-m2k", label: "M2K (IWM)", assetClass: "futures", apiSymbol: "IWM", tvSymbol: "CME_MINI:RTY1!" },

  // Stocks
  { id: "stock-nvda", label: "NVDA", assetClass: "stocks", apiSymbol: "NVDA", tvSymbol: "NASDAQ:NVDA" },
  { id: "stock-aapl", label: "AAPL", assetClass: "stocks", apiSymbol: "AAPL", tvSymbol: "NASDAQ:AAPL" },
  { id: "stock-tsla", label: "TSLA", assetClass: "stocks", apiSymbol: "TSLA", tvSymbol: "NASDAQ:TSLA" },
  { id: "stock-msft", label: "MSFT", assetClass: "stocks", apiSymbol: "MSFT", tvSymbol: "NASDAQ:MSFT" },
  { id: "stock-amzn", label: "AMZN", assetClass: "stocks", apiSymbol: "AMZN", tvSymbol: "NASDAQ:AMZN" },
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
