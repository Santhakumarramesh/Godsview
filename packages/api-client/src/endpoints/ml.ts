import type { ApiClient } from "../client.js";

export interface Prediction {
  symbol: string;
  direction: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  targetPrice?: number;
  features: Record<string, number>;
  timestamp: number;
}

export interface ModelStatus {
  modelId: string;
  version: string;
  status: "training" | "active" | "inactive" | "error";
  accuracy?: number;
  lastUpdated: number;
  nextRetraining?: number;
}

export interface MLEndpoints {
  getPrediction: (symbol: string) => Promise<Prediction>;
  getModelStatus: () => Promise<{ models: ModelStatus[] }>;
}

export function mlEndpoints(client: ApiClient): MLEndpoints {
  return {
    getPrediction: (symbol: string) =>
      client.get<Prediction>(`/v1/ml/predict/${symbol}`),
    getModelStatus: () =>
      client.get<{ models: ModelStatus[] }>("/v1/ml/status"),
  };
}
