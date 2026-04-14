/**
 * routes/multi_tenant.ts — Phase 57 HTTP surface for multi-tenant primitives.
 */

import { Router, Request, Response } from "express";
import {
  organizationManager,
  rbacManager,
  workspaceManager,
  teamManager,
  type Plan,
  type Permission,
} from "../lib/multi_tenant";
import { logger } from "../lib/logger";

const router = Router();

// ── Organizations ───────────────────────────────────────────────────────────

router.post("/api/tenant/orgs", (req: Request, res: Response) => {
  try {
    const { name, plan, ownerUserId, metadata } = req.body ?? {};
    if (!name || !plan || !ownerUserId) {
      return res.status(400).json({ error: "Missing name, plan, or ownerUserId" });
    }
    const org = organizationManager.create({ name, plan: plan as Plan, ownerUserId, metadata });
    return res.status(201).json(org);
  } catch (err) {
    logger.error({ err }, "Failed to create org");
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/tenant/orgs", (_req: Request, res: Response) => {
  res.json({ orgs: organizationManager.list() });
});

router.get("/api/tenant/orgs/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const org = organizationManager.get(id);
  if (!org) return res.status(404).json({ error: "Not found" });
  const limits = organizationManager.limits(id);
  return res.json({ org, limits });
});

router.patch("/api/tenant/orgs/:id/plan", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { plan } = req.body ?? {};
  if (!plan) return res.status(400).json({ error: "Missing plan" });
  const org = organizationManager.changePlan(id, plan as Plan);
  if (!org) return res.status(404).json({ error: "Not found" });
  return res.json(org);
});

// ── RBAC ────────────────────────────────────────────────────────────────────

router.get("/api/tenant/rbac/roles", (_req: Request, res: Response) => {
  res.json({ roles: rbacManager.listRoles() });
});

router.post("/api/tenant/rbac/roles", (req: Request, res: Response) => {
  const { name, permissions } = req.body ?? {};
  if (!name || !Array.isArray(permissions)) {
    return res.status(400).json({ error: "Missing name or permissions[]" });
  }
  const role = rbacManager.createRole(name, permissions as Permission[]);
  return res.status(201).json(role);
});

router.post("/api/tenant/rbac/assign", (req: Request, res: Response) => {
  const { userId, roleId } = req.body ?? {};
  if (!userId || !roleId) return res.status(400).json({ error: "Missing userId or roleId" });
  const ok = rbacManager.assign(userId, roleId);
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Role not found" });
});

router.post("/api/tenant/rbac/revoke", (req: Request, res: Response) => {
  const { userId, roleId } = req.body ?? {};
  if (!userId || !roleId) return res.status(400).json({ error: "Missing userId or roleId" });
  const ok = rbacManager.revoke(userId, roleId);
  return res.json({ ok });
});

router.get("/api/tenant/rbac/user/:userId", (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  res.json({ userId, roles: rbacManager.rolesForUser(userId) });
});

router.get("/api/tenant/rbac/check", (req: Request, res: Response) => {
  const userId = String(req.query.userId ?? "");
  const permission = String(req.query.permission ?? "") as Permission;
  if (!userId || !permission) return res.status(400).json({ error: "Missing userId or permission" });
  return res.json({ userId, permission, allowed: rbacManager.can(userId, permission) });
});

// ── Workspaces ──────────────────────────────────────────────────────────────

router.post("/api/tenant/workspaces", (req: Request, res: Response) => {
  const { orgId, name, metadata } = req.body ?? {};
  if (!orgId || !name) return res.status(400).json({ error: "Missing orgId or name" });
  const ws = workspaceManager.create({ orgId, name, metadata });
  return res.status(201).json(ws);
});

router.get("/api/tenant/workspaces", (req: Request, res: Response) => {
  const orgId = String(req.query.orgId ?? "");
  if (!orgId) return res.status(400).json({ error: "Missing orgId" });
  return res.json({ workspaces: workspaceManager.listByOrg(orgId) });
});

router.post("/api/tenant/workspaces/:id/archive", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ok = workspaceManager.archive(id);
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

// ── Teams ───────────────────────────────────────────────────────────────────

router.post("/api/tenant/teams", (req: Request, res: Response) => {
  const { workspaceId, name } = req.body ?? {};
  if (!workspaceId || !name) return res.status(400).json({ error: "Missing workspaceId or name" });
  const team = teamManager.create({ workspaceId, name });
  return res.status(201).json({ ...team, members: Array.from(team.members) });
});

router.get("/api/tenant/teams", (req: Request, res: Response) => {
  const workspaceId = String(req.query.workspaceId ?? "");
  if (!workspaceId) return res.status(400).json({ error: "Missing workspaceId" });
  const teams = teamManager.listByWorkspace(workspaceId).map((t) => ({ ...t, members: Array.from(t.members) }));
  return res.json({ teams });
});

router.post("/api/tenant/teams/:id/members", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  const ok = teamManager.addMember(id, userId);
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Team not found" });
});

router.delete("/api/tenant/teams/:id/members/:userId", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const userId = String(req.params.userId);
  const ok = teamManager.removeMember(id, userId);
  return res.json({ ok });
});

export default router;
