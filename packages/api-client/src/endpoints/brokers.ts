/**
 * @gv/api-client — Phase 7 multi-broker registry endpoints.
 *
 * Surfaces served by services/control_plane/app/routes/brokers.py:
 *
 *   api.brokers.adapters           — broker adapter registry CRUD
 *   api.brokers.bindings           — (adapter, account) binding CRUD
 *   api.brokers.health             — rolling probe snapshots + filters
 *
 * Phase 4 shipped a single-kind Alpaca adapter. Phase 7 promotes the
 * adapter to a registry: every broker connection is a row, every
 * (adapter, account) pair is a binding, and the live gate picks the
 * routing adapter via `role + enabled + latest health snapshot`.
 *
 * The live gate (Phase 4) requires at least one `primary` adapter with
 * `status = healthy` before it will route a live order. An adapter with
 * `probeEnabled = true` is refreshed by the health cron (Phase 7 PR3).
 *
 * Mutations that change `liveEnabled` or `role` are audit-logged; an
 * admin reason (3-280 chars) is required on every update. Registering a
 * new adapter requires a paired governance approval
 * (`broker_adapter_register`) on live kinds — paper kinds are unrestricted.
 */
import type {
  BrokerAccountBinding,
  BrokerAccountBindingRequest,
  BrokerAccountBindingsList,
  BrokerAdapter,
  BrokerAdapterRegisterRequest,
  BrokerAdapterUpdateRequest,
  BrokerAdaptersList,
  BrokerHealthFilter,
  BrokerHealthSnapshot,
  BrokerHealthSnapshotsList,
  BrokerRegistrySummary,
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

// ───────────────────────────── adapters ────────────────────────────────

export interface BrokerAdapterEndpoints {
  /** GET /brokers/adapters — list every registered broker adapter. */
  list: () => Promise<BrokerAdaptersList>;
  /** GET /brokers/adapters/:id */
  get: (id: string) => Promise<BrokerAdapter>;
  /**
   * POST /brokers/adapters — register a new adapter. Live kinds require a
   * paired `broker_adapter_register` governance approval; the server
   * rejects unauthorised live registrations with 409.
   */
  register: (req: BrokerAdapterRegisterRequest) => Promise<BrokerAdapter>;
  /** PATCH /brokers/adapters/:id — update role / display / gates. */
  update: (
    id: string,
    req: BrokerAdapterUpdateRequest,
  ) => Promise<BrokerAdapter>;
  /**
   * POST /brokers/adapters/:id/probe — ad-hoc health probe. Returns the
   * snapshot the probe just wrote, not a cached row. Admin-gated.
   */
  probe: (id: string) => Promise<BrokerHealthSnapshot>;
  /** GET /brokers/registry — aggregated live-routable summary. */
  registry: () => Promise<BrokerRegistrySummary>;
}

export function brokerAdapterEndpoints(client: ApiClient): BrokerAdapterEndpoints {
  return {
    list: () => client.get<BrokerAdaptersList>(`/brokers/adapters`),
    get: (id) =>
      client.get<BrokerAdapter>(`/brokers/adapters/${encodeURIComponent(id)}`),
    register: (req) => client.post<BrokerAdapter>(`/brokers/adapters`, req),
    update: (id, req) =>
      client.patch<BrokerAdapter>(
        `/brokers/adapters/${encodeURIComponent(id)}`,
        req,
      ),
    probe: (id) =>
      client.post<BrokerHealthSnapshot>(
        `/brokers/adapters/${encodeURIComponent(id)}/probe`,
        {},
      ),
    registry: () => client.get<BrokerRegistrySummary>(`/brokers/registry`),
  };
}

// ───────────────────────────── bindings ────────────────────────────────

export interface BrokerBindingEndpoints {
  /**
   * GET /brokers/bindings — list every (adapter, account) binding. Filter
   * client-side by `adapterId` or `accountId` on the returned list.
   */
  list: (opts?: {
    adapterId?: string;
    accountId?: string;
  }) => Promise<BrokerAccountBindingsList>;
  /** GET /brokers/bindings/:id */
  get: (id: string) => Promise<BrokerAccountBinding>;
  /** POST /brokers/bindings — create a new binding. */
  create: (
    req: BrokerAccountBindingRequest,
  ) => Promise<BrokerAccountBinding>;
  /**
   * PATCH /brokers/bindings/:id — toggle `enabled`, re-weight, rename.
   * Role changes follow the same governance rules as adapters.
   */
  update: (
    id: string,
    req: Partial<BrokerAccountBindingRequest> & { reason: string },
  ) => Promise<BrokerAccountBinding>;
  /** DELETE /brokers/bindings/:id */
  remove: (id: string, reason: string) => Promise<void>;
}

export function brokerBindingEndpoints(
  client: ApiClient,
): BrokerBindingEndpoints {
  return {
    list: (opts = {}) =>
      client.get<BrokerAccountBindingsList>(`/brokers/bindings${qs(opts)}`),
    get: (id) =>
      client.get<BrokerAccountBinding>(
        `/brokers/bindings/${encodeURIComponent(id)}`,
      ),
    create: (req) =>
      client.post<BrokerAccountBinding>(`/brokers/bindings`, req),
    update: (id, req) =>
      client.patch<BrokerAccountBinding>(
        `/brokers/bindings/${encodeURIComponent(id)}`,
        req,
      ),
    remove: (id, reason) =>
      client.delete<void>(
        `/brokers/bindings/${encodeURIComponent(id)}${qs({ reason })}`,
      ),
  };
}

// ───────────────────────────── health ──────────────────────────────────

export interface BrokerHealthEndpoints {
  /** GET /brokers/health — rolling snapshots with filter support. */
  list: (filter?: BrokerHealthFilter) => Promise<BrokerHealthSnapshotsList>;
  /** GET /brokers/adapters/:id/health — per-adapter probe history. */
  history: (
    adapterId: string,
    opts?: { limit?: number; offset?: number; since?: string },
  ) => Promise<BrokerHealthSnapshotsList>;
}

export function brokerHealthEndpoints(
  client: ApiClient,
): BrokerHealthEndpoints {
  return {
    list: (filter = { limit: 100 } as BrokerHealthFilter) =>
      client.get<BrokerHealthSnapshotsList>(`/brokers/health${qs(filter)}`),
    history: (adapterId, opts = {}) =>
      client.get<BrokerHealthSnapshotsList>(
        `/brokers/adapters/${encodeURIComponent(adapterId)}/health${qs(opts)}`,
      ),
  };
}
