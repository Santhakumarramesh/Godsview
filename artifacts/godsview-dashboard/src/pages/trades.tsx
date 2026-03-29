import { useGetTrades, useCreateTrade, useUpdateTrade, type CreateTradeRequest, type UpdateTradeRequest } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ExecutionPanel from "@/components/ExecutionPanel";

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

function operatorHeaders(): HeadersInit | undefined {
  if (typeof window === "undefined") return undefined;
  const token = window.localStorage.getItem("godsview_operator_token")?.trim();
  if (!token) return undefined;
  return { "x-godsview-token": token };
}

function μLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AlpacaPosition = {
  asset_id: string;
  symbol: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  change_today: string;
};

type AlpacaOrder = {
  id: string;
  symbol: string;
  qty: string;
  filled_qty: string;
  side: string;
  type: string;
  status: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  submitted_at: string;
  filled_at: string | null;
  filled_avg_price: string | null;
  order_class: string;
};

// ─── Shared subcomponents ─────────────────────────────────────────────────────

function FieldInput({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <μLabel>{label}</μLabel>
      <input {...props} className="w-full rounded px-3 py-2 outline-none"
        style={{ backgroundColor: C.bg, border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontSize: "12px", fontFamily: "JetBrains Mono, monospace" }} />
    </div>
  );
}

