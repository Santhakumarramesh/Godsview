import { useState, useEffect, useCallback } from "react";

const C = {
  card: "#1a191b",
  cardDeep: "#131214",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
  bg: "#0e0e0f",
};

function μLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>
      {children}
    </span>
  );
}

type FullAccount = {
  account_number?: string;
  status?: string;
  crypto_status?: string;
  equity?: string;
  buying_power?: string;
  cash?: string;
  portfolio_value?: string;
  shorting_enabled?: boolean;
  error?: string;
  message?: string;
};

type ExecutionPanelProps = {
  symbol?: string;
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  direction?: "long" | "short";
  setupType?: string;
  atr?: number;
  onOrderPlaced?: (order: unknown) => void;
};

export default function ExecutionPanel({
  symbol = "BTCUSD",
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  direction = "long",
  setupType,
  onOrderPlaced,
}: ExecutionPanelProps) {
  const [account, setAccount] = useState<FullAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTicket, setShowTicket] = useState(false);
  const [ticketDir, setTicketDir] = useState<"long" | "short">(direction);
  const [riskPct, setRiskPct] = useState(1);

  const equity = parseFloat(account?.equity ?? account?.portfolio_value ?? "0");
  const buyingPower = parseFloat(account?.buying_power ?? "0");
  const cash = parseFloat(account?.cash ?? "0");

  const isConnected = !!account && !account.error;
  const isPaper = account?.account_number?.startsWith("PA");

  // ATR-based position size
  const calcQty = (() => {
    if (equity <= 0 || !entryPrice || !stopLossPrice) return null;
    const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
    if (riskPerUnit <= 0) return null;
    return Math.round((equity * riskPct / 100) / riskPerUnit * 1e6) / 1e6;
  })();

  const calcNotional = equity > 0 ? Math.round(equity * riskPct / 100 * 100) / 100 : null;

  const fetchAccount = useCallback(async () => {
    try {
      const r = await fetch("/api/alpaca/account");
      setAccount(await r.json());
    } catch { setAccount({ error: "fetch_failed" }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAccount(); }, [fetchAccount]);

  const openTicket = (dir: "long" | "short") => { setTicketDir(dir); setShowTicket(true); };

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>

        {/* ── Header ── */}
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "15px", color: C.secondary }}>bolt</span>
            <μLabel>Execution Engine</μLabel>
            {account?.account_number && (
              <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>
                #{account.account_number}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {account?.crypto_status === "ACTIVE" && (
              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.secondary, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                ● Crypto
              </span>
            )}
            {loading ? (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.outline }} />
            ) : isConnected ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ backgroundColor: isPaper ? "rgba(251,191,36,0.08)" : "rgba(156,255,147,0.08)", border: `1px solid ${isPaper ? "rgba(251,191,36,0.2)" : "rgba(156,255,147,0.2)"}` }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: isPaper ? "#fbbf24" : C.primary }} />
                <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", color: isPaper ? "#fbbf24" : C.primary }}>
                  {isPaper ? "Paper" : "Live"}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.tertiary }}>● Disconnected</span>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4">

          {/* ── Account stats ── */}
          {isConnected && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Equity", value: `$${fmt(equity)}`, color: C.primary },
                { label: "Buying Power", value: `$${fmt(buyingPower)}`, color: "#fff" },
                { label: "Cash", value: `$${fmt(cash)}`, color: C.muted },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded p-3" style={{ backgroundColor: C.cardDeep }}>
                  <μLabel>{label}</μLabel>
                  <div className="mt-1 font-bold" style={{ fontSize: "13px", fontFamily: "JetBrains Mono, monospace", color }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Error state ── */}
          {!loading && !isConnected && (
            <div className="px-3 py-2.5 rounded" style={{ backgroundColor: "rgba(255,113,98,0.06)", border: "1px solid rgba(255,113,98,0.15)" }}>
              <p style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.tertiary }}>
                {account?.message ?? "Unable to connect to Alpaca. Check API keys."}
              </p>
            </div>
          )}

          {/* ── Signal context ── */}
          {entryPrice && stopLossPrice && (
            <div className="grid grid-cols-3 gap-2 p-3 rounded" style={{ backgroundColor: C.cardDeep, border: `1px solid ${C.border}` }}>
              {[
                { label: "Entry", value: `$${entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "#fff" },
                { label: "Stop Loss", value: `$${stopLossPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: C.tertiary },
                { label: "Take Profit", value: takeProfitPrice ? `$${takeProfitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—", color: C.primary },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <μLabel>{label}</μLabel>
                  <div className="mt-0.5 font-bold" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Position Sizer ── */}
          {isConnected && equity > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <μLabel>Risk-Based Position Sizer</μLabel>
                <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.muted }}>
                  {calcQty !== null ? `${calcQty} units` : `$${calcNotional?.toFixed(2) ?? "—"} notional`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <μLabel>Risk %</μLabel>
                <input
                  type="range" min={0.1} max={equity <= 100 ? 50 : 5} step={0.1}
                  value={riskPct}
                  onChange={e => setRiskPct(parseFloat(e.target.value))}
                  className="flex-1"
                  style={{ accentColor: C.secondary }}
                />
                <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: C.secondary, minWidth: "36px" }}>
                  {riskPct.toFixed(1)}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 p-2.5 rounded" style={{ backgroundColor: C.cardDeep }}>
                <div>
                  <μLabel>Risk $</μLabel>
                  <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: C.secondary, marginTop: "2px" }}>
                    ${(equity * riskPct / 100).toFixed(2)}
                  </div>
                </div>
                <div>
                  <μLabel>{calcQty !== null ? "Qty" : "Notional"}</μLabel>
                  <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: "#fff", marginTop: "2px" }}>
                    {calcQty !== null ? calcQty : `$${calcNotional?.toFixed(2)}`}
                  </div>
                </div>
                <div>
                  <μLabel>Symbol</μLabel>
                  <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: "#fff", marginTop: "2px" }}>{symbol}</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Execute buttons ── */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => openTicket("long")}
              className="flex items-center justify-center gap-2 py-3 rounded font-bold transition-all hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.25)",
                color: C.primary, fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase"
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>arrow_upward</span>
              Buy Long
            </button>
            <button
              onClick={() => openTicket("short")}
              className="flex items-center justify-center gap-2 py-3 rounded font-bold transition-all hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: "rgba(255,113,98,0.1)", border: "1px solid rgba(255,113,98,0.25)",
                color: C.tertiary, fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase"
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>arrow_downward</span>
              Sell Short
            </button>
          </div>

        </div>
      </div>

      {showTicket && (
        <OrderTicket
          symbol={symbol}
          direction={ticketDir}
          entryPrice={entryPrice}
          stopLossPrice={stopLossPrice}
          takeProfitPrice={takeProfitPrice}
          suggestedQty={calcQty ?? undefined}
          suggestedNotional={calcNotional ?? undefined}
          setupType={setupType}
          equity={equity}
          onClose={() => setShowTicket(false)}
          onSuccess={order => { setShowTicket(false); onOrderPlaced?.(order); }}
        />
      )}
    </>
  );
}

// ─── Order Ticket ─────────────────────────────────────────────────────────────

function parseAlpacaError(raw: string): string {
  try {
    const jsonStr = raw.replace(/^.*?Alpaca \d+: /, "");
    const obj = JSON.parse(jsonStr);
    return obj.message ?? raw;
  } catch { return raw; }
}

type OrderTicketProps = {
  symbol: string;
  direction: "long" | "short";
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  suggestedQty?: number;
  suggestedNotional?: number;
  setupType?: string;
  equity: number;
  onClose: () => void;
  onSuccess: (order: unknown) => void;
};

function OrderTicket({
  symbol, direction, entryPrice, stopLossPrice, takeProfitPrice,
  suggestedQty, suggestedNotional, setupType, equity, onClose, onSuccess,
}: OrderTicketProps) {
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [useNotional, setUseNotional] = useState(!suggestedQty);
  const [qty, setQty] = useState(suggestedQty ? String(suggestedQty) : "");
  const [notional, setNotional] = useState(suggestedNotional ? String(Math.min(suggestedNotional, equity * 0.9)) : "");
  const [limitPrice, setLimitPrice] = useState(entryPrice ? String(entryPrice.toFixed(2)) : "");
  const [slPrice, setSlPrice] = useState(stopLossPrice ? String(stopLossPrice.toFixed(2)) : "");
  const [tpPrice, setTpPrice] = useState(takeProfitPrice ? String(takeProfitPrice.toFixed(2)) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [placed, setPlaced] = useState<{ id: string; status: string } | null>(null);

  const side = direction === "long" ? "buy" : "sell";
  const dirColor = direction === "long" ? "#9cff93" : "#ff7162";

  const maxRisk = entryPrice && slPrice && qty
    ? Math.abs(entryPrice - parseFloat(slPrice)) * parseFloat(qty)
    : null;
  const rr = entryPrice && slPrice && tpPrice
    ? Math.abs(entryPrice - parseFloat(tpPrice)) / Math.abs(entryPrice - parseFloat(slPrice))
    : null;

  const handleSubmit = async () => {
    if (!confirming) { setConfirming(true); return; }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { symbol, side, type: orderType, time_in_force: "gtc" };
      if (useNotional) body.notional = parseFloat(notional);
      else body.qty = parseFloat(qty);
      if (orderType === "limit") body.limit_price = parseFloat(limitPrice);
      if (slPrice) body.stop_loss_price = parseFloat(slPrice);
      if (tpPrice) body.take_profit_price = parseFloat(tpPrice);

      const r = await fetch("/api/alpaca/orders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.message ?? "Order failed");

      // Auto-record in trade journal
      await fetch("/api/trades", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: symbol, direction, setup_type: setupType ?? "manual",
          entry_price: entryPrice ?? parseFloat(limitPrice) ?? 0,
          stop_loss: slPrice ? parseFloat(slPrice) : 0,
          take_profit: tpPrice ? parseFloat(tpPrice) : 0,
          quantity: useNotional ? 0 : parseFloat(qty),
          session: (() => {
            const h = new Date().getUTCHours();
            return h >= 13 && h < 22 ? "NY" : h >= 7 && h < 13 ? "London" : "ASIA";
          })(),
        }),
      });

      setPlaced({ id: data.order.id, status: data.order.status });
      setTimeout(() => { onSuccess(data.order); }, 2000);
    } catch (err) {
      setError(parseAlpacaError(String(err)));
      setConfirming(false);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
      <div className="w-full max-w-[420px] rounded-lg overflow-hidden"
        style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.5)", boxShadow: "0 25px 60px rgba(0,0,0,0.6)" }}>

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid rgba(72,72,73,0.25)", background: direction === "long" ? "linear-gradient(90deg,rgba(156,255,147,0.06) 0%,transparent 60%)" : "linear-gradient(90deg,rgba(255,113,98,0.06) 0%,transparent 60%)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded flex items-center justify-center"
              style={{ backgroundColor: direction === "long" ? "rgba(156,255,147,0.12)" : "rgba(255,113,98,0.12)", border: `1px solid ${dirColor}30` }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px", color: dirColor }}>
                {direction === "long" ? "arrow_upward" : "arrow_downward"}
              </span>
            </div>
            <div>
              <div className="font-headline font-bold text-sm" style={{ color: dirColor }}>
                {direction === "long" ? "Buy Long" : "Sell Short"} · {symbol}
              </div>
              {setupType && (
                <div style={{ fontSize: "9px", color: "#767576", fontFamily: "Space Grotesk", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {setupType.replace(/_/g, " ")}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="material-symbols-outlined" style={{ fontSize: "18px", color: "#767576" }}>close</button>
        </div>

        {/* Success state */}
        {placed ? (
          <div className="p-8 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "rgba(156,255,147,0.12)", border: "1px solid rgba(156,255,147,0.3)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "28px", color: "#9cff93" }}>check_circle</span>
            </div>
            <div className="text-center">
              <div className="font-headline font-bold text-base" style={{ color: "#9cff93" }}>Order Submitted</div>
              <div style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#767576", marginTop: "4px" }}>
                {placed.id.slice(0, 8)}… · {placed.status.replace(/_/g, " ")}
              </div>
              <div style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: "#adaaab", marginTop: "8px" }}>
                Recorded in trade journal · View in Execution Center
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Order type */}
            <div className="flex gap-2">
              {(["market", "limit"] as const).map(t => (
                <button key={t} onClick={() => setOrderType(t)}
                  className="flex-1 py-2 rounded text-center transition-all"
                  style={{
                    fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                    backgroundColor: orderType === t ? "rgba(102,157,255,0.12)" : "transparent",
                    border: orderType === t ? "1px solid rgba(102,157,255,0.35)" : "1px solid rgba(72,72,73,0.25)",
                    color: orderType === t ? "#669dff" : "#767576",
                  }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Qty / Notional */}
            <div className="flex items-center gap-2 pb-1">
              {["Units", "Notional $"].map((label, i) => (
                <button key={label} onClick={() => setUseNotional(i === 1)}
                  className="px-3 py-1 rounded transition-all"
                  style={{
                    fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase",
                    backgroundColor: useNotional === (i === 1) ? "rgba(102,157,255,0.1)" : "transparent",
                    border: useNotional === (i === 1) ? "1px solid rgba(102,157,255,0.25)" : "1px solid rgba(72,72,73,0.2)",
                    color: useNotional === (i === 1) ? "#669dff" : "#767576",
                  }}>
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {useNotional ? (
                <div className="col-span-2 space-y-1">
                  <μLabel>Notional Amount ($)</μLabel>
                  <input type="number" step="1" value={notional} onChange={e => setNotional(e.target.value)}
                    placeholder="10.00" className="w-full rounded px-3 py-2.5 outline-none text-sm"
                    style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.4)", color: "#fff", fontFamily: "JetBrains Mono, monospace" }} />
                </div>
              ) : (
                <div className="col-span-2 space-y-1">
                  <μLabel>Quantity (units)</μLabel>
                  <input type="number" step="0.000001" value={qty} onChange={e => setQty(e.target.value)}
                    placeholder="0.000100" className="w-full rounded px-3 py-2.5 outline-none text-sm"
                    style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.4)", color: "#fff", fontFamily: "JetBrains Mono, monospace" }} />
                </div>
              )}

              {orderType === "limit" && (
                <div className="col-span-2 space-y-1">
                  <μLabel>Limit Price</μLabel>
                  <input type="number" step="0.01" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                    className="w-full rounded px-3 py-2.5 outline-none text-sm"
                    style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.4)", color: "#fff", fontFamily: "JetBrains Mono, monospace" }} />
                </div>
              )}

              <div className="space-y-1">
                <μLabel>Stop Loss</μLabel>
                <input type="number" step="0.01" value={slPrice} onChange={e => setSlPrice(e.target.value)}
                  placeholder="optional" className="w-full rounded px-3 py-2.5 outline-none text-sm"
                  style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(255,113,98,0.25)", color: "#fff", fontFamily: "JetBrains Mono, monospace" }} />
              </div>
              <div className="space-y-1">
                <μLabel>Take Profit</μLabel>
                <input type="number" step="0.01" value={tpPrice} onChange={e => setTpPrice(e.target.value)}
                  placeholder="optional" className="w-full rounded px-3 py-2.5 outline-none text-sm"
                  style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(156,255,147,0.25)", color: "#fff", fontFamily: "JetBrains Mono, monospace" }} />
              </div>
            </div>

            {/* Risk summary */}
            {(maxRisk !== null || rr !== null) && (
              <div className="grid grid-cols-2 gap-2 px-3 py-2.5 rounded"
                style={{ backgroundColor: "#131214", border: "1px solid rgba(72,72,73,0.2)" }}>
                {maxRisk !== null && (
                  <div>
                    <μLabel>Max Risk</μLabel>
                    <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: "#ff7162", marginTop: "2px" }}>
                      ${maxRisk.toFixed(2)}
                    </div>
                  </div>
                )}
                {rr !== null && (
                  <div>
                    <μLabel>R:R Ratio</μLabel>
                    <div style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: "#9cff93", marginTop: "2px" }}>
                      {rr.toFixed(2)}:1
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="px-3 py-2.5 rounded" style={{ backgroundColor: "rgba(255,113,98,0.08)", border: "1px solid rgba(255,113,98,0.2)" }}>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#ff7162", flexShrink: 0, marginTop: "1px" }}>error</span>
                  <p style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: "#ff7162", lineHeight: 1.5 }}>{error}</p>
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="space-y-2 pt-1">
              <button
                onClick={handleSubmit}
                disabled={submitting || (!qty && !notional)}
                className="w-full py-3 rounded font-bold transition-all hover:brightness-110 disabled:opacity-40 active:scale-95"
                style={{
                  backgroundColor: confirming
                    ? (direction === "long" ? "rgba(156,255,147,0.22)" : "rgba(255,113,98,0.22)")
                    : (direction === "long" ? "rgba(156,255,147,0.1)" : "rgba(255,113,98,0.1)"),
                  border: `1px solid ${direction === "long" ? "rgba(156,255,147,0.4)" : "rgba(255,113,98,0.4)"}`,
                  color: dirColor, fontSize: "10px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase",
                }}>
                {submitting ? "Submitting to Alpaca..." : confirming ? `Confirm ${direction === "long" ? "Buy" : "Sell"}` : "Review Order"}
              </button>
              {confirming && !submitting && (
                <button onClick={() => setConfirming(false)} className="w-full py-1 text-center"
                  style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: "#767576", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
