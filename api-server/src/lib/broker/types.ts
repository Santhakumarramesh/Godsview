/**
 * Broker Abstraction Layer — Type Definitions
 * Supports multi-broker routing for stocks, crypto, forex, futures, options
 */

export type BrokerName = "alpaca" | "interactive_brokers" | "binance" | "generic_rest";
export type AssetClass = "crypto" | "stocks" | "forex" | "futures" | "options";

export interface BrokerCredentials {
  apiKey: string;
  secretKey: string;
  baseUrl?: string;
  paper?: boolean;
}

export interface BrokerOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit" | "stop" | "stop_limit";
  timeInForce: "day" | "gtc" | "ioc" | "fok";
  limitPrice?: number;
  stopPrice?: number;
  clientOrderId?: string;
}

export interface BrokerOrderResponse {
  id: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  filledQty: number;
  type: string;
  status: "new" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
  filledAvgPrice?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  side: "long" | "short";
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  marketValue: number;
}

export interface BrokerAccountInfo {
  id: string;
  currency: string;
  cash: number;
  portfolioValue: number;
  buyingPower: number;
  daytradeCount?: number;
  patternDayTrader?: boolean;
}

export interface BrokerAdapter {
  readonly name: BrokerName;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  submitOrder(req: BrokerOrderRequest): Promise<BrokerOrderResponse>;
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<BrokerOrderResponse>;
  getOpenOrders(): Promise<BrokerOrderResponse[]>;
  getPositions(): Promise<BrokerPosition[]>;
  getPosition(symbol: string): Promise<BrokerPosition | null>;
  closePosition(symbol: string): Promise<void>;
  getAccountInfo(): Promise<BrokerAccountInfo>;
}
