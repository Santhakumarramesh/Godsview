"use client";

import { useState, useMemo } from "react";

interface ScannerRow {
  id: string;
  symbol: string;
  price: number;
  change: number;
  regime: "trending" | "ranging" | "volatile";
  confluence: number;
  direction: "bullish" | "bearish" | "neutral";
  signals: number;
  volatility: number;
  liquidity: "high" | "medium" | "low";
  lastUpdate: string;
}

const mockScannerData: ScannerRow[] = [
  {
    id: "1",
    symbol: "NVDA",
    price: 1182.4,
    change: 2.18,
    regime: "trending",
    confluence: 92,
    direction: "bullish",
    signals: 5,
    volatility: 28,
    liquidity: "high",
    lastUpdate: "09:42",
  },
  {
    id: "2",
    symbol: "AAPL",
    price: 192.18,
    change: -1.24,
    regime: "ranging",
    confluence: 87,
    direction: "bearish",
    signals: 4,
    volatility: 18,
    liquidity: "high",
    lastUpdate: "09:41",
  },
  {
    id: "3",
    symbol: "TSLA",
    price: 248.65,
    change: 3.42,
    regime: "trending",
    confluence: 78,
    direction: "bullish",
    signals: 3,
    volatility: 35,
    liquidity: "high",
    lastUpdate: "09:42",
  },
  {
    id: "4",
    symbol: "MSFT",
    price: 423.51,
    change: 0.89,
    regime: "ranging",
    confluence: 81,
    direction: "bullish",
    signals: 3,
    volatility: 16,
    liquidity: "high",
    lastUpdate: "09:41",
  },
  {
    id: "5",
    symbol: "AMZN",
    price: 187.42,
    change: -0.56,
    regime: "volatile",
    confluence: 74,
    direction: "bearish",
    signals: 2,
    volatility: 31,
    liquidity: "high",
    lastUpdate: "09:40",
  },
  {
    id: "6",
    symbol: "GOOGL",
    price: 156.89,
    change: 1.67,
    regime: "trending",
    confluence: 76,
    direction: "bullish",
    signals: 3,
    volatility: 22,
    liquidity: "high",
    lastUpdate: "09:42",
  },
  {
    id: "7",
    symbol: "META",
    price: 524.11,
    change: 2.34,
    regime: "trending",
    confluence: 84,
    direction: "bullish",
    signals: 4,
    volatility: 26,
    liquidity: "high",
    lastUpdate: "09:41",
  },
  {
    id: "8",
    symbol: "NFLX",
    price: 289.45,
    change: -1.89,
    regime: "ranging",
    confluence: 68,
    direction: "neutral",
    signals: 1,
    volatility: 24,
    liquidity: "high",
    lastUpdate: "09:40",
  },
  {
    id: "9",
    symbol: "UBER",
    price: 78.32,
    change: 1.12,
    regime: "ranging",
    confluence: 71,
    direction: "bullish",
    signals: 2,
    volatility: 20,
    liquidity: "high",
    lastUpdate: "09:41",
  },
  {
    id: "10",
    symbol: "COIN",
    price: 142.56,
    change: 4.23,
    regime: "volatile",
    confluence: 79,
    direction: "bullish",
    signals: 3,
    volatility: 42,
    liquidity: "medium",
    lastUpdate: "09:42",
  },
  {
    id: "11",
    symbol: "AMD",
    price: 187.89,
    change: 1.45,
    regime: "trending",
    confluence: 75,
    direction: "bullish",
    signals: 3,
    volatility: 25,
    liquidity: "high",
    lastUpdate: "09:41",
  },
  {
    id: "12",
    symbol: "INTC",
    price: 43.21,
    change: -2.11,
    regime: "ranging",
    confluence: 62,
    direction: "bearish",
    signals: 2,
    volatility: 21,
    liquidity: "high",
    lastUpdate: "09:40",
  },
  {
    id: "13",
    symbol: "QQQ",
    price: 419.87,
    change: 1.87,
    regime: "trending",
    confluence: 88,
    direction: "bullish",
    signals: 5,
    volatility: 20,
    liquidity: "high",
    lastUpdate: "09:42",
  },
  {
    id: "14",
    symbol: "SPY",
    price: 521.45,
    change: 0.94,
    regime: "trending",
    confluence: 83,
    direction: "bullish",
    signals: 4,
    volatility: 15,
    liquidity: "high",
    lastUpdate: "09:41",
  },
  {
    id: "15",
    symbol: "ARKK",
    price: 67.89,
    change: 2.56,
    regime: "trending",
    confluence: 69,
    direction: "bullish",
    signals: 2,
    volatility: 28,
    liquidity: "medium",
    lastUpdate: "09:40",
  },
  {
    id: "16",
    symbol: "SOFI",
    price: 8.94,
    change: 3.18,
    regime: "volatile",
    confluence: 64,
    direction: "bullish",
    signals: 2,
    volatility: 38,
    liquidity: "medium",
    lastUpdate: "09:41",
  },
  {
    id: "17",
    symbol: "PLTR",
    price: 32.15,
    change: 1.23,
    regime: "ranging",
    confluence: 58,
    direction: "neutral",
    signals: 1,
    volatility: 19,
    liquidity: "high",
    lastUpdate: "09:40",
  },
  {
    id: "18",
    symbol: "SEMI",
    price: 198.76,
    change: 2.89,
    regime: "trending",
    confluence: 86,
    direction: "bullish",
    signals: 4,
    volatility: 24,
    liquidity: "medium",
    lastUpdate: "09:42",
  },
  {
    id: "19",
    symbol: "XBI",
    price: 89.45,
    change: -0.67,
    regime: "ranging",
    confluence: 65,
    direction: "neutral",
    signals: 1,
    volatility: 22,
    liquidity: "medium",
    lastUpdate: "09:39",
  },
  {
    id: "20",
    symbol: "MSTR",
    price: 467.23,
    change: 5.12,
    regime: "volatile",
    confluence: 81,
    direction: "bullish",
    signals: 3,
    volatility: 44,
    liquidity: "high",
    lastUpdate: "09:42",
  },
];

