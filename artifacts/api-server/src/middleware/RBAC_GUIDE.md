# RBAC and Safety Boundaries Guide

## Overview

The GodsView API implements a multi-layered security model:

1. **RBAC (Role-Based Access Control)** — Enforces permissions based on user role
2. **Kill Switch Override** — Emergency mutation blocker (RBAC layer)
3. **Kill Switch Active** — Business logic execution blocker (Risk Engine layer)
4. **Audit Logging** — Complete trail of all permission-gated actions

## Roles and Permissions

### Role Hierarchy

```
admin (highest privilege)
  ↓
operator
  ↓
trader
  ↓
viewer (least privilege)
```

### Permission Matrix

#### Admin Role
Full system access. All permissions granted:
- `view:dashboard`, `view:positions`, `view:audit`
- `submit:signal`, `request:approval`
- `approve:trade`, `execute:trade`
- `manage:risk_config`, `toggle:kill_switch`, `emergency:liquidate`
- `system:admin`

#### Operator Role
Can manage live execution and emergency controls:
- View: `view:dashboard`, `view:positions`, `view:audit`
- Execution: `approve:trade`, `execute:trade`
- Configuration: `manage:risk_config`
- Emergency: `toggle:kill_switch`, `emergency:liquidate`

#### Trader Role
Can submit signals and request approvals:
- View: `view:dashboard`, `view:positions`
- Submit: `submit:signal`, `request:approval`

#### Viewer Role (Least Privileged)
Read-only access:
- View: `view:dashboard`, `view:positions`

## Using RBAC Middleware

### 1. Attach RBAC Context

Required middleware that extracts role and actor from request:

```typescript
import { attachRBACContext } from "./middleware/rbac";

app.use(express.json());
app.use(attachRBACContext); // Must come early in middleware chain
```

### 2. Require Specific Role

```typescript
import { requireRole } from "./middleware/rbac";

// Only allow admin
app.post("/admin-endpoint", requireRole("admin"), handler);

// Allow multiple roles (OR logic)
app.post("/operator-action", requireRole("operator", "admin"), handler);
```

### 3. Require Specific Permission

```typescript
import { requirePermission } from "./middleware/rbac";

// Non-mutating (read) — not blocked by kill switch
app.get("/dashboard", requirePermission("view:dashboard", false), handler);

// Mutating action — blocked by kill switch
app.post("/execute-trade", requirePermission("execute:trade", true), handler);
```

### 4. Use Convenience Middlewares

Pre-configured for common scenarios:

```typescript
import {
  requireAdmin,           // Only admin
  requireOperator,        // Operator or admin
  requireTrader,          // Trader, operator, or admin
  requireExecuteTrade,    // execute:trade permission
  requireToggleKillSwitch, // toggle:kill_switch permission
} from "./middleware/rbac";

app.post("/kill-switch", requireToggleKillSwitch, handler);
app.post("/trade/execute", requireExecuteTrade, handler);
```

## Request Headers for Role Assignment

```
X-Role: admin|operator|trader|viewer
X-Actor: user@example.com (for audit trail)
X-User-Id: user-uuid-123 (optional, for tracking)
Authorization: Bearer <token> (optional, for token-based schemes)
```

### Examples

```bash
# As operator
curl -X POST https://api.example.com/kill-switch \
  -H "X-Role: operator" \
  -H "X-Actor: john@company.com" \
  -H "X-User-Id: user-123"

# As trader
curl -X POST https://api.example.com/signal \
  -H "X-Role: trader" \
  -H "X-Actor: alice@company.com"

# Default (viewer if no header)
curl https://api.example.com/dashboard
```

## Response Codes

### 403 Forbidden (Insufficient Role or Permission)

```json
{
  "error": "insufficient_role",
  "message": "This action requires one of: admin, operator. Your role: viewer"
}
```

```json
{
  "error": "insufficient_permission",
  "message": "This action requires permission: execute:trade"
}
```

### 403 Forbidden (Kill Switch Active)

```json
{
  "error": "kill_switch_active",
  "message": "All mutations are blocked while kill switch override is active"
}
```

### 401 Unauthorized

