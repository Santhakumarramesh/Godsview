import type { ApiClient } from "../client.js";

export interface PortfolioSnapshot {
  totalValue: number;
  totalInvested: number;
  totalPnL: number;
  totalPnLPercent: number;
  cash: number;
  positions: number;
  timestamp: number;
}

export interface AllocationItem {
  symbol: string;
  allocation: number;
  weight: number;
}

export interface PortfolioEndpoints {
  getPortfolioSnapshot: () => Promise<PortfolioSnapshot>;
  getAllocations: () => Promise<{ allocations: AllocationItem[] }>;
}

export function portfolioEndpoints(client: ApiClient): PortfolioEndpoints {
  return {
    getPortfolioSnapshot: () =>
      client.get<PortfolioSnapshot>("/v1/portfolio/snapshot"),
    getAllocations: () =>
      client.get<{ allocations: AllocationItem[] }>("/v1/portfolio/allocations"),
  };
}
