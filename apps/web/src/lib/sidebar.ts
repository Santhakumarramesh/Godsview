/**
 * GodsView Master Sidebar Map.
 *
 * 10 sections × 6-8 items = 68 routes. All pages are marked stub: false
 * as we're making them all real. Admin-only pages are marked with appropriate roles.
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
    label: "God Brain / Command",
    items: [
      { label: "God Brain Home", href: "/overview", stub: false },
      { label: "Brain Hologram View", href: "/brain/hologram", stub: false },
      { label: "Global System Health", href: "/ops/health", stub: false },
      { label: "Mission Control", href: "/brain/mission-control", stub: false },
      { label: "Alerts Command Hub", href: "/ops/alerts", stub: false },
      { label: "Daily Briefing", href: "/brain/daily-briefing", stub: false },
      { label: "Session Control", href: "/brain/session-control", stub: false },
      { label: "Strategy Radar", href: "/brain/strategy-radar", stub: false },
    ],
  },
  {
    label: "Market Discovery",
    items: [
      { label: "Market Scanner", href: "/market/scanner", stub: false },
      { label: "Watchlist Manager", href: "/market/watchlist", stub: false },
      { label: "Opportunity Queue", href: "/market/opportunity-queue", stub: false },
      { label: "Regime Detection", href: "/market/regimes", stub: false },
      { label: "Liquidity Environment", href: "/market/liquidity", stub: false },
      { label: "News & Sentiment Radar", href: "/market/sentiment", stub: false },
      { label: "Heat Candidate Board", href: "/market/heat-board", stub: false },
      { label: "Cross-Asset Pulse", href: "/market/cross-asset", stub: false },
    ],
  },
  {
    label: "Chart / Structure",
    items: [
      { label: "TradingView Live Chart", href: "/chart/live", stub: false },
      { label: "Multi-Timeframe Structure", href: "/chart/multi-tf", stub: false },
      { label: "Order Block Engine", href: "/chart/order-blocks", stub: false },
      { label: "BOS / CHOCH Engine", href: "/chart/bos-choch", stub: false },
      { label: "Liquidity Sweep Mapper", href: "/chart/sweeps", stub: false },
      { label: "Premium / Discount Map", href: "/chart/premium-discount", stub: false },
      { label: "Entry / Stop / Target Planner", href: "/chart/entry-planner", stub: false },
      { label: "Chart Annotation Studio", href: "/chart/annotations", stub: false },
    ],
  },
  {
    label: "TradingView MCP",
    items: [
      { label: "TradingView MCP Control", href: "/tv/mcp-control", stub: false },
      { label: "Pine Script Signal Registry", href: "/tv/pine-scripts", stub: false },
      { label: "Webhook Event Router", href: "/tv/webhooks", stub: false },
      { label: "TV Strategy Sync", href: "/tv/strategy-sync", stub: false },
      { label: "Chart Action Bridge", href: "/tv/action-bridge", stub: false },
      { label: "TV Replay Connector", href: "/tv/replay", stub: false },
    ],
  },
  {
    label: "Order Flow",
    items: [
      { label: "Order Flow Dashboard", href: "/flow/dashboard", stub: false },
      { label: "Heatmap Liquidity View", href: "/flow/heatmap", stub: false },
      { label: "DOM / Depth Monitor", href: "/flow/dom", stub: false },
      { label: "Footprint / Delta View", href: "/flow/footprint", stub: false },
      { label: "Absorption Detector", href: "/flow/absorption", stub: false },
      { label: "Imbalance Engine", href: "/flow/imbalance", stub: false },
      { label: "Execution Pressure Map", href: "/flow/pressure", stub: false },
      { label: "Flow + Structure Confluence", href: "/flow/confluence", stub: false },
    ],
  },
  {
    label: "Quant Lab",
    items: [
      { label: "Quant Lab Home", href: "/quant/home", stub: false },
      { label: "Backtesting Engine", href: "/quant/backtests", stub: false },
      { label: "Strategy Builder", href: "/quant/builder", stub: false },
      { label: "Walk-Forward Validation", href: "/quant/walk-forward", stub: false },
      { label: "Performance Analytics", href: "/quant/performance", stub: false },
      { label: "Regime Performance Matrix", href: "/quant/regime-matrix", stub: false },
      { label: "Experiment Tracker", href: "/quant/experiments", stub: false },
      { label: "Promotion Pipeline", href: "/quant/promotions", stub: false },
    ],
  },
  {
    label: "Memory / Recall",
    items: [
      { label: "Recall Engine", href: "/memory/recall", stub: false },
      { label: "Case Library", href: "/memory/cases", stub: false },
      { label: "Screenshot Memory Vault", href: "/memory/screenshots", stub: false },
      { label: "Setup Similarity Search", href: "/memory/similarity", stub: false },
      { label: "Trade Journal AI", href: "/memory/journal", stub: false },
      { label: "Learning Loop Dashboard", href: "/memory/learning", stub: false },
    ],
  },
  {
    label: "Portfolio / Risk",
    items: [
      { label: "Portfolio Command", href: "/portfolio/command", stub: false },
      { label: "Position Monitor", href: "/portfolio/positions", stub: false },
      { label: "Allocation Engine", href: "/portfolio/allocation", stub: false },
      { label: "Correlation Risk", href: "/portfolio/correlation", stub: false },
      { label: "Drawdown Protection", href: "/portfolio/drawdown", stub: false },
      { label: "Risk Policy Center", href: "/risk/policies", stub: false, roles: ["admin", "operator"] },
      { label: "Pre-Trade Risk Gate", href: "/risk/pre-trade", stub: false },
      { label: "Capital Efficiency View", href: "/portfolio/efficiency", stub: false },
    ],
  },
  {
    label: "Execution",
    items: [
      { label: "Execution Center", href: "/execution/center", stub: false },
      { label: "Paper Trading Arena", href: "/execution/paper", stub: false },
      { label: "Assisted Live Trading", href: "/execution/assisted", stub: false },
      { label: "Semi-Autonomous Mode", href: "/execution/semi-auto", stub: false },
      { label: "Autonomous Candidate Mode", href: "/execution/autonomous", stub: false, roles: ["admin", "operator"] },
      { label: "Broker / Exchange Connector", href: "/execution/broker", stub: false },
      { label: "Slippage & Fill Quality", href: "/execution/fill-quality", stub: false },
      { label: "Emergency Controls / Kill Switch", href: "/execution/killswitch", stub: false },
    ],
  },
];

/** Flat list of every link the sidebar exposes — used for static checks. */
export const ALL_HREFS: ReadonlyArray<string> = SIDEBAR.flatMap((section) =>
  section.items.map((it) => it.href),
);
