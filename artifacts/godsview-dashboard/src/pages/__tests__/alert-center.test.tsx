/**
 * Smoke test for the Alert Center page (Phase 8 + 9).
 *
 * This is the most wired-up page in the dashboard: it subscribes to SSE
 * via useAlertStream, invalidates six query keys on push events, and
 * renders six query-backed sub-components (summary, active feed, rules,
 * channels, escalation, anomalies). It's the best single-page smoke test
 * for proving that React Query + SSE + MSW interop is green.
 *
 * The FakeEventSource shim in src/test/setup.ts keeps the SSE subscription
 * from hitting the network; the MSW handlers in src/test/msw-handlers.ts
 * serve the six query endpoints with shapes that match the Phase 8 API.
 */
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import AlertCenterPage from "../alert-center";
import { renderPage } from "../../test/render";

describe("AlertCenterPage", () => {
  it("renders the dashboard header without throwing", async () => {
    renderPage(<AlertCenterPage />);
    // The top banner renders "Alert Center Dashboard" unconditionally.
    expect(
      await screen.findByText(/Alert Center Dashboard/i)
    ).toBeInTheDocument();
  });

  it("renders a live connection badge", async () => {
    renderPage(<AlertCenterPage />);
    // The badge shows one of: Live / Connecting / Offline / Reconnecting.
    // Our FakeEventSource transitions CONNECTING → OPEN in a microtask, so
    // either "Connecting" (first paint) or "Live" (after hook effect) is
    // acceptable.
    await waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(/Live|Connecting|Offline|Reconnecting/i.test(text)).toBe(true);
    });
  });

  it("shows at least one metric pill from the summary endpoint", async () => {
    renderPage(<AlertCenterPage />);
    // From msw-handlers.ts alertSummaryDefault: totalActive=3, healthScore=92.
    await waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toMatch(/Total Active/i);
    });
  });
});
