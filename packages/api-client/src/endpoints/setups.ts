import type {
  PaperTrade,
  Setup,
  SetupApprovalRequest,
  SetupFilter,
  SetupListItem,
  SetupRecallMatch,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface SetupListResponse {
  items: SetupListItem[];
  nextCursor: string | null;
  total: number;
}

export interface SetupDetailResponse {
  setup: Setup;
  recall: SetupRecallMatch[];
  /** Populated if the setup has already been approved in paper mode. */
  paperTrade: PaperTrade | null;
}

export interface SetupApprovalResponse {
  setup: Setup;
  paperTrade: PaperTrade;
}

export interface SetupEndpoints {
  /** GET /setups */
  list: (filter?: SetupFilter) => Promise<SetupListResponse>;
  /** GET /setups/:id */
  get: (setupId: string) => Promise<SetupDetailResponse>;
  /** GET /setups/:id/recall — just the similarity matches. */
  getRecall: (setupId: string, limit?: number) => Promise<SetupRecallMatch[]>;
  /** POST /setups/:id/approve */
  approve: (
    setupId: string,
    req?: SetupApprovalRequest,
  ) => Promise<SetupApprovalResponse>;
  /** POST /setups/:id/reject */
  reject: (setupId: string, note?: string) => Promise<{ setup: Setup }>;
}

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function setupEndpoints(client: ApiClient): SetupEndpoints {
  return {
    list: (filter = { limit: 50 } as SetupFilter) =>
      client.get<SetupListResponse>(`/setups${qs(filter)}`),
    get: (setupId) =>
      client.get<SetupDetailResponse>(
        `/setups/${encodeURIComponent(setupId)}`,
      ),
    getRecall: (setupId, limit = 10) =>
      client.get<SetupRecallMatch[]>(
        `/setups/${encodeURIComponent(setupId)}/recall${qs({ limit })}`,
      ),
    approve: (setupId, req = {} as SetupApprovalRequest) =>
      client.post<SetupApprovalResponse>(
        `/setups/${encodeURIComponent(setupId)}/approve`,
        req,
      ),
    reject: (setupId, note) =>
      client.post<{ setup: Setup }>(
        `/setups/${encodeURIComponent(setupId)}/reject`,
        { note },
      ),
  };
}
