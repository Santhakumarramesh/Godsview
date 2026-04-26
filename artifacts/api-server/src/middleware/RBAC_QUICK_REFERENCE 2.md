# RBAC Quick Reference Card

## Import Statement

```typescript
import {
  attachRBACContext,           // Attach RBAC context to request
  requireRole,                 // Require specific role(s)
  requirePermission,           // Require specific permission
  requireAdmin,                // Convenience: admin only
  requireOperator,             // Convenience: operator+ 
  requireTrader,               // Convenience: trader+
  requireExecuteTrade,         // Convenience: execute:trade permission
  requireToggleKillSwitch,     // Convenience: toggle:kill_switch permission
  hasPermission,               // Check permission programmatically
  getPermissionsForRole,       // Get all permissions for role
  setKillSwitchOverride,       // Activate/deactivate override
  isKillSwitchOverrideActive,  // Query override state
} from "../middleware/rbac";

import { auditKillSwitch } from "../lib/audit_logger";
```

## Most Common Patterns

### 1. Protect a Route (Use Pre-made Middleware)
```typescript
// Most common: protect trade execution
router.post("/trade/execute", requireExecuteTrade, handler);

// Only operator can toggle kill switch
router.post("/kill-switch", requireToggleKillSwitch, handler);

// Only admin
router.post("/admin/action", requireAdmin, handler);
```

### 2. Protect with Custom Permission
```typescript
// Non-mutating (read): allow all authenticated
router.get("/dashboard", requirePermission("view:dashboard", false), handler);

// Mutating: blocked by kill switch when active
router.post("/order", requirePermission("execute:trade", true), handler);
```

### 3. Multiple Roles Required
```typescript
// Allow operator OR admin
router.post("/risk/update", requireRole("operator", "admin"), handler);
```

### 4. Check Permission in Code
```typescript
const hasAccess = hasPermission(req.rbac?.role, "execute:trade");
if (!hasAccess) {
  return res.status(403).json({ error: "Insufficient permissions" });
}
```

### 5. Toggle Kill Switch
```typescript
router.post("/kill-switch", requireToggleKillSwitch, (req, res) => {
  const { active } = req.body;
  
  // Activate/deactivate
  setKillSwitchOverride(active);
  
  // Audit the change
  await auditKillSwitch(active, req.rbac?.actor || "system");
  
  res.json({ kill_switch_active: isKillSwitchOverrideActive() });
});
```

## Roles at a Glance

| Role | Can View | Can Submit | Can Approve | Can Execute | Can Manage |
|------|----------|-----------|------------|-------------|-----------|
| **admin** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **operator** | ✓ | ✗ | ✓ | ✓ | ✓ |
| **trader** | ✓ | ✓ | ✗ | ✗ | ✗ |
| **viewer** | ✓ | ✗ | ✗ | ✗ | ✗ |

## Send Headers in Requests

```bash
# As operator
curl -X POST https://api/trade \
  -H "X-Role: operator" \
  -H "X-Actor: john@company.com"

# As trader
curl -X POST https://api/signal \
  -H "X-Role: trader" \
  -H "X-Actor: alice@company.com" \
  -H "X-User-Id: user-abc-123"

# Default (viewer)
curl https://api/dashboard
```

## Permission Names

**Read Permissions** (non-mutating):
- `view:dashboard` — Can see main dashboard
- `view:positions` — Can see positions
- `view:audit` — Can see audit logs

**Trading Permissions** (mutating):
- `submit:signal` — Can submit signals
- `request:approval` — Can request trade approval
- `approve:trade` — Can approve trades
- `execute:trade` — Can execute orders

**Admin Permissions** (mutating):
- `manage:risk_config` — Can modify risk settings
- `toggle:kill_switch` — Can activate emergency stop
- `emergency:liquidate` — Can force liquidation
- `system:admin` — Can manage system

## Kill Switch States

```typescript
// Check if kill switch override is active
if (isKillSwitchOverrideActive()) {
  // All mutations blocked, reads allowed
}

// Check if execution is blocked by risk engine
import { isKillSwitchActive } from "../lib/risk_engine";
if (isKillSwitchActive()) {
  // Trading logic kill switch engaged
}

// For safe execution, check both:
const canExecute = !isKillSwitchActive() && !isKillSwitchOverrideActive();
```

## Test Examples

```typescript
// Test permission denied
it("should deny viewer execute permission", async () => {
  const res = await request(app)
    .get("/trade")
    .set("X-Role", "viewer");
  
  expect(res.status).toBe(403);
  expect(res.body.error).toBe("insufficient_permission");
});

// Test permission granted
it("should allow operator execute", async () => {
  const res = await request(app)
    .get("/trade")
    .set("X-Role", "operator");
  
  expect(res.status).toBe(200);
});
```

