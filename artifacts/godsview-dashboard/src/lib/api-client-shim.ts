/**
 * Shim for @workspace/api-client-react
 * Re-exports equivalent hooks from the local api module.
 * In the full monorepo, the real generated client is used instead.
 * This file is referenced by the Vite alias so standalone builds work.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export function useGetSystemStatus(options?: Record<string, unknown>) {
  return useQuery({ queryKey: ["system-status"], queryFn: () => apiFetch("/system"), ...options });
}

export function useGetPerformance(options?: Record<string, unknown>) {
  return useQuery({ queryKey: ["performance"], queryFn: () => apiFetch("/performance"), ...options });
}

export function useGetSignals(options?: Record<string, unknown>) {
  return useQuery({ queryKey: ["signals"], queryFn: () => apiFetch("/signals"), ...options });
}

export function useGetTrades(options?: Record<string, unknown>) {
  return useQuery({ queryKey: ["trades"], queryFn: () => apiFetch("/trades"), ...options });
}

export type CreateSignalRequest = {
  symbol: string;
  direction: "long" | "short";
  confidence: number;
  source?: string;
  [key: string]: unknown;
};

export type CreateTradeRequest = {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type?: string;
  [key: string]: unknown;
};

export type UpdateTradeRequest = {
  id: string;
  status?: string;
  [key: string]: unknown;
};

export function useCreateSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSignalRequest) =>
      apiFetch("/signals", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signals"] }),
  });
}

export function useCreateTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTradeRequest) =>
      apiFetch("/trades", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trades"] }),
  });
}

export function useUpdateTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTradeRequest) =>
      apiFetch(`/trades/${body.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trades"] }),
  });
}
