import express, { Request, Response } from "express";
import {
  organizationManager,
  rbacManager,
  workspaceManager,
  teamManager,
} from "../lib/multi_tenant/index.js";

const router = express.Router();

// Organization endpoints
router.post("/api/orgs", (req: Request, res: Response) => {
  try {
    const { name, plan, ownerEmail } = req.body;
    const orgId = organizationManager.createOrg({ name, plan, ownerEmail });
    res.json({ ok: true, data: { orgId } });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/api/orgs", (req: Request, res: Response) => {
  try {
    const orgs = organizationManager.listOrgs();
    res.json({ ok: true, data: orgs });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/api/orgs/stats", (req: Request, res: Response) => {
  try {
    const stats = organizationManager.getOrgStats();
    res.json({ ok: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/api/orgs/:orgId", (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const org = organizationManager.getOrg(orgId);
    if (!org) throw new Error(`Organization ${orgId} not found`);
    res.json({ ok: true, data: org });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch("/api/orgs/:orgId", (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const updates = req.body;
    const org = organizationManager.updateOrg(orgId, updates);
    res.json({ ok: true, data: org });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/api/orgs/:orgId/suspend", (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const org = organizationManager.suspendOrg(orgId);
    res.json({ ok: true, data: org });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete("/api/orgs/:orgId", (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    organizationManager.deleteOrg(orgId);
    res.json({ ok: true, data: { deleted: orgId } });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Role endpoints
router.post("/api/orgs/:orgId/roles", (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { name, permissions, description } = req.body;
    const roleId = rbacManager.createRole(orgId, {
      name,
      permissions,
      description,
    });
    res.json({ ok: true, data: { roleId } });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/api/orgs/:orgId/roles", (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const roles = rbacManager.listRoles(orgId);
    res.json({ ok: true, data: roles });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post(
  "/api/orgs/:orgId/roles/assign",
  (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const { userId, roleId } = req.body;
      const assignId = rbacManager.assignRole(orgId, userId, roleId);
      res.json({ ok: true, data: { assignId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.delete(
  "/api/orgs/:orgId/roles/revoke",
  (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const { userId, roleId } = req.body;
      rbacManager.revokeRole(orgId, userId, roleId);
      res.json({ ok: true, data: { revoked: true } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/orgs/:orgId/permissions/:userId",
  (req: Request, res: Response) => {
    try {
      const { orgId, userId } = req.params;
      const roles = rbacManager.getUserRoles(orgId, userId);
      res.json({ ok: true, data: roles });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/orgs/:orgId/permissions/check",
  (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const { userId, permission } = req.body;
      const hasPermission = rbacManager.checkPermission(
        orgId,
        userId,
        permission
      );
      res.json({ ok: true, data: { hasPermission } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/orgs/:orgId/permission-matrix",
  (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const matrix = rbacManager.getPermissionMatrix(orgId);
      res.json({ ok: true, data: matrix });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Workspace endpoints
router.post(
  "/api/orgs/:orgId/workspaces",
  (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const { name, type, isolation } = req.body;
      const wsId = workspaceManager.createWorkspace(orgId, {
        name,
        type,
        isolation,
      });
      res.json({ ok: true, data: { wsId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/orgs/:orgId/workspaces",
  (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const workspaces = workspaceManager.listWorkspaces(orgId);
      res.json({ ok: true, data: workspaces });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/orgs/:orgId/workspaces/:wsId",
  (req: Request, res: Response) => {
    try {
      const { wsId } = req.params;
      const workspace = workspaceManager.getWorkspace(wsId);
      if (!workspace) throw new Error(`Workspace ${wsId} not found`);
      res.json({ ok: true, data: workspace });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/orgs/:orgId/workspaces/:wsId/members",
  (req: Request, res: Response) => {
    try {
      const { wsId } = req.params;
      const { userId, role } = req.body;
      workspaceManager.addMember(wsId, userId, role);
      res.json({ ok: true, data: { added: true } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.delete(
  "/api/orgs/:orgId/workspaces/:wsId/members/:userId",
  (req: Request, res: Response) => {
    try {
      const { wsId, userId } = req.params;
      workspaceManager.removeMember(wsId, userId);
      res.json({ ok: true, data: { removed: true } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/orgs/:orgId/workspaces/:wsId/archive",
  (req: Request, res: Response) => {
    try {
      const { wsId } = req.params;
      const workspace = workspaceManager.archiveWorkspace(wsId);
      res.json({ ok: true, data: workspace });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Team/Member endpoints
router.post(
  "/api/orgs/:orgId/members/invite",
  (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const { email, role } = req.body;
      const inviteId = teamManager.inviteMember(orgId, email, role);
      res.json({ ok: true, data: { inviteId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/orgs/:orgId/members/accept",
  (req: Request, res: Response) => {
    try {
      const { inviteId } = req.body;
      const userId = teamManager.acceptInvite(inviteId);
      res.json({ ok: true, data: { userId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.delete(
  "/api/orgs/:orgId/members/:userId",
  (req: Request, res: Response) => {
    try {
      const { orgId, userId } = req.params;
      teamManager.removeMember(orgId, userId);
      res.json({ ok: true, data: { removed: true } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get("/api/orgs/:orgId/members", (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const members = teamManager.listMembers(orgId);
    res.json({ ok: true, data: members });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/api/orgs/:orgId/invites", (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const invites = teamManager.listInvites(orgId);
    res.json({ ok: true, data: invites });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post(
  "/api/orgs/:orgId/transfer-ownership",
  (req: Request, res: Response) => {
    try {
      const { orgId } = req.params;
      const { newOwnerUserId } = req.body;
      teamManager.transferOwnership(orgId, newOwnerUserId);
      res.json({ ok: true, data: { transferred: true } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

export default router;