function FieldSelect({ label, children, ...props }: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1">
      <μLabel>{label}</μLabel>
      <select {...props} className="w-full rounded px-3 py-2 outline-none"
        style={{ backgroundColor: C.bg, border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontSize: "12px", fontFamily: "Space Grotesk" }}>
        {children}
      </select>
    </div>
  );
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg rounded overflow-hidden" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.4)" }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.25)" }}>
          <span className="font-headline font-bold text-sm">{title}</span>
          <button onClick={onClose} className="material-symbols-outlined text-base" style={{ color: C.outline }}>close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; border: string }> = {
    win: { bg: "rgba(156,255,147,0.1)", color: C.primary, border: "rgba(156,255,147,0.2)" },
    loss: { bg: "rgba(255,113,98,0.1)", color: C.tertiary, border: "rgba(255,113,98,0.2)" },
    open: { bg: "rgba(102,157,255,0.1)", color: C.secondary, border: "rgba(102,157,255,0.2)" },
    new: { bg: "rgba(102,157,255,0.1)", color: C.secondary, border: "rgba(102,157,255,0.2)" },
    accepted: { bg: "rgba(102,157,255,0.08)", color: C.secondary, border: "rgba(102,157,255,0.15)" },
    pending_new: { bg: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "rgba(251,191,36,0.2)" },
    filled: { bg: "rgba(156,255,147,0.1)", color: C.primary, border: "rgba(156,255,147,0.2)" },
    canceled: { bg: "rgba(72,72,73,0.2)", color: C.muted, border: "rgba(72,72,73,0.3)" },
    partially_filled: { bg: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "rgba(251,191,36,0.2)" },
  };
  const s = map[status] ?? { bg: "rgba(72,72,73,0.2)", color: C.muted, border: "rgba(72,72,73,0.3)" };
  return (
    <span className="px-2 py-0.5 rounded" style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Journal Tab ─────────────────────────────────────────────────────────────

function JournalTab() {
  const { data, isLoading } = useGetTrades({ limit: 50 });
  const [showCreate, setShowCreate] = useState(false);
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-all hover:brightness-110"
          style={{ backgroundColor: "rgba(102,157,255,0.1)", border: "1px solid rgba(102,157,255,0.2)", color: C.secondary, fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>add</span>
          Record Trade
        </button>
      </div>

      {showCreate && <CreateTradeDialog onClose={() => setShowCreate(false)} />}
      {editingTradeId !== null && <UpdateTradeDialog tradeId={editingTradeId} onClose={() => setEditingTradeId(null)} />}

      <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {isLoading ? (
          <div className="flex justify-center py-16"><span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} /></div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.3)" }}>
                {["Time", "Asset", "Dir", "Setup", "Entry", "Exit", "P&L", "Outcome", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.trades.map((trade) => (
                <tr key={trade.id} className="group hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{format(new Date(trade.created_at), "MM/dd HH:mm")}</td>
                  <td className="px-4 py-2.5 font-headline font-bold text-xs">{trade.instrument}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-headline font-bold text-xs" style={{ color: trade.direction === "long" ? C.primary : C.tertiary }}>{trade.direction.toUpperCase()}</span>
                  </td>
                  <td className="px-4 py-2.5" style={{ fontSize: "9px", color: C.muted }}>{trade.setup_type?.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>{trade.entry_price}</td>
                  <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{trade.exit_price ?? "—"}</td>
                  <td className="px-4 py-2.5 font-bold" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: (trade.pnl ?? 0) > 0 ? C.primary : (trade.pnl ?? 0) < 0 ? C.tertiary : C.muted }}>
                    {formatCurrency(trade.pnl)}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={trade.outcome ?? "open"} /></td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => setEditingTradeId(trade.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-xs" style={{ color: C.secondary, fontFamily: "Space Grotesk" }}>Update</button>
                  </td>
                </tr>
              ))}
              {(!data?.trades || data.trades.length === 0) && (
                <tr><td colSpan={9} className="px-4 py-12 text-center" style={{ color: C.outlineVar, fontSize: "11px", fontFamily: "Space Grotesk" }}>No trades recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Live Account Bar ─────────────────────────────────────────────────────────

type AccountInfo = {
  equity?: string;
  buying_power?: string;
  cash?: string;
  account_number?: string;
  is_paper?: boolean;
  mode?: "paper" | "live";
  status?: string;
  error?: string;
};

function AccountBar() {
  const [acct, setAcct] = useState<AccountInfo | null>(null);
  const [posCount, setPosCount] = useState(0);
  const [openOrderCount, setOpenOrderCount] = useState(0);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [aRes, pRes, oRes] = await Promise.all([
          fetch("/api/alpaca/account").then(r => r.json()),
          fetch("/api/alpaca/positions/live").then(r => r.json()),
          fetch("/api/alpaca/orders?status=open&limit=50").then(r => r.json()),
        ]);
        setAcct(aRes);
        setPosCount(pRes.positions?.length ?? 0);
        setOpenOrderCount(oRes.orders?.filter((o: { status: string }) => ["new","accepted","pending_new","partially_filled"].includes(o.status)).length ?? 0);
      } catch { /* silent */ }
    };
    fetchAll();
    const id = setInterval(fetchAll, 10000);
    return () => clearInterval(id);
  }, []);

  if (!acct || acct.error) return null;

  const equity = parseFloat(acct.equity ?? "0");
  const bp = parseFloat(acct.buying_power ?? "0");
  const isPaper = acct.is_paper ?? acct.account_number?.startsWith("PA");

  return (
    <div className="flex items-center gap-6 px-5 py-3 rounded-lg" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.25)" }}>
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: isPaper ? "#fbbf24" : "#9cff93" }} />
        <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: isPaper ? "#fbbf24" : "#9cff93" }}>
          {isPaper ? "Paper" : "Live"}
        </span>
      </div>
      <div className="w-px h-4" style={{ backgroundColor: "rgba(72,72,73,0.4)" }} />
      {[
        { label: "Equity", value: `$${equity.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`, color: "#9cff93" },
        { label: "Buying Power", value: `$${bp.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`, color: "#fff" },
        { label: "Positions", value: String(posCount), color: posCount > 0 ? "#669dff" : "#767576" },
        { label: "Open Orders", value: String(openOrderCount), color: openOrderCount > 0 ? "#fbbf24" : "#767576" },
      ].map(({ label, value, color }) => (
        <div key={label} className="flex items-center gap-2">
          <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: "#767576" }}>{label}</span>
          <span style={{ fontSize: "12px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Positions Tab ────────────────────────────────────────────────────────────

function PositionsTab() {
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const resp = await fetch("/api/alpaca/positions/live");
      const data = await resp.json();
      if (data.error) { setError(data.message ?? data.error); setPositions([]); }
      else { setPositions(data.positions ?? []); setError(null); }
      setLastUpdated(new Date());
    } catch { setError("Connection failed"); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchPositions();
    intervalRef.current = setInterval(fetchPositions, 15_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchPositions]);

  const handleClose = async (symbol: string) => {
    if (!confirm(`Close entire ${symbol} position?`)) return;
    setClosing(symbol);
    try {
      await fetch(`/api/alpaca/positions/${symbol}`, { method: "DELETE", headers: operatorHeaders() });
      await fetchPositions();
    } catch { setError("Failed to close position"); } finally { setClosing(null); }
  };

  const totalPnL = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl ?? "0"), 0);
  const totalValue = positions.reduce((sum, p) => sum + parseFloat(p.market_value ?? "0"), 0);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4 p-4 rounded" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div>
          <μLabel>Total Positions</μLabel>
          <div className="mt-1 font-bold" style={{ fontSize: "18px", fontFamily: "JetBrains Mono, monospace" }}>{positions.length}</div>
        </div>
        <div>
          <μLabel>Market Value</μLabel>
          <div className="mt-1 font-bold" style={{ fontSize: "18px", fontFamily: "JetBrains Mono, monospace" }}>${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div>
          <μLabel>Unrealized P&L</μLabel>
          <div className="mt-1 font-bold" style={{ fontSize: "18px", fontFamily: "JetBrains Mono, monospace", color: totalPnL >= 0 ? C.primary : C.tertiary }}>
            {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Live indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
          <span style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Live · Refreshes every 5s</span>
        </div>
        {lastUpdated && <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.outlineVar }}>{format(lastUpdated, "HH:mm:ss")}</span>}
      </div>

      {error && (
        <div className="px-4 py-3 rounded" style={{ backgroundColor: "rgba(255,113,98,0.06)", border: "1px solid rgba(255,113,98,0.15)" }}>
          <p style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.tertiary }}>{error}</p>
          {error.includes("Trading API") && <p style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.muted, marginTop: "4px" }}>Generate Trading API keys (PK/AK) from app.alpaca.markets to see live positions.</p>}
        </div>
      )}

      <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {loading ? (
          <div className="flex justify-center py-16"><span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} /></div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.3)" }}>
                {["Symbol", "Side", "Qty", "Avg Entry", "Current", "Mkt Value", "Unr. P&L", "% Today", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const pnl = parseFloat(pos.unrealized_pl ?? "0");
                const pnlPct = parseFloat(pos.unrealized_plpc ?? "0") * 100;
                const changeToday = parseFloat(pos.change_today ?? "0") * 100;
                return (
                  <tr key={pos.symbol} className="group hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
                    <td className="px-4 py-3 font-headline font-bold text-sm">{pos.symbol.replace("/", "")}</td>
                    <td className="px-4 py-3">
                      <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, color: pos.side === "long" ? C.primary : C.tertiary, textTransform: "uppercase" }}>
                        {pos.side}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}>{parseFloat(pos.qty).toFixed(6)}</td>
                    <td className="px-4 py-3" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>${parseFloat(pos.avg_entry_price).toLocaleString()}</td>
                    <td className="px-4 py-3" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}>${parseFloat(pos.current_price).toLocaleString()}</td>
                    <td className="px-4 py-3" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}>${parseFloat(pos.market_value).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <div>
                        <span style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: pnl >= 0 ? C.primary : C.tertiary }}>
                          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                        </span>
                        <span style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted, display: "block" }}>
                          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: changeToday >= 0 ? C.primary : C.tertiary }}>
                      {changeToday >= 0 ? "+" : ""}{changeToday.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleClose(pos.symbol.replace("/", "%2F"))}
                        disabled={closing === pos.symbol}
                        className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded text-xs disabled:opacity-40"
                        style={{ backgroundColor: "rgba(255,113,98,0.1)", border: "1px solid rgba(255,113,98,0.2)", color: C.tertiary, fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}
                      >
                        {closing === pos.symbol ? "Closing..." : "Close"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {positions.length === 0 && !loading && !error && (
                <tr><td colSpan={9} className="px-4 py-12 text-center" style={{ color: C.outlineVar, fontSize: "11px", fontFamily: "Space Grotesk" }}>No open positions.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────

function OrdersTab() {
  const [orders, setOrders] = useState<AlpacaOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "all">("open");
  const [canceling, setCanceling] = useState<string | null>(null);
  const [cancelingAll, setCancelingAll] = useState(false);

  const fetchOrders = useCallback(async () => {
    try {
      const resp = await fetch(`/api/alpaca/orders?status=${statusFilter}&limit=50`);
      const data = await resp.json();
      if (data.error) { setError(data.message ?? data.error); setOrders([]); }
      else { setOrders(data.orders ?? []); setError(null); }
    } catch { setError("Connection failed"); } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { setLoading(true); fetchOrders(); }, [fetchOrders]);

  const handleCancel = async (orderId: string) => {
    setCanceling(orderId);
    try {
      await fetch(`/api/alpaca/orders/${orderId}`, { method: "DELETE", headers: operatorHeaders() });
      await fetchOrders();
    } catch { setError("Failed to cancel order"); } finally { setCanceling(null); }
  };

  const handleCancelAll = async () => {
    if (!confirm("Cancel all open orders?")) return;
    setCancelingAll(true);
    try {
      await fetch("/api/alpaca/orders", { method: "DELETE", headers: operatorHeaders() });
      await fetchOrders();
    } catch { setError("Failed to cancel all orders"); } finally { setCancelingAll(false); }
  };

  const openOrders = orders.filter((o) => ["new", "accepted", "pending_new", "partially_filled"].includes(o.status));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["open", "closed", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="px-3 py-1.5 rounded text-xs transition-all"
              style={{
                fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                backgroundColor: statusFilter === s ? "rgba(102,157,255,0.12)" : "transparent",
                border: statusFilter === s ? "1px solid rgba(102,157,255,0.3)" : "1px solid rgba(72,72,73,0.25)",
                color: statusFilter === s ? C.secondary : C.outline,
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {openOrders.length > 0 && (
          <button
            onClick={handleCancelAll}
            disabled={cancelingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-all hover:brightness-110 disabled:opacity-50"
            style={{ backgroundColor: "rgba(255,113,98,0.08)", border: "1px solid rgba(255,113,98,0.2)", color: C.tertiary, fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>cancel</span>
            {cancelingAll ? "Canceling..." : `Cancel All (${openOrders.length})`}
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded" style={{ backgroundColor: "rgba(255,113,98,0.06)", border: "1px solid rgba(255,113,98,0.15)" }}>
          <p style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.tertiary }}>{error}</p>
        </div>
      )}

      <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {loading ? (
          <div className="flex justify-center py-16"><span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} /></div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.3)" }}>
                {["Submitted", "Symbol", "Side", "Type", "Qty", "Filled", "Avg Fill", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const isOpen = ["new", "accepted", "pending_new", "partially_filled"].includes(order.status);
                return (
                  <tr key={order.id} className="group hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{format(new Date(order.submitted_at), "MM/dd HH:mm:ss")}</td>
                    <td className="px-4 py-2.5 font-headline font-bold text-xs">{order.symbol.replace("/", "")}</td>
                    <td className="px-4 py-2.5">
                      <span style={{ fontSize: "10px", fontFamily: "Space Grotesk", fontWeight: 700, color: order.side === "buy" ? C.primary : C.tertiary, textTransform: "uppercase" }}>{order.side}</span>
                    </td>
                    <td className="px-4 py-2.5" style={{ fontSize: "9px", fontFamily: "Space Grotesk", color: C.muted, textTransform: "uppercase" }}>
                      {order.type}{order.order_class === "bracket" ? " ·bracket" : ""}
                    </td>
                    <td className="px-4 py-2.5" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}>{order.qty ?? "—"}</td>
                    <td className="px-4 py-2.5" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{order.filled_qty ?? "0"}</td>
                    <td className="px-4 py-2.5" style={{ fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}>
                      {order.filled_avg_price ? `$${parseFloat(order.filled_avg_price).toLocaleString()}` : order.limit_price ? `$${parseFloat(order.limit_price).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={order.status} /></td>
                    <td className="px-4 py-2.5">
                      {isOpen && (
                        <button
                          onClick={() => handleCancel(order.id)}
                          disabled={canceling === order.id}
                          className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded disabled:opacity-40"
                          style={{ fontSize: "8px", backgroundColor: "rgba(255,113,98,0.08)", border: "1px solid rgba(255,113,98,0.2)", color: C.tertiary, fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}
                        >
                          {canceling === order.id ? "..." : "Cancel"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && !loading && (
                <tr><td colSpan={9} className="px-4 py-12 text-center" style={{ color: C.outlineVar, fontSize: "11px", fontFamily: "Space Grotesk" }}>No {statusFilter} orders.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Trades() {
  const [activeTab, setActiveTab] = useState<"journal" | "positions" | "orders">("positions");
  const [showQuickTrade, setShowQuickTrade] = useState(false);

  const tabs: { id: "journal" | "positions" | "orders"; label: string; icon: string }[] = [
    { id: "journal", label: "Trade Journal", icon: "menu_book" },
    { id: "positions", label: "Live Positions", icon: "trending_up" },
    { id: "orders", label: "Orders", icon: "receipt_long" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Execution Log
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Execution Center</h1>
          <p style={{ fontSize: "11px", fontFamily: "Space Grotesk", color: C.muted, marginTop: "4px" }}>
            Trade journal · Live positions · Order management
          </p>
        </div>
        <button
          onClick={() => setShowQuickTrade(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-all hover:brightness-110 active:scale-95 mt-1"
          style={{ backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.3)", color: C.primary, fontSize: "9px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>add</span>
          Quick Trade
        </button>
      </div>

      {/* Live account bar */}
      <AccountBar />

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, width: "fit-content" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-2 rounded transition-all"
            style={{
              fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
              backgroundColor: activeTab === tab.id ? "rgba(102,157,255,0.12)" : "transparent",
              color: activeTab === tab.id ? C.secondary : C.outline,
              border: activeTab === tab.id ? "1px solid rgba(102,157,255,0.25)" : "1px solid transparent",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "journal" && <JournalTab />}
      {activeTab === "positions" && <PositionsTab />}
      {activeTab === "orders" && <OrdersTab />}

      {/* Quick Trade overlay */}
      {showQuickTrade && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
          <div className="w-full max-w-sm relative">
            <button
              onClick={() => setShowQuickTrade(false)}
              className="absolute -top-3 -right-3 z-10 w-7 h-7 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.4)" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "#767576" }}>close</span>
            </button>
            <ExecutionPanel
              symbol="BTCUSD"
              onOrderPlaced={() => { setShowQuickTrade(false); setActiveTab("positions"); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

function CreateTradeDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useCreateTrade({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/trades"] }); onClose(); } } });
  const [formData, setFormData] = useState<Partial<CreateTradeRequest>>({ instrument: "BTCUSDT", setup_type: "absorption_reversal", direction: "long", entry_price: 0, stop_loss: 0, take_profit: 0, quantity: 1, session: "NY" });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); mutation.mutate({ data: formData as CreateTradeRequest }); };
  return (
    <DialogShell title="Record Trade" onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FieldInput label="Instrument" value={formData.instrument} onChange={e => setFormData({ ...formData, instrument: e.target.value })} required />
          <FieldSelect label="Direction" value={formData.direction} onChange={e => setFormData({ ...formData, direction: e.target.value as any })}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </FieldSelect>
          {(["entry_price", "stop_loss", "take_profit", "quantity"] as const).map((field) => (
            <FieldInput key={field} label={field.replace(/_/g, " ")} type="number" step="0.01" value={formData[field] as number} onChange={e => setFormData({ ...formData, [field]: Number(e.target.value) })} required />
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs" style={{ color: C.outline, fontFamily: "Space Grotesk" }}>Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="px-6 py-2 text-xs rounded font-bold disabled:opacity-50"
            style={{ backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.2)", color: C.primary, fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {mutation.isPending ? "Saving..." : "Record"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function UpdateTradeDialog({ tradeId, onClose }: { tradeId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useUpdateTrade({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/trades"] }); onClose(); } } });
  const [formData, setFormData] = useState<Partial<UpdateTradeRequest>>({ outcome: "win", exit_price: 0, pnl: 0, notes: "" });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); mutation.mutate({ id: tradeId, data: formData as UpdateTradeRequest }); };
  return (
    <DialogShell title="Update Outcome" onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <FieldSelect label="Outcome" value={formData.outcome} onChange={e => setFormData({ ...formData, outcome: e.target.value as any })}>
          <option value="win">Win</option>
          <option value="loss">Loss</option>
          <option value="breakeven">Breakeven</option>
          <option value="open">Open</option>
        </FieldSelect>
        <div className="grid grid-cols-2 gap-4">
          <FieldInput label="Exit Price" type="number" step="0.01" value={formData.exit_price} onChange={e => setFormData({ ...formData, exit_price: Number(e.target.value) })} />
          <FieldInput label="P&L ($)" type="number" step="0.01" value={formData.pnl} onChange={e => setFormData({ ...formData, pnl: Number(e.target.value) })} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs" style={{ color: C.outline, fontFamily: "Space Grotesk" }}>Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="px-6 py-2 text-xs rounded font-bold disabled:opacity-50"
            style={{ backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.2)", color: C.primary, fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {mutation.isPending ? "Updating..." : "Update"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
