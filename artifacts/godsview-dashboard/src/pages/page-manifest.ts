/**
 * Single source of truth for the 68 dashboard pages.
 *
 * Every entry in this manifest is:
 *   - imported lazily by App.tsx (to build <Route> elements)
 *   - referenced by the Shell sidebar navigation (see components/layout/Shell.tsx)
 *   - used by the RBAC gate to decide the minimum role required to access
 *
 * When adding a new page:
 *   1. Create the component at src/pages/<slug>.tsx with a default export
 *   2. Add one entry here (path + lazy loader + label + minRole)
 *   3. Add it to the correct sidebar section in Shell.tsx
 *
 * DO NOT add `<Route>` elements outside this manifest. The duplicate-route
 * defect that landed pre-Phase-4 (tradingview-chart / bloomberg-terminal /
 * news-monitor were each registered twice in App.tsx) is exactly what this
 * single-source-of-truth eliminates by construction.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Role } from "@/auth/role-context";

export type PageManifestEntry = {
  /** URL path, must start with `/`. */
  path: string;
  /** Short stable identifier used for error-boundary scope + tests. */
  scope: string;
  /** Human-readable label shown in loading states / audit logs. */
  label: string;
  /** Minimum role required to view the page; viewer = everyone. */
  minRole: Role;
  /** Lazy-loaded component. App.tsx renders this inside a Suspense boundary. */
  component: LazyExoticComponent<ComponentType>;
};

/**
 * Rule of thumb for `minRole: "operator"`:
 *   - the page can mutate live state (send broker orders, flip kill switches,
 *     edit risk caps, rotate secrets, promote models to live)
 *   - the page renders chaos / deploy / infra controls
 *   - the page exposes raw credentials or full trade history for compliance
 *
 * Everything else is `viewer`.
 */
