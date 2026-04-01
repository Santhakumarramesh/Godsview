import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrderbook } from "@/hooks/useOrderbook";
import { isCryptoSymbol, normalizeMarketSymbol, toAlpacaSymbol, toDisplaySymbol } from "@/lib/market/symbols";

type Timeframe = "1" | "5" | "15" | "60" | "D";

type LiquidityZone = {
  price: number;
  side: "bid" | "ask";
  strength: number;
};

type LiquidityResponse = {
  bidZones: LiquidityZone[];
  askZones: LiquidityZone[];
};

type CandleIntelResponse = {
  summary?: {
    reversal_signals?: number;
    absorption_zones?: number;
    high_vol_events?: number;
  };
};

type Props = {
  symbol: string;
  timeframe?: Timeframe;
  compact?: boolean;
};

const C = {
  card: "#1a191b",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
};

const TF_TO_API: Record<Timeframe, "1Min" | "5Min" | "15Min" | "1Hour"> = {
  "1": "1Min",
  "5": "5Min",
  "15": "15Min",
  "60": "1Hour",
  "D": "1Hour",
};

function fmtPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 10) return value.toFixed(3);
  return value.toFixed(5);
}

function Pill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      className="rounded px-2 py-1"
      style={{
        backgroundColor: "rgba(14,14,15,0.65)",
        border: `1px solid rgba(72,72,73,0.2)`,
        minWidth: "96px",
      }}
    >
      <div style={{ fontSize: "7px", fontFamily: "Space Grotesk", color: C.outline, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: color ?? "#ffffff", fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

export default function ChartIntelStrip({ symbol, timeframe = "5", compact = false }: Props) {
  const normalized = normalizeMarketSymbol(symbol);
  const alpacaSymbol = toAlpacaSymbol(normalized);
  const apiTf = TF_TO_API[timeframe] ?? "5Min";
  const crypto = isCryptoSymbol(alpacaSymbol);

  const { data: orderbook, status } = useOrderbook(alpacaSymbol, compact ? 12 : 20, crypto);

  const { data: zones } = useQuery<LiquidityResponse>({
    queryKey: ["chart-intel-zones", alpacaSymbol, crypto],
    queryFn: () => fetch(`/api/market/liquidity-zones?symbol=${alpacaSymbol}&bucket_pct=0.08&top_n=4`).then((r) => r.json()),
    refetchInterval: 12_000,
    staleTime: 10_000,
    enabled: crypto,
  });

  const { data: candleIntel } = useQuery<CandleIntelResponse>({
    queryKey: ["chart-intel-candle", alpacaSymbol, apiTf, crypto],
    queryFn: () => fetch(`/api/market/candle-intelligence?symbol=${alpacaSymbol}&timeframe=${apiTf}&bars=50`).then((r) => r.json()),
    refetchInterval: 25_000,
    staleTime: 20_000,
    enabled: crypto,
  });

  if (!crypto) {
    return (
      <div
        className="rounded px-3 py-2"
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: "13px", color: C.outline }}>info</span>
          <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.muted, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
            {toDisplaySymbol(alpacaSymbol)} · Orderbook/Heatmap overlays are available for crypto pairs.
          </span>
        </div>
      </div>
    );
  }

  const metrics = useMemo(() => {
    if (!orderbook?.bestBid || !orderbook.bestAsk) {
      return {
        spreadBps: null as number | null,
        imbalance: 0,
        bidStrength: 0,
        askStrength: 0,
      };
    }

    const bestBid = orderbook.bestBid.price;
    const bestAsk = orderbook.bestAsk.price;
    const mid = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadBps = mid > 0 ? (spread / mid) * 10_000 : null;

    const bidVol = orderbook.bids.slice(0, 8).reduce((sum, level) => sum + level.size, 0);
    const askVol = orderbook.asks.slice(0, 8).reduce((sum, level) => sum + level.size, 0);
    const imbalance = bidVol + askVol > 0 ? (bidVol - askVol) / (bidVol + askVol) : 0;

    const bidStrength = Math.max(0, zones?.bidZones?.[0]?.strength ?? 0);
    const askStrength = Math.max(0, zones?.askZones?.[0]?.strength ?? 0);

    return { spreadBps, imbalance, bidStrength, askStrength };
  }, [orderbook, zones]);

  const biasLabel =
    metrics.imbalance > 0.2 ? "Long Bias" :
    metrics.imbalance < -0.2 ? "Short Bias" :
    "Neutral";

  const biasColor =
    metrics.imbalance > 0.2 ? C.primary :
    metrics.imbalance < -0.2 ? C.tertiary :
    C.muted;

  const reversalCount = candleIntel?.summary?.reversal_signals ?? 0;
  const absorptionCount = candleIntel?.summary?.absorption_zones ?? 0;
  const highVolCount = candleIntel?.summary?.high_vol_events ?? 0;

  return (
    <div
      className="rounded px-3 py-2"
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: "13px", color: C.secondary }}>insights</span>
          <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.muted, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700 }}>
            {toDisplaySymbol(alpacaSymbol)} · Bookmap + Orderbook + Heatmap
          </span>
        </div>
        <span
          style={{
            fontSize: "8px",
            fontFamily: "Space Grotesk",
            color: status === "ws" ? C.primary : status === "error" ? C.tertiary : C.outline,
            letterSpacing: "0.1em",
            fontWeight: 700,
          }}
        >
          {status === "ws" ? "WS LIVE" : status === "error" ? "RECONNECTING" : "REST LIVE"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Pill label="Best Bid" value={fmtPrice(orderbook?.bestBid?.price)} color={C.primary} />
        <Pill label="Best Ask" value={fmtPrice(orderbook?.bestAsk?.price)} color={C.tertiary} />
        <Pill
          label="Spread"
          value={metrics.spreadBps === null ? "-" : `${metrics.spreadBps.toFixed(2)} bps`}
          color={metrics.spreadBps !== null && metrics.spreadBps <= 4 ? C.primary : C.muted}
        />
        <Pill
          label="Imbalance"
          value={`${(metrics.imbalance * 100).toFixed(1)}%`}
          color={metrics.imbalance >= 0 ? C.primary : C.tertiary}
        />
        <Pill
          label="Heatmap"
          value={`B ${(metrics.bidStrength * 100).toFixed(0)} · A ${(metrics.askStrength * 100).toFixed(0)}`}
          color={metrics.bidStrength >= metrics.askStrength ? C.primary : C.tertiary}
        />
        <Pill label="Bias" value={biasLabel} color={biasColor} />
        <Pill label="Reversal" value={`${reversalCount}`} color={reversalCount > 0 ? C.secondary : C.outline} />
        <Pill label="Absorption" value={`${absorptionCount}`} color={absorptionCount > 0 ? "#fbbf24" : C.outline} />
        <Pill label="High Vol" value={`${highVolCount}`} color={highVolCount > 0 ? "#e879f9" : C.outline} />
      </div>
    </div>
  );
}
