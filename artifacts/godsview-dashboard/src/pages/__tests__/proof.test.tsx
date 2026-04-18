/**
 * Smoke test — Proof Dashboard.
 *
 * Exercises the single-query page pattern:
 *   - One useQuery against `/api/proof/dashboard?days=N`
 *   - Loading spinner while the query resolves, then the real view
 *
 * Proves the MSW handler for `/api/proof/dashboard` returns a shape the
 * page can consume end-to-end without crashing the chart components
 * (recharts) under jsdom.
 */
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import Proof from "../proof";
import { renderPage } from "../../test/render";

describe("Proof Dashboard page", () => {
  it("renders the page header and loads data without throwing", async () => {
    renderPage(<Proof />, { initialPath: "/proof" });

    // Header is rendered synchronously alongside the loading spinner.
    expect(
      screen.getByText(/Proof Dashboard/i, { selector: "h1" })
    ).toBeInTheDocument();

    // After the useQuery resolves, the summary cards should appear.
    // We assert on the "Overall Win Rate" label which is text-only — no
    // chart rendering required to pass.
    expect(
      await screen.findByText(/Overall Win Rate/i)
    ).toBeInTheDocument();
  });

  it("renders the day-range toggle buttons", () => {
    renderPage(<Proof />, { initialPath: "/proof" });
    // DAY_OPTIONS = [7, 14, 30, 60, 90]; the 30d button is default-selected.
    expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "90d" })).toBeInTheDocument();
  });
});
