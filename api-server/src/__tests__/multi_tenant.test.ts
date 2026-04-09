import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({
  default: vi.fn(),
}));

import {
  organizationManager,
  rbacManager,
  workspaceManager,
  teamManager,
} from "../lib/multi_tenant/index";

describe("OrganizationManager", () => {
  beforeEach(() => {
    organizationManager._clearOrganizationManager();
    rbacManager._clearRBACManager();
    workspaceManager._clearWorkspaceManager();
    teamManager._clearTeamManager();
  });

  it("should create organization with retail plan", () => {
    const orgId = organizationManager.createOrg({
      name: "Retail Org",
      plan: "retail",
      ownerEmail: "owner@retail.com",
    });

    expect(orgId).toMatch(/^org_/);
    const org = organizationManager.getOrg(orgId);
    expect(org).toBeDefined();
    expect(org?.name).toBe("Retail Org");
    expect(org?.plan).toBe("retail");
    expect(org?.status).toBe("active");
  });

  it("should create organization with pro plan", () => {
    const orgId = organizationManager.createOrg({
      name: "Pro Org",
      plan: "pro",
      ownerEmail: "owner@pro.com",
    });

    const org = organizationManager.getOrg(orgId);
    expect(org?.settings.maxUsers).toBe(20);
    expect(org?.settings.maxStrategies).toBe(100);
    expect(org?.settings.maxWorkspaces).toBe(10);
  });

  it("should create organization with team plan", () => {
    const orgId = organizationManager.createOrg({
      name: "Team Org",
      plan: "team",
      ownerEmail: "owner@team.com",
    });

    const org = organizationManager.getOrg(orgId);
    expect(org?.settings.maxUsers).toBe(50);
    expect(org?.settings.maxStrategies).toBe(500);
    expect(org?.settings.maxWorkspaces).toBe(25);
  });

  it("should create organization with institutional plan", () => {
    const orgId = organizationManager.createOrg({
      name: "Institutional Org",
      plan: "institutional",
      ownerEmail: "owner@institutional.com",
    });

    const org = organizationManager.getOrg(orgId);
    expect(org?.settings.maxUsers).toBe(999);
    expect(org?.settings.maxStrategies).toBe(9999);
    expect(org?.settings.maxWorkspaces).toBe(999);
  });

  it("should get organization by ID", () => {
    const orgId = organizationManager.createOrg({
      name: "Test Org",
      plan: "retail",
      ownerEmail: "test@example.com",
    });

    const org = organizationManager.getOrg(orgId);
    expect(org?.id).toBe(orgId);
  });

  it("should return undefined for non-existent organization", () => {
    const org = organizationManager.getOrg("org_nonexistent");
    expect(org).toBeUndefined();
  });

  it("should list all organizations", () => {
    const org1 = organizationManager.createOrg({
      name: "Org 1",
      plan: "retail",
      ownerEmail: "org1@example.com",
    });
    const org2 = organizationManager.createOrg({
      name: "Org 2",
      plan: "pro",
      ownerEmail: "org2@example.com",
    });

    const orgs = organizationManager.listOrgs();
    expect(orgs).toHaveLength(2);
    expect(orgs.map((o) => o.id)).toContain(org1);
    expect(orgs.map((o) => o.id)).toContain(org2);
  });

  it("should update organization name", () => {
    const orgId = organizationManager.createOrg({
      name: "Original Name",
      plan: "retail",
      ownerEmail: "test@example.com",
    });

    organizationManager.updateOrg(orgId, { name: "Updated Name" });
    const org = organizationManager.getOrg(orgId);
    expect(org?.name).toBe("Updated Name");
  });

  it("should update organization plan and adjust settings", () => {
    const orgId = organizationManager.createOrg({
      name: "Test Org",
      plan: "retail",
      ownerEmail: "test@example.com",
    });

    organizationManager.updateOrg(orgId, { plan: "pro" });
    const org = organizationManager.getOrg(orgId);
    expect(org?.plan).toBe("pro");
    expect(org?.settings.maxUsers).toBe(20);
    expect(org?.settings.maxStrategies).toBe(100);
  });

  it("should throw error when updating non-existent organization", () => {
    expect(() => {
      organizationManager.updateOrg("org_nonexistent", { name: "New Name" });
    }).toThrow();
  });

  it("should suspend organization", () => {
    const orgId = organizationManager.createOrg({
      name: "Test Org",
      plan: "retail",
      ownerEmail: "test@example.com",
    });

    organizationManager.suspendOrg(orgId);
    const org = organizationManager.getOrg(orgId);
    expect(org?.status).toBe("suspended");
  });

  it("should delete organization", () => {
    const orgId = organizationManager.createOrg({
      name: "Test Org",
      plan: "retail",
      ownerEmail: "test@example.com",
    });

    organizationManager.deleteOrg(orgId);
    const org = organizationManager.getOrg(orgId);
    expect(org).toBeUndefined();
  });

  it("should get organization stats", () => {
    organizationManager.createOrg({
      name: "Retail 1",
      plan: "retail",
      ownerEmail: "r1@example.com",
    });
    organizationManager.createOrg({
      name: "Retail 2",
      plan: "retail",
      ownerEmail: "r2@example.com",
    });
    organizationManager.createOrg({
      name: "Pro 1",
      plan: "pro",
      ownerEmail: "p1@example.com",
    });

    const stats = organizationManager.getOrgStats();
    expect(stats.total).toBe(3);
    expect(stats.byPlan.retail).toBe(2);
    expect(stats.byPlan.pro).toBe(1);
    expect(stats.activeCount).toBe(3);
  });

  it("should count suspended organizations in stats", () => {
    const org1 = organizationManager.createOrg({
      name: "Active Org",
      plan: "retail",
      ownerEmail: "active@example.com",
    });
    const org2 = organizationManager.createOrg({
      name: "Suspended Org",
      plan: "retail",
      ownerEmail: "suspended@example.com",
    });

    organizationManager.suspendOrg(org2);
    const stats = organizationManager.getOrgStats();
    expect(stats.activeCount).toBe(1);
    expect(stats.suspendedCount).toBe(1);
  });
});

