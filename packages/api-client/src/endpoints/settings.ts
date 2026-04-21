import type {
  ChangePasswordRequest,
  CreateSelfApiTokenRequest,
  Preferences,
  Profile,
  SelfApiToken,
  SelfApiTokenCreateResponse,
  SelfApiTokenList,
  UpdateProfileRequest,
} from "@gv/types";
import type { ApiClient } from "../client.js";

export interface SettingsEndpoints {
  getProfile: () => Promise<Profile>;
  updateProfile: (patch: UpdateProfileRequest) => Promise<Profile>;
  changePassword: (payload: ChangePasswordRequest) => Promise<{ ok: true }>;
  getPreferences: () => Promise<Preferences>;
  putPreferences: (preferences: Record<string, unknown>) => Promise<Preferences>;
  listApiTokens: () => Promise<SelfApiTokenList>;
  createApiToken: (
    payload: CreateSelfApiTokenRequest,
  ) => Promise<SelfApiTokenCreateResponse>;
  revokeApiToken: (id: string) => Promise<SelfApiToken>;
}

export function settingsEndpoints(client: ApiClient): SettingsEndpoints {
  return {
    getProfile: () => client.get<Profile>("/v1/settings/profile"),
    updateProfile: (patch) =>
      client.patch<Profile>("/v1/settings/profile", patch),
    changePassword: (payload) =>
      client.post<{ ok: true }>("/v1/settings/password", payload),
    getPreferences: () => client.get<Preferences>("/v1/settings/preferences"),
    putPreferences: (preferences) =>
      client.put<Preferences>("/v1/settings/preferences", { preferences }),
    listApiTokens: () =>
      client.get<SelfApiTokenList>("/v1/settings/api-tokens"),
    createApiToken: (payload) =>
      client.post<SelfApiTokenCreateResponse>(
        "/v1/settings/api-tokens",
        payload,
      ),
    revokeApiToken: (id) =>
      client.delete<SelfApiToken>(
        `/v1/settings/api-tokens/${encodeURIComponent(id)}`,
      ),
  };
}
