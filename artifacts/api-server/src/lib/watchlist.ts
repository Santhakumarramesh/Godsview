/**
 * watchlist.ts — Persistent-across-session in-memory watchlist store
 *
 * Manages the set of symbols the autonomous scanner will monitor.
 * Each entry records metadata about when it was added, last scanned,
 * and whether it is currently enabled.
 *
 * Thread-safety: single-threaded Node.js — Map operations are atomic.
 */

import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "watchlist" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatchlistEntry {
  /** Canonical symbol as used by Alpaca (e.g. "BTCUSD", "SPY") */
  symbol:      string;
  /** Display label (may differ from the Alpaca symbol) */
  label:       string;
  /** Asset class hint for macro bias weighting */
  assetClass:  "crypto" | "forex" | "equity" | "commodity";
  /** Whether the scanner should include this symbol */
  enabled:     boolean;
  /** ISO timestamp when added */
  addedAt:     string;
  /** ISO timestamp of most recent scan, or null */
  lastScannedAt: string | null;
  /** Count of signals emitted for this symbol since added */
  signalCount: number;
  /** Optional human note */
  note:        string;
}

export type AddWatchlistParams = Pick<WatchlistEntry, "symbol" | "label" | "assetClass"> &
  Partial<Pick<WatchlistEntry, "enabled" | "note">>;

// ─── Default watchlist ────────────────────────────────────────────────────────

const DEFAULT_SYMBOLS: AddWatchlistParams[] = [
  { symbol: "BTCUSD",  label: "Bitcoin",  assetClass: "crypto" },
  { symbol: "ETHUSD",  label: "Ethereum", assetClass: "crypto" },
  { symbol: "SPY",     label: "S&P 500 ETF", assetClass: "equity" },
  { symbol: "QQQ",     label: "Nasdaq ETF",  assetClass: "equity" },
];

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * PRODUCTION: Replace with database persistence (e.g., PostgreSQL or MongoDB)
 * This in-memory watchlist is lost on process restart and not suitable for production.
 * Demo mode: Log warning if GODSVIEW_DATA_PERSISTENCE is not set to 'database'.
 */
/** symbol → WatchlistEntry */
const _store = new Map<string, WatchlistEntry>();

// Demo/Production boundary check
if (!process.env.GODSVIEW_DATA_PERSISTENCE || process.env.GODSVIEW_DATA_PERSISTENCE !== "database") {
  logger.warn(
    { persistence: process.env.GODSVIEW_DATA_PERSISTENCE ?? "fallback-in-memory" },
    "[watchlist] Using in-memory fallback; watchlist data will be lost on restart. Set GODSVIEW_DATA_PERSISTENCE=database for production.",
  );
}

function _initDefaults() {
  for (const p of DEFAULT_SYMBOLS) {
    if (!_store.has(p.symbol)) addSymbol(p);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Add or update a symbol in the watchlist. Idempotent on symbol. */
export function addSymbol(params: AddWatchlistParams): WatchlistEntry {
  const existing = _store.get(params.symbol);
  const entry: WatchlistEntry = {
    symbol:        params.symbol,
    label:         params.label,
    assetClass:    params.assetClass,
    enabled:       params.enabled ?? true,
    addedAt:       existing?.addedAt ?? new Date().toISOString(),
    lastScannedAt: existing?.lastScannedAt ?? null,
    signalCount:   existing?.signalCount  ?? 0,
    note:          params.note ?? existing?.note ?? "",
  };
  _store.set(entry.symbol, entry);
  logger.info({ symbol: entry.symbol }, "[watchlist] Symbol added/updated");
  return entry;
}

/** Remove a symbol from the watchlist. Returns true if it existed. */
export function removeSymbol(symbol: string): boolean {
  const existed = _store.has(symbol);
  _store.delete(symbol);
  if (existed) logger.info({ symbol }, "[watchlist] Symbol removed");
  return existed;
}

/** Enable or disable scanning for a symbol. */
export function setEnabled(symbol: string, enabled: boolean): WatchlistEntry | null {
  const entry = _store.get(symbol);
  if (!entry) return null;
  const updated = { ...entry, enabled };
  _store.set(symbol, updated);
  return updated;
}

/** Record a scan touch for a symbol (called by the scanner after each pass). */
export function touchScanned(symbol: string, hadSignal = false): void {
  const entry = _store.get(symbol);
  if (!entry) return;
  _store.set(symbol, {
    ...entry,
    lastScannedAt: new Date().toISOString(),
    signalCount:   entry.signalCount + (hadSignal ? 1 : 0),
  });
}

/** Return all entries, sorted by symbol. */
export function listWatchlist(): WatchlistEntry[] {
  return Array.from(_store.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Return only enabled entries. */
export function listEnabledSymbols(): WatchlistEntry[] {
  return listWatchlist().filter(e => e.enabled);
}

/** Return a single entry or undefined. */
export function getEntry(symbol: string): WatchlistEntry | undefined {
  return _store.get(symbol);
}

/** Clear the watchlist entirely (useful for testing). */
export function clearWatchlist(): void {
  _store.clear();
}

/** Reload defaults (used at server startup). */
export function initWatchlistDefaults(): void {
  _initDefaults();
}

// Boot-time initialisation
_initDefaults();