describe("RBACManager", () => {
  beforeEach(() => {
    organizationManager._clearOrganizationManager();
    rbacManager._clearRBACManager();
    workspaceManager._clearWorkspaceManager();
    teamManager._clearTeamManager();
  });

  it("should create custom role", () => {
    const roleId = rbacManager.createRole("org_test", {
      name: "Custom Role",
      permissions: ["strategy.create", "trade.execute"],
      description: "A custom role",
    });

    expect(roleId).toMatch(/^role_/);
    const perms = rbacManager.getRolePermissions(roleId);
    expect(perms).toContain("strategy.create");
    expect(perms).toContain("trade.execute");
  });

  it("should assign role to user", () => {
    const roleId = rbacManager.createRole("org_test", {
      name: "Test Role",
      permissions: ["trade.execute"],
    });

    const assignId = rbacManager.assignRole("org_test", "user_123", roleId);
    expect(assignId).toMatch(/^assign_/);
  });

  it("should assign built-in admin role", () => {
    const assignId = rbacManager.assignRole("org_test", "user_123", "role_admin");
    expect(assignId).toMatch(/^assign_/);

    const hasPermission = rbacManager.checkPermission(
      "org_test",
      "user_123",
      "system.admin"
    );
    expect(hasPermission).toBe(true);
  });

  it("should assign built-in operator role", () => {
    const assignId = rbacManager.assignRole("org_test", "user_123", "role_operator");
    expect(assignId).toMatch(/^assign_/);

    expect(
      rbacManager.checkPermission("org_test", "user_123", "strategy.create")
    ).toBe(true);
    expect(
      rbacManager.checkPermission("org_test", "user_123", "system.admin")
    ).toBe(false);
  });

  it("should assign built-in trader role", () => {
    rbacManager.assignRole("org_test", "user_123", "role_trader");

    expect(
      rbacManager.checkPermission("org_test", "user_123", "trade.execute")
    ).toBe(true);
    expect(
      rbacManager.checkPermission("org_test", "user_123", "strategy.create")
    ).toBe(false);
  });

  it("should assign built-in viewer role", () => {
    rbacManager.assignRole("org_test", "user_123", "role_viewer");

    expect(
      rbacManager.checkPermission("org_test", "user_123", "audit.view")
    ).toBe(true);
    expect(
      rbacManager.checkPermission("org_test", "user_123", "trade.execute")
    ).toBe(false);
  });

  it("should assign built-in auditor role", () => {
    rbacManager.assignRole("org_test", "user_123", "role_auditor");

    expect(
      rbacManager.checkPermission("org_test", "user_123", "audit.view")
    ).toBe(true);
    expect(
      rbacManager.checkPermission("org_test", "user_123", "trade.execute")
    ).toBe(false);
  });

  it("should revoke role from user", () => {
    const roleId = rbacManager.createRole("org_test", {
      name: "Test Role",
      permissions: ["trade.execute"],
    });

    rbacManager.assignRole("org_test", "user_123", roleId);
    rbacManager.revokeRole("org_test", "user_123", roleId);

    const hasPermission = rbacManager.checkPermission(
      "org_test",
      "user_123",
      "trade.execute"
    );
    expect(hasPermission).toBe(false);
  });

  it("should check permission correctly", () => {
    const roleId = rbacManager.createRole("org_test", {
      name: "Test Role",
      permissions: ["strategy.create"],
    });

    rbacManager.assignRole("org_test", "user_123", roleId);

    expect(
      rbacManager.checkPermission("org_test", "user_123", "strategy.create")
    ).toBe(true);
    expect(
      rbacManager.checkPermission("org_test", "user_123", "trade.execute")
    ).toBe(false);
  });

  it("should return false for unassigned permission", () => {
    const hasPermission = rbacManager.checkPermission(
      "org_test",
      "user_unknown",
      "strategy.create"
    );
    expect(hasPermission).toBe(false);
  });

  it("should get user roles", () => {
    const roleId = rbacManager.createRole("org_test", {
      name: "Test Role",
      permissions: ["strategy.create"],
    });

    rbacManager.assignRole("org_test", "user_123", roleId);
    const roles = rbacManager.getUserRoles("org_test", "user_123");

    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe(roleId);
  });

  it("should get role permissions", () => {
    const roleId = rbacManager.createRole("org_test", {
      name: "Test Role",
      permissions: ["strategy.create", "trade.execute"],
    });

    const perms = rbacManager.getRolePermissions(roleId);
    expect(perms).toContain("strategy.create");
    expect(perms).toContain("trade.execute");
  });

  it("should list roles for organization", () => {
    const role1 = rbacManager.createRole("org_test", {
      name: "Role 1",
      permissions: ["strategy.create"],
    });
    const role2 = rbacManager.createRole("org_test", {
      name: "Role 2",
      permissions: ["trade.execute"],
    });

    const roles = rbacManager.listRoles("org_test");
    const roleIds = roles.map((r) => r.id);
    expect(roleIds).toContain(role1);
    expect(roleIds).toContain(role2);
  });

  it("should include built-in roles in list", () => {
    const roles = rbacManager.listRoles("org_test");
    const roleNames = roles.map((r) => r.name);
    expect(roleNames).toContain("admin");
    expect(roleNames).toContain("operator");
    expect(roleNames).toContain("trader");
    expect(roleNames).toContain("viewer");
    expect(roleNames).toContain("auditor");
  });

  it("should build permission matrix for organization", () => {
    const roleId = rbacManager.createRole("org_test", {
      name: "Test Role",
      permissions: ["strategy.create", "trade.execute"],
    });

    rbacManager.assignRole("org_test", "user_123", roleId);

    const matrix = rbacManager.getPermissionMatrix("org_test");
    expect(matrix["user_123"]["strategy.create"]).toBe(true);
    expect(matrix["user_123"]["trade.execute"]).toBe(true);
    expect(matrix["user_123"]["system.admin"]).toBe(false);
  });

  it("should build permission matrix with multiple users", () => {
    const adminRoleId = rbacManager.createRole("org_test", {
      name: "Admin Role",
      permissions: ["system.admin"],
    });
    const traderRoleId = rbacManager.createRole("org_test", {
      name: "Trader Role",
      permissions: ["trade.execute"],
    });

    rbacManager.assignRole("org_test", "user_admin", adminRoleId);
    rbacManager.assignRole("org_test", "user_trader", traderRoleId);

    const matrix = rbacManager.getPermissionMatrix("org_test");
    expect(matrix["user_admin"]["system.admin"]).toBe(true);
    expect(matrix["user_admin"]["trade.execute"]).toBe(false);
    expect(matrix["user_trader"]["trade.execute"]).toBe(true);
    expect(matrix["user_trader"]["system.admin"]).toBe(false);
  });

  it("should throw error when assigning non-existent role", () => {
    expect(() => {
      rbacManager.assignRole("org_test", "user_123", "role_nonexistent");
    }).toThrow();
  });
});