type SortColumn = "symbol" | "price" | "change" | "confluence" | "volatility";
type SortDirection = "asc" | "desc";

export default function MarketScannerPage() {
  const [assetClass, setAssetClass] = useState<"all" | "equities" | "crypto" | "futures">("equities");
  const [regime, setRegime] = useState<"all" | "trending" | "ranging" | "volatile">("all");
  const [minConfluence, setMinConfluence] = useState(60);
  const [sortColumn, setSortColumn] = useState<SortColumn>("confluence");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedSymbol, setSelectedSymbol] = useState<ScannerRow | null>(null);

  const filteredData = useMemo(() => {
    let data = [...mockScannerData];

    // Filter by regime
    if (regime !== "all") {
      data = data.filter((row) => row.regime === regime);
    }

    // Filter by confluence score
    data = data.filter((row) => row.confluence >= minConfluence);

    // Sort
    data.sort((a, b) => {
      const aVal = a[sortColumn] as string | number;
      const bVal = b[sortColumn] as string | number;

      let comparison = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal;
      } else if (typeof aVal === "string" && typeof bVal === "string") {
        comparison = aVal.localeCompare(bVal);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return data;
  }, [regime, minConfluence, sortColumn, sortDirection]);

  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Market Scanner</h1>
          <p className="text-sm text-muted mt-1">
            Real-time scanning: {filteredData.length} symbols match criteria
          </p>
        </div>
        <span className="rounded bg-success/20 text-success px-3 py-1 font-mono text-xs border border-success/30">
          ● live
        </span>
      </header>

      {/* Filter Bar */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
              Asset Class
            </label>
            <select
              value={assetClass}
              onChange={(e) =>
                setAssetClass(
                  e.target.value as
                    | "all"
                    | "equities"
                    | "crypto"
                    | "futures"
                )
              }
              className="w-full px-3 py-2 rounded border border-border bg-background text-sm text-foreground focus:border-primary outline-none"
            >
              <option value="equities">Equities</option>
              <option value="crypto">Crypto</option>
              <option value="futures">Futures</option>
              <option value="all">All</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
              Market Regime
            </label>
            <select
              value={regime}
              onChange={(e) =>
                setRegime(
                  e.target.value as
                    | "all"
                    | "trending"
                    | "ranging"
                    | "volatile"
                )
              }
              className="w-full px-3 py-2 rounded border border-border bg-background text-sm text-foreground focus:border-primary outline-none"
            >
              <option value="all">All Regimes</option>
              <option value="trending">Trending</option>
              <option value="ranging">Ranging</option>
              <option value="volatile">Volatile</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wide block mb-2">
              Min Confluence: {minConfluence}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={minConfluence}
              onChange={(e) => setMinConfluence(parseInt(e.target.value))}
              className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Scanner Table */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <SortHeader
                  label="Symbol"
                  column="symbol"
                  active={sortColumn === "symbol"}
                  direction={sortDirection}
                  onClick={() => toggleSort("symbol")}
                />
                <SortHeader
                  label="Price"
                  column="price"
                  active={sortColumn === "price"}
                  direction={sortDirection}
                  onClick={() => toggleSort("price")}
                />
                <SortHeader
                  label="Change %"
                  column="change"
                  active={sortColumn === "change"}
                  direction={sortDirection}
                  onClick={() => toggleSort("change")}
                />
                <th className="px-4 py-3 text-left font-medium text-xs text-muted uppercase tracking-wide">
                  Regime
                </th>
                <SortHeader
                  label="Confluence"
                  column="confluence"
                  active={sortColumn === "confluence"}
                  direction={sortDirection}
                  onClick={() => toggleSort("confluence")}
                />
                <th className="px-4 py-3 text-left font-medium text-xs text-muted uppercase tracking-wide">
                  Direction
                </th>
                <th className="px-4 py-3 text-center font-medium text-xs text-muted uppercase tracking-wide">
                  Signals
                </th>
                <SortHeader
                  label="Volatility"
                  column="volatility"
                  active={sortColumn === "volatility"}
                  direction={sortDirection}
                  onClick={() => toggleSort("volatility")}
                />
                <th className="px-4 py-3 text-left font-medium text-xs text-muted uppercase tracking-wide">
                  Liquidity
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted uppercase tracking-wide">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedSymbol(row)}
                  className="border-b border-border/50 hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-foreground">
                    {row.symbol}
                  </td>
                  <td className="px-4 py-3 font-mono text-foreground">
                    ${row.price.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        row.change > 0
                          ? "text-success font-semibold"
                          : "text-error font-semibold"
                      }
                    >
                      {row.change > 0 ? "+" : ""}
                      {row.change.toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <RegimeBadge regime={row.regime} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{
                            width: `${row.confluence}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-primary">
                        {row.confluence}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <DirectionBadge direction={row.direction} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-semibold">
                      {row.signals}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <VolatilityMeter volatility={row.volatility} />
                  </td>
                  <td className="px-4 py-3">
                    <LiquidityBadge liquidity={row.liquidity} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted">
                    {row.lastUpdate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Panel */}
      {selectedSymbol && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border max-w-md w-full p-6 space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-semibold">{selectedSymbol.symbol}</h2>
                <p className="text-sm text-muted mt-1">
                  Current: ${selectedSymbol.price.toFixed(2)}
                </p>
              </div>
              <button
                onClick={() => setSelectedSymbol(null)}
                className="text-2xl leading-none text-muted hover:text-foreground"
              >
                ×
              </button>
            </div>

            {/* Active Signals */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Active Signals</h3>
              <div className="space-y-2">
                {Array.from({ length: selectedSymbol.signals }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 rounded bg-primary/10 border border-primary/20"
                  >
                    <span className="text-xs text-muted">
                      Signal {i + 1}
                    </span>
                    <span className="text-xs font-semibold text-primary">
                      Active
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Suggested Levels */}
            <div className="border-t border-border pt-4 space-y-3">
              <h3 className="text-sm font-semibold">Suggested Levels</h3>
              <div className="grid grid-cols-3 gap-3">
                <LevelBox
                  label="Entry"
                  value={`$${selectedSymbol.price.toFixed(2)}`}
                  hint="Market"
                />
                <LevelBox
                  label="Stop Loss"
                  value={`$${(selectedSymbol.price * 0.98).toFixed(2)}`}
                  hint="-2.0%"
                />
                <LevelBox
                  label="Target"
                  value={`$${(
                    selectedSymbol.price *
                    (selectedSymbol.direction === "bullish" ? 1.03 : 0.97)
                  ).toFixed(2)}`}
                  hint={
                    selectedSymbol.direction === "bullish" ? "+3.0%" : "-3.0%"
                  }
                />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 bg-background/50 rounded-lg p-3">
              <StatBox label="Confluence" value={`${selectedSymbol.confluence}%`} />
              <StatBox label="Volatility" value={`${selectedSymbol.volatility}%`} />
              <StatBox label="Regime" value={selectedSymbol.regime} />
              <StatBox label="Liquidity" value={selectedSymbol.liquidity} />
            </div>

            <button
              onClick={() => setSelectedSymbol(null)}
              className="w-full py-2 px-3 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SortHeader({
  label,
  column,
  active,
  direction,
  onClick,
}: {
  label: string;
  column: SortColumn;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className="px-4 py-3 text-left font-medium text-xs text-muted uppercase tracking-wide cursor-pointer hover:text-foreground transition-colors"
    >
      <div className="flex items-center gap-1">
        {label}
        {active && (
          <span className="text-primary">
            {direction === "asc" ? "▲" : "▼"}
          </span>
        )}
      </div>
    </th>
  );
}

function RegimeBadge({
  regime,
}: {
  regime: "trending" | "ranging" | "volatile";
}) {
  const colors = {
    trending: "bg-success/20 text-success border-success/30",
    ranging: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    volatile: "bg-error/20 text-error border-error/30",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${colors[regime]}`}
    >
      {regime.charAt(0).toUpperCase() + regime.slice(1)}
    </span>
  );
}

function DirectionBadge({
  direction,
}: {
  direction: "bullish" | "bearish" | "neutral";
}) {
  const colors = {
    bullish: "text-success",
    bearish: "text-error",
    neutral: "text-muted",
  };

  const symbols = {
    bullish: "↗ Bullish",
    bearish: "↘ Bearish",
    neutral: "→ Neutral",
  };

  return (
    <span className={`font-semibold text-sm ${colors[direction]}`}>
      {symbols[direction]}
    </span>
  );
}

function VolatilityMeter({ volatility }: { volatility: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-12 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            volatility > 35
              ? "bg-error"
              : volatility > 20
              ? "bg-yellow-500"
              : "bg-success"
          }`}
          style={{
            width: `${Math.min(volatility, 100)}%`,
          }}
        />
      </div>
      <span className="text-xs text-muted font-mono">{volatility}</span>
    </div>
  );
}

function LiquidityBadge({ liquidity }: { liquidity: "high" | "medium" | "low" }) {
  const colors = {
    high: "bg-success/20 text-success border-success/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low: "bg-error/20 text-error border-error/30",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${colors[liquidity]}`}
    >
      {liquidity.charAt(0).toUpperCase() + liquidity.slice(1)}
    </span>
  );
}

function LevelBox({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="text-center">
      <div className="text-xs text-muted uppercase tracking-wide font-medium">
        {label}
      </div>
      <div className="text-sm font-semibold mt-1">{value}</div>
      <div className="text-xs text-muted/70 mt-0.5">{hint}</div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted uppercase tracking-wide font-medium">
        {label}
      </div>
      <div className="text-sm font-semibold mt-1">{value}</div>
    </div>
  );
}
