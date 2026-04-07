/**
 * api-phase-115.ts — Phase 115: Ops, Security & Failure Testing API Hooks
 *
 * These hooks should be appended to artifacts/godsview-dashboard/src/lib/api.ts
 * They follow the same pattern as existing hooks using useQuery/useMutation with apiFetch
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// NOTE: This assumes apiFetch is already imported in api.ts
// For reference, it's defined as:
// async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>

// ─── Phase 115: Ops, Security & Failure Testing ─────────────────────────────

// Security Audit Hooks
export function useSecurityAudit() {
  return useQuery({
    queryKey: ["security", "audit"],
    queryFn: () => apiFetch<any>("/ops-security/security/audit"),
  });
}

export function useSecurityScore() {
  return useQuery({
    queryKey: ["security", "score"],
    queryFn: () => apiFetch<any>("/ops-security/security/score"),
    refetchInterval: 30_000,
  });
}

export function useSecurityHistory() {
  return useQuery({
    queryKey: ["security", "history"],
    queryFn: () => apiFetch<any>("/ops-security/security/history"),
  });
}

// Chaos Test Hooks
export function useRunChaosTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { scenario: string }) =>
      apiFetch<any>("/ops-security/chaos/run", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chaos"] });
    },
  });
}

export function useChaosResults() {
  return useQuery({
    queryKey: ["chaos", "results"],
    queryFn: () => apiFetch<any>("/ops-security/chaos/results"),
  });
}

export function useResiliencyMatrix() {
  return useQuery({
    queryKey: ["chaos", "resiliency"],
    queryFn: () => apiFetch<any>("/ops-security/chaos/resiliency"),
  });
}

export function useRecoveryMetrics() {
  return useQuery({
    queryKey: ["chaos", "recovery"],
    queryFn: () => apiFetch<any>("/ops-security/chaos/recovery"),
  });
}

// Ops Health Hooks
export function useOpsSnapshot() {
  return useQuery({
    queryKey: ["ops", "snapshot"],
    queryFn: () => apiFetch<any>("/ops-security/ops/snapshot"),
    refetchInterval: 5_000,
  });
}

export function useIncidentLog(limit = 50) {
  return useQuery({
    queryKey: ["ops", "incidents", limit],
    queryFn: () =>
      apiFetch<any>(`/ops-security/ops/incidents?limit=${limit}`),
  });
}

export function useLogIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      severity: string;
      title: string;
      description: string;
      component: string;
    }) =>
      apiFetch<any>("/ops-security/ops/incidents", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops"] });
    },
  });
}

export function useResolveIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<any>(`/ops-security/ops/incidents/${id}/resolve`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops"] });
    },
  });
}

export function useGetRunbook(component: string) {
  return useQuery({
    queryKey: ["ops", "runbook", component],
    queryFn: () =>
      apiFetch<any>(`/ops-security/ops/runbook/${component}`),
    enabled: !!component,
  });
}

// Deployment Gate Hooks
export function useDeployGate() {
  return useQuery({
    queryKey: ["deploy", "gate"],
    queryFn: () => apiFetch<any>("/ops-security/deploy/gate"),
  });
}

export function useDeployHistory() {
  return useQuery({
    queryKey: ["deploy", "history"],
    queryFn: () => apiFetch<any>("/ops-security/deploy/history"),
  });
}

export function useRecordDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      version: string;
      commitHash: string;
      deployer: string;
      notes: string;
    }) =>
      apiFetch<any>("/ops-security/deploy/record", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deploy"] });
    },
  });
}
