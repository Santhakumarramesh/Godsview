import type { ApiClient } from "../client.js";

export interface SystemConfig {
  environment: string;
  apiVersion: string;
  dataSource: string;
  paperTrading: boolean;
  maxConnections: number;
  riskLimits: Record<string, unknown>;
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description?: string;
  rolloutPercent?: number;
}

export interface AuditEvent {
  id: string;
  action: string;
  user?: string;
  resource: string;
  details: Record<string, unknown>;
  timestamp: number;
}

export interface AuditEndpoints {
  getSystemConfig: () => Promise<SystemConfig>;
  getFeatureFlags: () => Promise<{ flags: FeatureFlag[] }>;
  getAuditEvents: (limit?: number) => Promise<{ events: AuditEvent[] }>;
}

export function auditEndpoints(client: ApiClient): AuditEndpoints {
  return {
    getSystemConfig: () =>
      client.get<SystemConfig>("/v1/system-config"),
    getFeatureFlags: () =>
      client.get<{ flags: FeatureFlag[] }>("/v1/feature-flags"),
    getAuditEvents: (limit?: number) =>
      client.get<{ events: AuditEvent[] }>(
        `/v1/audit/events?limit=${limit || 50}`
      ),
  };
}
