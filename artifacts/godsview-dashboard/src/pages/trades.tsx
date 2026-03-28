import { useGetTrades, useCreateTrade, useUpdateTrade, type CreateTradeRequest, type UpdateTradeRequest } from "@workspace/api-client-react";
import { formatCurrency, formatNumber, formatPercent, cn } from "@/lib/utils";
import { format } from "date-fns";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const C = {
  card: "#1a191b",
  border: "rgba(72,72,73,0.25)",
  primary: "#9cff93",
  secondary: "#669dff",
  tertiary: "#ff7162",
  muted: "#adaaab",
  outline: "#767576",
  outlineVar: "#484849",
};

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

export default function Trades() {
  const { data, isLoading } = useGetTrades({ limit: 50 });
  const [showCreate, setShowCreate] = useState(false);
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Execution Log
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Trade Journal</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-all hover:brightness-110"
          style={{ backgroundColor: "rgba(102,157,255,0.1)", border: `1px solid rgba(102,157,255,0.2)`, color: C.secondary, fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>add</span>
          Record Trade
        </button>
      </div>

      {showCreate && <CreateTradeDialog onClose={() => setShowCreate(false)} />}
      {editingTradeId !== null && <UpdateTradeDialog tradeId={editingTradeId} onClose={() => setEditingTradeId(null)} />}

      {/* Table */}
      <div className="rounded overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: C.primary }} />
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(72,72,73,0.3)" }}>
                {["Time", "Asset", "Dir", "Setup", "Entry", "Exit", "P&L", "Outcome", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.trades.map((trade) => (
                <tr key={trade.id} className="group hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                    {format(new Date(trade.created_at), "MM/dd HH:mm")}
                  </td>
                  <td className="px-4 py-2.5 font-headline font-bold text-xs">{trade.instrument}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-headline font-bold text-xs" style={{ color: trade.direction === "long" ? C.primary : C.tertiary }}>
                      {trade.direction.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5" style={{ fontSize: "9px", color: C.muted }}>{trade.setup_type?.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}>{trade.entry_price}</td>
                  <td className="px-4 py-2.5" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>{trade.exit_price ?? "—"}</td>
                  <td className="px-4 py-2.5 font-bold" style={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: (trade.pnl ?? 0) > 0 ? C.primary : (trade.pnl ?? 0) < 0 ? C.tertiary : C.muted }}>
                    {formatCurrency(trade.pnl)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded" style={{
                      fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                      backgroundColor: trade.outcome === "win" ? "rgba(156,255,147,0.1)" : trade.outcome === "loss" ? "rgba(255,113,98,0.1)" : "rgba(72,72,73,0.2)",
                      color: trade.outcome === "win" ? C.primary : trade.outcome === "loss" ? C.tertiary : C.muted,
                      border: `1px solid ${trade.outcome === "win" ? "rgba(156,255,147,0.2)" : trade.outcome === "loss" ? "rgba(255,113,98,0.2)" : "rgba(72,72,73,0.3)"}`,
                    }}>
                      {trade.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => setEditingTradeId(trade.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                      style={{ color: C.secondary, fontFamily: "Space Grotesk" }}
                    >
                      Update
                    </button>
                  </td>
                </tr>
              ))}
              {(!data?.trades || data.trades.length === 0) && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center" style={{ color: C.outlineVar, fontSize: "11px", fontFamily: "Space Grotesk" }}>
                    No trades recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg rounded overflow-hidden" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.4)" }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.25)" }}>
          <span className="font-headline font-bold text-sm">{title}</span>
          <button onClick={onClose} className="material-symbols-outlined text-base" style={{ color: "#767576" }}>close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldInput({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: "#767576" }}>{label}</span>
      <input {...props} className="w-full rounded px-3 py-2 outline-none"
        style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontSize: "12px", fontFamily: "JetBrains Mono, monospace" }} />
    </div>
  );
}

function FieldSelect({ label, children, ...props }: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1">
      <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: "#767576" }}>{label}</span>
      <select {...props} className="w-full rounded px-3 py-2 outline-none"
        style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontSize: "12px", fontFamily: "Space Grotesk" }}>
        {children}
      </select>
    </div>
  );
}

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
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs" style={{ color: "#767576", fontFamily: "Space Grotesk" }}>Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="px-6 py-2 text-xs rounded font-bold disabled:opacity-50"
            style={{ backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.2)", color: "#9cff93", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
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
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs" style={{ color: "#767576", fontFamily: "Space Grotesk" }}>Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="px-6 py-2 text-xs rounded font-bold disabled:opacity-50"
            style={{ backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.2)", color: "#9cff93", fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {mutation.isPending ? "Updating..." : "Update"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
