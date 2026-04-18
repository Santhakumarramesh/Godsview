import React, { type ErrorInfo, type ReactNode, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import { GlobalDataProvider } from "@/components/GlobalDataProvider";
import { NotificationSystem } from "@/components/NotificationSystem";
import { RoleProvider } from "@/auth/role-context";
import { RouteGuard } from "@/auth/route-guard";
import { PAGE_MANIFEST, type PageManifestEntry } from "@/pages/page-manifest";

// ── Eager: primary landing page (fastest first paint) ───────────────────────
import Dashboard from "@/pages/dashboard";

// ── Lazy: 404 fallback ──────────────────────────────────────────────────────
const NotFound = React.lazy(() => import("@/pages/not-found"));

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

// ── Route wrapper: Suspense + ErrorBoundary + RBAC per page ─────────────────
function ManifestRoute({ entry }: { entry: PageManifestEntry }) {
  const Component = entry.component;
  const body = (
    <AppErrorBoundary scope={entry.scope}>
      <Suspense fallback={<PageSkeleton />}>
        <Component />
      </Suspense>
    </AppErrorBoundary>
  );

  return (
    <Route path={entry.path}>
      {entry.minRole === "viewer" ? body : (
        <RouteGuard required={entry.minRole}>{body}</RouteGuard>
      )}
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

        {PAGE_MANIFEST.map((entry) => (
          <ManifestRoute key={entry.path} entry={entry} />
        ))}

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
        <RoleProvider>
          <GlobalDataProvider>
            <AppErrorBoundary scope="app-root">
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
            </AppErrorBoundary>
            <NotificationSystem />
          </GlobalDataProvider>
        </RoleProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
