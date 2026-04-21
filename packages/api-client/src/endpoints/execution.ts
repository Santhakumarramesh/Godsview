import type { ApiClient } from "../client.js";

export interface Order {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  status: "pending" | "filled" | "cancelled" | "rejected";
  filledQuantity: number;
  filledPrice?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  createdAt: number;
}

export interface ExecutionEndpoints {
  submitOrder: (order: Omit<Order, "id" | "status" | "createdAt" | "updatedAt" | "filledQuantity">) => Promise<Order>;
  getOrders: () => Promise<{ orders: Order[] }>;
  getPositions: () => Promise<{ positions: Position[] }>;
  cancelOrder: (id: string) => Promise<{ success: boolean }>;
}

export function executionEndpoints(client: ApiClient): ExecutionEndpoints {
  return {
    submitOrder: (order) =>
      client.post<Order>("/v1/trades/paper", order),
    getOrders: () =>
      client.get<{ orders: Order[] }>("/v1/trades/orders"),
    getPositions: () =>
      client.get<{ positions: Position[] }>("/v1/trades/positions"),
    cancelOrder: (id: string) =>
      client.post<{ success: boolean }>(`/v1/trades/orders/${id}/cancel`),
  };
}
