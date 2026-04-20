/**
 * @gv/api-client — Phase 6 governance endpoints.
 *
 * Surfaces served by services/control_plane/app/routes/governance.py:
 *
 *   api.approvals        — request + decide + query approval rows
 *   api.approvalPolicies — CRUD on (action → requirements) policy rows
 *   api.anomalies        — list + acknowledge + resolve anomaly alerts
 *   api.trust            — per-user trust-tier registry + history
 *
 * Every privileged mutation in the system funnels through an
 * `ApprovalPolicy` row; the `createApproval` surface is how UIs kick off
 * a governance request, and `decide` is how designated approvers sign
 * off or reject. Decision rows are append-only — withdrawing a request
 * produces a terminal `ApprovalState.withdrawn` transition, not a
 * deletion.
 */
import type {
  AcknowledgeAnomalyRequest,
  AnomalyAlert,
  AnomalyAlertsList,
  AnomalyFilter,
  ApprovalPolicy,
  ApprovalPolicyList,
  ApprovalPolicyUpdate,
  AssignTrustTierRequest,
  CreateApprovalRequest,
  DecideApprovalRequest,
  GovernanceAction,
  GovernanceApproval,
  GovernanceApprovalFilter,
  GovernanceApprovalsList,
  ResolveAnomalyRequest,
  TrustRegistryEntry,
  TrustRegistryList,
} from "@gv/types";
import type { ApiClient } from "../client.js";

// ───────────────────────────── query-string helper ──────────────────────

function qs(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// ───────────────────────────── approvals ────────────────────────────────

export interface GovernanceApprovalEndpoints {
  /** GET /governance/approvals — list with filter + pagination. */
  list: (
    filter?: GovernanceApprovalFilter,
  ) => Promise<GovernanceApprovalsList>;
  /** GET /governance/approvals/:id */
  get: (id: string) => Promise<GovernanceApproval>;
  /** POST /governance/approvals — create a new approval request. */
  create: (req: CreateApprovalRequest) => Promise<GovernanceApproval>;
  /** POST /governance/approvals/:id/decide — approver signs off or rejects. */
  decide: (
    id: string,
    req: DecideApprovalRequest,
  ) => Promise<GovernanceApproval>;
  /** POST /governance/approvals/:id/withdraw — requester pulls the request. */
  withdraw: (id: string, reason: string) => Promise<GovernanceApproval>;
}

export function governanceApprovalEndpoints(
  client: ApiClient,
): GovernanceApprovalEndpoints {
  return {
    list: (filter = { limit: 50 } as GovernanceApprovalFilter) =>
      client.get<GovernanceApprovalsList>(
        `/governance/approvals${qs(filter)}`,
      ),
    get: (id) =>
      client.get<GovernanceApproval>(
        `/governance/approvals/${encodeURIComponent(id)}`,
      ),
    create: (req) =>
      client.post<GovernanceApproval>(`/governance/approvals`, req),
    decide: (id, req) =>
      client.post<GovernanceApproval>(
        `/governance/approvals/${encodeURIComponent(id)}/decide`,
        req,
      ),
    withdraw: (id, reason) =>
      client.post<GovernanceApproval>(
        `/governance/approvals/${encodeURIComponent(id)}/withdraw`,
        { reason },
      ),
  };
}

// ───────────────────────────── approval policies ───────────────────────

export interface GovernanceApprovalPolicyEndpoints {
  /** GET /governance/policies — list all policy rows. */
  list: () => Promise<ApprovalPolicyList>;
  /** GET /governance/policies/:action */
  get: (action: GovernanceAction) => Promise<ApprovalPolicy>;
  /**
   * PATCH /governance/policies/:action — admin-gated. Policy edits
   * themselves require a `approval_policy_edit` governance approval.
   */
  update: (
    action: GovernanceAction,
    patch: ApprovalPolicyUpdate,
  ) => Promise<ApprovalPolicy>;
}

export function governanceApprovalPolicyEndpoints(
  client: ApiClient,
): GovernanceApprovalPolicyEndpoints {
  return {
    list: () => client.get<ApprovalPolicyList>(`/governance/policies`),
    get: (action) =>
      client.get<ApprovalPolicy>(
        `/governance/policies/${encodeURIComponent(action)}`,
      ),
    update: (action, patch) =>
      client.patch<ApprovalPolicy>(
        `/governance/policies/${encodeURIComponent(action)}`,
        patch,
      ),
  };
}

// ───────────────────────────── anomalies ────────────────────────────────

export interface GovernanceAnomalyEndpoints {
  /** GET /governance/anomalies — list anomaly alerts with filter. */
  list: (filter?: AnomalyFilter) => Promise<AnomalyAlertsList>;
  /** GET /governance/anomalies/:id */
  get: (id: string) => Promise<AnomalyAlert>;
  /**
   * POST /governance/anomalies/:id/acknowledge — operator acks the alert.
   * Optional `suppressForSeconds` mutes re-fires for that window.
   */
  acknowledge: (
    id: string,
    req: AcknowledgeAnomalyRequest,
  ) => Promise<AnomalyAlert>;
  /** POST /governance/anomalies/:id/resolve — operator closes the alert. */
  resolve: (
    id: string,
    req: ResolveAnomalyRequest,
  ) => Promise<AnomalyAlert>;
}

export function governanceAnomalyEndpoints(
  client: ApiClient,
): GovernanceAnomalyEndpoints {
  return {
    list: (filter = { limit: 50 } as AnomalyFilter) =>
      client.get<AnomalyAlertsList>(
        `/governance/anomalies${qs(filter)}`,
      ),
    get: (id) =>
      client.get<AnomalyAlert>(
        `/governance/anomalies/${encodeURIComponent(id)}`,
      ),
    acknowledge: (id, req) =>
      client.post<AnomalyAlert>(
        `/governance/anomalies/${encodeURIComponent(id)}/acknowledge`,
        req,
      ),
    resolve: (id, req) =>
      client.post<AnomalyAlert>(
        `/governance/anomalies/${encodeURIComponent(id)}/resolve`,
        req,
      ),
  };
}

// ───────────────────────────── trust registry ───────────────────────────

export interface GovernanceTrustEndpoints {
  /** GET /governance/trust — full registry with tier + history. */
  list: () => Promise<TrustRegistryList>;
  /** GET /governance/trust/:userId */
  get: (userId: string) => Promise<TrustRegistryEntry>;
  /**
   * POST /governance/trust — admin-gated. Assigns a new tier to a user.
   * `trust_tier_change` policy applies; raising a tier to admin/owner
   * requires dual-control.
   */
  assign: (req: AssignTrustTierRequest) => Promise<TrustRegistryEntry>;
}

export function governanceTrustEndpoints(
  client: ApiClient,
): GovernanceTrustEndpoints {
  return {
    list: () => client.get<TrustRegistryList>(`/governance/trust`),
    get: (userId) =>
      client.get<TrustRegistryEntry>(
        `/governance/trust/${encodeURIComponent(userId)}`,
      ),
    assign: (req) =>
      client.post<TrustRegistryEntry>(`/governance/trust`, req),
  };
}