describe("WorkspaceManager", () => {
  beforeEach(() => {
    organizationManager._clearOrganizationManager();
    rbacManager._clearRBACManager();
    workspaceManager._clearWorkspaceManager();
    teamManager._clearTeamManager();
  });

  it("should create trading workspace", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Trading Workspace",
      type: "trading",
      isolation: "full",
    });

    expect(wsId).toMatch(/^ws_/);
    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.name).toBe("Trading Workspace");
    expect(ws?.type).toBe("trading");
  });

  it("should create research workspace", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Research Workspace",
      type: "research",
      isolation: "shared",
    });

    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.type).toBe("research");
    expect(ws?.isolation).toBe("shared");
  });

  it("should create paper trading workspace", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Paper Trading",
      type: "paper",
      isolation: "full",
    });

    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.type).toBe("paper");
  });

  it("should create staging workspace", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Staging",
      type: "staging",
      isolation: "shared",
    });

    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.type).toBe("staging");
  });

  it("should get workspace by ID", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Test Workspace",
      type: "trading",
      isolation: "full",
    });

    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.id).toBe(wsId);
  });

  it("should list workspaces for organization", () => {
    const ws1 = workspaceManager.createWorkspace("org_test", {
      name: "Workspace 1",
      type: "trading",
      isolation: "full",
    });
    const ws2 = workspaceManager.createWorkspace("org_test", {
      name: "Workspace 2",
      type: "research",
      isolation: "shared",
    });

    const workspaces = workspaceManager.listWorkspaces("org_test");
    expect(workspaces).toHaveLength(2);
    expect(workspaces.map((w) => w.id)).toContain(ws1);
    expect(workspaces.map((w) => w.id)).toContain(ws2);
  });

  it("should add member to workspace", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Test Workspace",
      type: "trading",
      isolation: "full",
    });

    workspaceManager.addMember(wsId, "user_123", "trader");
    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.members).toHaveLength(1);
    expect(ws?.members[0].userId).toBe("user_123");
    expect(ws?.members[0].role).toBe("trader");
  });

  it("should not add duplicate member to workspace", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Test Workspace",
      type: "trading",
      isolation: "full",
    });

    workspaceManager.addMember(wsId, "user_123", "trader");
    workspaceManager.addMember(wsId, "user_123", "admin");
    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.members).toHaveLength(1);
  });

  it("should remove member from workspace", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Test Workspace",
      type: "trading",
      isolation: "full",
    });

    workspaceManager.addMember(wsId, "user_123", "trader");
    workspaceManager.removeMember(wsId, "user_123");
    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.members).toHaveLength(0);
  });

  it("should archive workspace", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Test Workspace",
      type: "trading",
      isolation: "full",
    });

    workspaceManager.archiveWorkspace(wsId);
    const ws = workspaceManager.getWorkspace(wsId);
    expect(ws?.status).toBe("archived");
  });

  it("should track workspace activity", () => {
    const wsId = workspaceManager.createWorkspace("org_test", {
      name: "Test Workspace",
      type: "trading",
      isolation: "full",
    });

    workspaceManager.addMember(wsId, "user_123", "trader");
    const activity = workspaceManager.getWorkspaceActivity(wsId);
    expect(activity.length).toBeGreaterThan(0);
  });

  it("should throw error for non-existent workspace", () => {
    expect(() => {
      workspaceManager.removeMember("ws_nonexistent", "user_123");
    }).toThrow();
  });
});

