import type { ApiClient } from "../client.js";

export interface FlowSnapshot {
  symbol: string;
  timestamp: number;
  buyVolume: number;
  sellVolume: number;
  netVolume: number;
  imbalance: number;
}

export interface FlowHeatmap {
  symbol: string;
  data: number[][];
  timeframe: string;
  timestamp: number;
}

export interface FlowDOM {
  symbol: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  timestamp: number;
}

export interface FlowFootprint {
  symbol: string;
  levels: Array<{
    price: number;
    buyVolume: number;
    sellVolume: number;
    netVolume: number;
  }>;
  timestamp: number;
}

export interface FlowAbsorption {
  symbol: string;
  largeOrderAbsorption: number;
  institutionalActivity: number;
  timestamp: number;
}

export interface FlowImbalance {
  symbol: string;
  bidAskImbalance: number;
  volumeImbalance: number;
  pressureIndex: number;
  timestamp: number;
}

export interface FlowPressure {
  symbol: string;
  buyingPressure: number;
  sellingPressure: number;
  pressureRatio: number;
  timestamp: number;
}

export interface FlowConfluence {
  symbol: string;
  confluenceLevels: Array<{ price: number; strength: number }>;
  majorSupport: number[];
  majorResistance: number[];
  timestamp: number;
}

export interface FlowEndpoints {
  getFlowSnapshot: (symbol: string) => Promise<FlowSnapshot>;
  getFlowHeatmap: (symbol: string) => Promise<FlowHeatmap>;
  getFlowDOM: (symbol: string) => Promise<FlowDOM>;
  getFlowFootprint: (symbol: string) => Promise<FlowFootprint>;
  getFlowAbsorption: (symbol: string) => Promise<FlowAbsorption>;
  getFlowImbalance: (symbol: string) => Promise<FlowImbalance>;
  getFlowPressure: (symbol: string) => Promise<FlowPressure>;
  getFlowConfluence: (symbol: string) => Promise<FlowConfluence>;
}

export function flowEndpoints(client: ApiClient): FlowEndpoints {
  return {
    getFlowSnapshot: (symbol: string) =>
      client.get<FlowSnapshot>(`/v1/flow/${symbol}/snapshot`),
    getFlowHeatmap: (symbol: string) =>
      client.get<FlowHeatmap>(`/v1/flow/${symbol}/heatmap`),
    getFlowDOM: (symbol: string) =>
      client.get<FlowDOM>(`/v1/flow/${symbol}/dom`),
    getFlowFootprint: (symbol: string) =>
      client.get<FlowFootprint>(`/v1/flow/${symbol}/footprint`),
    getFlowAbsorption: (symbol: string) =>
      client.get<FlowAbsorption>(`/v1/flow/${symbol}/absorption`),
    getFlowImbalance: (symbol: string) =>
      client.get<FlowImbalance>(`/v1/flow/${symbol}/imbalance`),
    getFlowPressure: (symbol: string) =>
      client.get<FlowPressure>(`/v1/flow/${symbol}/pressure`),
    getFlowConfluence: (symbol: string) =>
      client.get<FlowConfluence>(`/v1/flow/${symbol}/confluence`),
  };
}
