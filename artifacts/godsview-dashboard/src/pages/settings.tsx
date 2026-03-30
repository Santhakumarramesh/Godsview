import { useState, useEffect } from "react";
import { useRiskConfig, useUpdateRiskConfig, useSystemStatus, useAlpacaAccount } from "@/lib/api";
import { useWSConnection } from "@/lib/ws";
import {
  surface, colors, fonts, fontSize, spacing, radius,
  panelStyle, headerLabelStyle, pageBackground
} from "@/lib/design-tokens";

interface RiskFormState {
  max_daily_loss: number;
  max_exposure_pct: number;
  max_concurrent_positions: number;
  max_trades_per_session: number;
  cooldown_minutes: number;
  news_lockout: boolean;
  degraded_data_block: boolean;
}

interface SessionFilter {
  id: string;
  label: string;
  timeRange: string;
  enabled: boolean;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: `${radius.default}px`,  backgroundColor: surface.containerHigh, border: `1px solid ${colors.outlineVariant}`,
  color: colors.onSurface, fontFamily: fonts.mono, fontSize: `${fontSize.bodySm}px`,
  outline: "none", boxSizing: "border-box" as const,
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export default function SettingsPage() {
  const { data: riskConfig } = useRiskConfig();
  const { mutate: updateRiskConfig, isPending: isSaving } = useUpdateRiskConfig();
  const { data: systemStatus } = useSystemStatus();
  const { isError: alpacaError, isLoading: alpacaLoading } = useAlpacaAccount();
  const wsConnected = useWSConnection();

  const [riskForm, setRiskForm] = useState<RiskFormState>({
    max_daily_loss: -250, max_exposure_pct: 80, max_concurrent_positions: 3,
    max_trades_per_session: 8, cooldown_minutes: 15, news_lockout: false, degraded_data_block: false,
  });
  const [sessions, setSessions] = useState<SessionFilter[]>([
    { id: "ny-morning", label: "NY Morning", timeRange: "09:30 – 12:00", enabled: true },
    { id: "ny-afternoon", label: "NY Afternoon", timeRange: "12:00 – 16:00", enabled: true },
    { id: "london-open", label: "London Open", timeRange: "03:00 – 08:00", enabled: false },
    { id: "asian", label: "Asian", timeRange: "20:00 – 03:00", enabled: false },
    { id: "overnight", label: "Overnight", timeRange: "all other hours", enabled: true },
  ]);
  useEffect(() => {
    if (riskConfig) {
      setRiskForm({
        max_daily_loss: riskConfig.max_daily_loss ?? -250,
        max_exposure_pct: riskConfig.max_exposure_pct ?? 80,
        max_concurrent_positions: riskConfig.max_concurrent_positions ?? 3,
        max_trades_per_session: riskConfig.max_trades_per_session ?? 8,
        cooldown_minutes: riskConfig.cooldown_minutes ?? 15,
        news_lockout: riskConfig.news_lockout ?? false,
        degraded_data_block: riskConfig.degraded_data_block ?? false,
      });
    }
  }, [riskConfig]);

  const setField = (f: keyof RiskFormState, v: any) => setRiskForm((p) => ({ ...p, [f]: v }));
  const handleSave = () => updateRiskConfig({ ...riskForm, session_allowlist: sessions.filter((s) => s.enabled).map((s) => s.label) });
  const handleReset = () => setRiskForm({ max_daily_loss: -250, max_exposure_pct: 80, max_concurrent_positions: 3, max_trades_per_session: 8, cooldown_minutes: 15, news_lockout: false, degraded_data_block: false });
  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ riskParameters: riskForm, sessions: sessions.filter((s) => s.enabled).map((s) => s.label), exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `godsview-config-${new Date().toISOString().split("T")[0]}.json`; a.click();
  };
  const apiUrl = import.meta.env.VITE_API_URL || "/api";

