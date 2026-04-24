import type { ApiClient } from "../client.js";

export interface FeatureData {
  symbol: string;
  features: Record<string, number>;
  timestamp: number;
}

export interface SignalData {
  symbol: string;
  signals: Record<string, number | boolean>;
  confidence: number;
  timestamp: number;
}

export interface FeaturesEndpoints {
  getFeatures: (symbol: string) => Promise<FeatureData>;
  getSignals: (symbol: string) => Promise<SignalData>;
}

export function featuresEndpoints(client: ApiClient): FeaturesEndpoints {
  return {
    getFeatures: (symbol: string) =>
      client.get<FeatureData>(`/v1/features/${symbol}`),
    getSignals: (symbol: string) =>
      client.get<SignalData>(`/v1/signals/${symbol}`),
  };
}
