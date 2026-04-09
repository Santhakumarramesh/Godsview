import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino();

// Type definitions
interface Organization {
  id: string;
  name: string;
  plan: "retail" | "pro" | "team" | "institutional";
  ownerEmail: string;
  createdAt: Date;
  status: "active" | "suspended";
  settings: {
    maxUsers: number;
    maxStrategies: number;
    maxWorkspaces: number;
  };
  members: string[];
}

interface Role {
  id: string;
  orgId: string;
  name: string;
  permissions: string[];
  description?: string;
  createdAt: Date;
}

interface RoleAssignment {
  id: string;
  orgId: string;
  userId: string;
  roleId: string;
  createdAt: Date;
}

interface Workspace {
  id: string;
  orgId: string;
  name: string;
  type: "trading" | "research" | "paper" | "staging";
  isolation: "full" | "shared";
  status: "active" | "archived";
  members: { userId: string; role: string }[];
  activity: { timestamp: Date; action: string; userId: string }[];
  createdAt: Date;
}

interface TeamMember {
  id: string;
  orgId: string;
  email: string;
  status: "active" | "invited" | "inactive";
  createdAt: Date;
}

interface Invite {
  id: string;
  orgId: string;
  email: string;
  role?: string;
  status: "pending" | "accepted" | "expired";
  createdAt: Date;
}

// Plan limits
const PLAN_LIMITS: Record<
  string,
  { maxUsers: number; maxStrategies: number; maxWorkspaces: number }
> = {
  retail: { maxUsers: 5, maxStrategies: 10, maxWorkspaces: 2 },
  pro: { maxUsers: 20, maxStrategies: 100, maxWorkspaces: 10 },
  team: { maxUsers: 50, maxStrategies: 500, maxWorkspaces: 25 },
  institutional: { maxUsers: 999, maxStrategies: 9999, maxWorkspaces: 999 },
};

// Built-in role definitions
const BUILTIN_ROLES: Record<string, string[]> = {
  admin: [
    "strategy.create",
    "strategy.promote",
    "strategy.retire",
    "trade.execute",
    "trade.paper",
    "risk.override",
    "system.admin",
    "data.export",
    "audit.view",
    "config.modify",
  ],
  operator: [
    "strategy.create",
    "strategy.promote",
    "trade.execute",
    "trade.paper",
    "data.export",
    "audit.view",
  ],
  trader: ["trade.execute", "trade.paper", "data.export"],
  viewer: ["audit.view", "data.export"],
  auditor: ["audit.view"],
};

// OrganizationManager
class OrganizationManager {
  private organizations: Map<string, Organization> = new Map();

  createOrg(config: {
    name: string;
    plan: "retail" | "pro" | "team" | "institutional";
    ownerEmail: string;
  }): string {
    const orgId = `org_${randomUUID()}`;
    const limits = PLAN_LIMITS[config.plan];

    const org: Organization = {
      id: orgId,
      name: config.name,
      plan: config.plan,
      ownerEmail: config.ownerEmail,
      createdAt: new Date(),
      status: "active",
      settings: {
        maxUsers: limits.maxUsers,
        maxStrategies: limits.maxStrategies,
        maxWorkspaces: limits.maxWorkspaces,
      },
      members: [],
    };

    this.organizations.set(orgId, org);
    logger.info({ orgId, plan: config.plan }, "Organization created");
    return orgId;
  }

  getOrg(orgId: string): Organization | undefined {
    return this.organizations.get(orgId);
  }

  listOrgs(): Organization[] {
    return Array.from(this.organizations.values());
  }

  updateOrg(orgId: string, updates: Partial<Organization>): Organization {
    const org = this.organizations.get(orgId);
    if (!org) throw new Error(`Organization ${orgId} not found`);

    if (updates.name) org.name = updates.name;
    if (updates.plan) {
      org.plan = updates.plan;
      const limits = PLAN_LIMITS[updates.plan];
      org.settings = {
        maxUsers: limits.maxUsers,
        maxStrategies: limits.maxStrategies,
        maxWorkspaces: limits.maxWorkspaces,
      };
    }
    if (updates.settings) org.settings = { ...org.settings, ...updates.settings };

    logger.info({ orgId }, "Organization updated");
    return org;
  }

  suspendOrg(orgId: string): Organization {
    const org = this.organizations.get(orgId);
    if (!org) throw new Error(`Organization ${orgId} not found`);

    org.status = "suspended";
    logger.warn({ orgId }, "Organization suspended");
    return org;
  }

  deleteOrg(orgId: string): void {
    this.organizations.delete(orgId);
    logger.info({ orgId }, "Organization deleted");
  }

