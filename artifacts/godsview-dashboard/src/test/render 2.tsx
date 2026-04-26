/**
 * Shared test render helper. Wraps a page component in the minimum set of
 * providers it needs (React Query + wouter Router) so smoke tests can focus
 * on "does this page render without throwing".
 *
 * Usage:
 *
 *     import { renderPage } from "../test/render";
 *     import AlertCenterPage from "./alert-center";
 *
 *     it("renders without crashing", async () => {
 *       renderPage(<AlertCenterPage />);
 *       await screen.findByText(/alert/i);
 *     });
 */
import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

export interface RenderPageOptions extends Omit<RenderOptions, "wrapper"> {
  initialPath?: string;
}

export function renderPage(ui: ReactElement, options: RenderPageOptions = {}) {
  const { initialPath = "/", ...rest } = options;

  // One fresh QueryClient per render keeps state from leaking between
  // tests. `retry: false` makes failed queries surface immediately rather
  // than retrying three times with backoff (which slows tests).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 0,
      },
      mutations: { retry: false },
    },
  });

  // wouter's <Router> uses window.history by default; memory mode would be
  // ideal but wouter keeps its history module internal. For smoke tests we
  // set the pathname directly before mounting.
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", initialPath);
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <Router>{ui}</Router>
    </QueryClientProvider>,
    rest
  );
}
