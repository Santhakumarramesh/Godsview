# RBAC Integration Checklist

This checklist guides integration of the new RBAC system with existing routes. The system is fully functional but needs to be applied to route handlers.

## Phase 1: Core Setup (Complete ✓)

- [x] Create RBAC middleware (`/middleware/rbac.ts`)
  - Defines roles: admin, operator, trader, viewer
  - Permission matrix for each role
  - `attachRBACContext` middleware
  - `requireRole()` and `requirePermission()` factories
  - Kill switch override enforcement

- [x] Create RBAC tests (`/__tests__/rbac.test.ts`)
  - Permission utility tests
  - Role extraction tests
  - Middleware behavior tests
  - Integration scenarios

- [x] Create kill switch tests (`/__tests__/kill_switch.test.ts`)
  - Kill switch state management
  - Multi-layer enforcement
  - Execution blocking
  - Auditability

- [x] Create audit integration tests (`/__tests__/rbac_audit_integration.test.ts`)
  - Permission granted logging
  - Permission denied logging
  - Kill switch change logging
  - Audit completeness

- [x] Create RBAC guide (`/middleware/RBAC_GUIDE.md`)
  - Role and permission definitions
  - Usage patterns
  - Kill switch architecture
  - Testing patterns

## Phase 2: App.ts Integration (TODO)

Update `/src/app.ts` to apply RBAC middleware globally:

```typescript
import { attachRBACContext } from "./middleware/rbac";

// Early in middleware chain, after JSON parsing
app.use(express.json());
app.use(attachRBACContext); // <- ADD THIS

// Then all your routes
app.use("/api", router);
```

**Checklist:**
- [ ] Import `attachRBACContext` in app.ts
- [ ] Add to middleware stack before route handlers
- [ ] Verify routing still works
- [ ] Test with X-Role headers

## Phase 3: System Route Hardening (TODO)

Protect critical endpoints in `/src/routes/system.ts`:

### Kill Switch Endpoint
```typescript
import { requireToggleKillSwitch } from "../middleware/rbac";
import { auditKillSwitch } from "../lib/audit_logger";

router.post("/kill-switch", requireToggleKillSwitch, (req, res) => {
  const { active } = req.body;
  const state = setKillSwitchActive(active);

  // Audit the change
  auditKillSwitch(active, req.rbac?.actor || "system");

  res.json({
    ...state,
    active,
    updated_at: new Date().toISOString(),
  });
});
```

### Risk Config Endpoint
```typescript
import { requireManageRiskConfig } from "../middleware/rbac";

router.put("/system/risk", requireManageRiskConfig, (req, res) => {
  // Update risk configuration
});
```

### Retrain Endpoint
```typescript
import { requireSystemAdmin } from "../middleware/rbac";

router.post("/system/retrain", requireSystemAdmin, (req, res) => {
  // Retrain ML model
});
```

**Checklist:**
- [ ] Wrap `/kill-switch` with `requireToggleKillSwitch`
- [ ] Wrap `/risk` updates with `requireManageRiskConfig`
- [ ] Wrap `/retrain` with `requireSystemAdmin`
- [ ] Wrap `/recall/refresh` with `requireOperator`
- [ ] Verify all endpoints log via audit logger
- [ ] Test each with different roles

## Phase 4: Execution Route Hardening (TODO)

Protect execution endpoints in `/src/routes/execution.ts`:

```typescript
import {
  requireExecuteTrade,
  requireApprovalRequest,
  attachRBACContext,
} from "../middleware/rbac";

// Trade execution
router.post("/execution/orders", requireExecuteTrade, (req, res) => {
  // Execute trade (blocked by kill switch if active)
});

// Approval request
router.post("/execution/request-approval", requireApprovalRequest, (req, res) => {
  // Request approval (can be submitted by trader)
});

// Close position
router.post("/execution/close/:id", requireExecuteTrade, (req, res) => {
  // Close position (operator/admin only)
});
```

**Checklist:**
- [ ] Wrap execution endpoints with `requireExecuteTrade`
- [ ] Wrap approval endpoints with `requireApprovalRequest`
- [ ] Wrap liquidation endpoints with `requireEmergencyLiquidate`
- [ ] Log each execution attempt
- [ ] Test execution blocking when kill switch active

## Phase 5: Dashboard & View Route Hardening (TODO)

Protect read-only endpoints (use `false` for mutating flag):

```typescript
import { requireViewDashboard, requireViewPositions } from "../middleware/rbac";

// Dashboard data
router.get("/dashboard", requireViewDashboard, (req, res) => {
  // Viewer can access (non-mutating)
});

// Positions
router.get("/positions", requireViewPositions, (req, res) => {
  // All authenticated can view
});

// Audit log (restricted)
router.get("/audit", requireViewAudit, (req, res) => {
  // Only operator+ can view full audit
});
```

**Checklist:**
- [ ] Dashboard endpoints use non-mutating permission checks
- [ ] View endpoints accessible to lowest appropriate role
- [ ] Audit endpoint restricted to operator+
- [ ] Filter data based on role if needed

## Phase 6: Testing Integration (TODO)

Run comprehensive test suite:

```bash
# Core RBAC tests
npm test -- rbac.test.ts

# Kill switch tests
npm test -- kill_switch.test.ts

# Audit integration
npm test -- rbac_audit_integration.test.ts

# All tests
npm test
```

