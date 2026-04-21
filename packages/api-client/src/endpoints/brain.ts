import type { ApiClient } from "../client.js";

export interface BrainNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  z?: number;
  value?: number;
  color?: string;
}

export interface BrainEdge {
  source: string;
  target: string;
  weight: number;
  type?: string;
}

export interface BrainGraph {
  nodes: BrainNode[];
  edges: BrainEdge[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface BrainEndpoints {
  getBrainGraph: () => Promise<BrainGraph>;
  getBrainStreamUrl: () => string;
}

export function brainEndpoints(client: ApiClient): BrainEndpoints {
  return {
    getBrainGraph: () =>
      client.get<BrainGraph>("/v1/brain/graph"),
    getBrainStreamUrl: () => `${client.baseUrl}/v1/brain/stream`,
  };
}
