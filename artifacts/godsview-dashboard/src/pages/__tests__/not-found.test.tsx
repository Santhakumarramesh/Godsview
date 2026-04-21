/**
 * Smoke test for the 404 page.
 *
 * This is the simplest possible page in the dashboard — no React Query,
 * no SSE, no design-tokens module. It serves as a "does the test
 * infrastructure itself work" canary: if this test fails, something is
 * wrong with the vitest / jsdom / testing-library setup, not with the
 * page under test.
 */
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import NotFound from "../not-found";
import { renderPage } from "../../test/render";

describe("NotFound page", () => {
  it("renders the 404 title without throwing", () => {
    renderPage(<NotFound />);
    expect(screen.getByText(/404 Page Not Found/i)).toBeInTheDocument();
  });

  it("renders the helper copy", () => {
    renderPage(<NotFound />);
    expect(
      screen.getByText(/forget to add the page to the router/i)
    ).toBeInTheDocument();
  });
});
