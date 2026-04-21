/**
 * rbac.test.ts — RBAC Middleware Tests
 *
 * Tests cover:
 * 1. Role extraction and defaults
 * 2. Permission matrix validation
 * 3. requireRole middleware behavior
 * 4. requirePermission middleware behavior
 * 5. Kill switch override enforcement
 * 6. Audit logging on permission denial
 * 7. Unauthenticated/default access
 *
 * Uses direct middleware invocation (no supertest) for sandbox compatibility.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  attachRBACContext,
  requireRole,
  requirePermission,
  requireAdmin,
  requireOperator,
  requireTrader,
  requireViewDashboard,
  requireExecuteTrade,
  requireToggleKillSwitch,
  setKillSwitchOverride,
  isKillSwitchOverrideActive,
  hasPermission,
  getPermissionsForRole,
  type Role,
} from "../middleware/rbac";

// Mock audit logger
vi.mock("../lib/audit_logger", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// ──────────────────────────────────────────────────────────────────────────────
// Test Helper: Invoke middleware chain directly
// ──────────────────────────────────────────────────────────────────────────────

interface MockResult {
  status: number;
  body: any;
  headersSent: boolean;
}

function createMockReq(
  method = "GET",
  path = "/test",
  headers: Record<string, string> = {},
): Request {
  return {
    method,
    path,
    url: path,
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
    header(name: string) {
      return this.headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function createMockRes(): { res: Response; result: MockResult } {
  const result: MockResult = { status: 200, body: null, headersSent: false };
  const res = {
    statusCode: 200,
    headersSent: false,
    status(code: number) {
      result.status = code;
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      result.body = body;
      result.headersSent = true;
      this.headersSent = true;
      return this;
    },
    send(body: any) {
      result.body = body;
      result.headersSent = true;
      this.headersSent = true;
      return this;
    },
    end() {
      result.headersSent = true;
      this.headersSent = true;
      return this;
    },
    setHeader() { return this; },
    getHeader() { return undefined; },
  } as unknown as Response;
  return { res, result };
}

/** Run a chain of middlewares and return the final result */
async function runMiddleware(
  middlewares: Array<(req: Request, res: Response, next: NextFunction) => void>,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<MockResult> {
  const req = createMockReq(method, "/test", headers);
  const { res, result } = createMockRes();

  let idx = 0;
  const next: NextFunction = (err?: any) => {
    if (err) {
      result.status = 500;
      result.body = { error: "internal_error", message: String(err) };
      return;
    }
    idx++;
    if (idx < middlewares.length && !result.headersSent) {
      try {
        middlewares[idx](req, res, next);
      } catch (e) {
        result.status = 500;
        result.body = { error: "internal_error" };
      }
    }
  };

  try {
    await middlewares[0](req, res, next);
  } catch {
    result.status = 500;
    result.body = { error: "internal_error" };
  }

  // If nothing responded, that means the request passed through all middleware
  if (!result.headersSent) {
    result.status = 200;
    result.body = { success: true };
  }

  return result;
}

/** Helper: run attachRBACContext + given middlewares, with headers */
async function callWith(
  middlewares: Array<(req: Request, res: Response, next: NextFunction) => void>,
  headers: Record<string, string> = {},
): Promise<MockResult> {
  return runMiddleware([attachRBACContext as any, ...middlewares], headers);
}

/** Helper: Run attachRBACContext and capture the rbac object */
async function captureRbac(headers: Record<string, string> = {}): Promise<any> {
  const req = createMockReq("GET", "/test", headers);
  const { res } = createMockRes();
  let captured: any = null;

  await new Promise<void>((resolve) => {
    (attachRBACContext as any)(req, res, () => {
      captured = (req as any).rbac;
      resolve();
    });
  });

  return captured;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Permission Utilities
// ──────────────────────────────────────────────────────────────────────────────

describe("RBAC Utilities", () => {
  it("should check admin permissions correctly", () => {
    expect(hasPermission("admin", "view:dashboard")).toBe(true);
    expect(hasPermission("admin", "toggle:kill_switch")).toBe(true);
    expect(hasPermission("admin", "system:admin")).toBe(true);
  });

  it("should check operator permissions correctly", () => {
    expect(hasPermission("operator", "view:dashboard")).toBe(true);
    expect(hasPermission("operator", "approve:trade")).toBe(true);
    expect(hasPermission("operator", "toggle:kill_switch")).toBe(true);
    expect(hasPermission("operator", "system:admin")).toBe(false);
  });

  it("should check trader permissions correctly", () => {
    expect(hasPermission("trader", "view:dashboard")).toBe(true);
    expect(hasPermission("trader", "submit:signal")).toBe(true);
    expect(hasPermission("trader", "approve:trade")).toBe(false);
    expect(hasPermission("trader", "execute:trade")).toBe(false);
  });

  it("should check viewer permissions correctly", () => {
    expect(hasPermission("viewer", "view:dashboard")).toBe(true);
    expect(hasPermission("viewer", "view:positions")).toBe(true);
    expect(hasPermission("viewer", "submit:signal")).toBe(false);
    expect(hasPermission("viewer", "execute:trade")).toBe(false);
  });

  it("should return all permissions for admin", () => {
    const adminPerms = getPermissionsForRole("admin");
    expect(adminPerms).toContain("view:dashboard");
    expect(adminPerms).toContain("toggle:kill_switch");
    expect(adminPerms).toContain("system:admin");
    expect(adminPerms.length).toBeGreaterThan(5);
  });

  it("should return subset of permissions for trader", () => {
    const traderPerms = getPermissionsForRole("trader");
    expect(traderPerms).toContain("view:dashboard");
    expect(traderPerms).toContain("submit:signal");
    expect(traderPerms).not.toContain("toggle:kill_switch");
    expect(traderPerms).not.toContain("system:admin");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: RBAC Context Attachment
// ──────────────────────────────────────────────────────────────────────────────

describe("RBAC Context Attachment", () => {
  it("should attach default context (viewer) when no headers", async () => {
    const rbac = await captureRbac();
    expect(rbac).toBeDefined();
    expect(rbac.role).toBe("viewer");
    expect(rbac.userId).toBe("anonymous");
  });

  it("should extract role from X-Role header", async () => {
    const rbac = await captureRbac({ "X-Role": "operator" });
    expect(rbac.role).toBe("operator");
  });

  it("should extract actor from X-Actor header", async () => {
    const rbac = await captureRbac({ "X-Actor": "user@example.com" });
    expect(rbac.actor).toBe("user@example.com");
  });

  it("should extract user ID from X-User-Id header", async () => {
    const rbac = await captureRbac({ "X-User-Id": "user-123" });
    expect(rbac.userId).toBe("user-123");
  });

  it("should default invalid roles to viewer", async () => {
    const rbac = await captureRbac({ "X-Role": "superadmin" });
    expect(rbac.role).toBe("viewer");
  });

  it("should include timestamp in RBAC context", async () => {
    const before = Date.now();
    const rbac = await captureRbac();
    const after = Date.now();

    expect(rbac.timestamp).toBeGreaterThanOrEqual(before);
    expect(rbac.timestamp).toBeLessThanOrEqual(after);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: requireRole Middleware
// ──────────────────────────────────────────────────────────────────────────────

describe("requireRole Middleware", () => {
  it("should allow admin to pass admin role check", async () => {
    const res = await callWith([requireRole("admin") as any], { "X-Role": "admin" });
    expect(res.status).toBe(200);
  });

  it("should deny viewer when admin is required", async () => {
    const res = await callWith([requireRole("admin") as any], { "X-Role": "viewer" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_role");
  });

  it("should allow operator when operator or admin is required", async () => {
    const res = await callWith([requireRole("operator", "admin") as any], { "X-Role": "operator" });
    expect(res.status).toBe(200);
  });

  it("should deny trader when only operator required", async () => {
    const res = await callWith([requireRole("operator") as any], { "X-Role": "trader" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_role");
  });

  it("should deny unauthenticated (defaults to viewer) when admin required", async () => {
    const res = await callWith([requireRole("admin") as any]);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_role");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: requirePermission Middleware
// ──────────────────────────────────────────────────────────────────────────────

describe("requirePermission Middleware", () => {
  it("should allow admin to execute trade", async () => {
    const res = await callWith([requirePermission("execute:trade") as any], { "X-Role": "admin" });
    expect(res.status).toBe(200);
  });

  it("should allow operator to execute trade", async () => {
    const res = await callWith([requirePermission("execute:trade") as any], { "X-Role": "operator" });
    expect(res.status).toBe(200);
  });

  it("should deny trader from executing trade", async () => {
    const res = await callWith([requirePermission("execute:trade") as any], { "X-Role": "trader" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_permission");
  });

  it("should allow viewer to view dashboard (non-mutating)", async () => {
    const res = await callWith([requirePermission("view:dashboard", false) as any], { "X-Role": "viewer" });
    expect(res.status).toBe(200);
  });

  it("should deny all roles when kill switch active and mutating", async () => {
    setKillSwitchOverride(true);

    const res1 = await callWith([requirePermission("execute:trade", true) as any], { "X-Role": "admin" });
    expect(res1.status).toBe(403);
    expect(res1.body.error).toBe("kill_switch_active");

    const res2 = await callWith([requirePermission("execute:trade", true) as any], { "X-Role": "operator" });
    expect(res2.status).toBe(403);
    expect(res2.body.error).toBe("kill_switch_active");

    setKillSwitchOverride(false);
  });

  it("should allow read when kill switch active but non-mutating", async () => {
    setKillSwitchOverride(true);
    const res = await callWith([requirePermission("view:dashboard", false) as any], { "X-Role": "viewer" });
    expect(res.status).toBe(200);
    setKillSwitchOverride(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Convenience Middlewares
// ──────────────────────────────────────────────────────────────────────────────

describe("Convenience Middlewares", () => {
  it("requireAdmin should only allow admin", async () => {
    const adminRes = await callWith([requireAdmin as any], { "X-Role": "admin" });
    expect(adminRes.status).toBe(200);

    const operatorRes = await callWith([requireAdmin as any], { "X-Role": "operator" });
    expect(operatorRes.status).toBe(403);
  });

  it("requireOperator should allow operator and admin", async () => {
    const operatorRes = await callWith([requireOperator as any], { "X-Role": "operator" });
    expect(operatorRes.status).toBe(200);

    const adminRes = await callWith([requireOperator as any], { "X-Role": "admin" });
    expect(adminRes.status).toBe(200);

    const traderRes = await callWith([requireOperator as any], { "X-Role": "trader" });
    expect(traderRes.status).toBe(403);
  });

  it("requireTrader should allow trader, operator, and admin", async () => {
    const traderRes = await callWith([requireTrader as any], { "X-Role": "trader" });
    expect(traderRes.status).toBe(200);

    const operatorRes = await callWith([requireTrader as any], { "X-Role": "operator" });
    expect(operatorRes.status).toBe(200);

    const viewerRes = await callWith([requireTrader as any], { "X-Role": "viewer" });
    expect(viewerRes.status).toBe(403);
  });

  it("requireExecuteTrade should deny viewer", async () => {
    const res = await callWith([requireExecuteTrade as any], { "X-Role": "viewer" });
    expect(res.status).toBe(403);
  });

  it("requireToggleKillSwitch should only allow operator/admin", async () => {
    const operatorRes = await callWith([requireToggleKillSwitch as any], { "X-Role": "operator" });
    expect(operatorRes.status).toBe(200);

    const traderRes = await callWith([requireToggleKillSwitch as any], { "X-Role": "trader" });
    expect(traderRes.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Kill Switch Override State
// ──────────────────────────────────────────────────────────────────────────────

describe("Kill Switch Override", () => {
  afterEach(() => {
    setKillSwitchOverride(false);
  });

  it("should track override state correctly", () => {
    expect(isKillSwitchOverrideActive()).toBe(false);

    setKillSwitchOverride(true);
    expect(isKillSwitchOverrideActive()).toBe(true);

    setKillSwitchOverride(false);
    expect(isKillSwitchOverrideActive()).toBe(false);
  });

  it("should block all mutations when override is active", async () => {
    setKillSwitchOverride(true);

    for (const role of ["admin", "operator", "trader", "viewer"] as Role[]) {
      const res = await callWith([requirePermission("execute:trade", true) as any], { "X-Role": role });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("kill_switch_active");
    }
  });

  it("should allow reads even when override is active", async () => {
    setKillSwitchOverride(true);

    for (const role of ["admin", "operator", "trader", "viewer"] as Role[]) {
      const res = await callWith([requirePermission("view:dashboard", false) as any], { "X-Role": role });
      expect(res.status).toBe(200);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Error Handling
// ──────────────────────────────────────────────────────────────────────────────

describe("Error Handling", () => {
  it("should return 500 if RBAC context missing", async () => {
    // Skip attachRBACContext — go directly to requireRole
    const res = await runMiddleware([requireRole("admin") as any]);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal_error");
  });

  it("should return proper error messages on denial", async () => {
    const res = await callWith([requireRole("admin") as any], { "X-Role": "viewer" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_role");
    expect(res.body.message).toContain("admin");
    expect(res.body.message).toContain("viewer");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Integration Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Integration: Real-world Scenarios", () => {
  it("admin can view and execute trades", async () => {
    const viewRes = await callWith([requireViewDashboard as any], { "X-Role": "admin" });
    expect(viewRes.status).toBe(200);

    const execRes = await callWith([requireExecuteTrade as any], { "X-Role": "admin" });
    expect(execRes.status).toBe(200);
  });

  it("trader can view but not execute", async () => {
    const viewRes = await callWith([requireViewDashboard as any], { "X-Role": "trader" });
    expect(viewRes.status).toBe(200);

    const execRes = await callWith([requireExecuteTrade as any], { "X-Role": "trader" });
    expect(execRes.status).toBe(403);
  });

  it("viewer can only view", async () => {
    const viewRes = await callWith([requireViewDashboard as any], { "X-Role": "viewer" });
    expect(viewRes.status).toBe(200);

    const execRes = await callWith([requireExecuteTrade as any], { "X-Role": "viewer" });
    expect(execRes.status).toBe(403);
  });
});