  getOrgStats(): {
    total: number;
    byPlan: Record<string, number>;
    activeCount: number;
    suspendedCount: number;
  } {
    const orgs = Array.from(this.organizations.values());
    const byPlan = {
      retail: 0,
      pro: 0,
      team: 0,
      institutional: 0,
    };

    let activeCount = 0;
    let suspendedCount = 0;

    orgs.forEach((org) => {
      byPlan[org.plan]++;
      if (org.status === "active") activeCount++;
      else if (org.status === "suspended") suspendedCount++;
    });

    return {
      total: orgs.length,
      byPlan,
      activeCount,
      suspendedCount,
    };
  }

  _clearOrganizationManager(): void {
    this.organizations.clear();
  }
}

// RBACManager
class RBACManager {
  private roles: Map<string, Role> = new Map();
  private assignments: Map<string, RoleAssignment> = new Map();
  private builtInRoles: Map<string, Role> = new Map();

  constructor() {
    this._initializeBuiltInRoles();
  }

  private _initializeBuiltInRoles(): void {
    Object.entries(BUILTIN_ROLES).forEach(([name, permissions]) => {
      const roleId = `role_${name}`;
      this.builtInRoles.set(
        roleId,
        {
          id: roleId,
          orgId: "system",
          name,
          permissions,
          createdAt: new Date(),
        }
      );
    });
  }

  createRole(
    orgId: string,
    config: { name: string; permissions: string[]; description?: string }
  ): string {
    const roleId = `role_${randomUUID()}`;
    const role: Role = {
      id: roleId,
      orgId,
      name: config.name,
      permissions: config.permissions,
      description: config.description,
      createdAt: new Date(),
    };

    this.roles.set(roleId, role);
    logger.info({ roleId, orgId, name: config.name }, "Role created");
    return roleId;
  }

  assignRole(orgId: string, userId: string, roleId: string): string {
    const role = this.roles.get(roleId) || this.builtInRoles.get(roleId);
    if (!role) throw new Error(`Role ${roleId} not found`);
    if (role.orgId !== "system" && role.orgId !== orgId)
      throw new Error(`Role ${roleId} not authorized for org ${orgId}`);

    const assignId = `assign_${randomUUID()}`;
    const assignment: RoleAssignment = {
      id: assignId,
      orgId,
      userId,
      roleId,
      createdAt: new Date(),
    };

    this.assignments.set(assignId, assignment);
    logger.info({ assignId, userId, roleId }, "Role assigned");
    return assignId;
  }

  revokeRole(orgId: string, userId: string, roleId: string): void {
    const assignment = Array.from(this.assignments.values()).find(
      (a) => a.userId === userId && a.roleId === roleId && a.orgId === orgId
    );

    if (assignment) {
      this.assignments.delete(assignment.id);
      logger.info({ userId, roleId }, "Role revoked");
    }
  }

  checkPermission(orgId: string, userId: string, permission: string): boolean {
    const assignments = Array.from(this.assignments.values()).filter(
      (a) => a.userId === userId && a.orgId === orgId
    );

    for (const assignment of assignments) {
      const role =
        this.roles.get(assignment.roleId) ||
        this.builtInRoles.get(assignment.roleId);
      if (role && role.permissions.includes(permission)) {
        return true;
      }
    }

    return false;
  }

  getUserRoles(orgId: string, userId: string): Role[] {
    return Array.from(this.assignments.values())
      .filter((a) => a.userId === userId && a.orgId === orgId)
      .map((a) => {
        const role =
          this.roles.get(a.roleId) || this.builtInRoles.get(a.roleId);
        return role as Role;
      })
      .filter((role) => role !== undefined);
  }

  getRolePermissions(roleId: string): string[] {
    const role = this.roles.get(roleId) || this.builtInRoles.get(roleId);
    return role ? role.permissions : [];
  }

  listRoles(orgId: string): Role[] {
    const customRoles = Array.from(this.roles.values()).filter(
      (r) => r.orgId === orgId
    );
    const builtIn = Array.from(this.builtInRoles.values());
    return [...customRoles, ...builtIn];
  }

  getPermissionMatrix(
    orgId: string
  ): Record<string, Record<string, boolean>> {
    const matrix: Record<string, Record<string, boolean>> = {};
    const assignments = Array.from(this.assignments.values()).filter(
      (a) => a.orgId === orgId
    );

    const uniqueUsers = new Set(assignments.map((a) => a.userId));
    const allPermissions = new Set<string>([
      "strategy.create", "strategy.promote", "strategy.retire",
      "trade.execute", "trade.paper", "risk.override",
      "system.admin", "data.export", "audit.view", "config.modify",
    ]);

    uniqueUsers.forEach((userId) => {
      matrix[userId] = {};
      allPermissions.forEach((permission) => {
        matrix[userId][permission] = this.checkPermission(
          orgId,
          userId,
          permission
        );
      });
    });

    return matrix;
  }

