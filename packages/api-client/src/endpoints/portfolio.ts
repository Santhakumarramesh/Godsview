/**
 * @gv/api-client — Phase 6 portfolio intelligence endpoints.
 *
 * Surfaces served by services/control_plane/app/routes/portfolio.py:
 *
 *   api.portfolio.exposure    — per-symbol + per-correlation-class exposure
 *   api.portfolio.allocation  — strategy allocation plan (read + mutate)
 *   api.portfolio.pnl         — daily PnL timeseries + summary
 *   api.portfolio.accounts    — account selector projection
 *
 * The portfolio layer is read-biased — everything *except* allocation
 * updates is a pure projection of Phase 4 execution state
 * (`positions`, `live_trades`, `account_equity_snapshots`). The
 * `setAllocation` route writes an `AllocationPlan` row that the next
 * ranking pass consults.
 */
import type {
  AllocationPlan,
  AllocationPlanFilter,
  AllocationUpdateRequest,
  PortfolioAccountsList,
  PortfolioExposureFilter,
  PortfolioExposureReport,
  PortfolioPnlFilter,
  PortfolioPnlReport,
} from "@gv/types";
import type { ApiClient } from "../client.js";

// ───────────────────────────── query-string helper ──────────────────────

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ───────────────────────────── exposure ─────────────────────────────────

export interface PortfolioExposureEndpoints {
  /** GET /portfolio/exposure — per-account exposure report. */
  get: (
    filter?: PortfolioExposureFilter,
  ) => Promise<PortfolioExposureReport>;
}

export function portfolioExposureEndpoints(
  client: ApiClient,
): PortfolioExposureEndpoints {
  return {
    get: (filter = {}) =>
      client.get<PortfolioExposureReport>(
        `/portfolio/exposure${qs(filter)}`,
      ),
  };
}

// ───────────────────────────── allocation ───────────────────────────────

export interface PortfolioAllocationEndpoints {
  /** GET /portfolio/allocation — latest plan for the scoped account. */
  plan: (filter?: AllocationPlanFilter) => Promise<AllocationPlan>;
  /**
   * POST /portfolio/allocation — admin-gated. Sets a target percent for
   * a single strategy. The allocator re-reviews all rows on next tick.
   */
  setAllocation: (req: AllocationUpdateRequest) => Promise<AllocationPlan>;
  /**
   * POST /portfolio/allocation/rebalance — admin-gated. Forces the
   * allocator to recompute every row from current equity + active
   * strategy tiers.
   */
  rebalance: (opts?: { accountId?: string }) => Promise<AllocationPlan>;
}

export function portfolioAllocationEndpoints(
  client: ApiClient,
): PortfolioAllocationEndpoints {
  return {
    plan: (filter = {}) =>
      client.get<AllocationPlan>(`/portfolio/allocation${qs(filter)}`),
    setAllocation: (req) =>
      client.post<AllocationPlan>(`/portfolio/allocation`, req),
    rebalance: (opts = {}) =>
      client.post<AllocationPlan>(
        `/portfolio/allocation/rebalance${qs(opts)}`,
        {},
      ),
  };
}

// ───────────────────────────── PnL ──────────────────────────────────────

export interface PortfolioPnlEndpoints {
  /**
   * GET /portfolio/pnl — daily PnL timeseries + summary. Filter by
   * account and date range; unbounded ranges clamp to the last 90 days
   * server-side.
   */
  report: (filter?: PortfolioPnlFilter) => Promise<PortfolioPnlReport>;
}

export function portfolioPnlEndpoints(
  client: ApiClient,
): PortfolioPnlEndpoints {
  return {
    report: (filter = {}) =>
      client.get<PortfolioPnlReport>(`/portfolio/pnl${qs(filter)}`),
  };
}

// ───────────────────────────── accounts ─────────────────────────────────

export interface PortfolioAccountsEndpoints {
  /** GET /portfolio/accounts — selector projection. */
  list: () => Promise<PortfolioAccountsList>;
}

export function portfolioAccountsEndpoints(
  client: ApiClient,
): PortfolioAccountsEndpoints {
  return {
    list: () =>
      client.get<PortfolioAccountsList>(`/portfolio/accounts`),
  };
}