export const PAGE_MANIFEST: readonly PageManifestEntry[] = [
  // ── Command ────────────────────────────────────────────────────────────
  {
    path: "/command-center",
    scope: "page:command-center",
    label: "Command Center",
    minRole: "operator",
    component: lazy(() => import("@/pages/command-center")),
  },
  {
    path: "/bloomberg-terminal",
    scope: "page:bloomberg-terminal",
    label: "Bloomberg Terminal",
    minRole: "viewer",
    component: lazy(() => import("@/pages/bloomberg-terminal")),
  },
  {
    path: "/brain",
    scope: "page:brain",
    label: "Brain",
    minRole: "viewer",
    component: lazy(() => import("@/pages/brain")),
  },
  {
    path: "/brain-graph",
    scope: "page:brain-graph",
    label: "God Brain",
    minRole: "viewer",
    component: lazy(() => import("@/pages/brain-graph")),
  },
  {
    path: "/brain-nodes",
    scope: "page:brain-nodes",
    label: "Brain Nodes",
    minRole: "viewer",
    component: lazy(() => import("@/pages/brain-nodes")),
  },
  {
    path: "/infinity",
    scope: "page:infinity",
    label: "Infinity Screen",
    minRole: "viewer",
    component: lazy(() => import("@/pages/infinity")),
  },

  // ── Intelligence ───────────────────────────────────────────────────────
  {
    path: "/intelligence-center",
    scope: "page:intelligence-center",
    label: "Intelligence Hub",
    minRole: "viewer",
    component: lazy(() => import("@/pages/intelligence-center")),
  },
  {
    path: "/alpaca",
    scope: "page:alpaca",
    label: "Live Intelligence",
    minRole: "viewer",
    component: lazy(() => import("@/pages/alpaca")),
  },
  {
    path: "/super-intelligence",
    scope: "page:super-intelligence",
    label: "Super Intelligence",
    minRole: "viewer",
    component: lazy(() => import("@/pages/super-intelligence")),
  },
  {
    path: "/institutional-intelligence",
    scope: "page:institutional-intelligence",
    label: "Institutional Intelligence",
    minRole: "viewer",
    component: lazy(() => import("@/pages/institutional-intelligence")),
  },
  {
    path: "/regime-intelligence",
    scope: "page:regime-intelligence",
    label: "Regime Intelligence",
    minRole: "viewer",
    component: lazy(() => import("@/pages/regime-intelligence")),
  },
  {
    path: "/sentiment-intel",
    scope: "page:sentiment-intel",
    label: "Sentiment",
    minRole: "viewer",
    component: lazy(() => import("@/pages/sentiment-intel")),
  },
  {
    path: "/decision-loop",
    scope: "page:decision-loop",
    label: "Decision Loop",
    minRole: "viewer",
    component: lazy(() => import("@/pages/decision-loop")),
  },
  {
    path: "/decision-replay",
    scope: "page:decision-replay",
    label: "Decision Replay",
    minRole: "viewer",
    component: lazy(() => import("@/pages/decision-replay")),
  },
  {
    path: "/decision-explainability",
    scope: "page:decision-explainability",
    label: "Decision Explainability",
    minRole: "viewer",
    component: lazy(() => import("@/pages/decision-explainability")),
  },

  // ── Signals & Data ─────────────────────────────────────────────────────
  {
    path: "/signals",
    scope: "page:signals",
    label: "Signal Feed",
    minRole: "viewer",
    component: lazy(() => import("@/pages/signals")),
  },
  {
    path: "/mcp-signals",
    scope: "page:mcp-signals",
    label: "MCP Signals",
    minRole: "viewer",
    component: lazy(() => import("@/pages/mcp-signals")),
  },
  {
    path: "/pipeline",
    scope: "page:pipeline",
    label: "Pipeline Engine",
    minRole: "viewer",
    component: lazy(() => import("@/pages/pipeline")),
  },
  {
    path: "/pipeline-status",
    scope: "page:pipeline-status",
    label: "Pipeline Status",
    minRole: "viewer",
    component: lazy(() => import("@/pages/pipeline-status")),
  },
  {
    path: "/candle-xray",
    scope: "page:candle-xray",
    label: "Candle X-Ray",
    minRole: "viewer",
    component: lazy(() => import("@/pages/candle-xray")),
  },
  {
    path: "/tradingview-chart",
    scope: "page:tradingview-chart",
    label: "TradingView Chart",
    minRole: "viewer",
    component: lazy(() => import("@/pages/tradingview-chart")),
  },
  {
    path: "/news-monitor",
    scope: "page:news-monitor",
    label: "News Monitor",
    minRole: "viewer",
    component: lazy(() => import("@/pages/news-monitor")),
  },
  {
    path: "/economic-calendar",
    scope: "page:economic-calendar",
    label: "Economic Calendar",
    minRole: "viewer",
    component: lazy(() => import("@/pages/economic-calendar")),
  },
  {
    path: "/autonomous-brain",
    scope: "page:autonomous-brain",
    label: "Autonomous Brain",
    minRole: "viewer",
    component: lazy(() => import("@/pages/autonomous-brain")),
  },
  {
    path: "/microstructure",
    scope: "page:microstructure",
    label: "Microstructure",
    minRole: "viewer",
    component: lazy(() => import("@/pages/microstructure")),
  },
  {
    path: "/market-structure",
    scope: "page:market-structure",
    label: "Market Structure",
    minRole: "viewer",
    component: lazy(() => import("@/pages/market-structure")),
  },
  {
    path: "/setup-explorer",
    scope: "page:setup-explorer",
    label: "Setup Explorer",
    minRole: "viewer",
    component: lazy(() => import("@/pages/setup-explorer")),
  },
  {
    path: "/watchlist",
    scope: "page:watchlist",
    label: "Watchlist Scanner",
    minRole: "viewer",
    component: lazy(() => import("@/pages/watchlist")),
  },
  {
    path: "/correlation-lab",
    scope: "page:correlation-lab",
    label: "Correlation Lab",
    minRole: "viewer",
    component: lazy(() => import("@/pages/correlation-lab")),
  },
  {
    path: "/data-integrity",
    scope: "page:data-integrity",
    label: "Data Integrity",
    minRole: "viewer",
    component: lazy(() => import("@/pages/data-integrity")),
  },

  // ── Execution (writes to broker — operator only) ───────────────────────
  {
    path: "/execution",
    scope: "page:execution",
    label: "Execution",
    minRole: "operator",
    component: lazy(() => import("@/pages/execution")),
  },
  {
    path: "/execution-control",
    scope: "page:execution-control",
    label: "Execution Control",
    minRole: "operator",
    component: lazy(() => import("@/pages/execution-control")),
  },
  {
    path: "/exec-reliability",
    scope: "page:exec-reliability",
    label: "Execution Reliability",
    minRole: "operator",
    component: lazy(() => import("@/pages/exec-reliability")),
  },
  {
    path: "/trades",
    scope: "page:trades",
    label: "Trade Log",
    minRole: "viewer",
    component: lazy(() => import("@/pages/trades")),
  },
  {
    path: "/trade-journal",
    scope: "page:trade-journal",
    label: "Trade Journal",
    minRole: "viewer",
    component: lazy(() => import("@/pages/trade-journal")),
  },
  {
    path: "/portfolio",
    scope: "page:portfolio",
    label: "Portfolio",
    minRole: "viewer",
    component: lazy(() => import("@/pages/portfolio")),
  },

  // ── Backtesting ────────────────────────────────────────────────────────
  {
    path: "/backtester",
    scope: "page:backtester",
    label: "Backtester",
    minRole: "viewer",
    component: lazy(() => import("@/pages/backtester")),
  },
  {
    path: "/mcp-backtester",
    scope: "page:mcp-backtester",
    label: "MCP Backtester",
    minRole: "viewer",
    component: lazy(() => import("@/pages/mcp-backtester")),
  },
  {
    path: "/backtest-credibility",
    scope: "page:backtest-credibility",
    label: "Backtest Credibility",
    minRole: "viewer",
    component: lazy(() => import("@/pages/backtest-credibility")),
  },
  {
    path: "/quant-lab",
    scope: "page:quant-lab",
    label: "Quant Lab",
    minRole: "viewer",
    component: lazy(() => import("@/pages/quant-lab")),
  },
  {
    path: "/side-by-side",
    scope: "page:side-by-side",
    label: "Side-by-Side",
    minRole: "viewer",
    component: lazy(() => import("@/pages/side-by-side")),
  },

  // ── Risk & Safety (writes to risk caps / kill switch — operator only) ──
  {
    path: "/risk",
    scope: "page:risk",
    label: "Risk Command",
    minRole: "operator",
    component: lazy(() => import("@/pages/risk")),
  },
  {
    path: "/risk-command-v2",
    scope: "page:risk-command-v2",
    label: "Risk Command v2",
    minRole: "operator",
    component: lazy(() => import("@/pages/risk-command-v2")),
  },
  {
    path: "/alerts",
    scope: "page:alerts",
    label: "Alerts",
    minRole: "viewer",
    component: lazy(() => import("@/pages/alerts")),
  },
  {
    path: "/alert-center",
    scope: "page:alert-center",
    label: "Alert Center",
    minRole: "viewer",
    component: lazy(() => import("@/pages/alert-center")),
  },
  {
    path: "/advanced-risk",
    scope: "page:advanced-risk",
    label: "Advanced Risk",
    minRole: "operator",
    component: lazy(() => import("@/pages/advanced-risk")),
  },
  {
    path: "/capital-gating",
    scope: "page:capital-gating",
    label: "Capital Gating",
    minRole: "operator",
    component: lazy(() => import("@/pages/capital-gating")),
  },
  {
    path: "/paper-trading-program",
    scope: "page:paper-trading-program",
    label: "Paper Trading Program",
    minRole: "operator",
    component: lazy(() => import("@/pages/paper-trading-program")),
  },

  // ── Analytics ──────────────────────────────────────────────────────────
  {
    path: "/performance",
    scope: "page:performance",
    label: "Performance",
    minRole: "viewer",
    component: lazy(() => import("@/pages/performance")),
  },
  {
    path: "/performance-analytics",
    scope: "page:performance-analytics",
    label: "Deep Analytics",
    minRole: "viewer",
    component: lazy(() => import("@/pages/performance-analytics")),
  },
  {
    path: "/analytics",
    scope: "page:analytics",
    label: "Equity Analytics",
    minRole: "viewer",
    component: lazy(() => import("@/pages/analytics")),
  },
  {
    path: "/reports",
    scope: "page:reports",
    label: "Session Reports",
    minRole: "viewer",
    component: lazy(() => import("@/pages/reports")),
  },
  {
    path: "/daily-review",
    scope: "page:daily-review",
    label: "Daily Review",
    minRole: "viewer",
    component: lazy(() => import("@/pages/daily-review")),
  },
  {
    path: "/proof",
    scope: "page:proof",
    label: "Proof",
    minRole: "viewer",
    component: lazy(() => import("@/pages/proof")),
  },

  // ── Operations (chaos / deploy — operator only) ────────────────────────
  {
    path: "/ops",
    scope: "page:ops",
    label: "Ops Monitor",
    minRole: "viewer",
    component: lazy(() => import("@/pages/ops")),
  },
  {
    path: "/ops-security",
    scope: "page:ops-security",
    label: "Ops & Security",
    minRole: "operator",
    component: lazy(() => import("@/pages/ops-security")),
  },
  {
    path: "/war-room",
    scope: "page:war-room",
    label: "War Room",
    minRole: "viewer",
    component: lazy(() => import("@/pages/war-room")),
  },
  {
    path: "/checklist",
    scope: "page:checklist",
    label: "Checklist",
    minRole: "viewer",
    component: lazy(() => import("@/pages/checklist")),
  },

  // ── Governance (model promotion / audit — operator only on writes) ─────
  {
    path: "/model-governance",
    scope: "page:model-governance",
    label: "Model Governance",
    minRole: "operator",
    component: lazy(() => import("@/pages/model-governance")),
  },
  {
    path: "/trust-surface",
    scope: "page:trust-surface",
    label: "Trust Surface",
    minRole: "viewer",
    component: lazy(() => import("@/pages/trust-surface")),
  },
  {
    path: "/calibration",
    scope: "page:calibration",
    label: "Calibration",
    minRole: "viewer",
    component: lazy(() => import("@/pages/calibration")),
  },
  {
    path: "/eval-harness",
    scope: "page:eval-harness",
    label: "Eval Harness",
    minRole: "viewer",
    component: lazy(() => import("@/pages/eval-harness")),
  },
  {
    path: "/audit",
    scope: "page:audit",
    label: "Audit Trail",
    minRole: "viewer",
    component: lazy(() => import("@/pages/audit")),
  },
  {
    path: "/system-audit",
    scope: "page:system-audit",
    label: "System Audit",
    minRole: "viewer",
    component: lazy(() => import("@/pages/system-audit")),
  },

  // ── System ─────────────────────────────────────────────────────────────
  {
    path: "/system",
    scope: "page:system",
    label: "System Core",
    minRole: "viewer",
    component: lazy(() => import("@/pages/system")),
  },
  {
    path: "/stitch-lab",
    scope: "page:stitch-lab",
    label: "Stitch Vault",
    minRole: "viewer",
    component: lazy(() => import("@/pages/stitch-lab")),
  },
  {
    path: "/settings",
    scope: "page:settings",
    label: "Settings",
    minRole: "operator",
    component: lazy(() => import("@/pages/settings")),
  },

  // Note: The root route "/" (Dashboard) is eager-loaded in App.tsx and is NOT
  // part of this manifest. It is always accessible to `viewer`.
] as const;

/** Number of routes registered via manifest (does not count root "/" or 404). */
export const MANIFEST_ROUTE_COUNT = PAGE_MANIFEST.length;

/** Paths protected by an operator gate — useful for audit tooling. */
export const OPERATOR_PATHS: readonly string[] = PAGE_MANIFEST
  .filter((entry) => entry.minRole === "operator")
  .map((entry) => entry.path);

/** Runtime invariant: no duplicate paths. Throws at module load if violated. */
(() => {
  const seen = new Set<string>();
  for (const entry of PAGE_MANIFEST) {
    if (seen.has(entry.path)) {
      throw new Error(
        `[page-manifest] duplicate path detected: ${entry.path}. ` +
          "Every entry must have a unique path.",
      );
    }
    seen.add(entry.path);
  }
})();
