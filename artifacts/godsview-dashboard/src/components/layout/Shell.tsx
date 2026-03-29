import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { DEFAULT_WATCH_SYMBOLS, normalizeMarketSymbol, toDisplaySymbol } from "@/lib/market/symbols";

type TickerEntry = {
  symbol: string;
  price: number;
  change: number;
  change_pct: number;
  direction: "up" | "down";
  error?: string;
};

function useLiveTicker() {
  const [tickers, setTickers] = useState<TickerEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [feedMode, setFeedMode] = useState<"sse" | "poll">("poll");

  useEffect(() => {
    let cancelled = false;
    let sseConnected = false;
    let lastSseAt = 0;
    const watchSymbols = DEFAULT_WATCH_SYMBOLS.slice(0, 6).map((symbol) => normalizeMarketSymbol(symbol));
    const watchSymbolSet = new Set(watchSymbols);

    const upsertTicker = (symbol: string, price: number) => {
      setTickers((prev) => {
        const bySymbol = new Map(prev.map((row) => [normalizeMarketSymbol(row.symbol), row]));
        const existing = bySymbol.get(symbol);

        if (existing) {
          const direction: "up" | "down" = price >= existing.price ? "up" : "down";
          bySymbol.set(symbol, { ...existing, symbol, price, direction });
        } else {
          bySymbol.set(symbol, {
            symbol,
            price,
            change: 0,
            change_pct: 0,
            direction: "up",
          });
        }

        return watchSymbols
          .map((sym) => bySymbol.get(sym))
          .filter((row): row is TickerEntry => Boolean(row));
      });
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };

    const fetchTickers = async (force = false) => {
      if (!force && sseConnected && Date.now() - lastSseAt < 4_000) {
        return;
      }

      try {
        const res = await fetch(`/api/alpaca/ticker?symbols=${watchSymbols.join(",")}`);
        if (!res.ok) return;
        const data = await res.json() as { tickers?: TickerEntry[] };
        if (!cancelled && data.tickers) {
          const rows = data.tickers
            .filter((t: TickerEntry) => !t.error)
            .map((t) => ({ ...t, symbol: normalizeMarketSymbol(t.symbol) }));

          const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
          setTickers(
            watchSymbols
              .map((symbol) => bySymbol.get(symbol))
              .filter((row): row is TickerEntry => Boolean(row))
          );
          setFeedMode("poll");
          setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        }
      } catch {
        // silent fail
      }
    };

    const es = new EventSource(`/api/alpaca/stream?symbols=${encodeURIComponent(watchSymbols.join(","))}&timeframe=1Min`);

    es.onopen = () => {
      if (cancelled) return;
      sseConnected = true;
      setFeedMode("sse");
    };

    es.onmessage = (evt) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse(evt.data) as { type?: string; symbol?: string; price?: number };
        if (payload.type !== "tick" || typeof payload.price !== "number") return;
        const symbol = normalizeMarketSymbol(payload.symbol ?? "");
        if (!watchSymbolSet.has(symbol)) return;
        sseConnected = true;
        lastSseAt = Date.now();
        setFeedMode("sse");
        upsertTicker(symbol, payload.price);
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      if (cancelled) return;
      setFeedMode("poll");
    };

    fetchTickers(true);
    const interval = setInterval(() => {
      void fetchTickers();
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      es.close();
    };
  }, []);

  return { tickers, lastUpdated, feedMode };
}

