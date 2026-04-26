/**
 * Global mode badge — shown in the top-right of every page.
 *
 * Reads /api/system/status every 5s and renders a fixed-position pill that
 * tells the operator (or VC) which mode the system is running in:
 *   - PAPER — no real broker
 *   - ASSISTED — manual approval gate
 *   - AUTO — autonomous (should never appear on the demo!)
 *   - OFFLINE — backend unreachable
 *
 * The pill colour and label update reactively. There is no fallback to "PAPER"
 * if the backend is offline; we explicitly show OFFLINE so the operator knows
 * the system can't be trusted.
 */

import React, { useEffect, useState } from "react";

type Mode = "paper" | "assisted" | "auto" | "offline" | "unknown";

const COLORS: Record<Mode, { bg: string; fg: string; ring: string; label: string }> = {
  paper:    { bg: "rgba(0,180,255,0.18)", fg: "#7ad6ff", ring: "#1f9be0", label: "PAPER MODE" },
  assisted: { bg: "rgba(255,180,0,0.18)", fg: "#ffd47a", ring: "#e09b1f", label: "ASSISTED MODE" },
  auto:     { bg: "rgba(0,255,120,0.18)", fg: "#7afdb1", ring: "#1fe07b", label: "AUTONOMOUS" },
  offline:  { bg: "rgba(255,68,68,0.22)", fg: "#ff8a8a", ring: "#ff4444", label: "OFFLINE" },
  unknown:  { bg: "rgba(120,120,120,0.18)", fg: "#bbb",  ring: "#777",    label: "UNKNOWN" },
};

export const ModeBadge: React.FC<{ apiBase?: string }> = ({ apiBase = "" }) => {
  const [mode, setMode] = useState<Mode>("unknown");
  const [lastOk, setLastOk] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`${apiBase}/api/system/status`, { method: "GET" });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (cancelled) return;
        const m: Mode = (() => {
          const raw = (j?.mode || "").toLowerCase();
          if (raw === "paper" || raw === "assisted" || raw === "auto") return raw;
          return "unknown";
        })();
        setMode(m);
        setLastOk(Date.now());
      } catch {
        if (cancelled) return;
        setMode("offline");
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiBase]);

  const c = COLORS[mode];
  return (
    <div
      title={lastOk ? `Last status: ${new Date(lastOk).toLocaleTimeString()}` : "No status yet"}
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 10000,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.ring}`,
        borderRadius: 999,
        padding: "4px 12px",
        fontFamily: "monospace",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1,
        userSelect: "none",
        boxShadow: `0 0 12px ${c.ring}33`,
        pointerEvents: "auto",
      }}
    >
      ● {c.label}
    </div>
  );
};

export default ModeBadge;
