import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import {
  SIDEBAR_SECTION_ORDER,
  SIDEBAR_WATCHLIST,
  type AssetClass,
  normalizeMarketSymbol,
  toAlpacaSymbol,
} from "@/lib/market/symbols";

type FeedMode = "sse" | "poll" | "hybrid";

type TickerSnapshot = {
  symbol: string;
  price: number;
  change: number;
  change_pct: number;
  direction: "up" | "down";
  error?: string;
};

type LiveTickerRow = {
  symbol: string;
  label: string;
  assetClass: AssetClass;
  tvSymbol: string;
  price: number;
  change: number;
  change_pct: number;
  direction: "up" | "down";
};

type SetupMarker = {
  setupType: string;
  qualityPct: number;
};

const CATEGORY_META: Record<AssetClass, { label: string; color: string; icon: string; hotThreshold: number }> = {
  crypto: { label: "Crypto", color: "#9cff93", icon: "currency_bitcoin", hotThreshold: 0.6 },
  forex: { label: "Forex", color: "#67e8f9", icon: "currency_exchange", hotThreshold: 0.45 },
  futures: { label: "Futures", color: "#fbbf24", icon: "timeline", hotThreshold: 0.45 },
  stocks: { label: "Stocks", color: "#669dff", icon: "monitoring", hotThreshold: 0.75 },
};

function parseQualityPercent(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 1) return Math.round(parsed * 100);
  if (parsed <= 100) return Math.round(parsed);
  return null;
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  if (price >= 1) {
    return price.toFixed(2);
  }
  return price.toFixed(4);
}

