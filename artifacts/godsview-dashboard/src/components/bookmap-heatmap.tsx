import { useRef, useEffect, useState, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════
   Bookmap-Style Order Book Heatmap
   
   Canvas-rendered depth-of-market visualization:
   - Y axis = price levels (centered on current price)
   - X axis = time (candle-by-candle)
   - Color intensity = order book liquidity at that price/time
   - Bid liquidity = blue/cyan gradient
   - Ask liquidity = red/orange gradient  
   - Trade executions = bright dots on the price line
   - Absorption zones = bright white flashes
   - Liquidity pools = dense color bands
   - Current price line = yellow
   ═══════════════════════════════════════════════════════════════ */

interface BookmapCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bidDepth: number[];   // liquidity at each price level below mid
  askDepth: number[];   // liquidity at each price level above mid
  trades: { price: number; size: number; side: "buy" | "sell" }[];
  delta: number;        // buy volume - sell volume
  absorption: number;   // 0-1 absorption strength
}

interface Props {
  symbol: string;
  width?: number;
  height?: number;
}

/* ── Generate realistic order book depth data ─────────── */
const PRICE_LEVELS = 80;  // levels above and below mid price
const CANDLE_COUNT = 120;

function generateBookmapData(basePrice: number): BookmapCandle[] {
  const candles: BookmapCandle[] = [];
  let price = basePrice;
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const move = (Math.random() - 0.48) * basePrice * 0.003;
    price += move;
    const high = price + Math.random() * basePrice * 0.002;
    const low = price - Math.random() * basePrice * 0.002;
    const open = price - move * 0.3;
    const close = price;
    const volume = Math.floor(Math.random() * 500000 + 10000);

    // Generate bid depth (below current price) — clustered around key levels
    const bidDepth: number[] = [];
    for (let j = 0; j < PRICE_LEVELS; j++) {
      const dist = j / PRICE_LEVELS;
      // Liquidity clusters at round numbers and support levels
      const cluster = Math.sin(j * 0.3) * 0.5 + 0.5;
      const roundBonus = j % 10 === 0 ? 3 : j % 5 === 0 ? 1.5 : 1;
      const base = Math.max(0, (1 - dist * 0.8) * cluster * roundBonus);
      bidDepth.push(base * (0.5 + Math.random()) * 100);
    }

    // Generate ask depth (above current price)
    const askDepth: number[] = [];
    for (let j = 0; j < PRICE_LEVELS; j++) {
      const dist = j / PRICE_LEVELS;
      const cluster = Math.cos(j * 0.25) * 0.5 + 0.5;
      const roundBonus = j % 10 === 0 ? 3 : j % 5 === 0 ? 1.5 : 1;
      const base = Math.max(0, (1 - dist * 0.8) * cluster * roundBonus);
      askDepth.push(base * (0.5 + Math.random()) * 100);
    }

    // Generate trades
    const tradeCount = Math.floor(Math.random() * 8 + 2);
    const trades: BookmapCandle["trades"][] = [];
    for (let t = 0; t < tradeCount; t++) {
      trades.push({
        price: low + Math.random() * (high - low),
        size: Math.floor(Math.random() * 5000 + 100),
        side: Math.random() > 0.5 ? "buy" : "sell",
      } as any);
    }

    const buyVol = trades.filter((t: any) => t.side === "buy").reduce((s: number, t: any) => s + t.size, 0);
    const sellVol = trades.filter((t: any) => t.side === "sell").reduce((s: number, t: any) => s + t.size, 0);

    candles.push({
      time: Date.now() - (CANDLE_COUNT - i) * 60000,
      open, high, low, close, volume,
      bidDepth, askDepth,
      trades: trades as any,
      delta: buyVol - sellVol,
      absorption: Math.random() > 0.85 ? Math.random() * 0.8 + 0.2 : 0,
    });
  }
  return candles;
}

/* ── Color mapping functions ──────────────────────────── */
function bidColor(intensity: number): string {
  const norm = Math.min(1, intensity / 300);
  const r = Math.floor(norm * 30);
  const g = Math.floor(50 + norm * 150);
  const b = Math.floor(80 + norm * 175);
  return `rgb(${r},${g},${b})`;
}

function askColor(intensity: number): string {
  const norm = Math.min(1, intensity / 300);
  const r = Math.floor(80 + norm * 175);
  const g = Math.floor(30 + norm * 80);
  const b = Math.floor(norm * 30);
  return `rgb(${r},${g},${b})`;
}