  // Status dot helper
  const Dot = ({ on }: { on: boolean }) => (
    <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: on ? colors.primary : colors.error, boxShadow: `0 0 8px ${on ? colors.primary : colors.error}` }} />
  );
  const StatusRow = ({ label, on }: { label: string; on: boolean }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
      <span style={{ fontSize: fontSize.bodyMd, fontFamily: fonts.body, color: colors.onSurfaceVariant }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Dot on={on} />
        <span style={{ fontSize: fontSize.bodySm, fontFamily: fonts.mono, color: on ? colors.primary : colors.error, fontWeight: 600 }}>{on ? "CONNECTED" : "DISCONNECTED"}</span>
      </div>
    </div>
  );
  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
      <span style={{ fontSize: fontSize.bodyMd, fontFamily: fonts.body, color: colors.onSurfaceVariant }}>{label}</span>
      <span style={{ fontSize: fontSize.bodySm, fontFamily: fonts.mono, color: colors.onSurface }}>{value}</span>
    </div>
  );
  const NumberInput = ({ label, field, step }: { label: string; field: keyof RiskFormState; step?: number }) => (
    <div>
      <label style={{ ...headerLabelStyle, display: "block", marginBottom: spacing.sm }}>{label}</label>
      <input type="number" value={riskForm[field] as number} step={step} onChange={(e) => setField(field, parseFloat(e.target.value))} style={inputStyle} />
    </div>
  );
  const Toggle = ({ label, field }: { label: string; field: keyof RiskFormState }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `${spacing.md}px ${spacing.lg}px`, backgroundColor: surface.containerLow, borderRadius: radius.default }}>
      <span style={{ fontSize: fontSize.bodyMd, fontFamily: fonts.body, color: colors.onSurface }}>{label}</span>
      <button onClick={() => setField(field, !riskForm[field])} style={{ width: 44, height: 24, borderRadius: radius.full, border: "none", backgroundColor: riskForm[field] ? colors.primary : surface.container, cursor: "pointer", transition: "all 0.2s", boxShadow: `inset 0 0 0 1px ${colors.outline}` }}>
        <div style={{ width: 20, height: 20, borderRadius: "50%", backgroundColor: riskForm[field] ? surface.container : colors.outline, marginLeft: riskForm[field] ? 22 : 2, transition: "margin-left 0.2s" }} />
      </button>
    </div>
  );  const btnStyle = (primary: boolean, disabled = false): React.CSSProperties => ({
    flex: 1, padding: `${spacing.md}px ${spacing.lg}px`, fontSize: fontSize.labelMd, fontFamily: fonts.display,
    fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: radius.default,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, transition: "all 0.2s",
    backgroundColor: primary ? (disabled ? colors.muted : colors.primary) : surface.container,
    color: primary ? surface.base : colors.onSurface,
    border: `1px solid ${primary ? colors.primary : colors.outline}`,
  });

  return (
    <div style={{ ...pageBackground, padding: spacing.xxxl }}>
      {/* Header */}
      <div style={{ marginBottom: spacing.xxxl }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: colors.primary }}>settings</span>
          <span style={{ fontSize: fontSize.labelSm, fontFamily: fonts.display, fontWeight: 700, letterSpacing: "0.15em", color: colors.primary, textTransform: "uppercase" }}>system configuration</span>
        </div>
        <h1 style={{ fontSize: fontSize.displaySm, fontFamily: fonts.display, fontWeight: 700, color: colors.onSurface, margin: 0 }}>SETTINGS</h1>
      </div>

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing.xl, marginBottom: spacing.xl }}>
        {/* CONNECTION STATUS */}
        <div style={{ ...panelStyle }}>
          <div style={{ ...headerLabelStyle, marginBottom: spacing.xl }}>CONNECTION STATUS</div>
          <StatusRow label="WebSocket" on={wsConnected} />
          <StatusRow label="Alpaca Account" on={!alpacaError && !alpacaLoading} />
          <InfoRow label="API Server" value={apiUrl} />
          <InfoRow label="System Uptime" value={systemStatus?.uptime_seconds ? formatUptime(systemStatus.uptime_seconds) : "N/A"} />
          <InfoRow label="Last Sync" value={systemStatus?.last_sync_timestamp ? new Date(systemStatus.last_sync_timestamp).toLocaleTimeString() : "N/A"} />
        </div>
        {/* RISK PARAMETERS */}
        <div style={{ ...panelStyle }}>
          <div style={{ ...headerLabelStyle, marginBottom: spacing.xl }}>RISK PARAMETERS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}>
            <NumberInput label="Max Daily Loss ($)" field="max_daily_loss" step={10} />
            <NumberInput label="Max Exposure (%)" field="max_exposure_pct" step={5} />
            <NumberInput label="Max Concurrent Positions" field="max_concurrent_positions" step={1} />
            <NumberInput label="Max Trades Per Session" field="max_trades_per_session" step={1} />
            <NumberInput label="Cooldown Minutes" field="cooldown_minutes" step={1} />
            <Toggle label="News Lockout" field="news_lockout" />
            <Toggle label="Degraded Data Block" field="degraded_data_block" />
            <div style={{ display: "flex", gap: spacing.md, marginTop: spacing.lg }}>
              <button onClick={handleSave} disabled={isSaving} style={btnStyle(true, isSaving)}>{isSaving ? "SAVING..." : "SAVE RISK CONFIG"}</button>
              <button onClick={handleReset} style={btnStyle(false)}>RESET TO DEFAULTS</button>
            </div>
          </div>
        </div>
      </div>

      {/* Second Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing.xl }}>
        {/* SESSION FILTERS */}
        <div style={{ ...panelStyle }}>
          <div style={{ ...headerLabelStyle, marginBottom: spacing.xl }}>SESSION FILTERS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
            {sessions.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: spacing.md, padding: `${spacing.md}px ${spacing.lg}px`, backgroundColor: surface.containerLow, borderRadius: radius.default }}>
                <input type="checkbox" checked={s.enabled} onChange={() => setSessions((p) => p.map((x) => x.id === s.id ? { ...x, enabled: !x.enabled } : x))} style={{ width: 18, height: 18, cursor: "pointer", accentColor: colors.primary }} />
                <div style={{ flex: 1 }}>                  <div style={{ fontSize: fontSize.bodyMd, fontFamily: fonts.body, color: colors.onSurface, marginBottom: spacing.xs }}>{s.label}</div>
                  <div style={{ fontSize: fontSize.bodySm, fontFamily: fonts.mono, color: colors.muted }}>{s.timeRange}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SYSTEM INFO */}
        <div style={{ ...panelStyle }}>
          <div style={{ ...headerLabelStyle, marginBottom: spacing.xl }}>SYSTEM INFO</div>
          <InfoRow label="GodsView Version" value="1.0.0-alpha" />
          <InfoRow label="Pipeline Layers" value="6" />
          <InfoRow label="Active Models" value="sentiment, technical, regime" />
          <InfoRow label="Database Status" value="connected" />
          <InfoRow label="Environment" value={import.meta.env.MODE === "production" ? "production" : "development"} />
          <InfoRow label="Git Commit" value="a1b2c3d (placeholder)" />
          <div style={{ display: "flex", gap: spacing.md, marginTop: spacing.xl }}>
            <button onClick={() => { localStorage.clear(); sessionStorage.clear(); }} style={btnStyle(false)}>CLEAR CACHE</button>
            <button onClick={handleExport} style={btnStyle(false)}>EXPORT CONFIG</button>
          </div>
        </div>
      </div>
    </div>
  );
}
