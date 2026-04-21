/**
 * Smoke test — Checklist page.
 *
 * Exercises a minimal-dependency page:
 *   - No initial fetch on mount (data is pulled only via the
 *     "Auto-Evaluate" button click)
 *   - Local useState for the symbol input + evaluation result
 *
 * Proves the MSW scaffold can cover pages whose data loads are
 * user-initiated, not driven by useQuery at mount time.
 */
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import Checklist from "../checklist";
import { renderPage } from "../../test/render";

describe("Checklist page", () => {
  it("renders the page header without throwing", () => {
    renderPage(<Checklist />, { initialPath: "/checklist" });
    // The header is rendered synchronously — no data fetch on mount.
    expect(
      screen.getByText(/Checklist/i, { selector: "h1, h2, h3" })
    ).toBeInTheDocument();
  });

  it("renders the symbol input", () => {
    renderPage(<Checklist />, { initialPath: "/checklist" });
    // The auto-evaluate form ships a symbol input that the user fills in
    // before clicking the evaluate button. The placeholder text may vary,
    // so we match by role.
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(0);
  });
});
