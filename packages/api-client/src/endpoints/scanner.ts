import type { ApiClient } from "../client.js";

export interface ScanCandidate {
  symbol: string;
  score: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ScannerEndpoints {
  getScanResults: () => Promise<{ candidates: ScanCandidate[] }>;
}

export function scannerEndpoints(client: ApiClient): ScannerEndpoints {
  return {
    getScanResults: () =>
      client.get<{ candidates: ScanCandidate[] }>("/v1/scanner/results"),
  };
}
