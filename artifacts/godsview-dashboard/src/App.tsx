import React, { type ErrorInfo, type ReactNode, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import { GlobalDataProvider } from "@/components/GlobalDataProvider";
import { NotificationSystem } from "@/components/NotificationSystem";

// ── Eager: primary landing page (fastest first paint) ───────────────────────
import Dashboard from "@/pages/dashboard";

// ── Lazy: all other pages (each becomes its own JS chunk) ───────────────────
const Signals            = React.lazy(() => import("@/pages/signals"));
const Trades             = React.lazy(() => import("@/pages/trades"));
const Performance        = React.lazy(() => import("@/pages/performance"));
const System             = React.lazy(() => import("@/pages/system"));
const AlpacaPage         = React.lazy(() => import("@/pages/alpaca"));
const InfinityPage       = React.lazy(() => import("@/pages/infinity"));
const BrainPage          = React.lazy(() => import("@/pages/brain"));
const StitchLabPage      = React.lazy(() => import("@/pages/stitch-lab"));
const PipelinePage       = React.lazy(() => import("@/pages/pipeline"));
const CandleXRayPage     = React.lazy(() => import("@/pages/candle-xray"));
const SetupExplorerPage  = React.lazy(() => import("@/pages/setup-explorer"));
const ReportsPage        = React.lazy(() => import("@/pages/reports"));
const RiskPage           = React.lazy(() => import("@/pages/risk"));
const SettingsPage       = React.lazy(() => import("@/pages/settings"));
const SuperIntelligencePage = React.lazy(() => import("@/pages/super-intelligence"));
const InstitutionalIntelligencePage = React.lazy(() => import("@/pages/institutional-intelligence"));
const BacktesterPage        = React.lazy(() => import("@/pages/backtester"));
const IntelligenceCenterPage = React.lazy(() => import("@/pages/intelligence-center"));
const TradeJournalPage               = React.lazy(() => import("@/pages/trade-journal"));
const WatchlistPage                  = React.lazy(() => import("@/pages/watchlist"));
const AnalyticsPage                  = React.lazy(() => import("@/pages/analytics"));
const WarRoom            = React.lazy(() => import("@/pages/war-room"));
const Proof              = React.lazy(() => import("@/pages/proof"));
const Checklist          = React.lazy(() => import("@/pages/checklist"));
const OpsPage            = React.lazy(() => import("@/pages/ops"));
const QuantLabPage       = React.lazy(() => import("@/pages/quant-lab"));
const PortfolioPage      = React.lazy(() => import("@/pages/portfolio"));
const ExecutionPage      = React.lazy(() => import("@/pages/execution"));
const AuditPage          = React.lazy(() => import("@/pages/audit"));
const DecisionReplayPage = React.lazy(() => import("@/pages/decision-replay"));
const AlertsPage         = React.lazy(() => import("@/pages/alerts"));
const CommandCenterPage  = React.lazy(() => import("@/pages/command-center"));
const MarketStructurePage = React.lazy(() => import("@/pages/market-structure"));
const DailyReviewPage     = React.lazy(() => import("@/pages/daily-review"));
const SideBySidePage      = React.lazy(() => import("@/pages/side-by-side"));
const NotFound           = React.lazy(() => import("@/pages/not-found"));

// ── QueryClient ─────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

// ── Page-load skeleton shown while lazy chunks download ─────────────────────
function PageSkeleton() {
  return (
    <div className="flex items-center justify-center h-[60vh] w-full">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}

// ── Error boundary ───────────────────────────────────────────────────────────
class AppErrorBoundary extends React.Component<
  { children: ReactNode; scope: string },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode; scope: string }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: String(error ?? "Unknown UI error") };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error(`[ui-error:${this.props.scope}]`, error, errorInfo);
  }

  private handleReload = () => window.location.reload();

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a1a] p-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-red-400 mb-4">UI Error</h1>
            <p className="text-gray-400 mb-6">{this.state.message}</p>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Route wrapper: Suspense + ErrorBoundary per page ────────────────────────
function RoutedPage({
  path,
  component: Component,
  scope,
}: {
  path: string;
  component: React.ComponentType;
  scope: string;
}) {
  return (
    <Route path={path}>
      <AppErrorBoundary scope={scope}>
        <Suspense fallback={<PageSkeleton />}>
          <Component />
        </Suspense>
      </AppErrorBoundary>
    </Route>
  );
}

