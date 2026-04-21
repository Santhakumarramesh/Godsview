import type {
  CreateMcpServerRequest,
  McpServer,
  McpServerList,
  UpdateMcpServerRequest,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface McpEndpoints {
  list: () => Promise<McpServerList>;
  create: (payload: CreateMcpServerRequest) => Promise<McpServer>;
  update: (id: string, patch: UpdateMcpServerRequest) => Promise<McpServer>;
  deactivate: (id: string) => Promise<McpServer>;
}

export function mcpEndpoints(client: ApiClient): McpEndpoints {
  return {
    list: () => client.get<McpServerList>("/admin/mcp"),
    create: (payload) => client.post<McpServer>("/admin/mcp", payload),
    update: (id, patch) =>
      client.patch<McpServer>(`/admin/mcp/${encodeURIComponent(id)}`, patch),
    deactivate: (id) =>
      client.delete<McpServer>(`/admin/mcp/${encodeURIComponent(id)}`),
  };
}