**Checklist:**
- [ ] All RBAC tests passing
- [ ] All kill switch tests passing
- [ ] All audit tests passing
- [ ] Integration tests covering real routes
- [ ] Manual testing with different roles

## Phase 7: Security Verification (TODO)

Before production deployment:

### Permission Checks
- [ ] Admin can access all endpoints
- [ ] Operator can execute and manage risk
- [ ] Trader can submit and request approval
- [ ] Viewer can only view dashboards
- [ ] Unauthenticated defaults to viewer

### Kill Switch Behavior
- [ ] Kill switch blocks all mutations when active
- [ ] Kill switch allows all reads when active
- [ ] Kill switch prevents execution at multiple layers
- [ ] Kill switch state is queryable
- [ ] Kill switch changes are audited

### Audit Logging
- [ ] Every permission denied is logged
- [ ] Every permission granted is logged
- [ ] Kill switch state changes are logged
- [ ] Audit entries include actor, timestamp, reason
- [ ] Audit log is immutable

### Token Security
- [ ] Tokens never in query parameters
- [ ] Tokens never logged in plain text
- [ ] Tokens compared with constant-time function
- [ ] Token hashing included in audit entries

## Phase 8: Production Deployment (TODO)

Before going live:

```typescript
// Environment variables required
GODSVIEW_OPERATOR_TOKEN=<long-random-string>
GODSVIEW_API_KEY=<long-random-string>  // optional

// In production:
// - All users must have explicit role assignment
// - No default to admin role
// - Audit logs must be backed up
// - Kill switch must be tested regularly
```

**Checklist:**
- [ ] All environment variables configured
- [ ] Audit logs backed up daily
- [ ] Kill switch tested in staging
- [ ] Run-books updated for emergency procedures
- [ ] Team trained on RBAC system
- [ ] Monitoring alerts configured for:
  - Repeated permission denials (possible attack)
  - Kill switch state changes (audit trail)
  - Audit log write failures
  - Unusual role assignments

## Phase 9: Ongoing Maintenance (TODO)

Regular reviews:

- [ ] Weekly: Review audit logs for suspicious activity
- [ ] Monthly: Verify role assignments are current
- [ ] Quarterly: Test kill switch procedures
- [ ] Annually: Security audit of RBAC system

## File Locations Reference

**Core Implementation:**
- `/src/middleware/rbac.ts` — RBAC middleware and logic (13KB)
- `/src/lib/audit_logger.ts` — Audit logging (existing, updated in tests)
- `/src/lib/risk_engine.ts` — Kill switch management (existing)

**Tests:**
- `/src/__tests__/rbac.test.ts` — RBAC unit tests (25KB)
- `/src/__tests__/kill_switch.test.ts` — Kill switch tests (20KB)
- `/src/__tests__/rbac_audit_integration.test.ts` — Integration tests (15KB)

**Documentation:**
- `/src/middleware/RBAC_GUIDE.md` — Complete usage guide (25KB)
- `/src/RBAC_INTEGRATION_CHECKLIST.md` — This file

**Routes to Update:**
- `/src/routes/system.ts` — Kill switch, risk config, retrain
- `/src/routes/execution.ts` — Trade execution, approval
- `/src/routes/alpaca.ts` — Position management
- `/src/routes/*/` — All other protected routes

## Example: Hardening a Single Route

Before:
```typescript
router.post("/kill-switch", async (req, res) => {
  const { active } = req.body;
  const state = setKillSwitchActive(active);
  res.json(state);
});
```

After:
```typescript
import { requireToggleKillSwitch } from "../middleware/rbac";
import { auditKillSwitch } from "../lib/audit_logger";

router.post(
  "/kill-switch",
  requireToggleKillSwitch, // <- Enforce permission
  async (req, res) => {
    const { active } = req.body;
    const state = setKillSwitchActive(active);

    // Log the change
    await auditKillSwitch(active, req.rbac?.actor || "unknown");

    res.json({
      ...state,
      active,
      updated_at: new Date().toISOString(),
    });
  }
);
```

Benefits:
1. Only operator+ can toggle kill switch
2. Every toggle is audited with who did it
3. Returns 403 with clear message if unauthorized
4. Kill switch still blocks execution regardless

## Support & Troubleshooting

**Issue: Routes not applying RBAC**
- Verify `attachRBACContext` added to app.ts
- Verify middleware order (RBAC before routes)
- Check X-Role header is being sent

**Issue: Kill switch not blocking**
- Check `requirePermission("...", true)` has `true` flag
- Verify `isKillSwitchActive()` is checked in execution path
- Check both layers: RBAC override AND risk engine

**Issue: Missing audit logs**
- Check database connection to audit_events table
- Verify `logAuditEvent()` calls are not failing silently
- Search logs for "Audit write failed" messages

**Questions?**
- See `/src/middleware/RBAC_GUIDE.md` for comprehensive guide
- Check test files for working examples
- Review existing system.ts for patterns

## Next Steps

1. Update app.ts with attachRBACContext
2. Harden system.ts routes (kill switch, risk config)
3. Harden execution.ts routes (trade execution)
4. Run full test suite
5. Manual testing with different roles
6. Security audit before production
7. Deploy to staging first
8. Deploy to production with monitoring
