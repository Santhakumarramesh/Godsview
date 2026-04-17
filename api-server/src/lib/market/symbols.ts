const QUOTES = ["USDT", "USDC", "USD", "EUR", "GBP", "JPY", "BTC", "ETH"];

export function normalizeMarketSymbol(raw: string, fallback = "BTCUSD"): string {
  const normalized = String(raw ?? "")
    .trim()
    .toUpperCase()
    .split(":")
    .pop()
    ?.replace(/[^A-Z0-9/]/g, "") ?? "";

  if (!normalized) return fallback;
  if (normalized.includes("/")) return normalized.replace("/", "");
  if (normalized.endsWith("PERP")) return normalized.slice(0, -4);
  return normalized;
}

export function toAlpacaSlash(raw: string): string {
  const symbol = normalizeMarketSymbol(raw);
  if (symbol.includes("/")) return symbol;

  for (const quote of QUOTES) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      const base = symbol.slice(0, -quote.length);
      if (base.length >= 2) return `${base}/${quote}`;
    }
  }

  return symbol;
}

export function fromAlpacaSlash(raw: string): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isCryptoSymbol(raw: string): boolean {
  const symbol = normalizeMarketSymbol(raw, "");
  if (!symbol) return false;
  return QUOTES.some((quote) => symbol.endsWith(quote) && symbol.length > quote.length);
}
