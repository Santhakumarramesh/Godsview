/**
 * Audit Logger — Append-only audit log
 *
 * Immutable log of all actions for compliance and debugging.
 */

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details?: Record<string, any>;
  success: boolean;
  failure_reason?: string;
  timestamp: Date;
}

// In-memory append-only log
let auditLog: AuditLogEntry[] = [];

/**
 * Generate audit log ID with aud_ prefix
 */
function generateAuditId(): string {
  return `aud_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Log an audit entry
 */
export function logAudit(
  actor_id: string,
  action: string,
  resource_type: string,
  resource_id?: string,
  details?: Record<string, any>,
  success: boolean = true,
  failure_reason?: string
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: generateAuditId(),
    actor_id,
    action,
    resource_type,
    resource_id,
    details,
    success,
    failure_reason,
    timestamp: new Date(),
  };

  auditLog.push(entry);
  return entry;
}

/**
 * Get audit log with optional filters
 * @param limit Maximum number of entries to return (most recent first)
 * @param actor_id Optional filter by actor
 * @param action Optional filter by action
 */
export function getAuditLog(
  limit: number = 100,
  actor_id?: string,
  action?: string
): AuditLogEntry[] {
  let filtered = [...auditLog];

  if (actor_id) {
    filtered = filtered.filter((e) => e.actor_id === actor_id);
  }

  if (action) {
    filtered = filtered.filter((e) => e.action === action);
  }

  // Return most recent entries first
  return filtered.reverse().slice(0, limit);
}

/**
 * Get total audit log count
 */
export function getAuditLogCount(): number {
  return auditLog.length;
}

/**
 * Clear all audit logs (for testing)
 */
export function _clearAll() {
  auditLog = [];
}
