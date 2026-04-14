/**
 * multi_tenant/index.ts — Phase 57: Multi-Tenant System
 * ─────────────────────────────────────────────────────────────────────────────
 * Primitives for organizations, role-based access control, workspaces, and
 * teams. All in-memory and safe for unit tests.
 *
 *   1. OrganizationManager — CRUD orgs, plan-based limits.
 *   2. RBACManager         — 10 permissions, 5 built-in roles, user→role map.
 *   3. WorkspaceManager    — logical workspaces inside an org.
 *   4. TeamManager         — team membership inside a workspace.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Plans & Limits ──────────────────────────────────────────────────────────

export type Plan = "retail" | "pro" | "team" | "institutional";

export interface PlanLimits {
  maxUsers: number;
  maxWorkspaces: number;
  maxStrategies: number;
  maxTeams: number;
  maxLiveTrades: number;
  apiRateLimitPerMin: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  retail: { maxUsers: 1, maxWorkspaces: 1, maxStrategies: 5, maxTeams: 0, maxLiveTrades: 10, apiRateLimitPerMin: 60 },
  pro: { maxUsers: 5, maxWorkspaces: 3, maxStrategies: 25, maxTeams: 1, maxLiveTrades: 100, apiRateLimitPerMin: 600 },
  team: { maxUsers: 25, maxWorkspaces: 10, maxStrategies: 100, maxTeams: 10, maxLiveTrades: 1_000, apiRateLimitPerMin: 6_000 },
  institutional: { maxUsers: 500, maxWorkspaces: 100, maxStrategies: 10_000, maxTeams: 100, maxLiveTrades: 100_000, apiRateLimitPerMin: 60_000 },
};

// ── Organizations ───────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  plan: Plan;
  createdAt: number;
  ownerUserId: string;
  metadata: Record<string, string>;
}

export class OrganizationManager {
  private readonly orgs = new Map<string, Organization>();

  create(params: { name: string; plan: Plan; ownerUserId: string; metadata?: Record<string, string> }): Organization {
    const id = `org_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const org: Organization = {
      id,
      name: params.name,
      plan: params.plan,
      ownerUserId: params.ownerUserId,
      createdAt: Date.now(),
      metadata: params.metadata ?? {},
    };
    this.orgs.set(id, org);
    logger.info({ orgId: id, plan: params.plan }, "[MultiTenant] Organization created");
    return org;
  }

  get(id: string): Organization | null {
    return this.orgs.get(id) ?? null;
  }

  list(): Organization[] {
    return Array.from(this.orgs.values());
  }

  changePlan(id: string, plan: Plan): Organization | null {
    const org = this.orgs.get(id);
    if (!org) return null;
    org.plan = plan;
    logger.info({ orgId: id, plan }, "[MultiTenant] Plan changed");
    return org;
  }

  limits(id: string): PlanLimits | null {
    const org = this.orgs.get(id);
    return org ? PLAN_LIMITS[org.plan] : null;
  }

  delete(id: string): boolean {
    return this.orgs.delete(id);
  }
}

// ── RBAC ────────────────────────────────────────────────────────────────────

export type Permission =
  | "org.admin"
  | "org.billing"
  | "workspace.manage"
  | "workspace.view"
  | "strategy.create"
  | "strategy.edit"
  | "strategy.delete"
  | "trade.execute"
  | "trade.view"
  | "audit.view";

export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  builtin: boolean;
}

export const BUILTIN_ROLES: Role[] = [
  {
    id: "role_owner",
    name: "Owner",
    permissions: [
      "org.admin", "org.billing",
      "workspace.manage", "workspace.view",
      "strategy.create", "strategy.edit", "strategy.delete",
      "trade.execute", "trade.view", "audit.view",
    ],
    builtin: true,
  },
  {
    id: "role_admin",
    name: "Admin",
    permissions: [
      "workspace.manage", "workspace.view",
      "strategy.create", "strategy.edit", "strategy.delete",
      "trade.execute", "trade.view", "audit.view",
    ],
    builtin: true,
  },
  {
    id: "role_trader",
    name: "Trader",
    permissions: [
      "workspace.view",
      "strategy.create", "strategy.edit",
      "trade.execute", "trade.view",
    ],
    builtin: true,
  },
  {
    id: "role_analyst",
    name: "Analyst",
    permissions: ["workspace.view", "strategy.create", "strategy.edit", "trade.view"],
    builtin: true,
  },
  {
    id: "role_viewer",
    name: "Viewer",
    permissions: ["workspace.view", "trade.view"],
    builtin: true,
  },
];

export class RBACManager {
  private readonly roles = new Map<string, Role>();
  private readonly assignments = new Map<string, Set<string>>(); // userId → roleIds

  constructor() {
    for (const r of BUILTIN_ROLES) this.roles.set(r.id, r);
  }

  createRole(name: string, permissions: Permission[]): Role {
    const id = `role_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const role: Role = { id, name, permissions, builtin: false };
    this.roles.set(id, role);
    return role;
  }

  listRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  deleteRole(id: string): boolean {
    const role = this.roles.get(id);
    if (!role || role.builtin) return false;
    return this.roles.delete(id);
  }

  assign(userId: string, roleId: string): boolean {
    if (!this.roles.has(roleId)) return false;
    const set = this.assignments.get(userId) ?? new Set<string>();
    set.add(roleId);
    this.assignments.set(userId, set);
    return true;
  }

  revoke(userId: string, roleId: string): boolean {
    const set = this.assignments.get(userId);
    if (!set) return false;
    return set.delete(roleId);
  }

  rolesForUser(userId: string): Role[] {
    const ids = this.assignments.get(userId);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.roles.get(id)).filter((r): r is Role => r !== undefined);
  }

  can(userId: string, permission: Permission): boolean {
    const roles = this.rolesForUser(userId);
    return roles.some((r) => r.permissions.includes(permission));
  }
}

// ── Workspaces ──────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  createdAt: number;
  archived: boolean;
  metadata: Record<string, string>;
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, Workspace>();

  create(params: { orgId: string; name: string; metadata?: Record<string, string> }): Workspace {
    const id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const ws: Workspace = {
      id,
      orgId: params.orgId,
      name: params.name,
      createdAt: Date.now(),
      archived: false,
      metadata: params.metadata ?? {},
    };
    this.workspaces.set(id, ws);
    return ws;
  }

  get(id: string): Workspace | null {
    return this.workspaces.get(id) ?? null;
  }

  listByOrg(orgId: string): Workspace[] {
    return Array.from(this.workspaces.values()).filter((w) => w.orgId === orgId);
  }

  archive(id: string): boolean {
    const w = this.workspaces.get(id);
    if (!w) return false;
    w.archived = true;
    return true;
  }

  delete(id: string): boolean {
    return this.workspaces.delete(id);
  }
}

// ── Teams ───────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  members: Set<string>; // userIds
  createdAt: number;
}

export class TeamManager {
  private readonly teams = new Map<string, Team>();

  create(params: { workspaceId: string; name: string }): Team {
    const id = `team_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const team: Team = {
      id,
      workspaceId: params.workspaceId,
      name: params.name,
      members: new Set<string>(),
      createdAt: Date.now(),
    };
    this.teams.set(id, team);
    return team;
  }

  addMember(teamId: string, userId: string): boolean {
    const t = this.teams.get(teamId);
    if (!t) return false;
    t.members.add(userId);
    return true;
  }

  removeMember(teamId: string, userId: string): boolean {
    const t = this.teams.get(teamId);
    if (!t) return false;
    return t.members.delete(userId);
  }

  listByWorkspace(workspaceId: string): Team[] {
    return Array.from(this.teams.values()).filter((t) => t.workspaceId === workspaceId);
  }

  get(id: string): Team | null {
    return this.teams.get(id) ?? null;
  }

  delete(id: string): boolean {
    return this.teams.delete(id);
  }
}

// ── Singletons ──────────────────────────────────────────────────────────────

export const organizationManager = new OrganizationManager();
export const rbacManager = new RBACManager();
export const workspaceManager = new WorkspaceManager();
export const teamManager = new TeamManager();
