import { useMemo, useState } from "react";

type StitchTemplate = {
  id: string;
  title: string;
  category: "Mission Control" | "Candle X-Ray" | "Live Intelligence" | "Risk" | "Performance" | "Setup Explorer" | "Reports";
  notes: string;
};

const TEMPLATES: StitchTemplate[] = [
  {
    id: "godsview_sovereign_intelligence_terminal",
    title: "Sovereign Intelligence Terminal",
    category: "Mission Control",
    notes: "Premium hero composition with command-center density.",
  },
  {
    id: "godsview_massive_brain_console_master",
    title: "Massive Brain Console",
    category: "Mission Control",
    notes: "Brain-centric orchestration layout for attention routing.",
  },
  {
    id: "godsview_brain_master_dashboard",
    title: "Brain Master Dashboard",
    category: "Mission Control",
    notes: "Balanced left/right sidecar with center neural graph.",
  },
  {
    id: "live_intelligence_master_desktop_thinking_chart",
    title: "Thinking Chart Desktop",
    category: "Live Intelligence",
    notes: "Execution-aware chart framing for live overlays.",
  },
  {
    id: "live_signal_intelligence_master_overlay_v1",
    title: "Signal Intelligence Overlay",
    category: "Live Intelligence",
    notes: "Compact signal panel pattern for chart overlays.",
  },
  {
    id: "candle_x_ray_master_desktop_v2_production_ready",
    title: "Candle X-Ray Desktop v2",
    category: "Candle X-Ray",
    notes: "Deep microstructure paneling and modal treatment.",
  },
  {
    id: "brain_focus_mode_candle_x_ray_v1",
    title: "Brain Focus Mode X-Ray v1",
    category: "Candle X-Ray",
    notes: "Drawer-first workflow for clicked-candle inspection.",
  },
  {
    id: "setup_explorer_master_desktop_matrix",
    title: "Setup Explorer Matrix",
    category: "Setup Explorer",
    notes: "Matrix view for setup family diagnostics and ranking.",
  },
  {
    id: "risk_command_center_master_desktop_tactical_control",
    title: "Risk Tactical Control",
    category: "Risk",
    notes: "Operational risk cockpit for hard-gate governance.",
  },
  {
    id: "performance_analytics_master_desktop_dashboard",
    title: "Performance Analytics Desktop",
    category: "Performance",
    notes: "Portfolio/session analytics and setup cohort readouts.",
  },
  {
    id: "session_report_view_master",
    title: "Session Report View",
    category: "Reports",
    notes: "Session end report composition and evidence framing.",
  },
  {
    id: "mission_control",
    title: "Mission Control",
    category: "Mission Control",
    notes: "Early command-shell baseline from Stitch export.",
  },
];

function buildHtmlPath(id: string): string {
  return `/stitch-mission-control/${id}/code.html`;
}

function buildImagePath(id: string): string {
  return `/stitch-mission-control/${id}/screen.png`;
}

export default function StitchLabPage() {
  const [activeId, setActiveId] = useState<string>(TEMPLATES[0]?.id ?? "");
  const active = useMemo(
    () => TEMPLATES.find((item) => item.id === activeId) ?? TEMPLATES[0],
    [activeId],
  );
  const categories = useMemo(() => {
    const c = new Set(TEMPLATES.map((item) => item.category));
    return Array.from(c);
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded border p-4" style={{ borderColor: "rgba(72,72,73,0.28)", backgroundColor: "#1a191b" }}>
        <div style={{ fontSize: "9px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase" }}>
          GodsView · Design Vault
        </div>
        <h1 className="text-2xl font-bold tracking-tight mt-1">Stitch Mission Control Pack</h1>
        <p className="mt-2" style={{ fontSize: "11px", color: "#adaaab", fontFamily: "Space Grotesk" }}>
          Curated imported references from <code>stitch_mission_control.zip</code>. Use this vault to pick patterns for Mission Control, Candle X-Ray, Risk, and performance surfaces.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((category) => (
            <span
              key={category}
              className="rounded-full px-2 py-1"
              style={{ fontSize: "8px", fontFamily: "Space Grotesk", letterSpacing: "0.08em", border: "1px solid rgba(102,157,255,0.25)", backgroundColor: "rgba(102,157,255,0.08)", color: "#669dff" }}
            >
              {category}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-4 space-y-3">
          {TEMPLATES.map((item) => {
            const activeCard = item.id === active?.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                className="w-full text-left rounded border p-3 transition-all"
                style={{
                  borderColor: activeCard ? "rgba(156,255,147,0.45)" : "rgba(72,72,73,0.25)",
                  backgroundColor: activeCard ? "rgba(156,255,147,0.08)" : "#1a191b",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div style={{ fontSize: "10px", color: "#9cff93", fontFamily: "Space Grotesk", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {item.category}
                    </div>
                    <div className="mt-1" style={{ fontSize: "14px", color: "#fff", fontFamily: "Space Grotesk", fontWeight: 700 }}>
                      {item.title}
                    </div>
                  </div>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "14px", color: activeCard ? "#9cff93" : "#767576" }}
                  >
                    {activeCard ? "radio_button_checked" : "radio_button_unchecked"}
                  </span>
                </div>
                <p className="mt-2" style={{ fontSize: "10px", color: "#adaaab" }}>
                  {item.notes}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <a
                    href={buildImagePath(item.id)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "10px", color: "#669dff" }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    Screenshot
                  </a>
                  <a
                    href={buildHtmlPath(item.id)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "10px", color: "#669dff" }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    HTML
                  </a>
                </div>
              </button>
            );
          })}
        </div>

        <div className="xl:col-span-8 space-y-3">
          <div className="rounded border p-3" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#1a191b" }}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div style={{ fontSize: "9px", color: "#767576", fontFamily: "Space Grotesk", letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  Active Template
                </div>
                <div style={{ fontSize: "15px", color: "#fff", fontFamily: "Space Grotesk", fontWeight: 700 }}>
                  {active?.title}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={buildImagePath(active.id)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: "10px", color: "#9cff93", fontFamily: "JetBrains Mono, monospace" }}
                >
                  Open PNG
                </a>
                <a
                  href={buildHtmlPath(active.id)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: "10px", color: "#669dff", fontFamily: "JetBrains Mono, monospace" }}
                >
                  Open HTML
                </a>
              </div>
            </div>
          </div>

          <div className="rounded border overflow-hidden" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#111214" }}>
            <img
              src={buildImagePath(active.id)}
              alt={`${active.title} screenshot`}
              className="w-full h-auto block"
            />
          </div>

          <div className="rounded border overflow-hidden" style={{ borderColor: "rgba(72,72,73,0.25)", backgroundColor: "#0e0e0f" }}>
            <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "rgba(72,72,73,0.25)" }}>
              <span style={{ fontSize: "10px", color: "#adaaab", fontFamily: "Space Grotesk", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Live HTML Preview
              </span>
              <span style={{ fontSize: "10px", color: "#767576", fontFamily: "JetBrains Mono, monospace" }}>
                {active.id}
              </span>
            </div>
            <iframe
              title={`stitch-preview-${active.id}`}
              src={buildHtmlPath(active.id)}
              style={{ width: "100%", height: "780px", border: "0", backgroundColor: "#0e0e0f" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