```json
{
  "error": "unauthorized",
  "message": "Authentication required"
}
```

## Kill Switch Architecture

### Two-Layer Kill Switch System

#### Layer 1: Risk Engine (Business Logic)
- **Function**: `isKillSwitchActive()` / `setKillSwitchActive(boolean)`
- **Location**: `/lib/risk_engine.ts`
- **Purpose**: Block execution based on trading logic (drawdown, market conditions)
- **Scope**: All execution paths check this state

#### Layer 2: RBAC Override (Security/Enforcement)
- **Function**: `isKillSwitchOverrideActive()` / `setKillSwitchOverride(boolean)`
- **Location**: `/middleware/rbac.ts`
- **Purpose**: Emergency mutation blocker controlled via API
- **Scope**: All mutating operations (POST, PUT, DELETE) check this state

### How They Work Together

```typescript
// Execution is allowed only if BOTH layers permit it:
const canExecute = !isKillSwitchActive() && !isKillSwitchOverrideActive();

// Kill switch blocks execution at multiple points:
// 1. RBAC middleware returns 403 for all mutations
// 2. Risk engine prevents order submission
// 3. Execution guard blocks market operations

// Reads (non-mutating) are never blocked by kill switch:
const canRead = true; // Always allowed
```

### Kill Switch Activation

```typescript
import { setKillSwitchOverride } from "./middleware/rbac";

// Activate (emergency stop)
setKillSwitchOverride(true);
// → All POST/PUT/DELETE operations return 403
// → All GET operations allowed
// → All role checks still apply

// Check status
if (isKillSwitchOverrideActive()) {
  console.log("System is in emergency stop mode");
}

// Deactivate (resume normal operations)
setKillSwitchOverride(false);
```

## Audit Logging

Every permission-gated action is logged to `audit_events` table:

### Log Entry Structure

```typescript
{
  event_type: "execution_gate_blocked" | "execution_request_received",
  decision_state: "sufficient_permission" | "insufficient_permission" | "kill_switch_engaged",
  actor: "user@company.com",
  reason: "Role trader lacks permission: execute:trade",
  payload: {
    required_permission: "execute:trade",
    user_role: "trader",
    kill_switch_override?: true
  },
  created_at: "2025-04-20T15:30:45Z"
}
```

### Automatic Logging

```typescript
import { logAuditEvent } from "../lib/audit_logger";

// Automatically logged by requirePermission middleware:
// 1. Permission granted → "execution_request_received" with "permission_granted"
// 2. Permission denied → "execution_gate_blocked" with "insufficient_permission"
// 3. Kill switch blocks → "execution_gate_blocked" with "kill_switch_engaged"
```

### Querying Audit Log

```sql
SELECT * FROM audit_events
WHERE actor = 'alice@company.com'
  AND created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;

SELECT * FROM audit_events
WHERE event_type = 'execution_gate_blocked'
  AND decision_state = 'kill_switch_engaged'
ORDER BY created_at DESC;
```

## Common Patterns

### Pattern 1: Role-based Dashboard

```typescript
app.get(
  "/dashboard",
  attachRBACContext,
  requirePermission("view:dashboard", false),
  (req, res) => {
    // Get role for filtering data
    const role = req.rbac?.role;
    if (role === "admin") {
      // Show all metrics
    } else if (role === "operator") {
      // Show operational metrics
    } else {
      // Show limited view
    }
    res.json({ data: "filtered by role" });
  }
);
```

### Pattern 2: Multi-step Approval

```typescript
// Step 1: Trader submits signal
app.post(
  "/signal",
  attachRBACContext,
  requirePermission("submit:signal", true),
  (req, res) => {
    // Trader can submit
  }
);

// Step 2: Operator approves
app.post(
  "/signal/:id/approve",
  attachRBACContext,
  requirePermission("approve:trade", true),
  (req, res) => {
    // Only operator+ can approve
  }
);

// Step 3: Execute
app.post(
  "/signal/:id/execute",
  attachRBACContext,
  requirePermission("execute:trade", true),
  (req, res) => {
    // Operator or admin can execute
  }
);
```

### Pattern 3: Emergency Stop