function absorptionColor(strength: number): string {
  const a = Math.min(1, strength);
  return `rgba(255,255,255,${(a * 0.8).toFixed(2)})`;
}

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */
export default function BookmapHeatmap({ symbol, width: propW, height: propH }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: propW ?? 900, h: propH ?? 500 });
  const [hoveredCandle, setHoveredCandle] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: BookmapCandle } | null>(null);

  const basePrice = useMemo(() => {
    const prices: Record<string, number> = {
      SPY: 518, QQQ: 448, AAPL: 189, NVDA: 142, TSLA: 248, MSFT: 415, AMZN: 185, META: 505,
    };
    return prices[symbol] ?? 100 + Math.random() * 400;
  }, [symbol]);

  const data = useMemo(() => generateBookmapData(basePrice), [basePrice]);

  // Responsive resize
  useEffect(() => {
    if (propW && propH) return;
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: Math.max(400, entry.contentRect.height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [propW, propH]);

  /* ── Canvas render ──────────────────────────────────── */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = size.w;
    const H = size.h;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, 0, W, H);

    const MARGIN_LEFT = 60;
    const MARGIN_RIGHT = 10;
    const MARGIN_TOP = 10;
    const MARGIN_BOTTOM = 30;
    const chartW = W - MARGIN_LEFT - MARGIN_RIGHT;
    const chartH = H - MARGIN_TOP - MARGIN_BOTTOM;
    const candleW = chartW / data.length;

    // Price range
    const allPrices = data.flatMap((c) => [c.high, c.low]);
    const priceMin = Math.min(...allPrices) * 0.998;
    const priceMax = Math.max(...allPrices) * 1.002;
    const priceRange = priceMax - priceMin;

    const priceToY = (p: number) => MARGIN_TOP + (1 - (p - priceMin) / priceRange) * chartH;
    const idxToX = (i: number) => MARGIN_LEFT + i * candleW;

    // ── Draw heatmap cells (the core Bookmap visualization) ──
    data.forEach((candle, i) => {
      const x = idxToX(i);
      const midPrice = (candle.open + candle.close) / 2;
      const step = priceRange / (PRICE_LEVELS * 2);

      // Bid side (below mid)
      candle.bidDepth.forEach((depth, j) => {
        const p = midPrice - j * step;
        const y = priceToY(p);
        const cellH = Math.max(1, (step / priceRange) * chartH);
        ctx.fillStyle = bidColor(depth);
        ctx.fillRect(x, y, candleW - 0.5, cellH + 0.5);
      });

      // Ask side (above mid)
      candle.askDepth.forEach((depth, j) => {
        const p = midPrice + j * step;
        const y = priceToY(p + step);
        const cellH = Math.max(1, (step / priceRange) * chartH);
        ctx.fillStyle = askColor(depth);
        ctx.fillRect(x, y, candleW - 0.5, cellH + 0.5);
      });

      // Absorption flash
      if (candle.absorption > 0.2) {
        const y = priceToY(candle.close);
        ctx.fillStyle = absorptionColor(candle.absorption);
        ctx.fillRect(x, y - 3, candleW, 6);
      }
    });

    // ── Draw trade execution dots ────────────────────────
    data.forEach((candle, i) => {
      const x = idxToX(i) + candleW / 2;
      candle.trades.forEach((trade) => {
        const y = priceToY(trade.price);
        const r = Math.min(5, Math.max(1.5, trade.size / 2000));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = trade.side === "buy" ? "rgba(0,255,136,0.9)" : "rgba(255,80,80,0.9)";
        ctx.fill();
      });
    });

    // ── Draw price line (current price = yellow) ─────────
    const lastPrice = data[data.length - 1].close;
    const yLast = priceToY(lastPrice);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#f0e442";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN_LEFT, yLast);
    ctx.lineTo(W - MARGIN_RIGHT, yLast);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price label
    ctx.fillStyle = "#f0e442";
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`$${lastPrice.toFixed(2)}`, MARGIN_LEFT + 4, yLast - 4);

    // ── Y axis price labels ──────────────────────────────
    ctx.fillStyle = "#555";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    const priceTicks = 10;
    for (let i = 0; i <= priceTicks; i++) {
      const p = priceMin + (i / priceTicks) * priceRange;
      const y = priceToY(p);
      ctx.fillText(`$${p.toFixed(2)}`, MARGIN_LEFT - 4, y + 3);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN_LEFT, y);
      ctx.lineTo(W - MARGIN_RIGHT, y);
      ctx.stroke();
    }

    // ── X axis time labels ───────────────────────────────
    ctx.fillStyle = "#555";
    ctx.textAlign = "center";
    const step = Math.max(1, Math.floor(data.length / 8));
    for (let i = 0; i < data.length; i += step) {
      const x = idxToX(i) + candleW / 2;
      const t = new Date(data[i].time);
      ctx.fillText(`${t.getHours()}:${t.getMinutes().toString().padStart(2, "0")}`, x, H - 8);
    }

    // ── Hover highlight ──────────────────────────────────
    if (hoveredCandle !== null && hoveredCandle >= 0 && hoveredCandle < data.length) {
      const x = idxToX(hoveredCandle);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(x, MARGIN_TOP, candleW, chartH);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, MARGIN_TOP, candleW, chartH);
    }

    // ── Delta bar at bottom ──────────────────────────────
    const deltaH = 20;
    const maxDelta = Math.max(...data.map((c) => Math.abs(c.delta)));
    data.forEach((candle, i) => {
      const x = idxToX(i);
      const norm = candle.delta / (maxDelta || 1);
      const barH = Math.abs(norm) * deltaH;
      ctx.fillStyle = candle.delta >= 0 ? "rgba(0,255,136,0.5)" : "rgba(255,80,80,0.5)";
      ctx.fillRect(x, H - MARGIN_BOTTOM - barH, candleW - 0.5, barH);
    });
  }, [data, size, hoveredCandle]);

  useEffect(() => { render(); }, [render]);

  // Mouse interaction
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const MARGIN_LEFT = 60;
    const candleW = (size.w - 70) / data.length;
    const idx = Math.floor((mx - MARGIN_LEFT) / candleW);
    if (idx >= 0 && idx < data.length) {
      setHoveredCandle(idx);
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, data: data[idx] });
    } else {
      setHoveredCandle(null);
      setTooltip(null);
    }
  }, [data, size]);

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: size.h }}>
      <canvas
        ref={canvasRef}
        onMouseMove={onMouseMove}
        onMouseLeave={() => { setHoveredCandle(null); setTooltip(null); }}
        className="cursor-crosshair"
      />
      {/* Tooltip */}
      {tooltip && (
        <div className="absolute pointer-events-none bg-[#1a1a2e] border border-gray-700 rounded-lg p-2 text-[10px] z-10 shadow-lg"
          style={{ left: Math.min(tooltip.x + 12, size.w - 180), top: tooltip.y + 12 }}>
          <div className="text-gray-400 mb-1">{new Date(tooltip.data.time).toLocaleTimeString()}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <div><span className="text-gray-500">O</span> <span className="text-white">${tooltip.data.open.toFixed(2)}</span></div>
            <div><span className="text-gray-500">H</span> <span className="text-white">${tooltip.data.high.toFixed(2)}</span></div>
            <div><span className="text-gray-500">L</span> <span className="text-white">${tooltip.data.low.toFixed(2)}</span></div>
            <div><span className="text-gray-500">C</span> <span className="text-white">${tooltip.data.close.toFixed(2)}</span></div>
            <div><span className="text-gray-500">Vol</span> <span className="text-cyan-400">{(tooltip.data.volume / 1000).toFixed(0)}K</span></div>
            <div><span className="text-gray-500">Delta</span> <span className={tooltip.data.delta >= 0 ? "text-green-400" : "text-red-400"}>{tooltip.data.delta > 0 ? "+" : ""}{tooltip.data.delta}</span></div>
            <div><span className="text-gray-500">Trades</span> <span className="text-white">{tooltip.data.trades.length}</span></div>
            {tooltip.data.absorption > 0.2 && <div><span className="text-yellow-400">Absorption</span> <span className="text-yellow-300">{(tooltip.data.absorption * 100).toFixed(0)}%</span></div>}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-1 left-16 flex items-center gap-4 text-[9px] text-gray-500">
        <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm" style={{ background: "linear-gradient(90deg, #1a3050, #30c8ff)" }} /> Bid Liquidity</div>
        <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm" style={{ background: "linear-gradient(90deg, #501a1a, #ff5050)" }} /> Ask Liquidity</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-400" /> Buy</div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-400" /> Sell</div>
        <div className="flex items-center gap-1"><div className="w-3 h-2 rounded-sm bg-white/40" /> Absorption</div>
      </div>
    </div>
  );
}
