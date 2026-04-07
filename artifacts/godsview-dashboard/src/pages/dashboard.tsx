import { useGetSystemStatus, useGetPerformance, useGetSignals } from "@workspace/api-client-react";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { format } from "date-fns";
import { Link } from "wouter";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import TradingViewChart from "@/components/TradingViewChart";
import BookmapPanel from "@/components/BookmapPanel";
import CandleIntelligencePanel from "@/components/CandleIntelligencePanel";
import CVDPanel from "@/components/CVDPanel";
import ChartIntelStrip from "@/components/ChartIntelStrip";
import { isCryptoSymbol } from "@/lib/market/symbols";

const C = {
  bg: "#0e0e0f",
  card: "#1a191b",
  cardHigh: "#201f21",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>
      {children}
    </span>
  );
}

type DiagnosticsLayer = { status: "live" | "degraded" | "offline"; detail: string };
type DiagnosticsPayload = {
  system_status: "healthy" | "partial" | "degraded";
  timestamp: string;
  layers: Record<string, DiagnosticsLayer>;
  recommendations: string[];
};
type ModelDiagnosticsPayload = {
  status: { status: "active" | "warning" | "error"; message: string };
  validation: { auc: number; accuracy: number; evaluatedSamples: number } | null;
  drift: { status: "stable" | "watch" | "drift"; winRateDelta: number; qualityDelta: number } | null;
};
type ProofBucket = {
  key: string;
  closedSignals: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
};
type ProofPayload = {
  overall: { closedSignals: number; winRate: number; profitFactor: number; expectancyR: number };
  rows: ProofBucket[];
};
type OosPayload = {
  deltas: { winRateDelta: number; expectancyDeltaR: number; avgFinalQualityDelta: number };
};
type ConsciousnessBoardRow = {
  symbol: string;
  attention_score: number;
  readiness: "allow" | "watch" | "block";
  setup_family: string;
  direction: "long" | "short" | "none";
  structure_score: number;
  orderflow_score: number;
  context_score: number;
  memory_score: number;
  reasoning_score: number;
  risk_score: number;
  reasoning_verdict: string;
  risk_state: "allowed" | "blocked";
  block_reason: string;
};
type ConsciousnessSnapshot = {
  has_data: boolean;
  generated_at: string;
  board: ConsciousnessBoardRow[];
  fetched_at: string;
  source: {
    exists: boolean;
    path: string;
    error: string | null;
  };
};
type LivePosition = {
  symbol: string;
  side: string;
  qty: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  market_value: string;
  current_price: string;
};
type LivePositionsResponse = {
  positions?: LivePosition[];
  error?: string;
  message?: string;
};
type OpenOrder = {
  id: string;
  symbol: string;
  side: string;
  status: string;
  qty: string;
};
type OpenOrdersResponse = {
  orders?: OpenOrder[];
  error?: string;
  message?: string;
};
type CandleIntelBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  imbalance: number;
  absorption: number;
  liquidity_strength: number;
  reversal_score: number;
  wick_top: number;
  wick_bot: number;
  body_ratio: number;
  direction: "bull" | "bear";
  is_doji: boolean;
  is_high_vol: boolean;
  is_absorption: boolean;
  is_reversal_signal: boolean;
};
type CandleIntelResponse = {
  symbol: string;
  timeframe: string;
  bars: CandleIntelBar[];
  summary: {
    total_bars: number;
    avg_volume: number;
    avg_range: number;
    reversal_signals: number;
    absorption_zones: number;
    high_vol_events: number;
    top_reversals: Array<{ time: number; price: number; score: number; direction: string }>;
  };
};

function buildNeuralCurvePath(targetX: number, targetY: number, i: number): string {
  const startX = 50;
  const startY = 50;
  const direction = targetX >= 50 ? 1 : -1;
  const baseCurvature = 7 + i * 1.4;
  const controlX = (startX + targetX) / 2 + direction * baseCurvature;
  const controlY = (startY + targetY) / 2 - Math.abs(targetX - startX) * 0.18;
  return `M ${startX} ${startY} Q ${controlX} ${controlY} ${targetX} ${targetY}`;
}

function normalizeInstrumentKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function toCandleMs(unixOrMs: number): number {
  return unixOrMs > 1_000_000_000_000 ? unixOrMs : unixOrMs * 1000;
}

