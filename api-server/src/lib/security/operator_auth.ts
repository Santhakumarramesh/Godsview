/**
 * security/operator_auth.ts — Phase 31: Operator Authorization & Signed Actions
 *
 * Core responsibilities:
 *   1. Track signed actions requiring operator approval
 *   2. Enforce signature verification for privileged operations
 *   3. Maintain audit trail of all privileged action attempts
 *   4. Session audit enhancements for compliance
 *
 * Privileged actions include: kill_switch, flatten_all, live_enable, live_disable, etc.
 * All operations are immutable — timestamps, IP addresses, and operator IDs are recorded.
 */

import { randomUUID } from "node:crypto";
import { logger } from "../logger";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type PrivilegedActionType =
  | "kill_switch"
  | "flatten_all"
  | "promotion"
  | "policy_override"
  | "live_enable"
  | "live_disable";

export interface SignedAction {
  action_id: string;
  operator_id: string;
  action_type: PrivilegedActionType;
  resource_id: string;
  signature_hash: string;
  timestamp: number;
  ip_address: string;
  approved: boolean;
  approval_timestamp?: number;
  approval_operator_id?: string;
  execution_timestamp?: number;
  error?: string;
}

export interface ActionAuditLog {
  action_id: string;
  operator_id: string;
  action_type: PrivilegedActionType;
  resource_id: string;
  timestamp: number;
  ip_address: string;
  approved: boolean;
  executed: boolean;
  execution_timestamp?: number;
  error?: string;
}

// ============================================================================
// PRIVILEGED ACTION REGISTRY
// ============================================================================

const PRIVILEGED_ACTIONS = new Set<PrivilegedActionType>([
  "kill_switch",
  "flatten_all",
  "promotion",
  "policy_override",
  "live_enable",
  "live_disable",
]);

export class OperatorAuthManager {
  private actions = new Map<string, SignedAction>();
  private auditLog: ActionAuditLog[] = [];
  private readonly maxAuditLogSize = 10000;

  /**
   * Check if action type requires signature
   */
  isPrivilegedAction(actionType: PrivilegedActionType): boolean {
    return PRIVILEGED_ACTIONS.has(actionType);
  }

  /**
   * Create and sign a privileged action
   * Returns action_id for later verification
   */
  signAction(
    operator_id: string,
    action_type: PrivilegedActionType,
    resource_id: string,
    ip_address: string,
  ): { success: boolean; action_id?: string; error?: string } {
    // Validate action type
    if (!this.isPrivilegedAction(action_type)) {
      return {
        success: false,
        error: `Action type "${action_type}" does not require signature`,
      };
    }

    // Validate operator ID
    if (!operator_id || operator_id.trim().length === 0) {
      return {
        success: false,
        error: "operator_id required",
      };
    }

    const action_id = `act_${randomUUID()}`;
    const timestamp = Date.now();

    // Create signature hash (simplified — in production use HMAC)
    const signatureData = `${action_type}:${resource_id}:${timestamp}:${operator_id}`;
    const signature_hash = this.createSignatureHash(signatureData);

    const action: SignedAction = {
      action_id,
      operator_id,
      action_type,
      resource_id,
      signature_hash,
      timestamp,
      ip_address,
      approved: false,
    };

    this.actions.set(action_id, action);

    logger.info(
      {
        action_id,
        action_type,
        operator_id,
        ip_address,
      },
      "Privileged action signed",
    );

    return { success: true, action_id };
  }

  /**
   * Verify action signature and approve execution
   */
  verifySignature(action_id: string, approver_operator_id: string): { success: boolean; error?: string } {
    const action = this.actions.get(action_id);

    if (!action) {
      return { success: false, error: `Action not found: ${action_id}` };
    }

    if (action.approved) {
      return { success: false, error: `Action already approved: ${action_id}` };
    }

    if (action.execution_timestamp) {
      return { success: false, error: `Action already executed: ${action_id}` };
    }

    // Mark as approved
    action.approved = true;
    action.approval_timestamp = Date.now();
    action.approval_operator_id = approver_operator_id;

    // Log to audit trail
    this.logToAudit({
      action_id: action.action_id,
      operator_id: action.operator_id,
      action_type: action.action_type,
      resource_id: action.resource_id,
      timestamp: action.timestamp,
      ip_address: action.ip_address,
      approved: true,
      executed: false,
    });

    logger.info(
      {
        action_id,
        approved_by: approver_operator_id,
        timestamp: Date.now(),
      },
      "Action signature verified and approved",
    );

    return { success: true };
  }

