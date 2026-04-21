import type { ApiClient } from "../client.js";

export interface BacktestConfig {
  symbol: string;
  strategy: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  parameters?: Record<string, unknown>;
}

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  createdAt: number;
  completedAt?: number;
}

export interface BacktestEndpoints {
  runBacktest: (config: BacktestConfig) => Promise<BacktestResult>;
  getBacktestResults: () => Promise<{ results: BacktestResult[] }>;
  getBacktestResult: (id: string) => Promise<BacktestResult>;
}

export function backtestEndpoints(client: ApiClient): BacktestEndpoints {
  return {
    runBacktest: (config: BacktestConfig) =>
      client.post<BacktestResult>("/v1/backtest/run", config),
    getBacktestResults: () =>
      client.get<{ results: BacktestResult[] }>("/v1/backtest/results"),
    getBacktestResult: (id: string) =>
      client.get<BacktestResult>(`/v1/backtest/results/${id}`),
  };
}
