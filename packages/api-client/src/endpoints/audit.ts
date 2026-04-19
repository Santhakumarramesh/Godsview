import type {
  AuditEventList,
  AuditEventQuery,
  AuditExport,
  AuditExportList,
  CreateAuditExportRequest,
} from "@gv/types";
import type { ApiClient } from "../client.js";

function buildQuery(query: AuditEventQuery | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface AuditEndpoints {
  listEvents: (query?: AuditEventQuery) => Promise<AuditEventList>;
  listExports: () => Promise<AuditExportList>;
  getExport: (id: string) => Promise<AuditExport>;
  createExport: (payload: CreateAuditExportRequest) => Promise<AuditExport>;
}

export function auditEndpoints(client: ApiClient): AuditEndpoints {
  return {
    listEvents: (query) =>
      client.get<AuditEventList>(`/admin/audit/events${buildQuery(query)}`),
    listExports: () => client.get<AuditExportList>("/admin/audit/exports"),
    getExport: (id) =>
      client.get<AuditExport>(`/admin/audit/exports/${encodeURIComponent(id)}`),
    createExport: (payload) =>
      client.post<AuditExport>("/admin/audit/exports", payload),
  };
}
