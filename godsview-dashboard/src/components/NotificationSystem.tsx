import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { wsManager } from "@/lib/ws";
import { surface, colors, fonts, fontSize, radius } from "@/lib/design-tokens";

type ToastType = "SIGNAL" | "TRADE" | "RISK_WARNING" | "RISK_BLOCK" | "KILL_SWITCH" | "SYSTEM_ERROR";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  timestamp: Date;
  isExiting: boolean;
}

interface NotifyOptions {
  type: ToastType;
  title: string;
  message: string;
}

const NotifyContext = createContext<((options: NotifyOptions) => void) | null>(null);

const toastConfig: Record<ToastType, { border: string; icon: string; accentColor: string }> = {
  SIGNAL:       { border: colors.primary,     icon: "sensors",     accentColor: colors.primary },
  TRADE:        { border: colors.primary,     icon: "check_circle", accentColor: colors.primary },
  RISK_WARNING: { border: colors.warning,     icon: "warning",     accentColor: colors.warning },
  RISK_BLOCK:   { border: colors.error,       icon: "block",       accentColor: colors.error },  KILL_SWITCH:  { border: colors.errorBright, icon: "flash_on",    accentColor: colors.errorBright },
  SYSTEM_ERROR: { border: colors.error,       icon: "error",       accentColor: colors.error },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: string) => void }) {
  const cfg = toastConfig[toast.type];
  const timeStr = toast.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const isPulsing = toast.type === "KILL_SWITCH";

  return (
    <div style={{
      position: "relative", display: "flex", gap: "12px", padding: "12px 16px",
      background: surface.container, border: `1px solid ${cfg.border}`,
      borderRadius: `${radius.md}px`, backdropFilter: "blur(8px)",
      animation: toast.isExiting ? "gv-fadeOut 0.4s ease-out" : "gv-slideIn 0.3s cubic-bezier(0.34,1.56,0.64,1)",
      overflow: "hidden", minWidth: "300px",
    }}>
      {/* Accent bar */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: "4px",
        backgroundColor: cfg.accentColor,
        animation: isPulsing ? "gv-pulse 1.5s ease-in-out infinite" : "none",
      }} />
      {/* Icon */}
      <span className="material-symbols-outlined" style={{ fontSize: "18px", color: cfg.accentColor, marginTop: "2px" }}>{cfg.icon}</span>
      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>        <div style={{ fontFamily: fonts.display, fontSize: `${fontSize.labelMd}px`, fontWeight: 600, color: colors.onSurface }}>{toast.title}</div>
        <div style={{ fontSize: `${fontSize.labelSm}px`, color: colors.onSurfaceVariant, lineHeight: 1.4 }}>{toast.message}</div>
        <div style={{ fontFamily: fonts.mono, fontSize: `${fontSize.labelXxs}px`, color: colors.muted }}>{timeStr}</div>
      </div>
      {/* Close */}
      <button onClick={() => onClose(toast.id)} style={{
        position: "absolute", top: "8px", right: "8px", background: "none", border: "none",
        color: colors.muted, cursor: "pointer", padding: "2px 6px", fontSize: "14px",
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
      </button>
    </div>
  );
}

export const NotificationSystem: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const addToast = useCallback((options: NotifyOptions) => {
    const id = `${Date.now()}-${Math.random()}`;
    const newToast: Toast = { id, ...options, timestamp: new Date(), isExiting: false };
    setToasts((prev) => [...prev, newToast].slice(-5));
    timeoutRefs.current[id] = setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t)));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        delete timeoutRefs.current[id];
      }, 400);
    }, 5000);
  }, []);
  const handleClose = useCallback((id: string) => {
    if (timeoutRefs.current[id]) clearTimeout(timeoutRefs.current[id]);
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 400);
  }, []);

  // WS listener
  useEffect(() => {
    const off = wsManager.on("*", (msg) => {
      const { type, payload } = msg;
      if (type === "decision" && payload?.decision === "TRADE") {
        addToast({ type: "TRADE", title: "TRADE EXECUTED", message: `${payload.symbol} ${payload.direction} — Score ${payload.compositeScore ?? "N/A"}` });
      }
      if (type === "signal") {
        addToast({ type: "SIGNAL", title: "New Signal", message: `${payload.symbol} ${payload.direction} — Score ${payload.compositeScore ?? "N/A"}` });
      }
      if (type === "risk_event" && payload?.gate) {
        const isBlock = payload.gate === "BLOCK";
        addToast({ type: isBlock ? "RISK_BLOCK" : "RISK_WARNING", title: isBlock ? "RISK BLOCKED" : "Risk Gate Changed", message: `Gate → ${payload.gate}` });
      }
      if (type === "risk_event" && payload?.killSwitch) {
        addToast({ type: "KILL_SWITCH", title: "KILL SWITCH ACTIVATED", message: payload.reason || "Emergency stop triggered" });
      }
      if (type === "error") {
        addToast({ type: "SYSTEM_ERROR", title: "System Error", message: payload?.message || "Unexpected error" });
      }
    });
    return () => { off(); Object.values(timeoutRefs.current).forEach(clearTimeout); };
  }, [addToast]);
  return (
    <NotifyContext.Provider value={addToast}>
      <style>{`
        @keyframes gv-slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes gv-fadeOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }
        @keyframes gv-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
      <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999, display: "flex", flexDirection: "column", gap: "12px", maxWidth: "400px" }}>
        {toasts.map((t) => <ToastItem key={t.id} toast={t} onClose={handleClose} />)}
      </div>
    </NotifyContext.Provider>
  );
};

export const useNotify = () => {
  const notify = useContext(NotifyContext);
  if (!notify) throw new Error("useNotify must be used within NotificationSystem");
  return notify;
};
