import type { ApiClient } from "../client.js";

export interface WebhookEvent {
  id: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface PineScript {
  id: string;
  name: string;
  code: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StrategySync {
  id: string;
  strategyName: string;
  lastSync: number;
  status: "active" | "inactive" | "error";
  syncedSignals: number;
}

export interface TVAction {
  id: string;
  actionType: string;
  payload: Record<string, unknown>;
  status: "pending" | "executed" | "failed";
  createdAt: number;
  executedAt?: number;
}

export interface TradingViewEndpoints {
  sendWebhook: (data: Record<string, unknown>) => Promise<{ success: boolean }>;
  getWebhookEvents: (limit?: number) => Promise<{ events: WebhookEvent[] }>;
  listPineScripts: () => Promise<{ scripts: PineScript[] }>;
  registerPineScript: (data: {
    name: string;
    code: string;
    description?: string;
  }) => Promise<PineScript>;
  getStrategySyncs: () => Promise<{ syncs: StrategySync[] }>;
  createTVAction: (data: Record<string, unknown>) => Promise<TVAction>;
  getTVActions: () => Promise<{ actions: TVAction[] }>;
}

export function tradingViewEndpoints(client: ApiClient): TradingViewEndpoints {
  return {
    sendWebhook: (data: Record<string, unknown>) =>
      client.post<{ success: boolean }>("/v1/webhooks/tradingview", data),
    getWebhookEvents: (limit?: number) =>
      client.get<{ events: WebhookEvent[] }>(
        `/v1/webhooks/events?limit=${limit || 50}`
      ),
    listPineScripts: () =>
      client.get<{ scripts: PineScript[] }>("/v1/pine-scripts"),
    registerPineScript: (data: {
      name: string;
      code: string;
      description?: string;
    }) => client.post<PineScript>("/v1/pine-scripts", data),
    getStrategySyncs: () =>
      client.get<{ syncs: StrategySync[] }>("/v1/strategy-sync"),
    createTVAction: (data: Record<string, unknown>) =>
      client.post<TVAction>("/v1/actions", data),
    getTVActions: () => client.get<{ actions: TVAction[] }>("/v1/actions"),
  };
}
