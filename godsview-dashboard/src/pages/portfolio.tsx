import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

type PositionAlloc = {
  symbol: string;
  sector: string;
  conviction: number;
  realized_vol: number;
  raw_weight: number;
  final_weight: number;
  target_notional: number;
  target_qty: number;
  current_qty: number;
  delta_qty: number;
  capped_by: string | null;
};

type PortfolioState = {
  positions: PositionAlloc[];
  total_weight: number;
  cash_weight: number;
  sector_exposure: Record<string, number>;
  constraints: {
    vol_target: number;
    single_cap: number;
    sector_cap: number;
    total_cap: number;
    cash_min: number;
  };
  computed_at: string;
};

const SECTOR_COLORS: Record<string, string> = {
  crypto: "#9cff93", forex: "#67e8f9", futures: "#fbbf24",
  stocks: "#669dff", commodities: "#cc79a7", bonds: "#56b4e9",
  default: "#767576",
};

function SectorBar({ sectors, total }: { sectors: Record<string, number>; total: number }) {
  const entries = Object.entries(sectors).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div style={{ marginBottom: "24px" }}>
      <h3 style={{ fontFamily: "Space Grotesk", fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em", color: "#adaaab", marginBottom: "10px" }}>
        SECTOR EXPOSURE
      </h3>
      <div style={{ display: "flex", height: "24px", borderRadius: "6px", overflow: "hidden", marginBottom: "8px" }}>
        {entries.map(([sector, weight]) => (
          <div key={sector} style={{
            width: `${(weight / (total || 1)) * 100}%`,
            backgroundColor: SECTOR_COLORS[sector] ?? SECTOR_COLORS.default,
            opacity: 0.8,
            minWidth: "2px",
          }} title={`${sector}: ${(weight * 100).toFixed(1)}%`} />
        ))}
        {total < 1 && (
          <div style={{ width: `${((1 - total) / 1) * 100}%`, backgroundColor: "#1a191b" }} title={`Cash: ${((1 - total) * 100).toFixed(1)}%`} />
        )}
      </div>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {entries.map(([sector, weight]) => (
          <div key={sector} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: SECTOR_COLORS[sector] ?? SECTOR_COLORS.default }} />
            <span style={{ fontSize: "10px", color: "#adaaab" }}>{sector}</span>
            <span style={{ fontSize: "10px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>{(weight * 100).toFixed(1)}%</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#1a191b", border: "1px solid #484849" }} />
          <span style={{ fontSize: "10px", color: "#adaaab" }}>cash</span>
          <span style={{ fontSize: "10px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>{((1 - total) * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { data: current, isLoading } = useQuery({
    queryKey: ["portfolio-current"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio/current");
      if (!res.ok) return null;
      return res.json() as Promise<PortfolioState>;
    },
    refetchInterval: 15_000,
  });

  // Demo compute form
  const [demoJson, setDemoJson] = useState(`[
  { "symbol": "BTCUSD", "conviction": 0.85, "realized_vol": 0.65, "sector": "crypto", "current_qty": 0.1, "current_price": 67000 },
  { "symbol": "ETHUSD", "conviction": 0.70, "realized_vol": 0.72, "sector": "crypto", "current_qty": 1.5, "current_price": 3400 },
  { "symbol": "EURUSD", "conviction": 0.60, "realized_vol": 0.08, "sector": "forex", "current_qty": 10000, "current_price": 1.085 }
]`);
  const [demoEquity, setDemoEquity] = useState(100000);

  const computeMut = useMutation({
    mutationFn: async () => {
      const positions = JSON.parse(demoJson);
      const res = await fetch("/api/portfolio/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions, equity: demoEquity }),
      });
      if (!res.ok) throw new Error("Portfolio compute failed");
      return res.json() as Promise<PortfolioState>;
    },
  });

  const pf = computeMut.data ?? current;

  return (
    <div style={{ padding: "24px", maxWidth: "1100px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontFamily: "Space Grotesk", fontSize: "18px", fontWeight: 700, letterSpacing: "0.15em", color: "#9cff93", marginBottom: "4px" }}>
          PORTFOLIO ENGINE
        </h1>
        <p style={{ fontSize: "11px", color: "#767576" }}>Vol-targeted position sizing — conviction × vol allocation with 4-stage constraints</p>
      </div>

      {/* Compute panel */}
      <div style={{ padding: "16px", borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.15)", marginBottom: "24px" }}>
        <div style={{ fontSize: "10px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.1em", marginBottom: "10px" }}>COMPUTE ALLOCATION</div>
        <div style={{ display: "flex", gap: "12px", marginBottom: "12px", alignItems: "flex-end" }}>
          <div>
            <label style={{ fontSize: "9px", color: "#484849", display: "block", marginBottom: "4px", fontFamily: "Space Grotesk", letterSpacing: "0.1em" }}>EQUITY</label>
            <input type="number" value={demoEquity} onChange={(e) => setDemoEquity(Number(e.target.value))}
              style={{ padding: "6px 10px", borderRadius: "6px", backgroundColor: "#0e0e0f", border: "1px solid rgba(72,72,73,0.3)", color: "#fff", fontSize: "12px", fontFamily: "JetBrains Mono, monospace", width: "140px" }} />
          </div>
          <button onClick={() => computeMut.mutate()} disabled={computeMut.isPending}
            style={{
              padding: "8px 20px", borderRadius: "6px",
              backgroundColor: "rgba(156,255,147,0.1)", border: "1px solid rgba(156,255,147,0.3)",
              color: "#9cff93", fontSize: "11px", fontFamily: "Space Grotesk",
              fontWeight: 700, letterSpacing: "0.12em", cursor: computeMut.isPending ? "wait" : "pointer",
            }}>
            {computeMut.isPending ? "COMPUTING..." : "COMPUTE"}
          </button>
        </div>
        <textarea value={demoJson} onChange={(e) => setDemoJson(e.target.value)}
          rows={6} style={{
            width: "100%", padding: "10px", borderRadius: "6px", backgroundColor: "#0e0e0f",
            border: "1px solid rgba(72,72,73,0.2)", color: "#adaaab", fontSize: "10px",
            fontFamily: "JetBrains Mono, monospace", resize: "vertical",
          }} />
        {computeMut.isError && <p style={{ color: "#ff7162", fontSize: "11px", marginTop: "8px" }}>{(computeMut.error as Error).message}</p>}
      </div>

      {isLoading && !pf && <p style={{ color: "#767576", fontSize: "12px" }}>Loading portfolio...</p>}

      {pf && (
        <div>
          {/* KPI row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
            <div style={{ padding: "16px", borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.15)", textAlign: "center" }}>
              <div style={{ fontSize: "9px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.15em", marginBottom: "6px" }}>TOTAL WEIGHT</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#56b4e9", fontFamily: "JetBrains Mono, monospace" }}>{(pf.total_weight * 100).toFixed(1)}%</div>
            </div>
            <div style={{ padding: "16px", borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.15)", textAlign: "center" }}>
              <div style={{ fontSize: "9px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.15em", marginBottom: "6px" }}>CASH</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: pf.cash_weight >= pf.constraints.cash_min ? "#9cff93" : "#ff7162", fontFamily: "JetBrains Mono, monospace" }}>{(pf.cash_weight * 100).toFixed(1)}%</div>
            </div>
            <div style={{ padding: "16px", borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.15)", textAlign: "center" }}>
              <div style={{ fontSize: "9px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.15em", marginBottom: "6px" }}>POSITIONS</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#cc79a7", fontFamily: "JetBrains Mono, monospace" }}>{pf.positions.length}</div>
            </div>
            <div style={{ padding: "16px", borderRadius: "8px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.15)", textAlign: "center" }}>
              <div style={{ fontSize: "9px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.15em", marginBottom: "6px" }}>VOL TARGET</div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#f0e442", fontFamily: "JetBrains Mono, monospace" }}>{(pf.constraints.vol_target * 100).toFixed(0)}%</div>
            </div>
          </div>

          {/* Sector exposure bar */}
          <SectorBar sectors={pf.sector_exposure} total={pf.total_weight} />

          {/* Positions table */}
          <h3 style={{ fontFamily: "Space Grotesk", fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em", color: "#adaaab", marginBottom: "12px" }}>
            POSITION ALLOCATION
          </h3>
          <div style={{ borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(72,72,73,0.15)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ backgroundColor: "#1a191b" }}>
                  {["Symbol", "Sector", "Conv.", "Vol", "Raw W", "Final W", "Target $", "Δ Qty", "Cap"].map((h) => (
                    <th key={h} style={{ padding: "10px 10px", textAlign: "left", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.1em", fontSize: "9px" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pf.positions.map((p) => (
                  <tr key={p.symbol} style={{ borderTop: "1px solid rgba(72,72,73,0.1)" }}>
                    <td style={{ padding: "8px 10px", color: "#adaaab", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>{p.symbol}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ padding: "2px 6px", borderRadius: "3px", fontSize: "9px", backgroundColor: `${SECTOR_COLORS[p.sector] ?? SECTOR_COLORS.default}15`, color: SECTOR_COLORS[p.sector] ?? SECTOR_COLORS.default }}>{p.sector}</span>
                    </td>
                    <td style={{ padding: "8px 10px", color: p.conviction >= 0.7 ? "#9cff93" : "#f0e442", fontFamily: "JetBrains Mono, monospace" }}>{(p.conviction * 100).toFixed(0)}%</td>
                    <td style={{ padding: "8px 10px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>{(p.realized_vol * 100).toFixed(1)}%</td>
                    <td style={{ padding: "8px 10px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>{(p.raw_weight * 100).toFixed(1)}%</td>
                    <td style={{ padding: "8px 10px", color: "#56b4e9", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>{(p.final_weight * 100).toFixed(1)}%</td>
                    <td style={{ padding: "8px 10px", color: "#adaaab", fontFamily: "JetBrains Mono, monospace" }}>${p.target_notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td style={{ padding: "8px 10px", color: p.delta_qty > 0 ? "#9cff93" : p.delta_qty < 0 ? "#ff7162" : "#767576", fontFamily: "JetBrains Mono, monospace" }}>
                      {p.delta_qty > 0 ? "+" : ""}{p.delta_qty.toFixed(4)}
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: "9px", color: p.capped_by ? "#f0e442" : "#484849" }}>{p.capped_by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Constraints summary */}
          <div style={{ marginTop: "24px" }}>
            <h3 style={{ fontFamily: "Space Grotesk", fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em", color: "#adaaab", marginBottom: "10px" }}>
              ACTIVE CONSTRAINTS
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" }}>
              {[
                { label: "VOL TARGET", value: `${(pf.constraints.vol_target * 100).toFixed(0)}%` },
                { label: "SINGLE CAP", value: `${(pf.constraints.single_cap * 100).toFixed(0)}%` },
                { label: "SECTOR CAP", value: `${(pf.constraints.sector_cap * 100).toFixed(0)}%` },
                { label: "TOTAL CAP", value: `${(pf.constraints.total_cap * 100).toFixed(0)}%` },
                { label: "CASH MIN", value: `${(pf.constraints.cash_min * 100).toFixed(0)}%` },
              ].map((c) => (
                <div key={c.label} style={{ padding: "10px", borderRadius: "6px", backgroundColor: "#1a191b", border: "1px solid rgba(72,72,73,0.1)", textAlign: "center" }}>
                  <div style={{ fontSize: "8px", color: "#484849", fontFamily: "Space Grotesk", letterSpacing: "0.12em", marginBottom: "4px" }}>{c.label}</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>{c.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: "16px", fontSize: "10px", color: "#484849" }}>
            Computed {new Date(pf.computed_at).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
