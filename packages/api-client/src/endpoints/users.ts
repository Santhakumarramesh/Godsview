import type {
  AdminUser,
  AdminUserList,
  CreateUserRequest,
  UpdateUserRequest,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface UserEndpoints {
  list: () => Promise<AdminUserList>;
  create: (payload: CreateUserRequest) => Promise<AdminUser>;
  update: (id: string, patch: UpdateUserRequest) => Promise<AdminUser>;
  deactivate: (id: string) => Promise<AdminUser>;
}

export function userEndpoints(client: ApiClient): UserEndpoints {
  return {
    list: () => client.get<AdminUserList>("/admin/users"),
    create: (payload) => client.post<AdminUser>("/admin/users", payload),
    update: (id, patch) =>
      client.patch<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, patch),
    deactivate: (id) =>
      client.delete<AdminUser>(`/admin/users/${encodeURIComponent(id)}`),
  };
}
