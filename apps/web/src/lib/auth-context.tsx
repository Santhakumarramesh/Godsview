"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TokenPair, User } from "@gv/types";
import { api } from "./api";

const ACCESS_KEY = "gv.accessToken";
const REFRESH_KEY = "gv.refreshToken";
const ACCESS_EXP_KEY = "gv.accessExpiresAt";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function readAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

function persistTokens(pair: TokenPair): void {
  window.localStorage.setItem(ACCESS_KEY, pair.accessToken);
  window.localStorage.setItem(REFRESH_KEY, pair.refreshToken);
  window.localStorage.setItem(ACCESS_EXP_KEY, pair.accessExpiresAt);
}

function clearTokens(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(ACCESS_EXP_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Wire the API client's bearer-token getter to the persisted access token.
  useEffect(() => {
    api.setAccessTokenGetter(() => readAccessToken());
  }, []);

  const loadMe = useCallback(async () => {
    if (!readAccessToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.auth.me();
      setUser(me);
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const pair = await api.auth.login({ email, password });
      persistTokens(pair);
      const me = await api.auth.me();
      setUser(me);
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // best-effort — local clear is the source of truth
    }
    clearTokens();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    const refreshToken = window.localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return;
    const pair = await api.auth.refresh(refreshToken);
    persistTokens(pair);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, signOut, refresh }),
    [user, loading, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
