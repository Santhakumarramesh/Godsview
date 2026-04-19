"use client";

import { useMemo, useState } from "react";

// Phase 0 deterministic watchlist; wired to real market-data APIs later.
const INITIAL_SYMBOLS = [
  { ticker: "ES", venue: "CME", lastRefresh: "—" },
  { ticker: "NQ", venue: "CME", lastRefresh: "—" },
  { ticker: "CL", venue: "NYMEX", lastRefresh: "—" },
  { ticker: "BTC-USD", venue: "Coinbase", lastRefresh: "—" },
  { ticker: "AAPL", venue: "NASDAQ", lastRefresh: "—" },
  { ticker: "SPY", venue: "NYSE", lastRefresh: "—" },
];

export default function MarketSymbolsPage() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      INITIAL_SYMBOLS.filter((s) =>
        s.ticker.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Market · Symbols</h1>
        <p className="text-sm text-muted">
          Phase 0 watchlist. Live quote feed + order-book overlay lands in
          Phase 2 (Market Structure Engine).
        </p>
      </header>

      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tickers…"
          className="w-64 rounded border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
        />
        <span className="text-xs text-muted">
          {filtered.length} of {INITIAL_SYMBOLS.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface/80 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-3 py-2 font-medium">Venue</th>
              <th className="px-3 py-2 font-medium">Last refresh</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.ticker} className="border-t border-border hover:bg-surface/40">
                <td className="px-3 py-2 font-mono">{s.ticker}</td>
                <td className="px-3 py-2 text-muted">{s.venue}</td>
                <td className="px-3 py-2 text-muted">{s.lastRefresh}</td>
                <td className="px-3 py-2 text-right text-xs">
                  <span className="rounded bg-warn/15 px-2 py-0.5 font-mono uppercase text-warn">
                    awaiting feed
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted" colSpan={4}>
                  No symbols match "{query}".
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
