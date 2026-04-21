import type {
  Alert,
  AlertList,
  CreateSloRequest,
  Deployment,
  DeploymentList,
  Incident,
  IncidentList,
  IncidentStatus,
  LatencySeries,
  LogTail,
  Slo,
  SloList,
} from "@gv/types";
import type { ApiClient } from "../client.js";

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null,
  );
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

export interface OpsEndpoints {
  // SLOs
  listSlos: () => Promise<SloList>;
  createSlo: (payload: CreateSloRequest) => Promise<Slo>;
  updateSlo: (id: string, patch: Partial<CreateSloRequest>) => Promise<Slo>;
  // Alerts
  listAlerts: (filters?: { status?: string; severity?: string; limit?: number }) => Promise<AlertList>;
  createAlert: (payload: {
    severity: string;
    title: string;
    description?: string;
    sloKey?: string | null;
    runbookUrl?: string | null;
    details?: Record<string, unknown>;
  }) => Promise<Alert>;
  acknowledgeAlert: (id: string) => Promise<Alert>;
  resolveAlert: (id: string) => Promise<Alert>;
  // Incidents
  listIncidents: () => Promise<IncidentList>;
  createIncident: (payload: {
    code: string;
    title: string;
    severity: string;
    summary?: string;
  }) => Promise<Incident>;
  updateIncident: (
    id: string,
    patch: {
      title?: string;
      severity?: string;
      status?: IncidentStatus;
      summary?: string;
      postmortemUrl?: string;
      ownerUserId?: string;
    },
  ) => Promise<Incident>;
  // Deployments
  listDeployments: (filters?: {
    service?: string;
    environment?: string;
    limit?: number;
  }) => Promise<DeploymentList>;
  createDeployment: (payload: {
    service: string;
    version: string;
    environment: string;
    status?: string;
    initiator?: string;
    commitSha?: string;
    rollbackOf?: string;
  }) => Promise<Deployment>;
  // Latency + Logs
  getLatency: (params: {
    service: string;
    operation?: string;
    windowSeconds?: number;
    buckets?: number;
  }) => Promise<LatencySeries>;
  tailLogs: (params?: { limit?: number; level?: string }) => Promise<LogTail>;
}

export function opsEndpoints(client: ApiClient): OpsEndpoints {
  return {
    listSlos: () => client.get<SloList>("/admin/ops/slos"),
    createSlo: (payload) => client.post<Slo>("/admin/ops/slos", payload),
    updateSlo: (id, patch) =>
      client.patch<Slo>(`/admin/ops/slos/${encodeURIComponent(id)}`, patch),
    listAlerts: (filters) =>
      client.get<AlertList>(
        `/admin/ops/alerts${qs({
          status: filters?.status,
          severity: filters?.severity,
          limit: filters?.limit,
        })}`,
      ),
    createAlert: (payload) => client.post<Alert>("/admin/ops/alerts", payload),
    acknowledgeAlert: (id) =>
      client.post<Alert>(
        `/admin/ops/alerts/${encodeURIComponent(id)}/acknowledge`,
      ),
    resolveAlert: (id) =>
      client.post<Alert>(`/admin/ops/alerts/${encodeURIComponent(id)}/resolve`),
    listIncidents: () => client.get<IncidentList>("/admin/ops/incidents"),
    createIncident: (payload) =>
      client.post<Incident>("/admin/ops/incidents", payload),
    updateIncident: (id, patch) =>
      client.patch<Incident>(
        `/admin/ops/incidents/${encodeURIComponent(id)}`,
        patch,
      ),
    listDeployments: (filters) =>
      client.get<DeploymentList>(
        `/admin/ops/deployments${qs({
          service: filters?.service,
          environment: filters?.environment,
          limit: filters?.limit,
        })}`,
      ),
    createDeployment: (payload) =>
      client.post<Deployment>("/admin/ops/deployments", payload),
    getLatency: (params) =>
      client.get<LatencySeries>(
        `/admin/ops/latency${qs({
          service: params.service,
          operation: params.operation,
          windowSeconds: params.windowSeconds,
          buckets: params.buckets,
        })}`,
      ),
    tailLogs: (params) =>
      client.get<LogTail>(
        `/admin/ops/logs${qs({ limit: params?.limit, level: params?.level })}`,
      ),
  };
}