function humanizeSetupType(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function useLiveTicker() {
  const [tickerBySymbol, setTickerBySymbol] = useState<Record<string, LiveTickerRow>>({});
  const [setupBySymbol, setSetupBySymbol] = useState<Record<string, SetupMarker>>({});
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [feedMode, setFeedMode] = useState<FeedMode>("poll");

  useEffect(() => {
    let cancelled = false;
    let sseConnected = false;
    let lastSseAt = 0;

    const watchSymbols = Array.from(
      new Set(SIDEBAR_WATCHLIST.map((item) => normalizeMarketSymbol(item.apiSymbol, ""))),
    ).filter(Boolean);

    const cryptoSymbols = Array.from(
      new Set(
        SIDEBAR_WATCHLIST
          .filter((item) => item.assetClass === "crypto")
          .map((item) => normalizeMarketSymbol(item.apiSymbol, "")),
      ),
    ).filter(Boolean);

    const hasCrossAssetPolling = watchSymbols.some((symbol) => !cryptoSymbols.includes(symbol));

    const watchMetaBySymbol = new Map(
      SIDEBAR_WATCHLIST.map((item) => [
        normalizeMarketSymbol(item.apiSymbol, ""),
        {
          label: item.label,
          assetClass: item.assetClass,
          tvSymbol: item.tvSymbol,
        },
      ]),
    );
    const POLL_INTERVAL_MS = 2_000;
    const SETUP_REFRESH_MS = 20_000;
    const STREAM_STALE_MS = 3_500;

    const touchUpdatedAt = () => {
      setLastUpdated(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };

    const upsertPriceTick = (rawSymbol: string, price: number) => {
      const symbol = normalizeMarketSymbol(rawSymbol, "");
      const meta = watchMetaBySymbol.get(symbol);
      if (!symbol || !meta || !Number.isFinite(price)) return;

      setTickerBySymbol((prev) => {
        const existing = prev[symbol];
        const direction: "up" | "down" = existing ? (price >= existing.price ? "up" : "down") : "up";

        return {
          ...prev,
          [symbol]: {
            symbol,
            label: meta.label,
            assetClass: meta.assetClass,
            tvSymbol: meta.tvSymbol,
            price,
            change: existing?.change ?? 0,
            change_pct: existing?.change_pct ?? 0,
            direction,
          },
        };
      });

      touchUpdatedAt();
    };

    const fetchTickers = async () => {
      try {
        const res = await fetch(`/api/alpaca/ticker?symbols=${watchSymbols.join(",")}`);
        if (!res.ok) return;

        const data = (await res.json()) as { tickers?: TickerSnapshot[] };
        if (cancelled || !Array.isArray(data.tickers)) return;

        setTickerBySymbol((prev) => {
          const next = { ...prev };

          for (const row of data.tickers ?? []) {
            if (!row || row.error) continue;

            const symbol = normalizeMarketSymbol(String(row.symbol ?? ""), "");
            const meta = watchMetaBySymbol.get(symbol);
            if (!symbol || !meta) continue;

            const fallbackDirection: "up" | "down" = (prev[symbol]?.price ?? row.price) <= row.price ? "up" : "down";
            const direction = row.direction === "up" || row.direction === "down" ? row.direction : fallbackDirection;

            next[symbol] = {
              symbol,
              label: meta.label,
              assetClass: meta.assetClass,
              tvSymbol: meta.tvSymbol,
              price: row.price,
              change: row.change,
              change_pct: row.change_pct,
              direction,
            };
          }

          return next;
        });

        setFeedMode(sseConnected ? "hybrid" : "poll");
        touchUpdatedAt();
      } catch {
        // silent fail
      }
    };

    const fetchSetupMarkers = async () => {
      const nextMarkers: Record<string, SetupMarker> = {};

      const assignMarker = (rawSymbol: unknown, rawSetup: unknown, rawQuality: unknown) => {
        const symbol = normalizeMarketSymbol(toAlpacaSymbol(String(rawSymbol ?? "")), "");
        if (!symbol || nextMarkers[symbol] || !watchMetaBySymbol.has(symbol)) return;

        const setupType = String(rawSetup ?? "").trim();
        if (!setupType) return;

        const qualityPct = parseQualityPercent(rawQuality);
        if (qualityPct === null || qualityPct < 60) return;

        nextMarkers[symbol] = {
          setupType,
          qualityPct,
        };
      };

      try {
        const signalsRes = await fetch("/api/signals?limit=120");
        if (signalsRes.ok) {
          const signalsData = (await signalsRes.json()) as {
            signals?: Array<Record<string, unknown>>;
          };

          for (const sig of signalsData.signals ?? []) {
            assignMarker(sig.instrument, sig.setup_type, sig.final_quality);
          }
        }
      } catch {
        // ignore and try accuracy fallback
      }

      // Fallback / enrichment from historical recall rows.
      if (Object.keys(nextMarkers).length < 3) {
        try {
          const accuracyRes = await fetch("/api/alpaca/accuracy");
          if (accuracyRes.ok) {
            const accuracyData = (await accuracyRes.json()) as {
              recent?: Array<Record<string, unknown>>;
            };

            for (const row of accuracyData.recent ?? []) {
              assignMarker(row.symbol, row.setup_type, row.final_quality);
              if (Object.keys(nextMarkers).length >= watchSymbols.length) break;
            }
          }
        } catch {
          // silent
        }
      }

      if (!cancelled) {
        setSetupBySymbol(nextMarkers);
      }
    };

    let stream: EventSource | null = null;

    if (cryptoSymbols.length > 0) {
      stream = new EventSource(
        `/api/alpaca/stream?symbols=${encodeURIComponent(cryptoSymbols.join(","))}&timeframe=1Min`,
      );

      stream.onopen = () => {
        if (cancelled) return;
        sseConnected = true;
        setFeedMode(hasCrossAssetPolling ? "hybrid" : "sse");
      };

      stream.onmessage = (evt) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse(evt.data) as { type?: string; symbol?: string; price?: number };
          if (payload.type !== "tick" || typeof payload.symbol !== "string" || typeof payload.price !== "number") {
            return;
          }

          sseConnected = true;
          lastSseAt = Date.now();
          upsertPriceTick(payload.symbol, payload.price);
          setFeedMode(hasCrossAssetPolling ? "hybrid" : "sse");
        } catch {
          // ignore malformed frames
        }
      };

      stream.onerror = () => {
        if (cancelled) return;
        setFeedMode("poll");
      };
    }

    void fetchTickers();
    void fetchSetupMarkers();

    const tickerInterval = setInterval(() => {
      const streamStale = Date.now() - lastSseAt > STREAM_STALE_MS;
      if (!sseConnected || hasCrossAssetPolling || streamStale) {
        void fetchTickers();
      }
    }, POLL_INTERVAL_MS);

    const setupInterval = setInterval(() => {
      void fetchSetupMarkers();
    }, SETUP_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(tickerInterval);
      clearInterval(setupInterval);
      stream?.close();
    };
  }, []);

  return { tickerBySymbol, setupBySymbol, lastUpdated, feedMode };
}

