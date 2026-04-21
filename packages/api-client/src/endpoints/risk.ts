import type { ApiClient } from "../client.js";

export interface RiskCheck {
  orderId: string;
  passed: boolean;
  checks: Array<{
    name: string;
    status: "passed" | "failed" | "warning";
    details?: string;
  }>;
}

export interface RiskPolicy {
  id: string;
  name: string;
  description?: string;
  maxPositionSize?: number;
  maxDailyLoss?: number;
  maxLeverage?: number;
  enabled: boolean;
}

export interface KillSwitchStatus {
  active: boolean;
  triggeredAt?: number;
  reason?: string;
}

export interface RiskEndpoints {
  getRiskChecks: (orderId: string) => Promise<RiskCheck>;
  getRiskPolicies: () => Promise<{ policies: RiskPolicy[] }>;
  getKillSwitchStatus: () => Promise<KillSwitchStatus>;
  triggerKillSwitch: () => Promise<{ success: boolean }>;
}

export function riskEndpoints(client: ApiClient): RiskEndpoints {
  return {
    getRiskChecks: (orderId: string) =>
      client.get<RiskCheck>(`/v1/risk/check/${orderId}`),
    getRiskPolicies: () =>
      client.get<{ policies: RiskPolicy[] }>("/v1/risk/policies"),
    getKillSwitchStatus: () =>
      client.get<KillSwitchStatus>("/v1/risk/killswitch"),
    triggerKillSwitch: () =>
      client.post<{ success: boolean }>("/v1/risk/killswitch"),
  };
}