## Error Responses

**Insufficient Role:**
```json
{
  "error": "insufficient_role",
  "message": "This action requires one of: operator, admin. Your role: trader"
}
```

**Insufficient Permission:**
```json
{
  "error": "insufficient_permission",
  "message": "This action requires permission: execute:trade"
}
```

**Kill Switch Active:**
```json
{
  "error": "kill_switch_active",
  "message": "All mutations are blocked while kill switch override is active"
}
```

## Middleware Setup Checklist

Add to app.ts:
```typescript
import { attachRBACContext } from "./middleware/rbac";

app.use(express.json());
app.use(attachRBACContext); // ← Must be before routes
app.use("/api", apiRoutes);
```

## Flow Diagram

```
Request arrives with X-Role header
           ↓
attachRBACContext extracts role/actor
           ↓
Request reaches requirePermission/requireRole middleware
           ↓
Permission check:
  - Is kill switch override active? → 403 if mutating
  - Does role have permission? → 403 if denied
  - Audit log created → permission granted/denied
           ↓
Handler executes (if authorized)
           ↓
Response sent with audit trail
```

## Debugging

**Check role is attached:**
```typescript
app.use((req, res, next) => {
  console.log("RBAC Context:", req.rbac);
  next();
});
```

**Manual permission test:**
```typescript
import { hasPermission } from "../middleware/rbac";

console.log(hasPermission("trader", "execute:trade")); // false
console.log(hasPermission("operator", "execute:trade")); // true
```

**View all permissions for role:**
```typescript
import { getPermissionsForRole } from "../middleware/rbac";

const operatorPerms = getPermissionsForRole("operator");
console.log(operatorPerms);
// [
//   'view:dashboard',
//   'view:positions',
//   'view:audit',
//   'approve:trade',
//   'execute:trade',
//   'manage:risk_config',
//   'toggle:kill_switch',
//   'emergency:liquidate'
// ]
```

## Files Reference

| File | Purpose | Size |
|------|---------|------|
| `middleware/rbac.ts` | Core RBAC implementation | 350 lines |
| `__tests__/rbac.test.ts` | RBAC unit tests | 502 lines |
| `__tests__/kill_switch.test.ts` | Kill switch tests | 496 lines |
| `__tests__/rbac_audit_integration.test.ts` | Audit integration tests | 416 lines |
| `middleware/RBAC_GUIDE.md` | Complete guide | 25KB |
| `middleware/RBAC_QUICK_REFERENCE.md` | This file | 3KB |
| `RBAC_INTEGRATION_CHECKLIST.md` | Integration steps | 20KB |

## One-Liner Examples

```typescript
// Protect endpoint with operator+ access
router.post("/kill-switch", requireOperator, handler);

// Protect with specific permission
router.post("/execute", requireExecuteTrade, handler);

// Check permission in code
if (!hasPermission(req.rbac?.role, "approve:trade")) return res.status(403).json({});

// Activate kill switch
setKillSwitchOverride(true);

// Check if all operations blocked
if (isKillSwitchOverrideActive()) { /* handle */ }

// Log kill switch change
await auditKillSwitch(true, "operator-123");

// Get all perms for a role
const perms = getPermissionsForRole("admin");
```

## Key Concepts to Remember

1. **RBAC is layered**: Middleware (role/permission) + Kill Switch (business logic)
2. **Kill switch blocks ALL mutations**: Regardless of role or permission
3. **Reads are always allowed**: Even when kill switch active (only mutations blocked)
4. **Every denial is audited**: Audit trail shows who tried what and when
5. **Default is least privilege**: Unauthenticated → viewer role
6. **Tokens in headers only**: Never in URLs to prevent logging in reverse proxies
7. **Two independent kill switches**: Risk engine + RBAC override (either blocks execution)

## When to Use What

| Scenario | Use This |
|----------|----------|
| Route requires operator role | `requireOperator` |
| Route requires specific permission | `requirePermission("...", true)` |
| Read-only dashboard | `requirePermission("view:dashboard", false)` |
| Emergency stop needed | `setKillSwitchOverride(true)` + `auditKillSwitch()` |
| Check in code | `hasPermission(role, permission)` |
| List role permissions | `getPermissionsForRole(role)` |

## Status Codes Quick Reference

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Permission granted, action executed |
| 403 | Forbidden | Insufficient role, permission, or kill switch active |
| 401 | Unauthorized | Missing/invalid credentials |
| 500 | Internal Error | RBAC context not attached |

---

**Last Updated**: April 2025  
**Version**: 1.0 - Core RBAC System  
**For Details**: See RBAC_GUIDE.md
