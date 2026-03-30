/**
 * GodsView Design Tokens
 * Unified color, typography, and spacing system across all pages.
 * Based on the Obsidian Terminal design spec from the Stitch vault.
 */

// ─── Surface Hierarchy (Tonal Layering) ──────────────────────────────────────
export const surface = {
  base: "#0e0e0f",
  dim: "#131314",
  container: "#1a191b",
  containerLow: "#161617",
  containerHigh: "#201f21",
  containerHighest: "#2a2a2b",
  bright: "#353436",
} as const;

// ─── Functional Colors ───────────────────────────────────────────────────────
export const colors = {
  primary: "#9cff93",        // System Online / Success / Bullish
  primaryDim: "#4dcc44",
  secondary: "#669dff",      // Execution / Buy-side / Focus
  secondaryDim: "#4d7acc",
  tertiary: "#00dfc1",       // Teal accent / AI / Intelligence
  tertiaryDim: "#00b39a",
  warning: "#ffd166",        // Caution / Forming / Approaching limits
  error: "#ff7162",          // Critical / Bearish / Stop-loss
  errorBright: "#ff4444",    // Kill switch / Emergency
  onSurface: "#e6e1e5",     // Primary text
  onSurfaceVariant: "#b4b0b8", // Secondary text
  muted: "#8c909f",          // Labels / metadata
  faint: "#666666",          // Tertiary text / timestamps
  outline: "#484849",        // Ghost borders
  outlineVariant: "rgba(72,72,73,0.15)", // Subtle separators
} as const;
// ─── Typography ──────────────────────────────────────────────────────────────
export const fonts = {
  display: "'Space Grotesk', sans-serif",
  mono: "'JetBrains Mono', monospace",
  body: "Inter, sans-serif",
} as const;

export const fontSize = {
  displayLg: 48,
  displayMd: 32,
  displaySm: 22,
  headlineMd: 20,
  headlineSm: 18,
  titleLg: 16,
  titleMd: 14,
  bodyLg: 14,
  bodyMd: 13,
  bodySm: 12,
  labelLg: 12,
  labelMd: 11,
  labelSm: 10,
  labelXs: 9,
  labelXxs: 8,
} as const;

// ─── Spacing ─────────────────────────────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;
// ─── Border Radius ───────────────────────────────────────────────────────────
export const radius = {
  sm: 2,
  default: 4,
  md: 6,
  lg: 8,
  full: 9999,
} as const;

// ─── Status Colors ───────────────────────────────────────────────────────────
export const statusColors = {
  optimal: colors.primary,
  scanning: colors.secondary,
  processing: colors.secondary,
  forming: colors.warning,
  degraded: colors.error,
  offline: colors.faint,
} as const;

export const decisionColors = {
  TRADE: colors.primary,
  PASS: colors.muted,
  REJECTED: colors.error,
  BLOCKED_BY_RISK: colors.warning,
  DEGRADED_DATA: colors.faint,
} as const;

export const gateColors = {
  ALLOW: colors.primary,
  WATCH: colors.warning,
  REDUCE: "#ff9a5c",
  BLOCK: colors.errorBright,
} as const;
export const directionColors = {
  LONG: colors.primary,
  SHORT: colors.error,
} as const;

export const sentimentColors = {
  bullish: colors.primary,
  bearish: colors.error,
  neutral: colors.muted,
} as const;

export const regimeColors = {
  BALANCED: colors.secondary,
  VOLATILE: colors.warning,
  TRENDING: colors.primary,
  EXTREME: colors.error,
  REVERSAL: colors.tertiary,
} as const;

export const sessionColors = {
  "NY Morning": colors.secondary,
  "London Open": colors.warning,
  Asian: colors.tertiary,
  Overnight: colors.muted,
  "NY Close": "#b4a0ff",
} as const;

// ─── Shared Styles ───────────────────────────────────────────────────────────
export const panelStyle: React.CSSProperties = {
  background: surface.container,
  border: `1px solid ${colors.outlineVariant}`,
  borderRadius: radius.md,
  padding: `${spacing.lg}px ${spacing.xl}px`,
};
export const headerLabelStyle: React.CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: fontSize.labelMd,
  color: colors.muted,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export const pageBackground: React.CSSProperties = {
  minHeight: "100vh",
  background: surface.dim,
  color: colors.onSurface,
};

// ─── Utility Functions ───────────────────────────────────────────────────────
export function formatPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return p.toFixed(2);
}

export function formatPnl(v: number): string {
  return (v >= 0 ? "+" : "") + "$" + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatVol(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v.toString();
}

export function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}