import { useGetSignals, useCreateSignal, type CreateSignalRequest } from "@workspace/api-client-react";
import { formatNumber, cn } from "@/lib/utils";
import { format } from "date-fns";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const C = {
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
  return <span style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.2em", textTransform: "uppercase", color: C.outline }}>{children}</span>;
}

function InputField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <MicroLabel>{label}</MicroLabel>
      <input {...props} className="w-full rounded px-3 py-2 text-sm outline-none transition-all focus:border-[#9cff93]"
        style={{ backgroundColor: "#0e0e0f", border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "JetBrains Mono, monospace", fontSize: "12px" }}
      />
    </div>
  );
}

export default function Signals() {
  const [instrumentFilter, setInstrumentFilter] = useState<string>("");
  const { data, isLoading } = useGetSignals({ instrument: instrumentFilter || undefined, limit: 50 });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div style={{ fontSize: "9px", color: C.outline, fontFamily: "Space Grotesk", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: "6px" }}>
            Godsview · Signal Intelligence
          </div>
          <h1 className="font-headline font-bold text-2xl tracking-tight">Signal Feed</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={instrumentFilter}
            onChange={(e) => setInstrumentFilter(e.target.value)}
            className="rounded px-3 py-1.5 text-xs outline-none"
            style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: "#ffffff", fontFamily: "Space Grotesk" }}
          >
            <option value="">All Instruments</option>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="MES">MES</option>
            <option value="MNQ">MNQ</option>
          </select>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded transition-all hover:brightness-110"
            style={{ backgroundColor: "rgba(102,157,255,0.12)", border: `1px solid rgba(102,157,255,0.25)`, color: C.secondary, fontSize: "9px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>add</span>
            Inject Signal
          </button>
        </div>
      </div>

      {showCreate && <CreateSignalDialog onClose={() => setShowCreate(false)} />}

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
                {["Timestamp", "Asset", "Setup", "Str", "OF", "Rcl", "ML", "Cld", "Final Q.", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5" style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.15em", textTransform: "uppercase", color: C.outlineVar, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.signals.map((sig) => {
                const q = sig.final_quality;
                const qColor = q > 75 ? C.primary : q > 50 ? "#fbbf24" : C.tertiary;
                return (
                  <tr key={sig.id} className="hover:brightness-105 transition-all" style={{ borderBottom: "1px solid rgba(72,72,73,0.12)" }}>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                      {format(new Date(sig.created_at), "MM/dd HH:mm:ss")}
                    </td>
                    <td className="px-4 py-2.5 font-headline font-bold text-xs">{sig.instrument}</td>
                    <td className="px-4 py-2.5" style={{ fontSize: "9px", color: C.muted, whiteSpace: "nowrap" }}>{sig.setup_type.replace(/_/g, " ")}</td>
                    {[sig.structure_score, sig.order_flow_score, sig.recall_score, sig.ml_probability, sig.claude_score].map((v, i) => (
                      <td key={i} className="px-4 py-2.5" style={{ fontSize: "9px", fontFamily: "JetBrains Mono, monospace", color: C.muted }}>
                        {formatNumber(v, 1)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      <span className="font-mono-num font-bold text-xs" style={{ color: qColor }}>{formatNumber(q, 1)}%</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded" style={{
                        fontSize: "8px", fontFamily: "Space Grotesk", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                        backgroundColor: sig.status === "active" ? "rgba(156,255,147,0.1)" : "rgba(72,72,73,0.2)",
                        color: sig.status === "active" ? C.primary : C.muted,
                        border: `1px solid ${sig.status === "active" ? "rgba(156,255,147,0.2)" : "rgba(72,72,73,0.3)"}`,
                      }}>
                        {sig.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(!data?.signals || data.signals.length === 0) && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center" style={{ color: C.outlineVar, fontSize: "11px", fontFamily: "Space Grotesk" }}>
                    No signals found. Run a live scan or backtest to generate signals.
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

function CreateSignalDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useCreateSignal({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
        onClose();
      },
    },
  });

  const [formData, setFormData] = useState<Partial<CreateSignalRequest>>({
    instrument: "BTCUSDT",
    setup_type: "sweep_reclaim",
    structure_score: 85,
    order_flow_score: 70,
    recall_score: 90,
    ml_probability: 75,
    claude_score: 88,
    news_lockout: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: formData as CreateSignalRequest });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg rounded overflow-hidden" style={{ backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.4)" }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.25)" }}>
          <span className="font-headline font-bold text-sm tracking-wide">Inject Manual Signal</span>
          <button onClick={onClose} className="material-symbols-outlined text-base" style={{ color: C.outline }}>close</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <MicroLabel>Instrument</MicroLabel>
              <input value={formData.instrument} onChange={e => setFormData({ ...formData, instrument: e.target.value })} required
                className="w-full rounded px-3 py-2 text-xs outline-none" style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontFamily: "Space Grotesk" }} />
            </div>
            <div className="space-y-1">
              <MicroLabel>Setup Type</MicroLabel>
              <input value={formData.setup_type} onChange={e => setFormData({ ...formData, setup_type: e.target.value })} required
                className="w-full rounded px-3 py-2 text-xs outline-none" style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontFamily: "Space Grotesk" }} />
            </div>
            {(["structure_score", "order_flow_score", "recall_score", "ml_probability", "claude_score"] as const).map((field) => (
              <div key={field} className="space-y-1">
                <MicroLabel>{field.replace(/_/g, " ")}</MicroLabel>
                <input type="number" value={formData[field] as number} onChange={e => setFormData({ ...formData, [field]: Number(e.target.value) })} required
                  className="w-full rounded px-3 py-2 text-xs outline-none" style={{ backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.35)", color: "#fff", fontFamily: "JetBrains Mono, monospace" }} />
              </div>
            ))}
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="nl" checked={formData.news_lockout} onChange={e => setFormData({ ...formData, news_lockout: e.target.checked })}
                className="w-3.5 h-3.5 rounded" style={{ accentColor: C.primary }} />
              <label htmlFor="nl" style={{ fontSize: "10px", fontFamily: "Space Grotesk", color: C.muted }}>News Lockout Override</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs rounded" style={{ color: C.outline, fontFamily: "Space Grotesk" }}>Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="px-6 py-2 text-xs rounded font-bold transition-all hover:brightness-110 disabled:opacity-50"
              style={{ backgroundColor: "rgba(156,255,147,0.12)", border: "1px solid rgba(156,255,147,0.25)", color: C.primary, fontFamily: "Space Grotesk", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {mutation.isPending ? "Processing..." : "Inject Signal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
