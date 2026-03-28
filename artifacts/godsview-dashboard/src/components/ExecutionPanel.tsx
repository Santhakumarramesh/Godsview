import { useState, useEffect, useCallback } from "react";

const C = {
  card: "#1a191b",
  cardDeep: "#131214",
  border: "rgba(72,72,73,0.25)",
  borderHigh: "rgba(72,72,73,0.4)",
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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <μLabel>{label}</μLabel>
      <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: color ?? "#fff", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

type AccountData = {
  equity?: string;
  buying_power?: string;
  cash?: string;
  portfolio_value?: string;
  currency?: string;
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
  atr,
  onOrderPlaced,
}: ExecutionPanelProps) {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [showTicket, setShowTicket] = useState(false);
  const [ticketDir, setTicketDir] = useState<"long" | "short">(direction);
  const [riskPct, setRiskPct] = useState(1);
  const [calcQty, setCalcQty] = useState<number | null>(null);

  const equity = account ? parseFloat(account.equity ?? account.portfolio_value ?? "0") : 0;

  const fetchAccount = useCallback(async () => {
    try {
      const resp = await fetch("/api/alpaca/account");
      const data = await resp.json();
      setAccount(data);
    } catch {
      setAccount({ error: "fetch_failed" });
    } finally {
      setAccountLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccount(); }, [fetchAccount]);

  useEffect(() => {
    if (equity > 0 && entryPrice && stopLossPrice) {
      const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
      if (riskPerUnit > 0) {
        const riskDollars = equity * (riskPct / 100);
        const qty = riskDollars / riskPerUnit;
        setCalcQty(Math.round(qty * 1e6) / 1e6);
      }
    }
  }, [equity, entryPrice, stopLossPrice, riskPct]);

  const openTicket = (dir: "long" | "short") => {
    setTicketDir(dir);
    setShowTicket(true);
  };

  const noTradingKey = account?.error === "broker_key" || !account || !!account?.error;
  const hasSignal = !!entryPrice && !!stopLossPrice;

  return (
    <>
      <div className="rounded" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {/* Header */}
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: "14px", color: C.secondary }}>bolt</span>
            <μLabel>Execution Engine</μLabel>
          </div>
          {accountLoading ? (
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.outline }} />
          ) : noTradingKey ? (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.tertiary }} />
              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.tertiary, letterSpacing: "0.1em", textTransform: "uppercase" }}>Paper/No Key</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
              <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", color: C.primary, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {(account as { account_type?: string })?.account_type === "live" ? "Live" : "Paper"}
              </span>
            </div>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Account stats */}
          <div className="grid grid-cols-3 gap-4 pb-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            <Stat
              label="Equity"
              value={accountLoading ? "—" : noTradingKey ? "—" : `$${parseFloat(account?.equity ?? "0").toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
              color={C.primary}
            />
            <Stat
              label="Buying Power"
              value={accountLoading ? "—" : noTradingKey ? "—" : `$${parseFloat(account?.buying_power ?? "0").toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            />
            <Stat
              label="Cash"
              value={accountLoading ? "—" : noTradingKey ? "—" : `$${parseFloat(account?.cash ?? "0").toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            />
          </div>

          {noTradingKey && (
            <div className="px-3 py-2 rounded" style={{ backgroundColor: "rgba(255,113,98,0.06)", border: "1px solid rgba(255,113,98,0.15)" }}>
              <p style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.tertiary, lineHeight: 1.5 }}>
                Paper / Broker keys detected. Generate <strong>Trading API keys</strong> (PK/AK) from app.alpaca.markets to enable live execution.
              </p>
            </div>
          )}

          {/* Signal context */}
          {hasSignal && (
            <div className="grid grid-cols-3 gap-3 p-3 rounded" style={{ backgroundColor: C.cardDeep, border: `1px solid ${C.border}` }}>
              <Stat label="Entry" value={entryPrice!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
              <Stat label="Stop Loss" value={stopLossPrice!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} color={C.tertiary} />
              <Stat label="Take Profit" value={takeProfitPrice ? takeProfitPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} color={C.primary} />
            </div>
          )}

          {/* Risk / Position Sizer */}
          {hasSignal && equity > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <μLabel>Position Sizer</μLabel>
                <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.muted }}>ATR-based risk</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <μLabel>Risk %</μLabel>
                  <input
                    type="range" min={0.1} max={5} step={0.1}
                    value={riskPct}
                    onChange={(e) => setRiskPct(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: C.secondary }}
                  />
                  <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: C.secondary, minWidth: "32px" }}>
                    {riskPct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 p-2.5 rounded" style={{ backgroundColor: C.cardDeep }}>
                <Stat label="Risk $" value={`$${(equity * riskPct / 100).toFixed(2)}`} color={C.secondary} />
                <Stat label="Qty" value={calcQty !== null ? String(calcQty) : "—"} color="#fff" />
                <Stat label="Symbol" value={symbol} />
              </div>
            </div>
          )}

          {/* Execute buttons */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={() => openTicket("long")}
              className="flex items-center justify-center gap-2 py-2.5 rounded font-bold transition-all hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: "rgba(156,255,147,0.1)",
                border: "1px solid rgba(156,255,147,0.25)",
                color: C.primary,
                fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase"
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>arrow_upward</span>
              Long
            </button>
            <button
              onClick={() => openTicket("short")}
              className="flex items-center justify-center gap-2 py-2.5 rounded font-bold transition-all hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: "rgba(255,113,98,0.1)",
                border: "1px solid rgba(255,113,98,0.25)",
                color: C.tertiary,
                fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase"
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>arrow_downward</span>
              Short
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
          setupType={setupType}
          onClose={() => setShowTicket(false)}
          onSuccess={(order) => { setShowTicket(false); onOrderPlaced?.(order); }}
        />
      )}
    </>
  );
}

type OrderTicketProps = {
  symbol: string;
  direction: "long" | "short";
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  suggestedQty?: number;
  setupType?: string;
  onClose: () => void;
  onSuccess: (order: unknown) => void;
};

function OrderTicket({ symbol, direction, entryPrice, stopLossPrice, takeProfitPrice, suggestedQty, setupType, onClose, onSuccess }: OrderTicketProps) {
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [qty, setQty] = useState(suggestedQty ? String(suggestedQty) : "");
  const [notional, setNotional] = useState("");
  const [useNotional, setUseNotional] = useState(false);
  const [limitPrice, setLimitPrice] = useState(entryPrice ? String(entryPrice) : "");
  const [slPrice, setSlPrice] = useState(stopLossPrice ? String(stopLossPrice) : "");
  const [tpPrice, setTpPrice] = useState(takeProfitPrice ? String(takeProfitPrice) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const side = direction === "long" ? "buy" : "sell";
  const dirColor = direction === "long" ? C.primary : C.tertiary;

  const handleSubmit = async () => {
    if (!confirming) { setConfirming(true); return; }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        symbol,
        side,
        type: orderType,
        time_in_force: "gtc",
      };
      if (useNotional) body.notional = parseFloat(notional);
      else body.qty = parseFloat(qty);
      if (orderType === "limit") body.limit_price = parseFloat(limitPrice);
      if (slPrice) body.stop_loss_price = parseFloat(slPrice);
      if (tpPrice) body.take_profit_price = parseFloat(tpPrice);

      const resp = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message ?? "Order failed");

      // Auto-record in trade journal
      await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument: symbol,
          direction,
          setup_type: setupType ?? "manual",
          entry_price: entryPrice ?? parseFloat(limitPrice) ?? 0,
          stop_loss: slPrice ? parseFloat(slPrice) : 0,
          take_profit: tpPrice ? parseFloat(tpPrice) : 0,
          quantity: useNotional ? 0 : parseFloat(qty),
          session: new Date().getUTCHours() < 16 ? "NY" : "ASIA",
        }),
      });

      onSuccess(data.order);
    } catch (err) {
      setError(String(err));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-md rounded overflow-hidden" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.5)" }}>
        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(72,72,73,0.25)" }}>
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined" style={{ fontSize: "16px", color: dirColor }}>
              {direction === "long" ? "arrow_upward" : "arrow_downward"}
            </span>
            <div>
              <div className="font-headline font-bold text-sm" style={{ color: dirColor }}>
                {direction === "long" ? "Buy Long" : "Sell Short"} · {symbol}
              </div>
              {setupType && <div style={{ fontSize: "9px", color: C.muted, fontFamily: "Space Grotesk" }}>{setupType.replace(/_/g, " ")}</div>}
            </div>
          </div>
          <button onClick={onClose} className="material-symbols-outlined" style={{ fontSize: "18px", color: C.outline }}>close</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Order type toggle */}
          <div className="flex gap-2">
            {(["market", "limit"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className="flex-1 py-1.5 rounded text-center transition-all"
                style={{
                  fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                  backgroundColor: orderType === t ? "rgba(102,157,255,0.12)" : "transparent",
                  border: orderType === t ? "1px solid rgba(102,157,255,0.3)" : "1px solid rgba(72,72,73,0.25)",
                  color: orderType === t ? C.secondary : C.outline,
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Qty / Notional toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseNotional(false)}
              style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: !useNotional ? C.secondary : C.outline, textTransform: "uppercase", letterSpacing: "0.1em" }}
            >
              Units
            </button>
            <div
              onClick={() => setUseNotional(!useNotional)}
              className="relative cursor-pointer"
              style={{ width: "30px", height: "16px", backgroundColor: useNotional ? "rgba(102,157,255,0.3)" : "rgba(72,72,73,0.3)", borderRadius: "8px", transition: "all 0.2s" }}
            >
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#fff", position: "absolute", top: "3px", left: useNotional ? "17px" : "3px", transition: "left 0.2s" }} />
            </div>
            <button
              onClick={() => setUseNotional(true)}
              style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: useNotional ? C.secondary : C.outline, textTransform: "uppercase", letterSpacing: "0.1em" }}
            >
              Notional $
            </button>
          </div>

          {/* Qty or Notional */}
          <div className="grid grid-cols-2 gap-3">
            {useNotional ? (
              <div className="space-y-1 col-span-2">
                <μLabel>Notional ($)</μLabel>
                <input type="number" step="1" value={notional} onChange={(e) => setNotional(e.target.value)} placeholder="100.00"
                  className="w-full rounded px-3 py-2 outline-none"
                  style={{ backgroundColor: C.bg, border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontSize: "13px", fontFamily: "JetBrains Mono, monospace" }} />
              </div>
            ) : (
              <div className="space-y-1 col-span-2">
                <μLabel>Quantity (units)</μLabel>
                <input type="number" step="0.000001" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0.001"
                  className="w-full rounded px-3 py-2 outline-none"
                  style={{ backgroundColor: C.bg, border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontSize: "13px", fontFamily: "JetBrains Mono, monospace" }} />
              </div>
            )}
            {orderType === "limit" && (
              <div className="space-y-1 col-span-2">
                <μLabel>Limit Price</μLabel>
                <input type="number" step="0.01" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)}
                  className="w-full rounded px-3 py-2 outline-none"
                  style={{ backgroundColor: C.bg, border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontSize: "13px", fontFamily: "JetBrains Mono, monospace" }} />
              </div>
            )}
            <div className="space-y-1">
              <μLabel>Stop Loss</μLabel>
              <input type="number" step="0.01" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} placeholder="optional"
                className="w-full rounded px-3 py-2 outline-none"
                style={{ backgroundColor: C.bg, border: "1px solid rgba(255,113,98,0.2)", color: "#fff", fontSize: "13px", fontFamily: "JetBrains Mono, monospace" }} />
            </div>
            <div className="space-y-1">
              <μLabel>Take Profit</μLabel>
              <input type="number" step="0.01" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} placeholder="optional"
                className="w-full rounded px-3 py-2 outline-none"
                style={{ backgroundColor: C.bg, border: "1px solid rgba(156,255,147,0.2)", color: "#fff", fontSize: "13px", fontFamily: "JetBrains Mono, monospace" }} />
            </div>
          </div>

          {/* Risk summary */}
          {entryPrice && slPrice && qty && (
            <div className="px-3 py-2 rounded" style={{ backgroundColor: C.cardDeep, border: "1px solid rgba(72,72,73,0.2)" }}>
              <div className="flex justify-between">
                <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.outline }}>Max Risk</span>
                <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.tertiary }}>
                  ${(Math.abs(entryPrice - parseFloat(slPrice)) * parseFloat(qty)).toFixed(2)}
                </span>
              </div>
              {takeProfitPrice && (
                <div className="flex justify-between mt-1">
                  <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.outline }}>Target R/R</span>
                  <span style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.primary }}>
                    {slPrice && tpPrice ? (Math.abs(entryPrice - parseFloat(tpPrice)) / Math.abs(entryPrice - parseFloat(slPrice))).toFixed(2) : "—"}:1
                  </span>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded" style={{ backgroundColor: "rgba(255,113,98,0.08)", border: "1px solid rgba(255,113,98,0.2)" }}>
              <p style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.tertiary }}>{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || (!qty && !notional)}
            className="w-full py-3 rounded font-bold transition-all hover:brightness-110 disabled:opacity-40 active:scale-95"
            style={{
              backgroundColor: confirming
                ? (direction === "long" ? "rgba(156,255,147,0.25)" : "rgba(255,113,98,0.25)")
                : (direction === "long" ? "rgba(156,255,147,0.1)" : "rgba(255,113,98,0.1)"),
              border: `1px solid ${direction === "long" ? "rgba(156,255,147,0.35)" : "rgba(255,113,98,0.35)"}`,
              color: dirColor,
              fontSize: "10px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase"
            }}
          >
            {submitting ? "Submitting..." : confirming ? `Confirm ${direction === "long" ? "Buy" : "Sell"} Order` : `Review Order`}
          </button>
          {confirming && !submitting && (
            <button onClick={() => setConfirming(false)} className="w-full text-center py-1"
              style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.outline, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