  _clearRBACManager(): void {
    this.roles.clear();
    this.assignments.clear();
    this._initializeBuiltInRoles();
  }
}

// WorkspaceManager
class WorkspaceManager {
  private workspaces: Map<string, Workspace> = new Map();

  createWorkspace(
    orgId: string,
    config: {
      name: string;
      type: "trading" | "research" | "paper" | "staging";
      isolation: "full" | "shared";
    }
  ): string {
    const wsId = `ws_${randomUUID()}`;
    const workspace: Workspace = {
      id: wsId,
      orgId,
      name: config.name,
      type: config.type,
      isolation: config.isolation,
      status: "active",
      members: [],
      activity: [],
      createdAt: new Date(),
    };

    this.workspaces.set(wsId, workspace);
    logger.info({ wsId, orgId, name: config.name }, "Workspace created");
    return wsId;
  }

  getWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  listWorkspaces(orgId: string): Workspace[] {
    return Array.from(this.workspaces.values()).filter((w) => w.orgId === orgId);
  }

  addMember(workspaceId: string, userId: string, role: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    const existing = workspace.members.find((m) => m.userId === userId);
    if (!existing) {
      workspace.members.push({ userId, role });
      workspace.activity.push({
        timestamp: new Date(),
        action: `User ${userId} added as ${role}`,
        userId,
      });
      logger.info({ workspaceId, userId, role }, "Member added to workspace");
    }
  }

  removeMember(workspaceId: string, userId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    workspace.members = workspace.members.filter((m) => m.userId !== userId);
    workspace.activity.push({
      timestamp: new Date(),
      action: `User ${userId} removed`,
      userId,
    });
    logger.info({ workspaceId, userId }, "Member removed from workspace");
  }

  archiveWorkspace(workspaceId: string): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    workspace.status = "archived";
    workspace.activity.push({
      timestamp: new Date(),
      action: "Workspace archived",
      userId: "system",
    });
    logger.info({ workspaceId }, "Workspace archived");
    return workspace;
  }

  getWorkspaceActivity(workspaceId: string): Array<{
    timestamp: Date;
    action: string;
    userId: string;
  }> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    return workspace.activity;
  }

  _clearWorkspaceManager(): void {
    this.workspaces.clear();
  }
}

// TeamManager
class TeamManager {
  private members: Map<string, TeamMember> = new Map();
  private invites: Map<string, Invite> = new Map();

  inviteMember(orgId: string, email: string, role?: string): string {
    const inviteId = `invite_${randomUUID()}`;
    const invite: Invite = {
      id: inviteId,
      orgId,
      email,
      role,
      status: "pending",
      createdAt: new Date(),
    };

    this.invites.set(inviteId, invite);
    logger.info({ inviteId, email, orgId }, "Member invited");
    return inviteId;
  }

  acceptInvite(inviteId: string): string {
    const invite = this.invites.get(inviteId);
    if (!invite) throw new Error(`Invite ${inviteId} not found`);

    invite.status = "accepted";

    const userId = `user_${randomUUID()}`;
    const member: TeamMember = {
      id: userId,
      orgId: invite.orgId,
      email: invite.email,
      status: "active",
      createdAt: new Date(),
    };

    this.members.set(userId, member);
    logger.info({ userId, email: invite.email }, "Invite accepted");
    return userId;
  }

  removeMember(orgId: string, userId: string): void {
    const member = this.members.get(userId);
    if (!member || member.orgId !== orgId)
      throw new Error(`Member ${userId} not found in org ${orgId}`);

    this.members.delete(userId);
    logger.info({ userId, orgId }, "Member removed");
  }

  listMembers(orgId: string): TeamMember[] {
    return Array.from(this.members.values()).filter((m) => m.orgId === orgId);
  }

  listInvites(orgId: string): Invite[] {
    return Array.from(this.invites.values()).filter((i) => i.orgId === orgId);
  }

  transferOwnership(orgId: string, newOwnerUserId: string): void {
    const member = this.members.get(newOwnerUserId);
    if (!member || member.orgId !== orgId)
      throw new Error(`Member ${newOwnerUserId} not found in org ${orgId}`);

    logger.info({ orgId, newOwnerId: newOwnerUserId }, "Ownership transferred");
  }

  _clearTeamManager(): void {
    this.members.clear();
    this.invites.clear();
  }
}

// Export singleton instances
export const organizationManager = new OrganizationManager();
export const rbacManager = new RBACManager();
export const workspaceManager = new WorkspaceManager();
export const teamManager = new TeamManager();
