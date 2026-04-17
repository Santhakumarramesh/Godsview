/**
 * Trading Session Guard — Market hours awareness layer.
 *
 * Determines if the current time falls within tradeable sessions
 * for different asset classes, accounting for:
 * - US equity market hours (9:30 AM - 4:00 PM ET)
 * - Extended hours (pre-market 4:00 AM, after-hours 8:00 PM ET)
 * - Crypto (24/7)
 * - US market holidays
 * - Weekend detection
 *
 * Used by the production gate as a hard filter.
 */

import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────

export type MarketSession =
  | "pre_market"       // 4:00 AM - 9:30 AM ET
  | "regular"          // 9:30 AM - 4:00 PM ET
  | "after_hours"      // 4:00 PM - 8:00 PM ET
  | "closed"           // 8:00 PM - 4:00 AM ET
  | "weekend"
  | "holiday";

export type AssetClass = "equity" | "crypto" | "futures";
export interface SessionStatus {
  session: MarketSession;
  tradeable: boolean;
  asset_class: AssetClass;
  next_open?: string;
  reason?: string;
}

// ── US Market Holidays 2025-2026 ───────────────────────────────────
// (Expand annually — dates when NYSE/NASDAQ are closed)

const US_HOLIDAYS: Set<string> = new Set([
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18",
  "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01",
  "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
  "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
  "2026-11-26", "2026-12-25",
]);

// ── Time Helpers (Eastern Time) ────────────────────────────────────

function getETNow(): { hours: number; minutes: number; dayOfWeek: number; dateStr: string } {
  const now = new Date();
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", hour12: false,
    weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",  }).formatToParts(now);

  const parts = Object.fromEntries(et.map((p) => [p.type, p.value]));
  const hours = Number(parts.hour ?? "0");
  const minutes = Number(parts.minute ?? "0");
  const weekdayStr = parts.weekday ?? "Mon";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekdayStr] ?? 1;
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;

  return { hours, minutes, dayOfWeek, dateStr };
}

function etMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

// ── Session Detection ──────────────────────────────────────────────

export function getMarketSession(assetClass: AssetClass = "equity"): SessionStatus {
  // Crypto is always tradeable
  if (assetClass === "crypto") {
    return { session: "regular", tradeable: true, asset_class: "crypto" };
  }

  const { hours, minutes, dayOfWeek, dateStr } = getETNow();
  const currentMin = etMinutes(hours, minutes);
  // Weekend check
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      session: "weekend",
      tradeable: assetClass === "futures", // Futures trade Sunday evening
      asset_class: assetClass,
      reason: "Weekend — US equity markets closed",
    };
  }

  // Holiday check
  if (US_HOLIDAYS.has(dateStr)) {
    return {
      session: "holiday",
      tradeable: false,
      asset_class: assetClass,
      reason: `US market holiday (${dateStr})`,
    };
  }

  // Time-based session detection (Eastern Time)
  const PRE_MARKET_OPEN = etMinutes(4, 0);    // 4:00 AM
  const REGULAR_OPEN = etMinutes(9, 30);       // 9:30 AM
  const REGULAR_CLOSE = etMinutes(16, 0);      // 4:00 PM
  const AFTER_HOURS_CLOSE = etMinutes(20, 0);  // 8:00 PM

  if (currentMin >= REGULAR_OPEN && currentMin < REGULAR_CLOSE) {    return { session: "regular", tradeable: true, asset_class: assetClass };
  }

  if (currentMin >= PRE_MARKET_OPEN && currentMin < REGULAR_OPEN) {
    const allowExtended = process.env["GODSVIEW_ALLOW_EXTENDED_HOURS"] === "true";
    return {
      session: "pre_market",
      tradeable: allowExtended,
      asset_class: assetClass,
      reason: allowExtended ? undefined : "Pre-market — enable GODSVIEW_ALLOW_EXTENDED_HOURS for extended hours trading",
    };
  }

  if (currentMin >= REGULAR_CLOSE && currentMin < AFTER_HOURS_CLOSE) {
    const allowExtended = process.env["GODSVIEW_ALLOW_EXTENDED_HOURS"] === "true";
    return {
      session: "after_hours",
      tradeable: allowExtended,
      asset_class: assetClass,
      reason: allowExtended ? undefined : "After-hours — enable GODSVIEW_ALLOW_EXTENDED_HOURS for extended hours trading",
    };
  }

  return {
    session: "closed",
    tradeable: false,
    asset_class: assetClass,
    reason: "Market closed (overnight)",
    next_open: "4:00 AM ET (pre-market) / 9:30 AM ET (regular)",  };
}

/**
 * Quick boolean check — is trading allowed right now for this asset?
 */
export function isTradingAllowed(assetClass: AssetClass = "equity"): boolean {
  return getMarketSession(assetClass).tradeable;
}

/**
 * Determine asset class from symbol string.
 */
export function inferAssetClass(symbol: string): AssetClass {
  const upper = symbol.toUpperCase();
  if (upper.includes("BTC") || upper.includes("ETH") || upper.includes("USD")) {
    return "crypto";
  }
  if (upper.startsWith("M") && (upper.includes("ES") || upper.includes("NQ") || upper.includes("YM"))) {
    return "futures";
  }
  return "equity";
}

// ── Session status endpoint data ───────────────────────────────────

export function getFullSessionStatus(): Record<string, SessionStatus> {
  return {
    equity: getMarketSession("equity"),
    crypto: getMarketSession("crypto"),
    futures: getMarketSession("futures"),
  };
}