const navItems = [
  { href: "/", label: "Mission Control", icon: "dashboard", sub: "Overview" },
  { href: "/alpaca", label: "Live Intelligence", icon: "psychology", sub: "Analysis" },
  { href: "/infinity", label: "Infinity Screen", icon: "grid_view", sub: "Multi-Chart" },
  { href: "/signals", label: "Signal Feed", icon: "sensors", sub: "Pipeline" },
  { href: "/trades", label: "Trade Journal", icon: "receipt_long", sub: "Execution" },
  { href: "/performance", label: "Analytics", icon: "analytics", sub: "Performance" },
  { href: "/system", label: "System Core", icon: "memory", sub: "Diagnostics" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { tickers, lastUpdated, feedMode } = useLiveTicker();

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ backgroundColor: "#0e0e0f", color: "#ffffff" }}>
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(72,72,73,0.3)", backgroundColor: "#1a191b" }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#9cff93] text-xl">bolt</span>
          <span className="font-headline font-bold tracking-[0.2em] text-sm">GODSVIEW</span>
        </div>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{ color: "#767576" }}>
          <span className="material-symbols-outlined">menu</span>
        </button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "w-60 flex-col z-50 border-r",
        "fixed md:relative h-[calc(100vh-57px)] md:h-screen",
        mobileMenuOpen ? "flex translate-x-0" : "hidden md:flex"
      )} style={{ backgroundColor: "#0e0e0f", borderColor: "rgba(72,72,73,0.2)" }}>

        {/* Logo */}
        <div className="hidden md:flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
          <div className="w-7 h-7 flex items-center justify-center rounded" style={{ backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.25)" }}>
            <span className="material-symbols-outlined text-base" style={{ color: "#9cff93", fontSize: "16px" }}>bolt</span>
          </div>
          <div>
            <div className="font-headline font-bold tracking-[0.25em] text-sm" style={{ color: "#ffffff" }}>GODSVIEW</div>
            <div style={{ fontSize: "8px", color: "#767576", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "Space Grotesk" }}>
              AI Trading Terminal
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.25em", textTransform: "uppercase", fontFamily: "Space Grotesk", fontWeight: 700, padding: "0 8px 12px" }}>
            Pipeline Control
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded cursor-pointer group transition-all",
                  isActive ? "bg-[rgba(156,255,147,0.08)] border border-[rgba(156,255,147,0.15)]" : "border border-transparent hover:bg-[rgba(255,255,255,0.03)]"
                )}>
                  <span
                    className="material-symbols-outlined transition-colors"
                    style={{
                      fontSize: "18px",
                      color: isActive ? "#9cff93" : "#767576",
                    }}
                  >
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-xs font-medium font-headline truncate", isActive ? "text-white" : "text-[#adaaab]")}>
                      {item.label}
                    </div>
                  </div>
                  {isActive && (
                    <div className="w-1 h-1 rounded-full" style={{ backgroundColor: "#9cff93" }} />
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Live Price Ticker */}
        {tickers.length > 0 && (
          <div className="px-3 py-3 border-t" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
            <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "Space Grotesk", fontWeight: 700, marginBottom: "8px", paddingLeft: "4px" }}>
              Live Prices
            </div>
            <div className="space-y-1.5">
              {tickers.map((t) => {
                const up = t.direction === "up";
                const color = up ? "#9cff93" : "#ff7162";
                const sym = toDisplaySymbol(t.symbol);
                return (
                  <div key={t.symbol} className="flex items-center justify-between px-3 py-2 rounded" style={{ backgroundColor: "rgba(255,255,255,0.025)", border: "1px solid rgba(72,72,73,0.18)" }}>
                    <div className="flex items-center gap-2">
                      <span className="font-headline font-bold" style={{ fontSize: "10px", color: "#ffffff" }}>{sym}</span>
                    </div>
                    <div className="text-right">
                      <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff", fontWeight: 700 }}>
                        ${t.price > 1000 ? t.price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : t.price.toFixed(2)}
                      </div>
                      <div style={{ fontSize: "8px", fontFamily: "JetBrains Mono, monospace", color, fontWeight: 700 }}>
                        {up ? "▲" : "▼"} {Math.abs(t.change_pct).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {lastUpdated && (
              <div style={{ fontSize: "7px", color: "#484849", fontFamily: "JetBrains Mono, monospace", marginTop: "6px", paddingLeft: "4px" }}>
                {lastUpdated} · {feedMode === "sse" ? "SSE live" : "REST snapshot"}
              </div>
            )}
          </div>
        )}

        {/* System Status */}
        <div className="px-3 pb-4 border-t pt-4" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
          <div className="px-3 py-2.5 rounded" style={{ backgroundColor: "rgba(156,255,147,0.04)", border: "1px solid rgba(156,255,147,0.1)" }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#9cff93" }} />
              <span className="font-headline font-bold" style={{ fontSize: "9px", color: "#9cff93", letterSpacing: "0.1em", textTransform: "uppercase" }}>System Online</span>
            </div>
            <div style={{ fontSize: "9px", color: "#484849", fontFamily: "JetBrains Mono, monospace" }}>
              Crypto · 6-Layer Pipeline
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto" style={{ height: "100dvh", backgroundColor: "#0e0e0f" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 80% 0%, rgba(156,255,147,0.03) 0%, transparent 60%)",
          }}
        />
        <div className="relative z-10 p-5 md:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