const navItems = [
  { href: "/", label: "Mission Control", icon: "dashboard", sub: "Overview" },
  { href: "/brain", label: "Brain", icon: "neurology", sub: "Intelligence" },
  { href: "/alpaca", label: "Live Intelligence", icon: "psychology", sub: "Analysis" },
  { href: "/infinity", label: "Infinity Screen", icon: "grid_view", sub: "Multi-Chart" },
  { href: "/pipeline", label: "Pipeline Engine", icon: "hub", sub: "6-Layer AI" },
  { href: "/candle-xray", label: "Candle X-Ray", icon: "radiology", sub: "Microstructure" },
  { href: "/signals", label: "Signal Feed", icon: "sensors", sub: "Pipeline" },
  { href: "/setup-explorer", label: "Setup Explorer", icon: "explore", sub: "Strategy Matrix" },
  { href: "/trades", label: "Trade Journal", icon: "receipt_long", sub: "Execution" },
  { href: "/war-room", label: "War Room", icon: "groups", sub: "Consensus" },
  { href: "/proof", label: "Proof", icon: "check_circle", sub: "Performance" },
  { href: "/checklist", label: "Checklist", icon: "task_alt", sub: "Validation" },
  { href: "/ops", label: "Ops Monitor", icon: "monitor_heart", sub: "Health" },
  { href: "/quant-lab", label: "Quant Lab", icon: "science", sub: "Backtest" },
  { href: "/portfolio", label: "Portfolio", icon: "account_balance", sub: "Allocation" },
  { href: "/execution", label: "Execution", icon: "bolt", sub: "Live Orders" },
  { href: "/audit", label: "Audit Trail", icon: "history", sub: "Event Log" },
  { href: "/decision-replay", label: "Decision Replay", icon: "travel_explore", sub: "Explainability" },
  { href: "/alerts", label: "Alerts", icon: "bell", sub: "Live Alerts" },
  { href: "/reports", label: "Session Reports", icon: "summarize", sub: "Intelligence" },
  { href: "/risk", label: "Risk Command", icon: "shield", sub: "Safety Rails" },
  { href: "/super-intelligence", label: "Super Intelligence", icon: "auto_awesome", sub: "AI Engine" },
  { href: "/institutional-intelligence", label: "Inst. Intelligence", icon: "trending_up", sub: "Macro · Sentiment" },
  { href: "/backtester", label: "Backtester", icon: "bar_chart_4_bars", sub: "Multi-TF Replay" },
  { href: "/intelligence-center", label: "Control Center", icon: "monitor_heart", sub: "System Status" },
  { href: "/trade-journal", label: "Trade Journal", icon: "book", sub: "PnL Attribution" },
  { href: "/watchlist", label: "Watchlist Scanner", icon: "radar", sub: "Auto-Scan" },
  { href: "/analytics", label: "Equity Analytics", icon: "show_chart", sub: "Equity · Circuit Breaker" },
  { href: "/performance", label: "Analytics", icon: "analytics", sub: "Performance" },
  { href: "/market-structure", label: "Market Structure", icon: "bar_chart", sub: "Market Microstructure" },
  { href: "/daily-review", label: "Daily Review", icon: "calendar_today", sub: "Daily Analysis" },
  { href: "/side-by-side", label: "Side-by-Side", icon: "compare_arrows", sub: "Comparison Tool" },
  { href: "/decision-loop", label: "Decision Loop", icon: "route", sub: "Strategy Pipeline" },
  { href: "/trust-surface", label: "Trust Surface", icon: "verified_user", sub: "Operator View" },
  { href: "/eval-harness", label: "Eval Harness", icon: "science", sub: "Benchmarks" },
  { href: "/calibration", label: "Calibration", icon: "tune", sub: "Live Truth" },
  { href: "/system", label: "System Core", icon: "memory", sub: "Diagnostics" },
  { href: "/stitch-lab", label: "Stitch Vault", icon: "palette", sub: "Design Pack" },
  { href: "/brain-graph", label: "God Brain", icon: "neurology", sub: "Live Neural Graph" },
  { href: "/mcp-signals", label: "MCP Signals", icon: "swap_vert", sub: "Signal Flow" },
  { href: "/mcp-backtester", label: "MCP Backtester", icon: "compare", sub: "MCP vs Raw" },
  { href: "/pipeline-status", label: "Pipeline Status", icon: "hub", sub: "Live Pipeline" },
  { href: "/regime-intelligence", label: "Regime Intel", icon: "psychology", sub: "Adaptive Strategy" },
  { href: "/correlation-lab", label: "Correlation Lab", icon: "grid_view", sub: "Portfolio Risk Map" },
  { href: "/execution-control", label: "Exec Control", icon: "tune", sub: "Orders & Venues" },
  { href: "/sentiment-intel", label: "Sentiment", icon: "trending_up", sub: "News & Social Intel" },
  { href: "/performance-analytics", label: "Performance", icon: "leaderboard", sub: "Journal & Rankings" },
  { href: "/alert-center", label: "Alert Center", icon: "notification_important", sub: "Rules & Anomalies" },
  { href: "/microstructure", label: "Microstructure", icon: "candlestick_chart", sub: "Order Flow & Depth" },
  { href: "/system-audit", label: "Truth Audit", icon: "verified", sub: "System Integrity" },
  { href: "/data-integrity", label: "Data Integrity", icon: "fact_check", sub: "Feed & Tick Health" },
  { href: "/backtest-credibility", label: "Backtest Lab", icon: "biotech", sub: "Credibility & Overfit" },
  { href: "/exec-reliability", label: "Exec Reliability", icon: "security", sub: "Failsafe & Recon" },
  { href: "/risk-command-v2", label: "Risk v2", icon: "shield", sub: "VaR & Capital Guard" },
  { href: "/model-governance", label: "Model Gov", icon: "model_training", sub: "Registry & Drift" },
  { href: "/settings", label: "Settings", icon: "settings", sub: "Configuration" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { tickerBySymbol, setupBySymbol, lastUpdated, feedMode } = useLiveTicker();

  const groupedTickers = useMemo(() => {
    return SIDEBAR_SECTION_ORDER.map((assetClass) => {
      const rows = SIDEBAR_WATCHLIST
        .filter((item) => item.assetClass === assetClass)
        .map((item) => {
          const apiSymbol = normalizeMarketSymbol(item.apiSymbol, "");
          const ticker = tickerBySymbol[apiSymbol];
          const setup = setupBySymbol[apiSymbol];
          const moveMagnitude = Math.abs(ticker?.change_pct ?? 0);

          return {
            ...item,
            apiSymbol,
            ticker,
            setup,
            moveMagnitude,
          };
        })
        .sort((a, b) => b.moveMagnitude - a.moveMagnitude)
        .slice(0, 4);

      return {
        assetClass,
        rows,
      };
    });
  }, [tickerBySymbol, setupBySymbol]);

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
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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

          {/* Grouped Live Movers */}
          <div className="pt-3 mt-3 border-t" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
            <div style={{ fontSize: "8px", color: "#484849", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "Space Grotesk", fontWeight: 700, marginBottom: "8px", padding: "0 4px" }}>
              Live Movers · TradingView Universe
            </div>

            <div className="space-y-2">
              {groupedTickers.map(({ assetClass, rows }) => {
                const meta = CATEGORY_META[assetClass];
                return (
                  <div key={assetClass} className="rounded px-2 py-2" style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(72,72,73,0.18)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined" style={{ fontSize: "13px", color: meta.color }}>{meta.icon}</span>
                        <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: meta.color, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
                          {meta.label}
                        </span>
                      </div>
                      <span style={{ fontSize: "7px", color: "#484849", fontFamily: "JetBrains Mono, monospace" }}>
                        {rows.filter((row) => !!row.ticker).length}/{rows.length}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {rows.map((row) => {
                        const ticker = row.ticker;
                        const setup = row.setup;
                        const hasLive = !!ticker && Number.isFinite(ticker.price);
                        const up = ticker?.direction === "up";
                        const pct = Math.abs(ticker?.change_pct ?? 0);
                        const isHot = hasLive && pct >= meta.hotThreshold;
                        const priceColor = up ? "#9cff93" : "#ff7162";
                        const setupColor = (setup?.qualityPct ?? 0) >= 70 ? "#9cff93" : "#fbbf24";

                        return (
                          <div key={row.id} className="flex items-start justify-between gap-2 px-1 py-1 rounded" style={{ backgroundColor: "rgba(255,255,255,0.02)" }}>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-headline font-bold truncate" style={{ fontSize: "9px", color: "#ffffff" }}>{row.label}</span>
                                {isHot && (
                                  <span style={{ fontSize: "6px", fontFamily: "Space Grotesk", color: "#ff7162", border: "1px solid rgba(255,113,98,0.45)", backgroundColor: "rgba(255,113,98,0.12)", borderRadius: "3px", padding: "0 3px", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
                                    Hot
                                  </span>
                                )}
                              </div>
                              <div className="truncate" style={{ fontSize: "7px", color: "#484849", fontFamily: "JetBrains Mono, monospace" }}>
                                {row.tvSymbol}
                              </div>
                              {setup && (
                                <div className="truncate" style={{ fontSize: "7px", color: setupColor, fontFamily: "Space Grotesk", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: "1px" }}>
                                  Setup {humanizeSetupType(setup.setupType)} · {setup.qualityPct}%
                                </div>
                              )}
                            </div>

                            <div className="text-right shrink-0">
                              <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff", fontWeight: 700 }}>
                                {hasLive ? `$${formatPrice(ticker.price)}` : "—"}
                              </div>
                              <div style={{ fontSize: "7px", fontFamily: "JetBrains Mono, monospace", color: hasLive ? priceColor : "#484849", fontWeight: 700 }}>
                                {hasLive ? `${up ? "▲" : "▼"} ${pct.toFixed(2)}%` : "No feed"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {lastUpdated && (
              <div style={{ fontSize: "7px", color: "#484849", fontFamily: "JetBrains Mono, monospace", marginTop: "8px", paddingLeft: "4px" }}>
                {lastUpdated} · {feedMode === "sse" ? "SSE live" : feedMode === "hybrid" ? "SSE+REST" : "REST snapshot"}
              </div>
            )}
          </div>
        </nav>

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