// ── Router ───────────────────────────────────────────────────────────────────
function Router() {
  return (
    <Shell>
      <Switch>
        {/* Eager — no Suspense needed */}
        <Route path="/">
          <AppErrorBoundary scope="page:dashboard">
            <Dashboard />
          </AppErrorBoundary>
        </Route>

        <RoutedPage path="/signals"           component={Signals}               scope="page:signals" />
        <RoutedPage path="/trades"            component={Trades}                scope="page:trades" />
        <RoutedPage path="/performance"       component={Performance}           scope="page:performance" />
        <RoutedPage path="/system"            component={System}                scope="page:system" />
        <RoutedPage path="/alpaca"            component={AlpacaPage}            scope="page:alpaca" />
        <RoutedPage path="/infinity"          component={InfinityPage}          scope="page:infinity" />
        <RoutedPage path="/brain"             component={BrainPage}             scope="page:brain" />
        <RoutedPage path="/stitch-lab"        component={StitchLabPage}         scope="page:stitch-lab" />
        <RoutedPage path="/pipeline"          component={PipelinePage}          scope="page:pipeline" />
        <RoutedPage path="/candle-xray"       component={CandleXRayPage}        scope="page:candle-xray" />
        <RoutedPage path="/setup-explorer"    component={SetupExplorerPage}     scope="page:setup-explorer" />
        <RoutedPage path="/reports"           component={ReportsPage}           scope="page:reports" />
        <RoutedPage path="/risk"              component={RiskPage}              scope="page:risk" />
        <RoutedPage path="/super-intelligence"       component={SuperIntelligencePage}            scope="page:super-intelligence" />
        <RoutedPage path="/institutional-intelligence" component={InstitutionalIntelligencePage} scope="page:institutional-intelligence" />
        <RoutedPage path="/backtester"            component={BacktesterPage}        scope="page:backtester" />
        <RoutedPage path="/intelligence-center"   component={IntelligenceCenterPage} scope="page:intelligence-center" />
        <RoutedPage path="/trade-journal"     component={TradeJournalPage}      scope="page:trade-journal" />
        <RoutedPage path="/watchlist"         component={WatchlistPage}         scope="page:watchlist" />
        <RoutedPage path="/analytics"         component={AnalyticsPage}         scope="page:analytics" />
        <RoutedPage path="/settings"          component={SettingsPage}          scope="page:settings" />
        <RoutedPage path="/war-room"          component={WarRoom}               scope="page:war-room" />
        <RoutedPage path="/proof"             component={Proof}                 scope="page:proof" />
        <RoutedPage path="/checklist"         component={Checklist}             scope="page:checklist" />
        <RoutedPage path="/ops"               component={OpsPage}               scope="page:ops" />
        <RoutedPage path="/quant-lab"         component={QuantLabPage}          scope="page:quant-lab" />
        <RoutedPage path="/portfolio"         component={PortfolioPage}         scope="page:portfolio" />
        <RoutedPage path="/execution"         component={ExecutionPage}         scope="page:execution" />
        <RoutedPage path="/audit"             component={AuditPage}             scope="page:audit" />
        <RoutedPage path="/decision-replay"   component={DecisionReplayPage}    scope="page:decision-replay" />
        <RoutedPage path="/alerts"            component={AlertsPage}            scope="page:alerts" />
        <RoutedPage path="/command-center"   component={CommandCenterPage}     scope="page:command-center" />
        <RoutedPage path="/market-structure" component={MarketStructurePage}   scope="page:market-structure" />
        <RoutedPage path="/daily-review"     component={DailyReviewPage}       scope="page:daily-review" />
        <RoutedPage path="/side-by-side"     component={SideBySidePage}        scope="page:side-by-side" />

        <Route>
          <AppErrorBoundary scope="page:not-found">
            <Suspense fallback={<PageSkeleton />}>
              <NotFound />
            </Suspense>
          </AppErrorBoundary>
        </Route>
      </Switch>
    </Shell>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GlobalDataProvider>
          <AppErrorBoundary scope="app-root">
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </AppErrorBoundary>
          <NotificationSystem />
        </GlobalDataProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
