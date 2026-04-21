import type { ApiClient } from "../client.js";

export interface MemoryEntry {
  id: string;
  symbol: string;
  data: Record<string, unknown>;
  similarity?: number;
  timestamp: number;
}

export interface RecentSignal {
  symbol: string;
  signal: string;
  confidence: number;
  timestamp: number;
}

export interface MemoryEndpoints {
  storeMemory: (data: Record<string, unknown>) => Promise<{ id: string }>;
  searchSimilar: (symbol: string) => Promise<{ results: MemoryEntry[] }>;
  getRecentSignals: () => Promise<{ signals: RecentSignal[] }>;
}

export function memoryEndpoints(client: ApiClient): MemoryEndpoints {
  return {
    storeMemory: (data: Record<string, unknown>) =>
      client.post<{ id: string }>("/v1/memory/store", data),
    searchSimilar: (symbol: string) =>
      client.get<{ results: MemoryEntry[] }>(
        `/v1/memory/similar?symbol=${symbol}`
      ),
    getRecentSignals: () =>
      client.get<{ signals: RecentSignal[] }>("/v1/memory/recent"),
  };
}