```typescript
app.post(
  "/system/kill-switch",
  attachRBACContext,
  requirePermission("toggle:kill_switch", true),
  (req, res) => {
    const { active } = req.body;
    setKillSwitchOverride(active);

    // Audit the change
    auditKillSwitch(active, req.rbac?.actor || "unknown");

    res.json({
      kill_switch_override: isKillSwitchOverrideActive(),
      timestamp: new Date().toISOString(),
    });
  }
);
```

### Pattern 4: Programmatic Permission Check

```typescript
import { hasPermission, getPermissionsForRole } from "./middleware/rbac";

// Check if role has permission (without middleware)
if (hasPermission("trader", "execute:trade")) {
  console.log("Trader can execute");
} else {
  console.log("Trader cannot execute");
}

// Get all permissions for a role
const adminPerms = getPermissionsForRole("admin");
console.log("Admin can:", adminPerms);
```

## Testing

### Unit Tests

RBAC has comprehensive test coverage in:
- `/src/__tests__/rbac.test.ts` — Core RBAC functionality
- `/src/__tests__/kill_switch.test.ts` — Kill switch behavior
- `/src/__tests__/rbac_audit_integration.test.ts` — Audit logging

Run tests:

```bash
npm test rbac.test.ts
npm test kill_switch.test.ts
npm test rbac_audit_integration.test.ts
```

### Testing Permission Checks

```typescript
import { requirePermission } from "../middleware/rbac";
import request from "supertest";

it("should deny viewer execute permission", async () => {
  const app = express();
  app.use(express.json());
  app.use(attachRBACContext);
  app.get("/trade", requirePermission("execute:trade"), (req, res) => {
    res.json({ success: true });
  });

  const res = await request(app)
    .get("/trade")
    .set("X-Role", "viewer");

  expect(res.status).toBe(403);
  expect(res.body.error).toBe("insufficient_permission");
});
```

## Troubleshooting

### Issue: All requests return 403

**Cause**: `attachRBACContext` middleware not installed early enough, or X-Role header not recognized.

**Fix**:
```typescript
// ✅ Correct order
app.use(express.json());
app.use(attachRBACContext); // Very early
app.use("/api", apiRouter);

// ❌ Wrong order
app.use("/api", apiRouter); // Routes registered first
app.use(attachRBACContext); // Middleware comes too late
```

### Issue: Kill switch doesn't block requests

**Cause**: Kill switch check missing in execution path, or wrong layer being used.

**Fix**:
```typescript
// Check RBAC layer (for API mutations)
const canExecute = !isKillSwitchOverrideActive();

// Check Risk Engine layer (for business logic)
const canTrade = !isKillSwitchActive();

// Both should block
if (isKillSwitchActive() || isKillSwitchOverrideActive()) {
  return res.status(403).json({ error: "All operations blocked" });
}
```

### Issue: Audit logs missing

**Cause**: `logAuditEvent` call failed silently (non-blocking by design).

**Fix**: Check logs for audit write failures:
```bash
grep "Audit write failed" application.log
```

## Security Considerations

1. **Default Denial**: Unauthenticated users default to `viewer` role (least privilege)
2. **Token in Headers Only**: Never pass tokens in query parameters (they get logged)
3. **Timing-Safe Comparisons**: Token comparisons use constant-time hashing
4. **Audit Immutability**: Audit log entries cannot be modified after creation
5. **Kill Switch Independence**: Two kill switches ensure one compromise doesn't break both
6. **No Privilege Escalation**: Role escalation requires explicit action + audit

## FAQ

**Q: Can I have custom roles?**
A: Currently supports: admin, operator, trader, viewer. Adding custom roles requires modifying `ROLE_PERMISSIONS` map.

**Q: Can I remove RBAC for development?**
A: Not recommended. Instead, use development environment with all users as `admin`.

**Q: What if kill switch gets stuck?**
A: Both kill switches are independent. If one fails, check logs and manually toggle the other via API.

**Q: Can operators bypass kill switch?**
A: No. Kill switch blocks all mutations regardless of role. Only way around is to deactivate it.

**Q: How long are audit logs kept?**
A: Indefinitely in production. Implement retention policy based on compliance needs.
