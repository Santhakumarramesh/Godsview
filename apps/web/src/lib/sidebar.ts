/**
 * Phase 0 v2 sidebar map.
 *
 * 6 sections × ~10 items = 64 routes. The 6 functional pages (login,
 * overview, market/symbols, ops/health, ops/flags, admin/system) are
 * marked ``stub: false``. Everything else is a Phase 0 placeholder
 * rendered with <ToDoBanner> until later phases populate it.
 */

export type SidebarItem = {
  label: string;
  href: string;
  stub?: boolean;
  /** Roles allowed to see this entry. Empty = all authenticated users. */
  roles?: ReadonlyArray<"viewer" | "analyst" | "operator" | "admin">;
};

export type SidebarSection = {
  label: string;
  items: ReadonlyArray<SidebarItem>;
};

export const SIDEBAR: ReadonlyArray<SidebarSection> = [
  {
    label: "Command",
    items: [
      { label: "Overview", href: "/overview" },
      { label: "Replay", href: "/replay", stub: true },
    ],
  },
  {
    label: "Market",
    items: [
      { label: "Symbols", href: "/market/symbols" },
      { label: "Watchlist", href: "/market/watchlist", stub: true },
      { label: "Levels", href: "/market/levels", stub: true },
      { label: "Regimes", href: "/market/regimes", stub: true },
      { label: "Sessions", href: "/market/sessions", stub: true },
      { label: "Liquidity", href: "/market/liquidity", stub: true },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Fusion", href: "/intel/fusion", stub: true },
      { label: "Structure", href: "/intel/structure", stub: true },
      { label: "Order flow", href: "/intel/flow", stub: true },
      { label: "Setups", href: "/intel/setups", stub: true },
      { label: "Recall", href: "/intel/recall", stub: true },
      { label: "Agents", href: "/intel/agents", stub: true },
      { label: "Calibration", href: "/intel/calibration", stub: true },
    ],
  },
  {
    label: "Strategies",
    items: [
      { label: "Catalog", href: "/strategies", stub: true },
      { label: "Builder", href: "/strategies/builder", stub: true },
      { label: "Active", href: "/strategies/active", stub: true },
      { label: "Promotions", href: "/strategies/promotions", stub: true },
      { label: "Autonomy", href: "/strategies/autonomy" },
      { label: "DNA", href: "/strategies/dna", stub: true },
    ],
  },
  {
    label: "Quant lab",
    items: [
      { label: "Backtests", href: "/quant/backtests", stub: true },
      { label: "Replay", href: "/quant/replay", stub: true },
      { label: "Experiments", href: "/quant/experiments", stub: true },
      { label: "Metrics", href: "/quant/metrics", stub: true },
      { label: "Ranking", href: "/quant/ranking", stub: true },
    ],
  },
  {
    label: "Execution",
    items: [
      { label: "Orders", href: "/execution/orders", stub: true },
      { label: "Fills", href: "/execution/fills", stub: true },
      { label: "Positions", href: "/execution/positions", stub: true },
      { label: "Risk", href: "/execution/risk", stub: true },
      { label: "Kill switch", href: "/execution/killswitch" },
    ],
  },
  {
    label: "Portfolio",
    items: [
      { label: "PnL", href: "/portfolio/pnl", stub: true },
      { label: "Exposure", href: "/portfolio/exposure", stub: true },
      { label: "Correlation", href: "/portfolio/correlation", stub: true },
      { label: "Allocation", href: "/portfolio/allocation", stub: true },
      { label: "Drawdown", href: "/portfolio/drawdown", stub: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Health", href: "/ops/health" },
      { label: "Flags", href: "/ops/flags", roles: ["admin", "operator"] },
      { label: "SLOs", href: "/ops/slos", stub: true },
      { label: "Alerts", href: "/ops/alerts", stub: true },
      { label: "Incidents", href: "/ops/incidents", stub: true },
      { label: "Deployments", href: "/ops/deployments", stub: true },
      { label: "Latency", href: "/ops/latency", stub: true },
      { label: "Feeds", href: "/ops/feeds", stub: true },
      { label: "Logs", href: "/ops/logs", stub: true },
    ],
  },
  {
    label: "Audit",
    items: [
      { label: "Events", href: "/audit/events", stub: true, roles: ["admin"] },
      { label: "KV changes", href: "/audit/kv-changes", stub: true, roles: ["admin"] },
      { label: "Exports", href: "/audit/exports", stub: true, roles: ["admin"] },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Trust tiers", href: "/governance/trust" },
      { label: "Approvals", href: "/governance/approvals" },
      { label: "Anomalies", href: "/governance/anomalies" },
      { label: "Demotions", href: "/governance/demotions" },
      { label: "Policies", href: "/governance/policies" },
    ],
  },
  {
    label: "Learning",
    items: [
      { label: "Feedback loop", href: "/learning/feedback", stub: true },
      { label: "Missed trades", href: "/learning/missed", stub: true },
      { label: "Calibration drift", href: "/learning/drift", stub: true },
    ],
  },
  {
    label: "Research",
    items: [
      { label: "Brainstorm", href: "/research/brainstorm", stub: true },
      { label: "Regimes", href: "/research/regimes", stub: true },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "System config", href: "/admin/system", roles: ["admin"] },
      { label: "Users", href: "/admin/users", stub: true, roles: ["admin"] },
      { label: "Roles", href: "/admin/roles", stub: true, roles: ["admin"] },
      { label: "API keys", href: "/admin/api-keys", stub: true, roles: ["admin"] },
      { label: "Webhooks", href: "/admin/webhooks", stub: true, roles: ["admin"] },
      { label: "MCP servers", href: "/admin/mcp", stub: true, roles: ["admin"] },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Profile", href: "/settings/profile", stub: true },
      { label: "Preferences", href: "/settings/preferences", stub: true },
      { label: "API tokens", href: "/settings/api-tokens", stub: true },
    ],
  },
];

/** Flat list of every link the sidebar exposes — used for static checks. */
export const ALL_HREFS: ReadonlyArray<string> = SIDEBAR.flatMap((section) =>
  section.items.map((it) => it.href),
);