describe("TeamManager", () => {
  beforeEach(() => {
    organizationManager._clearOrganizationManager();
    rbacManager._clearRBACManager();
    workspaceManager._clearWorkspaceManager();
    teamManager._clearTeamManager();
  });

  it("should invite member to organization", () => {
    const inviteId = teamManager.inviteMember(
      "org_test",
      "newuser@example.com",
      "trader"
    );

    expect(inviteId).toMatch(/^invite_/);
  });

  it("should list pending invites", () => {
    const invite1 = teamManager.inviteMember("org_test", "user1@example.com");
    const invite2 = teamManager.inviteMember("org_test", "user2@example.com");

    const invites = teamManager.listInvites("org_test");
    expect(invites).toHaveLength(2);
    expect(invites.map((i) => i.id)).toContain(invite1);
    expect(invites.map((i) => i.id)).toContain(invite2);
  });

  it("should accept invite and create user", () => {
    const inviteId = teamManager.inviteMember("org_test", "newuser@example.com");
    const userId = teamManager.acceptInvite(inviteId);

    expect(userId).toMatch(/^user_/);
  });

  it("should remove member from organization", () => {
    const inviteId = teamManager.inviteMember("org_test", "newuser@example.com");
    const userId = teamManager.acceptInvite(inviteId);

    teamManager.removeMember("org_test", userId);
    const members = teamManager.listMembers("org_test");
    expect(members).toHaveLength(0);
  });

  it("should list organization members", () => {
    const inviteId1 = teamManager.inviteMember("org_test", "user1@example.com");
    const userId1 = teamManager.acceptInvite(inviteId1);
    const inviteId2 = teamManager.inviteMember("org_test", "user2@example.com");
    const userId2 = teamManager.acceptInvite(inviteId2);

    const members = teamManager.listMembers("org_test");
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.id)).toContain(userId1);
    expect(members.map((m) => m.id)).toContain(userId2);
  });

  it("should transfer ownership to new user", () => {
    const inviteId = teamManager.inviteMember("org_test", "newowner@example.com");
    const userId = teamManager.acceptInvite(inviteId);

    expect(() => {
      teamManager.transferOwnership("org_test", userId);
    }).not.toThrow();
  });

  it("should throw error when accepting non-existent invite", () => {
    expect(() => {
      teamManager.acceptInvite("invite_nonexistent");
    }).toThrow();
  });

  it("should throw error when removing member not in org", () => {
    expect(() => {
      teamManager.removeMember("org_test", "user_nonexistent");
    }).toThrow();
  });

  it("should throw error transferring ownership to non-existent user", () => {
    expect(() => {
      teamManager.transferOwnership("org_test", "user_nonexistent");
    }).toThrow();
  });

  it("should set invite role when provided", () => {
    const inviteId = teamManager.inviteMember(
      "org_test",
      "admin@example.com",
      "admin"
    );
    const invites = teamManager.listInvites("org_test");
    const invite = invites.find((i) => i.id === inviteId);
    expect(invite?.role).toBe("admin");
  });
});