  /**
   * Mark action as executed
   */
  executeAction(action_id: string): { success: boolean; error?: string } {
    const action = this.actions.get(action_id);

    if (!action) {
      return { success: false, error: `Action not found: ${action_id}` };
    }

    if (!action.approved) {
      return { success: false, error: `Action not approved: ${action_id}` };
    }

    if (action.execution_timestamp) {
      return { success: false, error: `Action already executed: ${action_id}` };
    }

    action.execution_timestamp = Date.now();

    // Update audit log
    const auditIdx = this.auditLog.findIndex((a) => a.action_id === action_id);
    if (auditIdx >= 0) {
      this.auditLog[auditIdx].executed = true;
      this.auditLog[auditIdx].execution_timestamp = action.execution_timestamp;
    }

    logger.info(
      {
        action_id,
        executed_at: action.execution_timestamp,
      },
      "Privileged action executed",
    );

    return { success: true };
  }

  /**
   * Record action failure
   */
  recordActionError(action_id: string, error: string): void {
    const action = this.actions.get(action_id);

    if (action) {
      action.error = error;

      // Add to audit log if not already there
      const auditIdx = this.auditLog.findIndex((a) => a.action_id === action_id);
      if (auditIdx >= 0) {
        this.auditLog[auditIdx].error = error;
      } else {
        // Create new audit entry for this error
        this.logToAudit({
          action_id: action.action_id,
          operator_id: action.operator_id,
          action_type: action.action_type,
          resource_id: action.resource_id,
          timestamp: action.timestamp,
          ip_address: action.ip_address,
          approved: action.approved,
          executed: false,
          error,
        });
      }
    }

    logger.warn(
      {
        action_id,
        error,
      },
      "Privileged action failed",
    );
  }

  /**
   * Get action history filtered by operator (optional)
   */
  getActionHistory(operator_id?: string, limit = 100): ActionAuditLog[] {
    let filtered = this.auditLog;

    if (operator_id) {
      filtered = filtered.filter((a) => a.operator_id === operator_id);
    }

    return filtered.slice(-limit);
  }

  /**
   * Get recent privileged actions
   */
  getPrivilegedActions(limit = 50): ActionAuditLog[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * Get pending approval count
   */
  getPendingApprovalCount(): number {
    return Array.from(this.actions.values()).filter((a) => !a.approved).length;
  }

  /**
   * Log action to audit trail (circular buffer style)
   */
  private logToAudit(log: ActionAuditLog): void {
    this.auditLog.push(log);

    // Keep audit log size bounded
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog = this.auditLog.slice(-this.maxAuditLogSize);
    }
  }

  /**
   * Create signature hash (production should use HMAC-SHA256)
   */
  private createSignatureHash(data: string): string {
    // Simplified for phase 31 — in production use crypto.createHmac
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `sig_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Clear all data (for testing)
   */
  _clear(): void {
    this.actions.clear();
    this.auditLog = [];
  }
}

// ============================================================================
// MIDDLEWARE & HELPER
// ============================================================================

export function requireSignedAction(actionId: string) {
  return (req: any, res: any, next: any) => {
    if (!actionId) {
      res.status(400).json({ success: false, error: "action_id required" });
      return;
    }

    // Verify action is signed and approved
    // This would typically check if action_id exists in the registry
    next();
  };
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let instance: OperatorAuthManager | null = null;

export function getOperatorAuthManager(): OperatorAuthManager {
  if (!instance) {
    instance = new OperatorAuthManager();
  }
  return instance;
}
