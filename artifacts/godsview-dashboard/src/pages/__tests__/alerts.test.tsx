/**
 * Smoke test for the Alerts page.
 *
 * This page is a good second test because:
 *   - it uses three `useQuery` hooks (active / history / stream-status)
 *   - it opens a raw `EventSource` in an effect (our FakeEventSource shim
 *     validates that code path doesn't throw)
 *   - it uses `useMutation` for ack flow
 *
 * We only assert the header renders — exhaustive list-rendering coverage
 * is delegated to the api-server contract tests.
 */
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import AlertsPage from "../alerts";
import { renderPage } from "../../test/render";

describe("AlertsPage", () => {
  it("renders the header 'Alerts & Live Stream'", async () => {
    renderPage(<AlertsPage />);
    expect(
      await screen.findByText(/Alerts & Live Stream/i)
    ).toBeInTheDocument();
  });

  it("renders tab buttons", async () => {
    renderPage(<AlertsPage />);
    // Three tabs: Active (N), History, Live Feed
    await screen.findByRole("button", { name: /History/i });
    await screen.findByRole("button", { name: /Live Feed/i });
  });
});
