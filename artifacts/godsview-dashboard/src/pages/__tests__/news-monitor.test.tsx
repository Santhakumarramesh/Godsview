/**
 * Smoke test — News Monitor page.
 *
 * Exercises the WebSocket-backed live-feed pattern:
 *   - No useQuery at mount time (news items are local-state seeded)
 *   - `new WebSocket(...)` call in useEffect — relies on the
 *     FakeWebSocket shim in src/test/setup.ts to not throw under jsdom
 *
 * Proves the WebSocket shim lets pages with live-stream integrations
 * mount cleanly in the smoke harness.
 */
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import NewsMonitor from "../news-monitor";
import { renderPage } from "../../test/render";

describe("News Monitor page", () => {
  it("renders the page header without throwing", () => {
    renderPage(<NewsMonitor />, { initialPath: "/news-monitor" });
    // The header renders synchronously — no async data needed.
    expect(
      screen.getByText(/News Monitor/i, { selector: "h2" })
    ).toBeInTheDocument();
  });

  it("renders the headline search input", () => {
    renderPage(<NewsMonitor />, { initialPath: "/news-monitor" });
    expect(
      screen.getByPlaceholderText(/Search headlines/i)
    ).toBeInTheDocument();
  });
});
