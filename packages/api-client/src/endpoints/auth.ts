import type { LoginRequest, TokenPair, User } from "@gv/types";
import type { ApiClient } from "../client.js";

export interface AuthEndpoints {
  login: (payload: LoginRequest) => Promise<TokenPair>;
  refresh: (refreshToken: string) => Promise<TokenPair>;
  logout: () => Promise<void>;
  me: () => Promise<User>;
}

export function authEndpoints(client: ApiClient): AuthEndpoints {
  return {
    login: (payload) => client.post<TokenPair>("/auth/login", payload),
    refresh: (refreshToken) => client.post<TokenPair>("/auth/refresh", { refreshToken }),
    logout: () => client.post<void>("/auth/logout"),
    me: () => client.get<User>("/auth/me"),
  };
}
