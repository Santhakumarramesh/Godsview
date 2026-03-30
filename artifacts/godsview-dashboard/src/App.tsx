import React, { type ErrorInfo, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Signals from "@/pages/signals";
import Trades from "@/pages/trades";
import Performance from "@/pages/performance";
import System from "@/pages/system";
import AlpacaPage from "@/pages/alpaca";
import InfinityPage from "@/pages/infinity";
import BrainPage from "@/pages/brain";
import StitchLabPage from "@/pages/stitch-lab";
import PipelinePage from "@/pages/pipeline";
import CandleXRayPage from "@/pages/candle-xray";
import SetupExplorerPage from "@/pages/setup-explorer";
import ReportsPage from "@/pages/reports";
import RiskPage from "@/pages/risk";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

class AppErrorBoundary extends React.Component<
  { children: ReactNode; scope: string },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode; scope: string }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: String(error ?? "Unknown UI error"),
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error(`[ui-error:${this.props.scope}]`, error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#0e0e0f]">
        <div className="max-w-xl w-full rounded border border-red-500/30 bg-[#181719] p-6 space-y-4">
          <div className="text-xs uppercase tracking-[0.2em] text-red-300">Godsview UI Fault</div>
          <h1 className="text-2xl font-bold">UI component crashed</h1>
          <p className="text-sm text-zinc-300">
            Scope: <span className="font-mono">{this.props.scope}</span>
          </p>
          <pre className="text-xs bg-black/30 border border-zinc-700 rounded p-3 overflow-x-auto text-zinc-300">
            {this.state.message}
          </pre>
          <button
            onClick={this.handleReload}
            className="px-4 py-2 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/30"
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }
}

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
        <Component />
      </AppErrorBoundary>
    </Route>
  );
}

function Router() {
  return (
    <Shell>
      <Switch>
        <RoutedPage path="/" component={Dashboard} scope="page:dashboard" />
        <RoutedPage path="/signals" component={Signals} scope="page:signals" />
        <RoutedPage path="/trades" component={Trades} scope="page:trades" />
        <RoutedPage path="/performance" component={Performance} scope="page:performance" />
        <RoutedPage path="/system" component={System} scope="page:system" />
        <RoutedPage path="/alpaca" component={AlpacaPage} scope="page:alpaca" />
        <RoutedPage path="/infinity" component={InfinityPage} scope="page:infinity" />
        <RoutedPage path="/brain" component={BrainPage} scope="page:brain" />
        <RoutedPage path="/stitch-lab" component={StitchLabPage} scope="page:stitch-lab" />
        <RoutedPage path="/pipeline" component={PipelinePage} scope="page:pipeline" />
        <RoutedPage path="/candle-xray" component={CandleXRayPage} scope="page:candle-xray" />
        <RoutedPage path="/setup-explorer" component={SetupExplorerPage} scope="page:setup-explorer" />
        <RoutedPage path="/reports" component={ReportsPage} scope="page:reports" />
        <RoutedPage path="/risk" component={RiskPage} scope="page:risk" />
        <Route>
          <AppErrorBoundary scope="page:not-found">
            <NotFound />
          </AppErrorBoundary>
        </Route>
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppErrorBoundary scope="app-root">
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AppErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
