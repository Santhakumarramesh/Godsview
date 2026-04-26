import React, { type ErrorInfo, type ReactNode, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import { GlobalDataProvider } from "@/components/GlobalDataProvider";
import { NotificationSystem } from "@/components/NotificationSystem";
import ModeBadge from "@/components/ModeBadge";

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
const TradingViewChartPage = React.lazy(() => import("@/pages/tradingview-chart")); // Phase 125
const BloombergTerminalPage = React.lazy(() => import("@/pages/bloomberg-terminal")); // Phase 126
const NewsMonitorPage = React.lazy(() => import("@/pages/news-monitor")); // Phase 127
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
const DecisionLoopPage    = React.lazy(() => import("@/pages/decision-loop"));
const TrustSurfacePage    = React.lazy(() => import("@/pages/trust-surface"));
const EvalHarnessPage     = React.lazy(() => import("@/pages/eval-harness"));
const CalibrationPage     = React.lazy(() => import("@/pages/calibration"));
const MCPSignalsPage      = React.lazy(() => import("@/pages/mcp-signals"));
const MCPBacktesterPage   = React.lazy(() => import("@/pages/mcp-backtester"));
const PipelineStatusPage  = React.lazy(() => import("@/pages/pipeline-status"));
const BrainGraphPage      = React.lazy(() => import("@/pages/brain-graph"));
const RegimeIntelligencePage = React.lazy(() => import("@/pages/regime-intelligence"));
const CorrelationLabPage  = React.lazy(() => import("@/pages/correlation-lab"));
const ExecutionControlPage = React.lazy(() => import("@/pages/execution-control"));
const SentimentIntelPage  = React.lazy(() => import("@/pages/sentiment-intel"));
const PerformanceAnalyticsPage = React.lazy(() => import("@/pages/performance-analytics"));
const AlertCenterPage     = React.lazy(() => import("@/pages/alert-center"));
const MicrostructurePage  = React.lazy(() => import("@/pages/microstructure"));
const SystemAuditPage    = React.lazy(() => import("@/pages/system-audit"));
const DataIntegrityPage  = React.lazy(() => import("@/pages/data-integrity"));
const BacktestCredibilityPage = React.lazy(() => import("@/pages/backtest-credibility"));
const ExecReliabilityPage = React.lazy(() => import("@/pages/exec-reliability"));
const RiskCommandV2Page  = React.lazy(() => import("@/pages/risk-command-v2"));
const ModelGovernancePage = React.lazy(() => import("@/pages/model-governance"));
const DecisionExplainabilityPage = React.lazy(() => import("@/pages/decision-explainability"));
const OpsSecurityPage    = React.lazy(() => import("@/pages/ops-security"));
const PaperTradingProgramPage = React.lazy(() => import("@/pages/paper-trading-program"));
const CapitalGatingPage  = React.lazy(() => import("@/pages/capital-gating"));
const BrainNodesPage     = React.lazy(() => import("@/pages/brain-nodes"));
const AdvancedRiskPage   = React.lazy(() => import("@/pages/advanced-risk"));
const EconomicCalendarPage = React.lazy(() => import("@/pages/economic-calendar"));
const AutonomousBrainPage = React.lazy(() => import("@/pages/autonomous-brain")); // Phase 148

// ── GodsView 68-page sidebar: merged from top-level ────────────────────────
const DailyBriefingPage           = React.lazy(() => import("@/pages/daily-briefing"));
const SessionControlPage          = React.lazy(() => import("@/pages/session-control"));
const MarketScannerPage           = React.lazy(() => import("@/pages/market-scanner"));
const RegimeDetectionPage         = React.lazy(() => import("@/pages/regime-detection"));
const LiquidityEnvironmentPage    = React.lazy(() => import("@/pages/liquidity-environment"));
const NewsSentimentPage           = React.lazy(() => import("@/pages/news-sentiment"));
const HeatBoardPage               = React.lazy(() => import("@/pages/heat-board"));
const MultiTimeframePage          = React.lazy(() => import("@/pages/multi-timeframe"));
const OrderBlocksPage             = React.lazy(() => import("@/pages/order-blocks"));
const BosChochPage                = React.lazy(() => import("@/pages/bos-choch"));
const LiquiditySweepPage          = React.lazy(() => import("@/pages/liquidity-sweep"));
const PremiumDiscountPage         = React.lazy(() => import("@/pages/premium-discount"));
const EntryPlannerPage            = React.lazy(() => import("@/pages/entry-planner"));
const ChartAnnotationsPage        = React.lazy(() => import("@/pages/chart-annotations"));
const TradingViewMcpPage          = React.lazy(() => import("@/pages/tradingview-mcp"));
const PineScriptsPage             = React.lazy(() => import("@/pages/pine-scripts"));
const WebhookRouterPage           = React.lazy(() => import("@/pages/webhook-router"));
const VcModePage                  = React.lazy(() => import("@/pages/vc-mode"));
const TvStrategySyncPage          = React.lazy(() => import("@/pages/tv-strategy-sync"));
const ChartActionBridgePage       = React.lazy(() => import("@/pages/chart-action-bridge"));
const TvReplayPage                = React.lazy(() => import("@/pages/tv-replay"));
const OrderFlowPage               = React.lazy(() => import("@/pages/order-flow"));
const C4StrategyPage              = React.lazy(() => import("@/pages/c4-strategy"));
const HeatmapLiquidityPage        = React.lazy(() => import("@/pages/heatmap-liquidity"));
const DomDepthPage                = React.lazy(() => import("@/pages/dom-depth"));
const FootprintDeltaPage          = React.lazy(() => import("@/pages/footprint-delta"));
const AbsorptionDetectorPage      = React.lazy(() => import("@/pages/absorption-detector"));
const ImbalanceEnginePage         = React.lazy(() => import("@/pages/imbalance-engine"));
const ExecutionPressurePage       = React.lazy(() => import("@/pages/execution-pressure"));
const FlowConfluencePage          = React.lazy(() => import("@/pages/flow-confluence"));
const StrategyBuilderPage         = React.lazy(() => import("@/pages/strategy-builder"));
const WalkForwardPage             = React.lazy(() => import("@/pages/walk-forward"));
const RegimeMatrixPage            = React.lazy(() => import("@/pages/regime-matrix"));
const ExperimentTrackerPage       = React.lazy(() => import("@/pages/experiment-tracker"));
const PromotionPipelinePage       = React.lazy(() => import("@/pages/promotion-pipeline"));
const RecallEnginePage            = React.lazy(() => import("@/pages/recall-engine"));
const CaseLibraryPage             = React.lazy(() => import("@/pages/case-library"));
const ScreenshotVaultPage         = React.lazy(() => import("@/pages/screenshot-vault"));
const SetupSimilarityPage         = React.lazy(() => import("@/pages/setup-similarity"));
const LearningLoopPage            = React.lazy(() => import("@/pages/learning-loop"));
const PositionMonitorPage         = React.lazy(() => import("@/pages/position-monitor"));
const AllocationEnginePage        = React.lazy(() => import("@/pages/allocation-engine"));
const CorrelationRiskPage         = React.lazy(() => import("@/pages/correlation-risk"));
const DrawdownProtectionPage      = React.lazy(() => import("@/pages/drawdown-protection"));
const RiskPoliciesPage            = React.lazy(() => import("@/pages/risk-policies"));
const PretradeGatePage            = React.lazy(() => import("@/pages/pretrade-gate"));
const CapitalEfficiencyPage       = React.lazy(() => import("@/pages/capital-efficiency"));
const PaperTradingPage            = React.lazy(() => import("@/pages/paper-trading"));
const AssistedTradingPage         = React.lazy(() => import("@/pages/assisted-trading"));
const SemiAutonomousPage          = React.lazy(() => import("@/pages/semi-autonomous"));
const AutonomousModePage          = React.lazy(() => import("@/pages/autonomous-mode"));
const SlippageQualityPage         = React.lazy(() => import("@/pages/slippage-quality"));
const EmergencyControlsPage       = React.lazy(() => import("@/pages/emergency-controls"));
const CryptoBacktestsPage         = React.lazy(() => import("@/pages/crypto-backtests"));
const PaperTradingLivePage        = React.lazy(() => import("@/pages/paper-trading-live"));

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

        <RoutedPage path="/vc-mode"           component={VcModePage}            scope="page:vc-mode" />
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
        <RoutedPage path="/tradingview-chart" component={TradingViewChartPage}  scope="page:tradingview-chart" />
        <RoutedPage path="/bloomberg-terminal" component={BloombergTerminalPage} scope="page:bloomberg-terminal" />
        <RoutedPage path="/news-monitor" component={NewsMonitorPage} scope="page:news-monitor" />
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
        <RoutedPage path="/decision-loop"    component={DecisionLoopPage}      scope="page:decision-loop" />
        <RoutedPage path="/trust-surface"    component={TrustSurfacePage}      scope="page:trust-surface" />
        <RoutedPage path="/eval-harness"     component={EvalHarnessPage}       scope="page:eval-harness" />
        <RoutedPage path="/calibration"      component={CalibrationPage}       scope="page:calibration" />
        <RoutedPage path="/mcp-signals"      component={MCPSignalsPage}        scope="page:mcp-signals" />
        <RoutedPage path="/mcp-backtester"   component={MCPBacktesterPage}     scope="page:mcp-backtester" />
        <RoutedPage path="/pipeline-status"  component={PipelineStatusPage}    scope="page:pipeline-status" />
        <RoutedPage path="/brain-graph"      component={BrainGraphPage}        scope="page:brain-graph" />
        <RoutedPage path="/regime-intelligence" component={RegimeIntelligencePage} scope="page:regime-intelligence" />
        <RoutedPage path="/correlation-lab" component={CorrelationLabPage} scope="page:correlation-lab" />
        <RoutedPage path="/execution-control" component={ExecutionControlPage} scope="page:execution-control" />
        <RoutedPage path="/sentiment-intel" component={SentimentIntelPage} scope="page:sentiment-intel" />
        <RoutedPage path="/performance-analytics" component={PerformanceAnalyticsPage} scope="page:performance-analytics" />
        <RoutedPage path="/alert-center" component={AlertCenterPage} scope="page:alert-center" />
        <RoutedPage path="/microstructure" component={MicrostructurePage} scope="page:microstructure" />
        <RoutedPage path="/system-audit" component={SystemAuditPage} scope="page:system-audit" />
        <RoutedPage path="/data-integrity" component={DataIntegrityPage} scope="page:data-integrity" />
        <RoutedPage path="/backtest-credibility" component={BacktestCredibilityPage} scope="page:backtest-credibility" />
        <RoutedPage path="/exec-reliability" component={ExecReliabilityPage} scope="page:exec-reliability" />
        <RoutedPage path="/risk-command-v2" component={RiskCommandV2Page} scope="page:risk-command-v2" />
        <RoutedPage path="/model-governance" component={ModelGovernancePage} scope="page:model-governance" />
        <RoutedPage path="/decision-explainability" component={DecisionExplainabilityPage} scope="page:decision-explainability" />
        <RoutedPage path="/ops-security" component={OpsSecurityPage} scope="page:ops-security" />
        <RoutedPage path="/paper-trading-program" component={PaperTradingProgramPage} scope="page:paper-trading-program" />
        <RoutedPage path="/capital-gating" component={CapitalGatingPage} scope="page:capital-gating" />
        <RoutedPage path="/brain-nodes" component={BrainNodesPage} scope="page:brain-nodes" />
        <RoutedPage path="/advanced-risk" component={AdvancedRiskPage} scope="page:advanced-risk" />
        <RoutedPage path="/economic-calendar" component={EconomicCalendarPage} scope="page:economic-calendar" />
        <RoutedPage path="/autonomous-brain" component={AutonomousBrainPage} scope="page:autonomous-brain" />

        {/* ── GodsView 68-page sidebar routes (merged) ─────────────────── */}
        <RoutedPage path="/daily-briefing"      component={DailyBriefingPage}       scope="page:daily-briefing" />
        <RoutedPage path="/session-control"     component={SessionControlPage}      scope="page:session-control" />
        <RoutedPage path="/market-scanner"      component={MarketScannerPage}       scope="page:market-scanner" />
        <RoutedPage path="/regime-detection"    component={RegimeDetectionPage}     scope="page:regime-detection" />
        <RoutedPage path="/liquidity-environment" component={LiquidityEnvironmentPage} scope="page:liquidity-environment" />
        <RoutedPage path="/news-sentiment"      component={NewsSentimentPage}       scope="page:news-sentiment" />
        <RoutedPage path="/heat-board"          component={HeatBoardPage}           scope="page:heat-board" />
        <RoutedPage path="/multi-timeframe"     component={MultiTimeframePage}      scope="page:multi-timeframe" />
        <RoutedPage path="/order-blocks"        component={OrderBlocksPage}         scope="page:order-blocks" />
        <RoutedPage path="/bos-choch"           component={BosChochPage}            scope="page:bos-choch" />
        <RoutedPage path="/liquidity-sweep"     component={LiquiditySweepPage}      scope="page:liquidity-sweep" />
        <RoutedPage path="/premium-discount"    component={PremiumDiscountPage}     scope="page:premium-discount" />
        <RoutedPage path="/entry-planner"       component={EntryPlannerPage}        scope="page:entry-planner" />
        <RoutedPage path="/chart-annotations"   component={ChartAnnotationsPage}    scope="page:chart-annotations" />
        <RoutedPage path="/tradingview-mcp"     component={TradingViewMcpPage}      scope="page:tradingview-mcp" />
        <RoutedPage path="/pine-scripts"        component={PineScriptsPage}         scope="page:pine-scripts" />
        <RoutedPage path="/webhook-router"      component={WebhookRouterPage}       scope="page:webhook-router" />
        <RoutedPage path="/tv-strategy-sync"    component={TvStrategySyncPage}      scope="page:tv-strategy-sync" />
        <RoutedPage path="/chart-action-bridge" component={ChartActionBridgePage}   scope="page:chart-action-bridge" />
        <RoutedPage path="/tv-replay"           component={TvReplayPage}            scope="page:tv-replay" />
        <RoutedPage path="/order-flow"          component={OrderFlowPage}           scope="page:order-flow" />
        <RoutedPage path="/c4-strategy"         component={C4StrategyPage}          scope="page:c4-strategy" />
        <RoutedPage path="/heatmap-liquidity"   component={HeatmapLiquidityPage}    scope="page:heatmap-liquidity" />
        <RoutedPage path="/dom-depth"           component={DomDepthPage}            scope="page:dom-depth" />
        <RoutedPage path="/footprint-delta"     component={FootprintDeltaPage}      scope="page:footprint-delta" />
        <RoutedPage path="/absorption-detector" component={AbsorptionDetectorPage}  scope="page:absorption-detector" />
        <RoutedPage path="/imbalance-engine"    component={ImbalanceEnginePage}     scope="page:imbalance-engine" />
        <RoutedPage path="/execution-pressure"  component={ExecutionPressurePage}   scope="page:execution-pressure" />
        <RoutedPage path="/flow-confluence"     component={FlowConfluencePage}      scope="page:flow-confluence" />
        <RoutedPage path="/strategy-builder"    component={StrategyBuilderPage}     scope="page:strategy-builder" />
        <RoutedPage path="/walk-forward"        component={WalkForwardPage}         scope="page:walk-forward" />
        <RoutedPage path="/regime-matrix"       component={RegimeMatrixPage}        scope="page:regime-matrix" />
        <RoutedPage path="/experiment-tracker"  component={ExperimentTrackerPage}   scope="page:experiment-tracker" />
        <RoutedPage path="/promotion-pipeline"  component={PromotionPipelinePage}   scope="page:promotion-pipeline" />
        <RoutedPage path="/recall-engine"       component={RecallEnginePage}        scope="page:recall-engine" />
        <RoutedPage path="/case-library"        component={CaseLibraryPage}         scope="page:case-library" />
        <RoutedPage path="/screenshot-vault"    component={ScreenshotVaultPage}     scope="page:screenshot-vault" />
        <RoutedPage path="/setup-similarity"    component={SetupSimilarityPage}     scope="page:setup-similarity" />
        <RoutedPage path="/learning-loop"       component={LearningLoopPage}        scope="page:learning-loop" />
        <RoutedPage path="/position-monitor"    component={PositionMonitorPage}     scope="page:position-monitor" />
        <RoutedPage path="/allocation-engine"   component={AllocationEnginePage}    scope="page:allocation-engine" />
        <RoutedPage path="/correlation-risk"    component={CorrelationRiskPage}     scope="page:correlation-risk" />
        <RoutedPage path="/drawdown-protection" component={DrawdownProtectionPage}  scope="page:drawdown-protection" />
        <RoutedPage path="/risk-policies"       component={RiskPoliciesPage}        scope="page:risk-policies" />
        <RoutedPage path="/pretrade-gate"       component={PretradeGatePage}        scope="page:pretrade-gate" />
        <RoutedPage path="/capital-efficiency"  component={CapitalEfficiencyPage}   scope="page:capital-efficiency" />
        <RoutedPage path="/paper-trading"       component={PaperTradingPage}        scope="page:paper-trading" />
        <RoutedPage path="/assisted-trading"    component={AssistedTradingPage}     scope="page:assisted-trading" />
        <RoutedPage path="/semi-autonomous"     component={SemiAutonomousPage}      scope="page:semi-autonomous" />
        <RoutedPage path="/autonomous-mode"     component={AutonomousModePage}      scope="page:autonomous-mode" />
        <RoutedPage path="/slippage-quality"    component={SlippageQualityPage}     scope="page:slippage-quality" />
        <RoutedPage path="/emergency-controls"  component={EmergencyControlsPage}   scope="page:emergency-controls" />
        <RoutedPage path="/crypto-backtests"    component={CryptoBacktestsPage}     scope="page:crypto-backtests" />
        <RoutedPage path="/paper-trading-live"  component={PaperTradingLivePage}     scope="page:paper-trading-live" />

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
          <ModeBadge />
        </GlobalDataProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