function getSymbolSeed(symbol: string): number {
  return [...symbol].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

function buildSparklineSeries(row: ConsciousnessBoardRow, length = 18): number[] {
  const seed = getSymbolSeed(row.symbol);
  const base = 30 + row.attention_score * 38;
  const amplitude = 7 + row.orderflow_score * 10;
  const trendBase = row.direction === "long" ? 0.85 : row.direction === "short" ? -0.85 : 0.2;
  const trend = trendBase * (0.35 + row.structure_score * 0.45);
  return Array.from({ length }, (_, i) => {
    const wave1 = Math.sin((i + seed) * 0.55) * amplitude * 0.45;
    const wave2 = Math.cos((i + seed * 0.17) * 0.24) * amplitude * 0.3;
    const jitter = Math.sin((seed + i * 3) * 0.16) * 1.6;
    return Math.min(96, Math.max(5, base + wave1 + wave2 + jitter + trend * i));
  });
}

function buildSparklinePath(values: number[], width: number, height: number, padding = 2): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  return values
    .map((value, i) => {
      const x = padding + (i / Math.max(values.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / span) * (height - padding * 2);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function Dashboard() {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(null);
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);
  const [xrayTab, setXrayTab] = useState<"summary" | "orderbook" | "heatmap" | "flow" | "ai">("summary");
  const [selectedCandleTs, setSelectedCandleTs] = useState<number | null>(null);
  const [orbitPhase, setOrbitPhase] = useState(0);

  // ── Data hooks — 5 s auto-refresh ────────────────────────────────────────
  const { data: systemStatus, isLoading: sysLoading, isError: sysError, refetch: refetchStatus } =
    useGetSystemStatus();

  const { data: performance, isLoading: perfLoading, isError: perfError, refetch: refetchPerf } =
    useGetPerformance({ days: 1 });

  const { data: signals, isLoading: sigLoading, isError: sigError, refetch: refetchSigs } =
    useGetSignals({ limit: 5 });
  const { data: diagnostics, isError: diagError, refetch: refetchDiag } = useQuery<DiagnosticsPayload>({
    queryKey: ["system-diagnostics"],
    queryFn: () => fetch("/api/system/diagnostics").then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 2,
  });
  const { data: modelDiagnostics, refetch: refetchModelDiagnostics } = useQuery<ModelDiagnosticsPayload>({
    queryKey: ["system-model-diagnostics"],
    queryFn: () => fetch("/api/system/model/diagnostics").then((r) => r.json()),
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: 2,
  });
  const { data: siStatus } = useQuery<{ status: string; ensemble: any; message: string }>({
    queryKey: ["super-intelligence-status"],
    queryFn: () => fetch("/api/super-intelligence/status").then((r) => r.json()),
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: 1,
  });
  const { data: prodStats } = useQuery<{ daily_trades: number; max_daily_trades: number }>({
    queryKey: ["production-stats"],
    queryFn: () => fetch("/api/super-intelligence/production-stats").then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 1,
  });
  const { data: proofBySetup, refetch: refetchProofBySetup } = useQuery<ProofPayload>({
    queryKey: ["proof-by-setup"],
    queryFn: () => fetch("/api/system/proof/by-setup?days=30&min_signals=20").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 2,
  });
  const { data: oosProof, refetch: refetchOosProof } = useQuery<OosPayload>({
    queryKey: ["proof-oos-vs-is"],
    queryFn: () => fetch("/api/system/proof/oos-vs-is?lookback_days=90&oos_days=14&min_signals=20").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 2,
  });
  const { data: consciousness, refetch: refetchConsciousness } = useQuery<ConsciousnessSnapshot>({
    queryKey: ["system-consciousness-latest-dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/system/consciousness/latest");
      if (!r.ok) throw new Error(`consciousness snapshot fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: 2,
  });
  const { data: livePositionsData } = useQuery<LivePositionsResponse>({
    queryKey: ["alpaca-live-positions-dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/alpaca/positions/live");
      if (!r.ok) throw new Error(`positions fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 15_000,
    staleTime: 8_000,
    retry: 2,
  });
  const { data: openOrders } = useQuery<OpenOrdersResponse>({
    queryKey: ["alpaca-open-orders-dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/alpaca/orders?status=open&limit=50");
      if (!r.ok) throw new Error(`open orders fetch failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 15_000,
    staleTime: 8_000,
    retry: 2,
  });

  // Fallback manual interval — 30 s to avoid Alpaca 429 rate limits
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      refetchStatus();
      refetchPerf();
      refetchSigs();
      refetchDiag();
      refetchModelDiagnostics();
      refetchProofBySetup();
      refetchOosProof();
      refetchConsciousness();
    }, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refetchStatus, refetchPerf, refetchSigs, refetchDiag, refetchModelDiagnostics, refetchProofBySetup, refetchOosProof, refetchConsciousness]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) return;
    const id = setInterval(() => {
      setOrbitPhase((prev) => (prev + 0.022) % (Math.PI * 2));
    }, 120);
    return () => clearInterval(id);
  }, []);

  const isInitialLoading =
    (sysLoading && !systemStatus) ||
    (perfLoading && !performance) ||
    (sigLoading && !signals);

  // NOTE: early return moved below all hooks to satisfy Rules of Hooks

  const layers = systemStatus?.layers ?? [];
  const sigs = signals?.signals ?? [];
  const hasDataIssue = sysError || perfError || sigError || diagError;
  const diagnosticLayers = diagnostics ? Object.values(diagnostics.layers) : [];
  const liveLayerCount = diagnosticLayers.filter((layer: any) => layer.status === "live").length;
  const degradedLayerCount = diagnosticLayers.filter((layer: any) => layer.status === "degraded").length;
  const offlineLayerCount = diagnosticLayers.filter((layer: any) => layer.status === "offline").length;
  const coreScore = diagnosticLayers.length > 0
    ? Math.round(((liveLayerCount + degradedLayerCount * 0.5) / diagnosticLayers.length) * 100)
    : null;
  const coreStatus = diagnostics?.system_status ?? (offlineLayerCount > 0 ? "degraded" : degradedLayerCount > 0 ? "partial" : "healthy");

  // ── P&L calculations ──────────────────────────────────────────────────────
  const realizedPnl = performance?.total_pnl ?? 0;
  const unrealizedPnl = (systemStatus as Record<string, number> | undefined)?.unrealized_pnl ?? 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const livePositions = (systemStatus as Record<string, number> | undefined)?.live_positions ?? 0;
  const closedTrades = performance?.total_trades ?? 0;

  const pnlSub = (() => {
    const parts = [];
    if (closedTrades > 0) parts.push(`${closedTrades} closed`);
    if (livePositions > 0) parts.push(`${livePositions} open`);
    return parts.length > 0 ? parts.join(" · ") : "No trades yet";
  })();

  const winRate = performance?.win_rate ?? 0;
  const expectancy = performance?.expectancy ?? 0;

  // Chart symbol: follow active instrument from system status, default BTCUSD
  const rawInstrument = systemStatus?.active_instrument ?? "BTCUSD";
  // Normalize: strip /USD suffix if needed, map to chart format
  const activeChartSymbol =
    rawInstrument.includes("BTC") ? "BTCUSD" :
    rawInstrument.includes("ETH") ? "ETHUSD" : "BTCUSD";
  const board = consciousness?.board ?? [];
  const rankedBoard = [...board].sort((a: any, b: any) => b.attention_score - a.attention_score);
  const featuredBrainNodes = rankedBoard.slice(0, 8);
  const avgAttention = rankedBoard.length > 0 ? rankedBoard.reduce((sum: any, row: any) => sum + row.attention_score, 0) / rankedBoard.length : 0;
  const avgRiskScore = rankedBoard.length > 0 ? rankedBoard.reduce((sum: any, row: any) => sum + row.risk_score, 0) / rankedBoard.length : 0;
  const avgStructureScore = rankedBoard.length > 0 ? rankedBoard.reduce((sum: any, row: any) => sum + row.structure_score, 0) / rankedBoard.length : 0;
  const avgOrderflowScore = rankedBoard.length > 0 ? rankedBoard.reduce((sum: any, row: any) => sum + row.orderflow_score, 0) / rankedBoard.length : 0;
  const bullishBiasCount = rankedBoard.filter((row: any) => row.direction === "long").length;
  const bearishBiasCount = rankedBoard.filter((row: any) => row.direction === "short").length;
  const sentimentQuality = sigs.length > 0 ? sigs.reduce((sum: any, row: any) => sum + row.final_quality, 0) / sigs.length : avgAttention * 100;
  const sentimentSign = winRate >= 0.5 ? "+" : "";
  const sentimentLabel = bullishBiasCount > bearishBiasCount ? "Bullish" : bearishBiasCount > bullishBiasCount ? "Bearish" : "Balanced";
  const setupAlerts = sigs.slice(0, 4);
  const heroSignal = sigs[0];
  const heroSignalDirection = heroSignal
    ? (heroSignal.setup_type.toLowerCase().includes("short") || heroSignal.setup_type.toLowerCase().includes("bear") ? "sell" : "buy")
    : rankedBoard[0]?.direction === "short"
      ? "sell"
      : rankedBoard[0]?.direction === "long"
        ? "buy"
        : "none";
  const executionSlippageLabel = avgRiskScore < 0.35 ? "Low" : avgRiskScore < 0.65 ? "Moderate" : "High";
  const executionFillLabel = avgOrderflowScore > 0.7 ? "Excellent" : avgOrderflowScore > 0.5 ? "Good" : "Watch";
  const executionRiskLabel = avgRiskScore < 0.35 ? "Disciplined" : avgRiskScore < 0.65 ? "Moderate" : "Elevated";
  const livePositionsList = livePositionsData?.positions ?? [];
  const openOrdersList = openOrders?.orders ?? [];
  const positionBySymbol = useMemo(() => {
    const map = new Map<string, LivePosition>();
    for (const pos of livePositionsList) {
      map.set(normalizeInstrumentKey(pos.symbol), pos);
    }
    return map;
  }, [livePositionsList]);
  const openOrderBySymbol = useMemo(() => {
    const map = new Map<string, { count: number; status: string; side: string }>();
    for (const order of openOrdersList) {
      const key = normalizeInstrumentKey(order.symbol);
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(key, { count: 1, status: order.status, side: order.side });
      }
    }
    return map;
  }, [openOrdersList]);
  const orbitNodes = useMemo(
    () => {
      const count = Math.max(featuredBrainNodes.length, 1);
      const angleStep = (Math.PI * 2) / count;
      const nodes = featuredBrainNodes.map((row: any, idx) => {
        const attention = Math.max(0, Math.min(1, row.attention_score));
        const seed = (getSymbolSeed(row.symbol) % 17) * 0.01;
        const angle = -Math.PI / 2 + idx * angleStep + orbitPhase + seed;
        const radiusX = 22 + attention * 20;
        const radiusY = 16 + attention * 12;
        const left = 50 + Math.cos(angle) * radiusX;
        const top = 50 + Math.sin(angle) * radiusY;
        return { row, left, top };
      });

      const minDistance = 11.5;
      for (let iter = 0; iter < 2; iter += 1) {
        for (let i = 0; i < nodes.length; i += 1) {
          for (let j = i + 1; j < nodes.length; j += 1) {
            const dx = nodes[j].left - nodes[i].left;
            const dy = nodes[j].top - nodes[i].top;
            const dist = Math.hypot(dx, dy);
            if (dist < minDistance) {
              const push = (minDistance - dist) / 2;
              const nx = dx / Math.max(dist, 0.0001);
              const ny = dy / Math.max(dist, 0.0001);
              nodes[i].left -= nx * push;
              nodes[i].top -= ny * push;
              nodes[j].left += nx * push;
              nodes[j].top += ny * push;
            }
          }
        }
      }

      return nodes.map((node: any) => {
        const clampedLeft = Math.min(90, Math.max(10, node.left));
        const clampedTop = Math.min(86, Math.max(14, node.top));
        return {
          row: node.row,
          left: clampedLeft,
          top: clampedTop,
          leftPct: `${clampedLeft.toFixed(2)}%`,
          topPct: `${clampedTop.toFixed(2)}%`,
        };
      });
    },
    [featuredBrainNodes, orbitPhase]
  );
  const surgeTopSymbols = orbitNodes
    .slice()
    .sort((a: any, b: any) => b.row.attention_score - a.row.attention_score)
    .slice(0, 3)
    .map((row: any) => row.row.symbol);
  const activeFocusedSymbol = pinnedSymbol ?? hoveredSymbol;
  const focusedNode = useMemo(
    () =>
      rankedBoard.find((row: any) => row.symbol === activeFocusedSymbol) ??
      orbitNodes[0]?.row ??
      null,
    [rankedBoard, activeFocusedSymbol, orbitNodes]
  );
  const drawerNode = useMemo(
    () =>
      rankedBoard.find((row: any) => row.symbol === drawerSymbol) ??
      focusedNode ??
      null,
    [rankedBoard, drawerSymbol, focusedNode]
  );
  const drawerExecution = useMemo(() => {
    if (!drawerNode) return { position: null as LivePosition | null, order: null as { count: number; status: string; side: string } | null };
    const key = normalizeInstrumentKey(drawerNode.symbol);
    return {
      position: positionBySymbol.get(key) ?? null,
      order: openOrderBySymbol.get(key) ?? null,
    };
  }, [drawerNode, positionBySymbol, openOrderBySymbol]);
  const xraySymbol = drawerNode?.symbol ?? null;
  const xrayTimeframe = "1Min";
  const xrayIsCrypto = xraySymbol ? isCryptoSymbol(xraySymbol) : false;
  const { data: candleXrayData } = useQuery<CandleIntelResponse>({
    queryKey: ["brain-focus-candle-intel", xraySymbol, xrayTimeframe],
    queryFn: async () => {
      const r = await fetch(`/api/market/candle-intelligence?symbol=${encodeURIComponent(xraySymbol ?? "BTCUSD")}&timeframe=${xrayTimeframe}&bars=120`);
      if (!r.ok) throw new Error(`candle intelligence fetch failed: ${r.status}`);
      return r.json();
    },
    enabled: Boolean(xraySymbol),
    refetchInterval: 45_000,
    staleTime: 20_000,
    retry: 2,
  });
  const selectedCandle = useMemo(() => {
    const bars = candleXrayData?.bars ?? [];
    if (!bars.length) return null;
    return bars.find((bar) => bar.time === selectedCandleTs) ?? bars[bars.length - 1];
  }, [candleXrayData, selectedCandleTs]);
  const selectedCandleTags = useMemo(() => {
    if (!selectedCandle) return [];
    const tags: string[] = [];
    if (selectedCandle.is_reversal_signal) tags.push("Reversal Signal");
    if (selectedCandle.is_absorption) tags.push("Absorption");
    if (selectedCandle.imbalance > 0.45) tags.push("Momentum Burst");
    if (selectedCandle.imbalance < -0.45) tags.push("Sell Aggression");
    if (selectedCandle.is_high_vol) tags.push("High Volatility");
    if (selectedCandle.wick_top > 0.45 || selectedCandle.wick_bot > 0.45) tags.push("Liquidity Sweep");
    if (selectedCandle.is_doji) tags.push("Doji / Indecision");
    return tags;
  }, [selectedCandle]);
  const selectedCandleAi = useMemo(() => {
    if (!selectedCandle || !drawerNode) return "Select a candle to generate Candle X-Ray explanation.";
    const narrative: string[] = [];
    const direction = selectedCandle.direction === "bull" ? "bullish" : "bearish";
    narrative.push(`This ${drawerNode.symbol} candle closed ${direction} with imbalance ${selectedCandle.imbalance >= 0 ? "+" : ""}${selectedCandle.imbalance.toFixed(2)} and liquidity strength ${selectedCandle.liquidity_strength.toFixed(2)}.`);
    if (selectedCandle.is_absorption) {
      narrative.push("Wick/body profile indicates absorption against the immediate move, suggesting hidden resting liquidity near the candle extremes.");
    }
    if (selectedCandle.is_reversal_signal) {
      narrative.push("Reversal score is elevated, so this candle likely marked a local turning event or trap response.");
    }
    if (selectedCandle.wick_top > 0.45 || selectedCandle.wick_bot > 0.45) {
      narrative.push("Large wick signature implies sweep behavior and potential stop-run participation at this level.");
    }
    narrative.push(`Brain context currently tags ${drawerNode.setup_family} with readiness ${drawerNode.readiness.toUpperCase()} and risk state ${drawerNode.risk_state.toUpperCase()}.`);
    return narrative.join(" ");
  }, [selectedCandle, drawerNode]);
  const xrayBars = useMemo(() => {
    const bars = candleXrayData?.bars ?? [];
    if (!bars.length) return [];
    return bars.slice(-32);
  }, [candleXrayData]);
  const xrayTabs: Array<{ key: "summary" | "orderbook" | "heatmap" | "flow" | "ai"; label: string; icon: string }> = [
    { key: "summary", label: "Summary", icon: "lightbulb" },
    { key: "orderbook", label: "Order Book", icon: "stacked_bar_chart" },
    { key: "heatmap", label: "Heatmap", icon: "heat_pump" },
    { key: "flow", label: "Flow", icon: "monitoring" },
    { key: "ai", label: "AI", icon: "neurology" },
  ];

  useEffect(() => {
    if (pinnedSymbol && !rankedBoard.some((row: any) => row.symbol === pinnedSymbol)) {
      setPinnedSymbol(null);
    }
  }, [pinnedSymbol, rankedBoard]);
  useEffect(() => {
    if (drawerSymbol && !rankedBoard.some((row: any) => row.symbol === drawerSymbol)) {
      setDrawerSymbol(null);
    }
  }, [drawerSymbol, rankedBoard]);
  useEffect(() => {
    setXrayTab("summary");
  }, [drawerSymbol]);
  useEffect(() => {
    const bars = candleXrayData?.bars ?? [];
    if (!bars.length) {
      setSelectedCandleTs(null);
      return;
    }
    if (!selectedCandleTs || !bars.some((bar) => bar.time === selectedCandleTs)) {
      setSelectedCandleTs(bars[bars.length - 1].time);
    }
  }, [candleXrayData, selectedCandleTs]);

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary, boxShadow: `0 0 8px ${C.primary}` }} />
          <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em" }}>LOADING PIPELINE</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Mission Control
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Pipeline Overview</h1>
          <div style={{ fontSize: "10px", color: C.muted, fontFamily: "Space Grotesk", marginTop: "6px", letterSpacing: "0.04em" }}>
            AI-assisted order-flow terminal for discretionary traders: structure-first filtering, order-flow confirmation, recall memory, and risk-gated execution.
          </div>
        </div>
        <div className="flex items-center gap-3">
          {systemStatus?.news_lockout_active && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold" style={{ backgroundColor: "rgba(255,113,98,0.1)", border: `1px solid rgba(255,113,98,0.3)`, color: C.tertiary }}>
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>warning</span>
              News Lockout
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded" style={{ backgroundColor: "rgba(156,255,147,0.06)", border: `1px solid rgba(156,255,147,0.15)` }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
            <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.primary, fontWeight: 700, letterSpacing: "0.05em" }}>
              {systemStatus?.active_instrument || "Crypto"} · {systemStatus?.active_session || "Live"}
            </span>
          </div>
        </div>
      </div>

      {hasDataIssue && (
        <div className="rounded p-3 flex items-center justify-between gap-2" style={{ backgroundColor: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)" }}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#fbbf24" }}>warning</span>
            <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: "#fbbf24", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Partial Data Mode
            </span>
          </div>
          <span style={{ fontSize: "9px", color: C.muted, fontFamily: "Space Grotesk" }}>
            Some endpoints are degraded. Dashboard is running with live fallbacks.
          </span>
        </div>
      )}

      {/* ── Neural Command Surface ── */}
      <div className="rounded-xl p-3 lg:p-4 space-y-3 overflow-hidden" style={{ backgroundColor: "#0c0f16", border: `1px solid rgba(102,157,255,0.18)`, boxShadow: "inset 0 0 0 1px rgba(102,157,255,0.08)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "15px", color: C.secondary }}>neurology</span>
            <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase" }}>
              Neural Command Surface
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.muted }}>
              Market Regime: <span style={{ color: sentimentLabel === "Bullish" ? C.primary : sentimentLabel === "Bearish" ? C.tertiary : C.secondary, fontWeight: 700 }}>{sentimentLabel}</span>
            </span>
            <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
              Active Setups: {setupAlerts.length}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <div className="xl:col-span-3 space-y-3">
            <div className="rounded p-3" style={{ backgroundColor: "#111726", border: `1px solid rgba(156,255,147,0.16)` }}>
              <MicroLabel>Global Market Sentiment</MicroLabel>
              <div className="mt-2" style={{ fontSize: "36px", lineHeight: 1, fontFamily: "Space Grotesk", fontWeight: 700, color: sentimentLabel === "Bullish" ? C.primary : sentimentLabel === "Bearish" ? C.tertiary : C.secondary }}>
                {sentimentSign}{formatNumber(sentimentQuality / 100, 2)}%
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ fontSize: "14px", color: sentimentLabel === "Bullish" ? C.primary : sentimentLabel === "Bearish" ? C.tertiary : C.secondary }}>
                  {sentimentLabel === "Bullish" ? "arrow_upward" : sentimentLabel === "Bearish" ? "arrow_downward" : "trending_flat"}
                </span>
                <span style={{ fontSize: "12px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#fff" }}>{sentimentLabel}</span>
              </div>
              <div className="mt-3 space-y-1.5">
                <div className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                  <span style={{ fontSize: "10px", color: C.muted }}>Structure</span>
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.primary }}>{(avgStructureScore * 100).toFixed(1)}%</span>
                </div>
                <div className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                  <span style={{ fontSize: "10px", color: C.muted }}>Orderflow</span>
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>{(avgOrderflowScore * 100).toFixed(1)}%</span>
                </div>
                <div className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                  <span style={{ fontSize: "10px", color: C.muted }}>Attention</span>
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#fff" }}>{(avgAttention * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="rounded p-3" style={{ backgroundColor: "#111726", border: `1px solid ${C.border}` }}>
              <MicroLabel>Setup Alerts</MicroLabel>
              <div className="mt-2 space-y-1.5">
                {setupAlerts.length > 0 ? setupAlerts.map((sig: any, idx: any) => (
                  <div key={sig.id} className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                    <span style={{ fontSize: "10px", color: "#fff", fontFamily: "Space Grotesk" }}>{idx + 1}. {sig.instrument} {sig.setup_type.replace(/_/g, " ")}</span>
                    <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: sig.final_quality > 70 ? C.primary : sig.final_quality > 50 ? "#fbbf24" : C.tertiary }}>
                      {formatNumber(sig.final_quality, 1)}%
                    </span>
                  </div>
                )) : (
                  <div style={{ fontSize: "10px", color: C.muted }}>No active setup alerts.</div>
                )}
              </div>
            </div>
          </div>

          <div className="xl:col-span-6">
            <div className="relative rounded min-h-[300px] md:min-h-[360px] overflow-hidden gv-neural-grid" style={{ background: "radial-gradient(circle at 52% 52%, rgba(71,144,255,0.28), rgba(10,16,32,0.95) 60%), linear-gradient(140deg, rgba(16,22,38,0.98), rgba(10,14,26,0.98))", border: `1px solid rgba(102,157,255,0.2)` }}>
              <div className="absolute inset-0 opacity-70" style={{ backgroundImage: "radial-gradient(circle at 30% 20%, rgba(156,255,147,0.2), transparent 25%), radial-gradient(circle at 70% 80%, rgba(255,113,98,0.15), transparent 30%), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "auto, auto, 38px 38px, 38px 38px" }} />
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                {orbitNodes.map(({ row, left, top }, idx) => {
                  const pathD = buildNeuralCurvePath(left, top, idx);
                  const lineColor = row.direction === "long" ? "rgba(156,255,147,0.75)" : row.direction === "short" ? "rgba(255,113,98,0.75)" : "rgba(102,157,255,0.75)";
                  const strokeWidth = 0.22 + row.attention_score * 0.6;
                  const isSurge = surgeTopSymbols.includes(row.symbol);
                  return (
                    <g key={`link-${row.symbol}`}>
                      <path
                        className={`gv-neural-link${isSurge ? " gv-neural-link-surge" : ""}`}
                        d={pathD}
                        stroke={lineColor}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        fill="none"
                      />
                      <circle
                        r={0.58 + row.attention_score * 0.28}
                        className={isSurge ? "gv-signal-particle gv-signal-particle-surge" : "gv-signal-particle"}
                        fill={lineColor}
                      >
                        <animateMotion
                          dur={`${Math.max(1.9, 3.8 - row.attention_score * 1.6)}s`}
                          repeatCount="indefinite"
                          rotate="auto"
                          path={pathD}
                          begin={`${(idx * 0.24).toFixed(2)}s`}
                        />
                      </circle>
                    </g>
                  );
                })}
              </svg>
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full w-32 h-32 md:w-40 md:h-40 flex items-center justify-center gv-brain-core" style={{ background: "radial-gradient(circle, rgba(255,199,84,0.95), rgba(255,153,0,0.18) 54%, rgba(255,153,0,0.02) 72%)", boxShadow: "0 0 60px rgba(255,184,77,0.4)" }}>
                <div className="text-center">
                  <div style={{ fontSize: "11px", letterSpacing: "0.12em", fontFamily: "Space Grotesk", textTransform: "uppercase", color: "#100d08" }}>Godsview Brain</div>
                  <div style={{ fontSize: "16px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#100d08" }}>{sentimentLabel}</div>
                </div>
              </div>
              {orbitNodes.map(({ row, leftPct, topPct }) => {
                const tone = row.direction === "long" ? C.primary : row.direction === "short" ? C.tertiary : C.secondary;
                const nodeScale = 0.86 + row.attention_score * 0.5;
                const isPinned = pinnedSymbol === row.symbol;
                const symbolKey = normalizeInstrumentKey(row.symbol);
                const livePos = positionBySymbol.get(symbolKey);
                const orderState = openOrderBySymbol.get(symbolKey);
                const unrealized = livePos ? Number.parseFloat(livePos.unrealized_pl ?? "0") : null;
                const executionBadge = livePos ? `${livePos.side.toUpperCase()} ${livePos.qty}` : orderState ? `ORDERS ${orderState.count}` : null;
                const executionColor = livePos ? (unrealized ?? 0) >= 0 ? C.primary : C.tertiary : orderState ? "#fbbf24" : C.muted;
                return (
                  <div
                    key={row.symbol}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-4 py-2 gv-neural-node${surgeTopSymbols.includes(row.symbol) ? " gv-neural-node-surge" : ""}${isPinned ? " gv-neural-node-pinned" : ""}`}
                    style={{
                      left: leftPct,
                      top: topPct,
                      transform: `translate(-50%, -50%) scale(${nodeScale.toFixed(2)})`,
                      border: `1px solid ${tone}88`,
                      backgroundColor: `${tone}22`,
                      boxShadow: `0 0 24px ${tone}66`,
                    }}
                    onMouseEnter={() => setHoveredSymbol(row.symbol)}
                    onMouseLeave={() => setHoveredSymbol((prev) => (prev === row.symbol ? null : prev))}
                    onClick={() => {
                      setPinnedSymbol((prev) => (prev === row.symbol ? null : row.symbol));
                      setDrawerSymbol(row.symbol);
                    }}
                    onFocus={() => setHoveredSymbol(row.symbol)}
                    onBlur={() => setHoveredSymbol((prev) => (prev === row.symbol ? null : prev))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setPinnedSymbol((prev) => (prev === row.symbol ? null : row.symbol));
                        setDrawerSymbol(row.symbol);
                      }
                    }}
                    tabIndex={0}
                  >
                    <div style={{ fontSize: "30px", fontWeight: 700, lineHeight: 1, color: "#fff", fontFamily: "Space Grotesk", textAlign: "center" }}>{row.symbol}</div>
                    <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: "#e2e8f0", textAlign: "center", marginTop: "2px" }}>
                      {(row.attention_score * 100).toFixed(0)}% attn
                    </div>
                    {executionBadge ? (
                      <span className="absolute -left-2 -top-2 rounded-full px-1.5 py-0.5" style={{ fontSize: "7px", fontFamily: "JetBrains Mono, monospace", color: executionColor, border: `1px solid ${executionColor}66`, backgroundColor: "rgba(10,14,22,0.9)" }}>
                        {executionBadge}
                      </span>
                    ) : null}
                    {livePos ? (
                      <span className="absolute left-1/2 -translate-x-1/2 -bottom-2 rounded-full px-1.5 py-0.5" style={{ fontSize: "7px", fontFamily: "JetBrains Mono, monospace", color: (unrealized ?? 0) >= 0 ? C.primary : C.tertiary, border: `1px solid ${((unrealized ?? 0) >= 0 ? C.primary : C.tertiary)}66`, backgroundColor: "rgba(10,14,22,0.92)" }}>
                        {(unrealized ?? 0) >= 0 ? "+" : ""}{(unrealized ?? 0).toFixed(2)}
                      </span>
                    ) : null}
                    {isPinned ? (
                      <span className="absolute -top-1 -right-1 rounded-full px-1 py-0.5" style={{ fontSize: "7px", fontFamily: "JetBrains Mono, monospace", color: C.primary, border: "1px solid rgba(156,255,147,0.45)", backgroundColor: "rgba(8,20,14,0.85)" }}>
                        PIN
                      </span>
                    ) : null}
                    <span className={`gv-node-ring${surgeTopSymbols.includes(row.symbol) ? " gv-node-ring-surge" : ""}`} style={{ borderColor: `${tone}55` }} />
                  </div>
                );
              })}
              {focusedNode ? (
                <div className="absolute left-2 right-2 bottom-2 md:left-auto md:right-3 md:bottom-3 md:w-[42%] rounded p-2.5" style={{ backgroundColor: "rgba(15,22,40,0.86)", border: `1px solid ${C.border}`, backdropFilter: "blur(8px)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <div style={{ fontSize: "12px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#fff" }}>{focusedNode.symbol} Intelligence Card</div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDrawerSymbol((prev) => (prev === focusedNode.symbol ? null : focusedNode.symbol))}
                        className="rounded px-1.5 py-0.5"
                        style={{ fontSize: "8px", fontFamily: "JetBrains Mono, monospace", color: drawerSymbol === focusedNode.symbol ? C.secondary : C.muted, border: `1px solid ${drawerSymbol === focusedNode.symbol ? "rgba(102,157,255,0.45)" : C.border}`, backgroundColor: "#0c1526" }}
                      >
                        {drawerSymbol === focusedNode.symbol ? "CLOSE" : "DEEP"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPinnedSymbol((prev) => (prev === focusedNode.symbol ? null : focusedNode.symbol))}
                        className="rounded px-1.5 py-0.5"
                        style={{ fontSize: "8px", fontFamily: "JetBrains Mono, monospace", color: pinnedSymbol === focusedNode.symbol ? C.primary : C.muted, border: `1px solid ${pinnedSymbol === focusedNode.symbol ? "rgba(156,255,147,0.45)" : C.border}`, backgroundColor: "#0c1526" }}
                      >
                        {pinnedSymbol === focusedNode.symbol ? "UNPIN" : "PIN"}
                      </button>
                      <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: focusedNode.readiness === "allow" ? C.primary : focusedNode.readiness === "watch" ? "#fbbf24" : C.tertiary }}>
                        {focusedNode.readiness.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                      <MicroLabel>Sentiment</MicroLabel>
                      <div style={{ fontSize: "10px", color: focusedNode.direction === "long" ? C.primary : focusedNode.direction === "short" ? C.tertiary : C.secondary }}>{focusedNode.direction}</div>
                    </div>
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                      <MicroLabel>Confidence</MicroLabel>
                      <div style={{ fontSize: "10px", color: "#fff" }}>{(focusedNode.attention_score * 100).toFixed(1)}%</div>
                    </div>
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                      <MicroLabel>Setup Family</MicroLabel>
                      <div style={{ fontSize: "10px", color: C.muted }}>{focusedNode.setup_family}</div>
                    </div>
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                      <MicroLabel>Market DNA</MicroLabel>
                      <div style={{ fontSize: "10px", color: C.muted }}>
                        S {focusedNode.structure_score.toFixed(2)} · O {focusedNode.orderflow_score.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                      <MicroLabel>Execution Signature</MicroLabel>
                      <div style={{ fontSize: "10px", color: focusedNode.risk_state === "allowed" ? C.primary : C.tertiary }}>{focusedNode.risk_state}</div>
                    </div>
                    <div className="rounded px-2 py-1" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                      <MicroLabel>Readiness</MicroLabel>
                      <div style={{ fontSize: "10px", color: focusedNode.readiness === "allow" ? C.primary : focusedNode.readiness === "watch" ? "#fbbf24" : C.tertiary }}>{focusedNode.readiness}</div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="xl:col-span-3 space-y-3">
            <div className="rounded p-3" style={{ backgroundColor: "#111726", border: `1px solid ${C.border}` }}>
              <MicroLabel>Claude Analysis</MicroLabel>
              <div className="mt-2 space-y-2">
                {rankedBoard.slice(0, 4).map((row: any) => {
                  const dotColor = row.readiness === "allow" ? C.primary : row.readiness === "watch" ? "#fbbf24" : C.tertiary;
                  const sparklineValues = buildSparklineSeries(row);
                  const sparklinePath = buildSparklinePath(sparklineValues, 74, 22, 1.5);
                  const key = normalizeInstrumentKey(row.symbol);
                  const rowPos = positionBySymbol.get(key);
                  const rowOrder = openOrderBySymbol.get(key);
                  return (
                    <div
                      key={row.symbol}
                      className="flex items-start justify-between gap-2 rounded px-1.5 py-1"
                      style={{ border: focusedNode?.symbol === row.symbol ? `1px solid ${dotColor}55` : "1px solid transparent", cursor: "pointer", backgroundColor: drawerSymbol === row.symbol ? "rgba(11,22,38,0.55)" : "transparent" }}
                      onMouseEnter={() => setHoveredSymbol(row.symbol)}
                      onMouseLeave={() => setHoveredSymbol((prev) => (prev === row.symbol ? null : prev))}
                      onClick={() => setDrawerSymbol((prev) => (prev === row.symbol ? null : row.symbol))}
                    >
                      <div className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full mt-1" style={{ backgroundColor: dotColor }} />
                        <div>
                          <div style={{ fontSize: "11px", color: "#fff", fontFamily: "Space Grotesk" }}>{row.symbol}: {row.reasoning_verdict.replace(/_/g, " ")}</div>
                          <div style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                            setup {row.setup_family} · {row.risk_state}
                            {rowPos ? ` · ${rowPos.side} ${rowPos.qty}` : rowOrder ? ` · orders ${rowOrder.count}` : ""}
                          </div>
                        </div>
                      </div>
                      <svg width="74" height="22" viewBox="0 0 74 22" className="shrink-0">
                        <path d={sparklinePath} fill="none" stroke={`${dotColor}AA`} strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </div>
                  );
                })}
                {rankedBoard.length === 0 && (
                  <div style={{ fontSize: "10px", color: C.muted }}>
                    No consciousness data yet. Run brain cycle.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded p-3" style={{ backgroundColor: "#111726", border: `1px solid ${C.border}` }}>
              <MicroLabel>Execution Metrics</MicroLabel>
              <div className="mt-2 space-y-2">
                <div className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                  <span style={{ fontSize: "10px", color: C.muted }}>Slippage</span>
                  <span style={{ fontSize: "10px", color: executionSlippageLabel === "Low" ? C.primary : executionSlippageLabel === "Moderate" ? "#fbbf24" : C.tertiary }}>{executionSlippageLabel}</span>
                </div>
                <div className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                  <span style={{ fontSize: "10px", color: C.muted }}>Fill Quality</span>
                  <span style={{ fontSize: "10px", color: executionFillLabel === "Excellent" ? C.primary : executionFillLabel === "Good" ? C.secondary : "#fbbf24" }}>{executionFillLabel}</span>
                </div>
                <div className="rounded px-2 py-1.5 flex items-center justify-between" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0f131e" }}>
                  <span style={{ fontSize: "10px", color: C.muted }}>Risk Level</span>
                  <span style={{ fontSize: "10px", color: executionRiskLabel === "Disciplined" ? C.primary : executionRiskLabel === "Moderate" ? "#fbbf24" : C.tertiary }}>{executionRiskLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-4 md:overflow-visible">
          {setupAlerts.length > 0 ? setupAlerts.map((sig: any) => (
            <div key={`strip-${sig.id}`} className="rounded px-3 py-2 min-w-[220px] md:min-w-0" style={{ backgroundColor: "#111726", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: "10px", color: "#fff", fontWeight: 700, fontFamily: "Space Grotesk" }}>{sig.instrument} {sig.setup_type.replace(/_/g, " ")}</div>
              <div style={{ fontSize: "9px", marginTop: "3px", color: sig.final_quality > 65 ? C.primary : sig.final_quality > 50 ? "#fbbf24" : C.tertiary }}>
                {formatNumber(sig.final_quality, 1)}% quality
              </div>
            </div>
          )) : (
            <div className="md:col-span-4 rounded px-3 py-2" style={{ backgroundColor: "#111726", border: `1px solid ${C.border}`, color: C.muted, fontSize: "10px" }}>
              Waiting for fresh setups from live scan.
            </div>
          )}
        </div>

        <div className="rounded px-4 py-3 flex flex-wrap items-center justify-between gap-3" style={{ backgroundColor: "#0f1628", border: `1px solid rgba(156,255,147,0.2)` }}>
          <div className="flex flex-wrap items-center gap-4">
            <span style={{ fontSize: "28px", fontFamily: "Space Grotesk", fontWeight: 700, color: heroSignalDirection === "buy" ? C.primary : heroSignalDirection === "sell" ? C.tertiary : "#fff" }}>
              {heroSignal?.instrument ?? rankedBoard[0]?.symbol ?? "NO-SIGNAL"}
            </span>
            <span style={{ fontSize: "18px", fontFamily: "Space Grotesk", fontWeight: 700, color: heroSignalDirection === "buy" ? C.primary : heroSignalDirection === "sell" ? C.tertiary : C.muted }}>
              {heroSignalDirection === "none" ? "STANDBY" : `${heroSignalDirection.toUpperCase()} SIGNAL`}
            </span>
            {heroSignal && (
              <span style={{ fontSize: "11px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>
                Entry {heroSignal.entry_price ? Number(heroSignal.entry_price).toFixed(2) : "—"} · Quality {formatNumber(heroSignal.final_quality, 1)}%
              </span>
            )}
          </div>
          <button
            type="button"
            className="rounded px-4 py-2 transition-all hover:brightness-110"
            style={{ backgroundColor: "rgba(156,255,147,0.16)", color: C.primary, border: "1px solid rgba(156,255,147,0.42)", fontFamily: "Space Grotesk", fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}
          >
            Execute Trade
          </button>
        </div>

        {drawerNode ? (
          <div className="rounded p-3 gv-deep-dive" style={{ backgroundColor: "#10182b", border: `1px solid ${C.border}` }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div style={{ fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", color: C.outline, fontFamily: "Space Grotesk" }}>Symbol Deep Dive</div>
                <div style={{ fontSize: "15px", color: "#fff", fontFamily: "Space Grotesk", fontWeight: 700 }}>{drawerNode.symbol}</div>
              </div>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: drawerNode.readiness === "allow" ? C.primary : drawerNode.readiness === "watch" ? "#fbbf24" : C.tertiary }}>
                  {drawerNode.readiness.toUpperCase()} · {drawerNode.risk_state.toUpperCase()}
                </span>
                {drawerExecution.position ? (
                  <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: Number.parseFloat(drawerExecution.position.unrealized_pl ?? "0") >= 0 ? C.primary : C.tertiary }}>
                    POS {drawerExecution.position.side.toUpperCase()} {drawerExecution.position.qty}
                  </span>
                ) : drawerExecution.order ? (
                  <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: "#fbbf24" }}>
                    ORDERS {drawerExecution.order.count}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="rounded px-2 py-1"
                  style={{ fontSize: "9px", color: C.muted, border: `1px solid ${C.border}` }}
                  onClick={() => setDrawerSymbol(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2.5">
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Sentiment</MicroLabel>
                <div style={{ fontSize: "10px", color: drawerNode.direction === "long" ? C.primary : drawerNode.direction === "short" ? C.tertiary : C.secondary }}>{drawerNode.direction}</div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Confidence</MicroLabel>
                <div style={{ fontSize: "10px", color: "#fff" }}>{(drawerNode.attention_score * 100).toFixed(1)}%</div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Setup Family</MicroLabel>
                <div style={{ fontSize: "10px", color: C.muted }}>{drawerNode.setup_family}</div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Regime Fit</MicroLabel>
                <div style={{ fontSize: "10px", color: drawerNode.context_score > 0.66 ? C.primary : drawerNode.context_score > 0.45 ? "#fbbf24" : C.tertiary }}>
                  {(drawerNode.context_score * 100).toFixed(1)}%
                </div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Market DNA</MicroLabel>
                <div style={{ fontSize: "10px", color: C.muted }}>S {drawerNode.structure_score.toFixed(2)} · O {drawerNode.orderflow_score.toFixed(2)}</div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Execution Signature</MicroLabel>
                <div style={{ fontSize: "10px", color: drawerNode.risk_score < 0.4 ? C.primary : drawerNode.risk_score < 0.65 ? "#fbbf24" : C.tertiary }}>
                  Risk {drawerNode.risk_score.toFixed(2)}
                </div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Live PnL</MicroLabel>
                <div style={{ fontSize: "10px", color: drawerExecution.position ? Number.parseFloat(drawerExecution.position.unrealized_pl ?? "0") >= 0 ? C.primary : C.tertiary : C.muted }}>
                  {drawerExecution.position
                    ? `${Number.parseFloat(drawerExecution.position.unrealized_pl ?? "0") >= 0 ? "+" : ""}${Number.parseFloat(drawerExecution.position.unrealized_pl ?? "0").toFixed(2)}`
                    : "flat"}
                </div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Execution State</MicroLabel>
                <div style={{ fontSize: "10px", color: drawerExecution.position ? C.primary : drawerExecution.order ? "#fbbf24" : C.muted }}>
                  {drawerExecution.position ? "In Position" : drawerExecution.order ? drawerExecution.order.status.replace(/_/g, " ") : "Idle"}
                </div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Memory / Reasoning</MicroLabel>
                <div style={{ fontSize: "10px", color: C.muted }}>{drawerNode.memory_score.toFixed(2)} / {drawerNode.reasoning_score.toFixed(2)}</div>
              </div>
              <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0e1424" }}>
                <MicroLabel>Block Reason</MicroLabel>
                <div style={{ fontSize: "10px", color: drawerNode.block_reason ? "#fbbf24" : C.muted }}>
                  {drawerNode.block_reason || "none"}
                </div>
              </div>
            </div>
            <div className="mt-2.5 rounded px-2 py-2" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0b1220" }}>
              <div className="flex items-center justify-between mb-1">
                <MicroLabel>Signal Trace</MicroLabel>
                <span style={{ fontSize: "9px", color: C.muted, fontFamily: "JetBrains Mono, monospace" }}>{drawerNode.reasoning_verdict.replace(/_/g, " ")}</span>
              </div>
              <svg width="100%" height="54" viewBox="0 0 220 54" preserveAspectRatio="none">
                <path
                  d={buildSparklinePath(buildSparklineSeries(drawerNode, 26), 220, 54, 3)}
                  fill="none"
                  stroke={drawerNode.direction === "long" ? `${C.primary}CC` : drawerNode.direction === "short" ? `${C.tertiary}CC` : `${C.secondary}CC`}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="mt-2.5 rounded p-2.5" style={{ border: `1px solid rgba(102,157,255,0.3)`, backgroundColor: "#0a1323" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>visibility</span>
                  <MicroLabel>Brain Focus Mode · Candle X-Ray</MicroLabel>
                </div>
                <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                  {xraySymbol ?? drawerNode.symbol} · {xrayTimeframe}
                </span>
              </div>

              <div className="mt-2">
                <ChartIntelStrip symbol={xraySymbol ?? drawerNode.symbol} timeframe="1" compact />
              </div>

              <div className="mt-2 rounded px-2 py-2" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0b1220" }}>
                <div className="flex items-center justify-between">
                  <MicroLabel>Candle Timeline (Click To Inspect)</MicroLabel>
                  {selectedCandle ? (
                    <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
                      {format(new Date(toCandleMs(selectedCandle.time)), "HH:mm:ss")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 overflow-x-auto">
                  <div className="flex items-end gap-1 min-w-max pb-1">
                    {xrayBars.map((bar: any) => {
                      const isSelected = selectedCandle?.time === bar.time;
                      const up = bar.close >= bar.open;
                      const bodyPct = Math.max(10, Math.min(100, Math.abs(bar.body_ratio) * 100));
                      const barColor = up ? C.primary : C.tertiary;
                      return (
                        <button
                          key={`xray-bar-${bar.time}`}
                          type="button"
                          onClick={() => {
                            setSelectedCandleTs(bar.time);
                            setXrayTab("summary");
                          }}
                          className="rounded-sm transition-all"
                          style={{
                            width: "12px",
                            height: `${Math.max(18, bodyPct)}px`,
                            border: `1px solid ${isSelected ? `${barColor}` : `${barColor}55`}`,
                            backgroundColor: isSelected ? `${barColor}88` : `${barColor}36`,
                            boxShadow: isSelected ? `0 0 12px ${barColor}` : "none",
                          }}
                          title={`${format(new Date(toCandleMs(bar.time)), "HH:mm:ss")} · O ${bar.open.toFixed(2)} H ${bar.high.toFixed(2)} L ${bar.low.toFixed(2)} C ${bar.close.toFixed(2)}`}
                        />
                      );
                    })}
                    {xrayBars.length === 0 ? (
                      <span style={{ fontSize: "10px", color: C.muted }}>No candle intelligence bars available.</span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 lg:grid-cols-4 gap-2">
                <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0d1628" }}>
                  <MicroLabel>Open / Close</MicroLabel>
                  <div style={{ fontSize: "10px", color: "#fff", fontFamily: "JetBrains Mono, monospace" }}>
                    {selectedCandle ? `${selectedCandle.open.toFixed(2)} → ${selectedCandle.close.toFixed(2)}` : "—"}
                  </div>
                </div>
                <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0d1628" }}>
                  <MicroLabel>High / Low</MicroLabel>
                  <div style={{ fontSize: "10px", color: "#fff", fontFamily: "JetBrains Mono, monospace" }}>
                    {selectedCandle ? `${selectedCandle.high.toFixed(2)} / ${selectedCandle.low.toFixed(2)}` : "—"}
                  </div>
                </div>
                <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0d1628" }}>
                  <MicroLabel>Volume / Delta</MicroLabel>
                  <div style={{ fontSize: "10px", color: selectedCandle && selectedCandle.imbalance >= 0 ? C.primary : C.tertiary, fontFamily: "JetBrains Mono, monospace" }}>
                    {selectedCandle ? `${Math.round(selectedCandle.volume)} / ${selectedCandle.imbalance >= 0 ? "+" : ""}${selectedCandle.imbalance.toFixed(2)}` : "—"}
                  </div>
                </div>
                <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0d1628" }}>
                  <MicroLabel>Liquidity / Reversal</MicroLabel>
                  <div style={{ fontSize: "10px", color: "#fff", fontFamily: "JetBrains Mono, monospace" }}>
                    {selectedCandle ? `${selectedCandle.liquidity_strength.toFixed(2)} / ${selectedCandle.reversal_score.toFixed(2)}` : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {selectedCandleTags.map((tag: any) => (
                  <span
                    key={`tag-${tag}`}
                    className="px-2 py-0.5 rounded-full"
                    style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.secondary, border: "1px solid rgba(102,157,255,0.35)", backgroundColor: "rgba(102,157,255,0.12)" }}
                  >
                    {tag}
                  </span>
                ))}
                {selectedCandleTags.length === 0 ? (
                  <span style={{ fontSize: "9px", color: C.muted }}>No event tags on selected candle.</span>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {xrayTabs.map((tab: any) => {
                  const active = xrayTab === tab.key;
                  return (
                    <button
                      key={`xray-tab-${tab.key}`}
                      type="button"
                      className="rounded px-2 py-1 transition-all flex items-center gap-1"
                      style={{
                        border: `1px solid ${active ? "rgba(156,255,147,0.45)" : C.border}`,
                        backgroundColor: active ? "rgba(156,255,147,0.12)" : "#0b1220",
                        color: active ? C.primary : C.muted,
                        fontSize: "9px",
                        fontFamily: "Space Grotesk",
                        letterSpacing: "0.08em",
                      }}
                      onClick={() => setXrayTab(tab.key)}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>{tab.icon}</span>
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2">
                {xrayTab === "summary" ? (
                  <div className="rounded px-2 py-2" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0b1220" }}>
                    <MicroLabel>Candle Summary</MicroLabel>
                    <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0d1628" }}>
                        <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk" }}>Candle Time</div>
                        <div style={{ fontSize: "10px", color: "#fff", fontFamily: "JetBrains Mono, monospace" }}>
                          {selectedCandle ? format(new Date(toCandleMs(selectedCandle.time)), "MMM dd · HH:mm:ss") : "—"}
                        </div>
                      </div>
                      <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0d1628" }}>
                        <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk" }}>Aggression / Absorption</div>
                        <div style={{ fontSize: "10px", color: "#fff", fontFamily: "JetBrains Mono, monospace" }}>
                          {selectedCandle ? `${selectedCandle.imbalance >= 0 ? "Buy" : "Sell"} / ${selectedCandle.absorption.toFixed(2)}` : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {xrayTab === "orderbook" ? (
                  xrayIsCrypto ? (
                    <BookmapPanel symbol={xraySymbol ?? "BTCUSD"} depth={22} />
                  ) : (
                    <div className="rounded px-3 py-3" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0b1220" }}>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>info</span>
                        <span style={{ fontSize: "10px", color: C.muted }}>
                          Live order-book ladder is currently enabled for crypto symbols. Use heatmap/flow tabs for this equity candle.
                        </span>
                      </div>
                    </div>
                  )
                ) : null}

                {xrayTab === "heatmap" ? (
                  <CandleIntelligencePanel symbol={xraySymbol ?? drawerNode.symbol} timeframe={xrayTimeframe} bars={90} />
                ) : null}

                {xrayTab === "flow" ? (
                  <CVDPanel symbol={xraySymbol ?? drawerNode.symbol} timeframe={xrayTimeframe} bars={120} autoRefresh={30} />
                ) : null}

                {xrayTab === "ai" ? (
                  <div className="rounded px-3 py-3 space-y-2" style={{ border: `1px solid rgba(156,255,147,0.28)`, backgroundColor: "#0b1220" }}>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.primary }}>psychology</span>
                      <MicroLabel>AI Candle Explanation</MicroLabel>
                    </div>
                    <p style={{ fontSize: "11px", lineHeight: "1.5", color: "#d7e1ef" }}>
                      {selectedCandleAi}
                    </p>
                    <div className="rounded px-2 py-1.5" style={{ border: `1px solid ${C.border}`, backgroundColor: "#0d1628" }}>
                      <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk" }}>Risk Policy Context</div>
                      <div style={{ fontSize: "10px", color: drawerNode.risk_state === "allowed" ? C.primary : C.tertiary }}>
                        {drawerNode.risk_state === "allowed" ? "Trade allowed if trigger confirms." : "Risk gate is blocking this moment."}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Top Metrics ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Today's P&L */}
        <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <MicroLabel>Today&apos;s P&amp;L</MicroLabel>
          <div className="mt-2 font-headline font-bold text-xl" style={{ color: totalPnl >= 0 ? C.primary : C.tertiary }}>
            {formatCurrency(totalPnl)}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk" }}>{pnlSub}</span>
            {livePositions > 0 && unrealizedPnl !== 0 && (
              <span className="px-1.5 py-0.5 rounded" style={{ fontSize: "7px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", backgroundColor: "rgba(102,157,255,0.1)", border: "1px solid rgba(102,157,255,0.2)", color: "#669dff" }}>
                {unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(unrealizedPnl)} LIVE
              </span>
            )}
          </div>
        </div>

        {/* Win Rate */}
        <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <MicroLabel>Win Rate (24h)</MicroLabel>
          <div className="mt-2 font-headline font-bold text-xl" style={{ color: closedTrades === 0 ? C.muted : winRate > 0.6 ? C.primary : C.muted }}>
            {closedTrades === 0 ? "—" : formatPercent(winRate)}
          </div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
            {closedTrades === 0 ? "Close trades to track" : "Target › 60%"}
          </div>
        </div>

        {/* Expectancy */}
        <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <MicroLabel>Expectancy</MicroLabel>
          <div className="mt-2 font-headline font-bold text-xl" style={{ color: closedTrades === 0 ? C.muted : expectancy > 0 ? C.primary : C.tertiary }}>
            {closedTrades === 0 ? "—" : formatCurrency(expectancy)}
          </div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
            Per trade average
          </div>
        </div>

        {/* Signals Today */}
        <div className="rounded p-4 transition-all hover:brightness-110" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <MicroLabel>Signals Today</MicroLabel>
          <div className="mt-2 font-headline font-bold text-xl" style={{ color: (systemStatus?.signals_today ?? 0) > 0 ? C.secondary : "#ffffff" }}>
            {systemStatus?.signals_today ?? 0}
          </div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
            {systemStatus?.trades_today || 0} executed · {livePositions} positions live
          </div>
        </div>
      </div>

      {/* ── AI Pipeline Intelligence — Model Accuracy & Win Rate ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {(() => {
          const mlMeta = (modelDiagnostics?.status as any)?.meta;
          const mlStatus = modelDiagnostics?.status?.status ?? "warning";
          const mlAccuracy = mlMeta?.accuracy ?? null;
          const mlAuc = mlMeta?.auc ?? null;
          const mlWinRate = mlMeta?.winRate ?? null;
          const mlSamples = mlMeta?.samples ?? null;
          const cvAuc = modelDiagnostics?.validation?.auc ?? null;
          const driftStatus = modelDiagnostics?.drift?.status ?? null;

          return (
            <>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>ML Model Accuracy</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: mlAccuracy != null ? (mlAccuracy >= 0.65 ? C.primary : mlAccuracy >= 0.55 ? "#fbbf24" : C.tertiary) : C.muted }}>
                  {mlAccuracy != null ? `${(mlAccuracy * 100).toFixed(1)}%` : "—"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  {mlSamples != null ? `${mlSamples.toLocaleString()} samples` : "Training..."}
                </div>
              </div>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>AUC-ROC</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: mlAuc != null ? (mlAuc >= 0.70 ? C.primary : mlAuc >= 0.60 ? "#fbbf24" : C.tertiary) : C.muted }}>
                  {mlAuc != null ? mlAuc.toFixed(3) : "—"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  {cvAuc != null ? `CV: ${cvAuc.toFixed(3)}` : "Model discriminative power"}
                </div>
              </div>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>Historical Win Rate</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: mlWinRate != null ? (mlWinRate >= 0.55 ? C.primary : C.tertiary) : C.muted }}>
                  {mlWinRate != null ? `${(mlWinRate * 100).toFixed(1)}%` : "—"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  From {mlSamples != null ? `${mlSamples.toLocaleString()} labeled trades` : "accuracy_results"}
                </div>
              </div>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>Model Status</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: mlStatus === "active" ? C.primary : mlStatus === "warning" ? "#fbbf24" : C.tertiary }}>
                  {mlStatus === "active" ? "TRAINED" : mlStatus === "warning" ? "HEURISTIC" : "ERROR"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  {mlStatus === "active" ? "L2 Logistic Regression" : "Fallback scoring active"}
                </div>
              </div>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>Drift</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: driftStatus === "stable" ? C.primary : driftStatus === "watch" ? "#fbbf24" : driftStatus === "drift" ? C.tertiary : C.muted }}>
                  {driftStatus != null ? driftStatus.toUpperCase() : "—"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  {driftStatus === "stable" ? "No regime shift detected" : driftStatus === "drift" ? "Retrain recommended" : "Monitoring..."}
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* ── Super Intelligence Engine — Ensemble, Kelly, Production Gate ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {(() => {
          const ens = siStatus?.ensemble;
          const siActive = siStatus?.status === "active";
          const ensAccuracy = ens?.ensemble_accuracy ?? null;
          const gbmAcc = ens?.gbm_accuracy ?? null;
          const lrAcc = ens?.lr_accuracy ?? null;
          const dailyTrades = prodStats?.daily_trades ?? 0;
          const maxTrades = prodStats?.max_daily_trades ?? 15;

          return (
            <>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>Ensemble Accuracy</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: ensAccuracy != null ? (ensAccuracy >= 0.65 ? C.primary : ensAccuracy >= 0.55 ? "#fbbf24" : C.tertiary) : C.muted }}>
                  {ensAccuracy != null ? `${(ensAccuracy * 100).toFixed(1)}%` : "—"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  {siActive ? "GBM + LR Voting" : "Ensemble training..."}
                </div>
              </div>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>GBM vs LR</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: C.secondary }}>
                  {gbmAcc != null && lrAcc != null ? `${(gbmAcc * 100).toFixed(0)}/${(lrAcc * 100).toFixed(0)}` : "—"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  Gradient Boosted / Logistic Reg
                </div>
              </div>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>SI Engine</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: siActive ? C.primary : "#fbbf24" }}>
                  {siActive ? "ACTIVE" : siStatus?.status === "partial" ? "PARTIAL" : "OFFLINE"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  Kelly + Regime + Confluence
                </div>
              </div>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>Daily Trades</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: dailyTrades < maxTrades * 0.8 ? C.primary : dailyTrades < maxTrades ? "#fbbf24" : C.tertiary }}>
                  {dailyTrades}/{maxTrades}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  Production gate limit
                </div>
              </div>
              <div className="rounded p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <MicroLabel>Samples</MicroLabel>
                <div className="mt-2 font-headline font-bold text-xl" style={{ color: C.secondary }}>
                  {ens?.samples != null ? (ens.samples >= 1000 ? `${(ens.samples / 1000).toFixed(1)}k` : ens.samples) : "—"}
                </div>
                <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", marginTop: "4px" }}>
                  {ens?.trained_at ? `Trained ${new Date(ens.trained_at).toLocaleTimeString()}` : "Awaiting training data"}
                </div>
              </div>
            </>
          );
        })()}
      </div>

      <div className="rounded p-4 space-y-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>monitoring</span>
            <MicroLabel>System Core Robustness</MicroLabel>
          </div>
          <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: coreScore == null ? C.muted : coreScore >= 80 ? C.primary : coreScore >= 60 ? "#fbbf24" : C.tertiary }}>
            {coreScore == null ? "N/A" : `${coreScore}%`} · {String(coreStatus).toUpperCase()}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>Live Layers</MicroLabel>
            <div style={{ marginTop: "4px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.primary }}>{liveLayerCount}</div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>Degraded</MicroLabel>
            <div style={{ marginTop: "4px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "#fbbf24" }}>{degradedLayerCount}</div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>Offline</MicroLabel>
            <div style={{ marginTop: "4px", fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: C.tertiary }}>{offlineLayerCount}</div>
          </div>
        </div>
        {diagnostics?.recommendations?.length ? (
          <p style={{ fontSize: "9px", color: C.muted, fontFamily: "Space Grotesk" }}>
            Next action: {diagnostics.recommendations[0]}
          </p>
        ) : null}
      </div>

      <div className="rounded p-4 space-y-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>analytics</span>
            <MicroLabel>Proof + Drift Snapshot</MicroLabel>
          </div>
          <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
            {(modelDiagnostics?.status.status ?? "n/a").toUpperCase()}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>Purged CV AUC</MicroLabel>
            <div style={{ marginTop: "4px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: C.secondary }}>
              {modelDiagnostics?.validation ? modelDiagnostics.validation.auc.toFixed(3) : "n/a"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>Drift</MicroLabel>
            <div style={{
              marginTop: "4px",
              fontSize: "11px",
              fontFamily: "JetBrains Mono, monospace",
              color: modelDiagnostics?.drift?.status === "drift" ? C.tertiary : modelDiagnostics?.drift?.status === "watch" ? "#fbbf24" : C.primary,
            }}>
              {(modelDiagnostics?.drift?.status ?? "n/a").toUpperCase()}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>OOS Win Δ</MicroLabel>
            <div style={{ marginTop: "4px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: (oosProof?.deltas.winRateDelta ?? 0) >= 0 ? C.primary : C.tertiary }}>
              {oosProof ? `${(oosProof.deltas.winRateDelta * 100).toFixed(2)}%` : "n/a"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>PF (30d)</MicroLabel>
            <div style={{ marginTop: "4px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: C.primary }}>
              {proofBySetup?.overall ? proofBySetup.overall.profitFactor.toFixed(2) : "n/a"}
            </div>
          </div>
          <div className="rounded p-2.5" style={{ backgroundColor: "#0e0e0f" }}>
            <MicroLabel>Expectancy R</MicroLabel>
            <div style={{ marginTop: "4px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: (proofBySetup?.overall.expectancyR ?? 0) >= 0 ? C.primary : C.tertiary }}>
              {proofBySetup?.overall ? `${proofBySetup.overall.expectancyR >= 0 ? "+" : ""}${proofBySetup.overall.expectancyR.toFixed(2)}` : "n/a"}
            </div>
          </div>
        </div>
        <div className="space-y-1">
          {(proofBySetup?.rows ?? []).slice(0, 3).map((row: any) => (
            <div key={row.key} className="flex items-center justify-between rounded px-2 py-1.5" style={{ backgroundColor: "#0f0f10", border: `1px solid ${C.border}` }}>
              <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: "#fff" }}>{row.key.replace(/_/g, " ")}</span>
              <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                {(row.winRate * 100).toFixed(1)}% · PF {row.profitFactor.toFixed(2)} · {row.expectancyR >= 0 ? "+" : ""}{row.expectancyR.toFixed(2)}R
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Live Chart — TradingView (Coinbase real-time) ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-base" style={{ color: C.secondary }}>candlestick_chart</span>
            <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase" }}>
              Live Market Chart
            </span>
            <span style={{ fontSize: "8px", color: C.outlineVar, fontFamily: "Space Grotesk" }}>Coinbase · Real-Time</span>
          </div>
          <Link href="/alpaca">
            <span style={{ fontSize: "9px", color: C.secondary, fontFamily: "Space Grotesk", letterSpacing: "0.1em", cursor: "pointer" }}>
              FULL ANALYSIS →
            </span>
          </Link>
        </div>
        <TradingViewChart
          symbol={activeChartSymbol}
          timeframe="5"
          height={380}
          showToolbar={true}
          studies={["Volume@tv-basicstudies"]}
        />
      </div>

      {/* ── 6-Layer Pipeline ── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-base" style={{ color: C.primary }}>account_tree</span>
          <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase" }}>
            6-Layer Reasoning Engine
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {layers.map((layer: any, i: any) => {
            const isActive = layer.status === "active";
            const isWarn = layer.status === "warning";
            const color = isActive ? C.primary : isWarn ? "#fbbf24" : C.tertiary;
            return (
              <div key={layer.name} className="rounded p-3 flex flex-col gap-2" style={{ backgroundColor: C.card, border: `1px solid ${isActive ? "rgba(156,255,147,0.12)" : "rgba(72,72,73,0.25)"}` }}>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: "9px", color: C.outlineVar, fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em" }}>L{i + 1}</span>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: isActive ? `0 0 6px ${color}` : "none" }} />
                </div>
                <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 600, color: "#ffffff", lineHeight: "1.3" }}>{layer.name}</div>
                <div style={{ fontSize: "8px", color: C.muted, lineHeight: "1.4" }} className="line-clamp-2">{layer.message}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Recent Signals ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-base" style={{ color: C.secondary }}>sensors</span>
            <span style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase" }}>
              Live Signal Feed
            </span>
          </div>
          <Link href="/signals">
            <span style={{ fontSize: "9px", color: C.secondary, fontFamily: "Space Grotesk", letterSpacing: "0.1em", cursor: "pointer" }}>
              VIEW ALL →
            </span>
          </Link>
        </div>

        <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: `1px solid rgba(72,72,73,0.3)` }}>
                {["Time", "Instrument", "Setup", "Quality", "Entry", "Status"].map((h: any) => (
                  <th key={h} className="px-4 py-2.5" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sigs.map((sig: any) => {
                const q = sig.final_quality;
                const qColor = q > 75 ? C.primary : q > 50 ? "#fbbf24" : C.tertiary;
                const isActiveSignal = sig.status === "approved" || sig.status === "executed";
                return (
                  <tr key={sig.id} className="hover:brightness-105 transition-all" style={{ borderBottom: `1px solid rgba(72,72,73,0.15)` }}>
                    <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                      {format(new Date(sig.created_at), "HH:mm:ss")}
                    </td>
                    <td className="px-4 py-2.5" style={{ fontSize: "11px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#ffffff" }}>
                      {sig.instrument}
                    </td>
                    <td className="px-4 py-2.5" style={{ fontSize: "10px", color: C.muted }}>
                      {sig.setup_type.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(72,72,73,0.4)" }}>
                          <div style={{ width: `${q}%`, height: "100%", backgroundColor: qColor, transition: "width 0.3s" }} />
                        </div>
                        <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: qColor }}>{formatNumber(q, 1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#ffffff" }}>
                      {sig.entry_price ? `$${Number(sig.entry_price).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded" style={{
                        fontSize: "8px",
                        fontFamily: "Space Grotesk",
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        backgroundColor: isActiveSignal ? "rgba(156,255,147,0.1)" : "rgba(72,72,73,0.2)",
                        color: isActiveSignal ? C.primary : C.muted,
                        border: `1px solid ${isActiveSignal ? "rgba(156,255,147,0.2)" : "rgba(72,72,73,0.3)"}`,
                      }}>
                        {sig.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sigs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center" style={{ color: C.outlineVar, fontSize: "11px" }}>
                    No signals recorded yet. Run a live scan to populate the feed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="pt-6 border-t flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.15)" }}>
        <div className="flex items-center gap-6">
          <div>
            <MicroLabel>Global Engine Status</MicroLabel>
            <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, color: C.primary, marginTop: "2px" }}>
              {String(coreStatus ?? systemStatus?.overall ?? "nominal").toUpperCase()}
            </div>
          </div>
          <div>
            <MicroLabel>Data Source</MicroLabel>
            <div style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, color: "#ffffff", marginTop: "2px" }}>
              Alpaca Crypto · Live
            </div>
          </div>
          <div>
            <MicroLabel>Refresh Rate</MicroLabel>
            <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono", fontWeight: 700, color: C.secondary, marginTop: "2px" }}>
              5s stats · SSE chart
            </div>
          </div>
        </div>
        <div style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
          GODSVIEW v0.4.2-CANDLE-XRAY
        </div>
      </div>
    </div>
  );
}