describe("Multi-Tenant Integration", () => {
  beforeEach(() => {
    organizationManager._clearOrganizationManager();
    rbacManager._clearRBACManager();
    workspaceManager._clearWorkspaceManager();
    teamManager._clearTeamManager();
  });

  it("should create organization with team and workspace", () => {
    const orgId = organizationManager.createOrg({
      name: "Integration Test Org",
      plan: "pro",
      ownerEmail: "owner@example.com",
    });

    const inviteId = teamManager.inviteMember(orgId, "user1@example.com");
    const userId = teamManager.acceptInvite(inviteId);

    const wsId = workspaceManager.createWorkspace(orgId, {
      name: "Test Workspace",
      type: "trading",
      isolation: "full",
    });

    workspaceManager.addMember(wsId, userId, "trader");

    const org = organizationManager.getOrg(orgId);
    const members = teamManager.listMembers(orgId);
    const workspaces = workspaceManager.listWorkspaces(orgId);

    expect(org?.name).toBe("Integration Test Org");
    expect(members).toHaveLength(1);
    expect(workspaces).toHaveLength(1);
  });

  it("should manage RBAC across organization", () => {
    const orgId = organizationManager.createOrg({
      name: "RBAC Test Org",
      plan: "team",
      ownerEmail: "owner@example.com",
    });

    const inviteId = teamManager.inviteMember(orgId, "admin@example.com");
    const adminId = teamManager.acceptInvite(inviteId);

    rbacManager.assignRole(orgId, adminId, "role_admin");

    const canCreateStrategy = rbacManager.checkPermission(
      orgId,
      adminId,
      "strategy.create"
    );
    const canSuspendOrg = rbacManager.checkPermission(
      orgId,
      adminId,
      "system.admin"
    );

    expect(canCreateStrategy).toBe(true);
    expect(canSuspendOrg).toBe(true);
  });

  it("should isolate organizations and their data", () => {
    const org1Id = organizationManager.createOrg({
      name: "Org 1",
      plan: "retail",
      ownerEmail: "org1@example.com",
    });
    const org2Id = organizationManager.createOrg({
      name: "Org 2",
      plan: "retail",
      ownerEmail: "org2@example.com",
    });

    const ws1 = workspaceManager.createWorkspace(org1Id, {
      name: "Org1 Workspace",
      type: "trading",
      isolation: "full",
    });
    const ws2 = workspaceManager.createWorkspace(org2Id, {
      name: "Org2 Workspace",
      type: "trading",
      isolation: "full",
    });

    const org1Workspaces = workspaceManager.listWorkspaces(org1Id);
    const org2Workspaces = workspaceManager.listWorkspaces(org2Id);

    expect(org1Workspaces).toHaveLength(1);
    expect(org2Workspaces).toHaveLength(1);
    expect(org1Workspaces[0].id).toBe(ws1);
    expect(org2Workspaces[0].id).toBe(ws2);
  });
});
