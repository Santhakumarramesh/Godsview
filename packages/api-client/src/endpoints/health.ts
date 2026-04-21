import type { ApiClient } from "../client.js";

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  service: string;
  version: string;
  uptimeSeconds: number;
  checks: Record<string, { status: "ok" | "degraded" | "down"; detail?: string }>;
}

export interface HealthEndpoints {
  live: () => Promise<{ status: "ok" }>;
  ready: () => Promise<HealthReport>;
}

export function healthEndpoints(client: ApiClient): HealthEndpoints {
  return {
    live: () => client.get<{ status: "ok" }>("/health/live"),
    ready: () => client.get<HealthReport>("/health/ready"),
  };
}
