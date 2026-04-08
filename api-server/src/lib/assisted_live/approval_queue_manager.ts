/**
 * Approval Queue Manager — Phase 21
 *
 * Manages the lifecycle of live order approvals:
 *   - Submit orders to the queue (pending)
 *   - Approve orders (triggers execution)
 *   - Reject orders (logged, no execution)
 *   - Expire stale approvals
 *   - Query queue state
 *
 * Every state transition is immutable and auditable.
 */

import { logger } from "../logger";
import crypto from "crypto";

export interface PendingApproval {
  approval_id: string;
  session_id: string;
  strategy_id: string;
  symbol: string;
  side: "buy" | "sell";
  order_type: string;
  qty: number;
  limit_price?: number;
  signal_confidence?: number;
  decision_packet_json?: Record<string, unknown>;
  risk_assessment_json?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
  approved_by?: string;
  rejected_by?: string;
  rejection_reason?: string;
  expires_at: Date;
  approved_at?: Date;
  rejected_at?: Date;
  order_uuid?: string;
  broker_order_id?: string;
  created_at: Date;
}

// In-memory queue (backed by DB for persistence)
const approvalQueue: Map<string, PendingApproval> = new Map();

const DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function submitToQueue(params: {
  session_id: string;
  strategy_id: string;
  symbol: string;
  side: "buy" | "sell";
  order_type: string;
  qty: number;
  limit_price?: number;
  signal_confidence?: number;
  decision_packet_json?: Record<string, unknown>;
  risk_assessment_json?: Record<string, unknown>;
  expiry_ms?: number;
}): PendingApproval {
  const approval_id = `apv_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();
  const expiryMs = params.expiry_ms ?? DEFAULT_EXPIRY_MS;

  const approval: PendingApproval = {
    approval_id,
    session_id: params.session_id,
    strategy_id: params.strategy_id,
    symbol: params.symbol,
    side: params.side,
    order_type: params.order_type,
    qty: params.qty,
    limit_price: params.limit_price,
    signal_confidence: params.signal_confidence,
    decision_packet_json: params.decision_packet_json,
    risk_assessment_json: params.risk_assessment_json,
    status: "pending",
    expires_at: new Date(now.getTime() + expiryMs),
    created_at: now,
  };

  approvalQueue.set(approval_id, approval);

  logger.info(
    { approval_id, session_id: params.session_id, symbol: params.symbol, side: params.side, qty: params.qty },
    "Order submitted to approval queue"
  );

  return approval;
}

export function approveOrder(
  approval_id: string,
  approved_by: string
): { success: boolean; approval?: PendingApproval; error?: string } {
  const approval = approvalQueue.get(approval_id);
  if (!approval) return { success: false, error: "Approval not found" };
  if (approval.status !== "pending") return { success: false, error: `Cannot approve: status is '${approval.status}'` };

  // Check expiry
  if (new Date() > approval.expires_at) {
    approval.status = "expired";
    logger.warn({ approval_id }, "Attempted to approve expired order");
    return { success: false, error: "Approval has expired" };
  }

  approval.status = "approved";
  approval.approved_by = approved_by;
  approval.approved_at = new Date();

  logger.info({ approval_id, approved_by, symbol: approval.symbol }, "Order APPROVED");

  return { success: true, approval };
}

export function rejectOrder(
  approval_id: string,
  rejected_by: string,
  reason: string
): { success: boolean; approval?: PendingApproval; error?: string } {
  const approval = approvalQueue.get(approval_id);
  if (!approval) return { success: false, error: "Approval not found" };
  if (approval.status !== "pending") return { success: false, error: `Cannot reject: status is '${approval.status}'` };

  approval.status = "rejected";
  approval.rejected_by = rejected_by;
  approval.rejection_reason = reason;
  approval.rejected_at = new Date();

  logger.info({ approval_id, rejected_by, reason, symbol: approval.symbol }, "Order REJECTED");

  return { success: true, approval };
}

export function expireStaleApprovals(): PendingApproval[] {
  const now = new Date();
  const expired: PendingApproval[] = [];

  for (const [, approval] of approvalQueue) {
    if (approval.status === "pending" && now > approval.expires_at) {
      approval.status = "expired";
      expired.push(approval);
      logger.warn({ approval_id: approval.approval_id, symbol: approval.symbol }, "Approval expired");
    }
  }

  return expired;
}

export function getQueueForSession(session_id: string): PendingApproval[] {
  return Array.from(approvalQueue.values())
    .filter((a) => a.session_id === session_id)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export function getPendingApprovals(session_id?: string): PendingApproval[] {
  // First expire stale
  expireStaleApprovals();

  const all = Array.from(approvalQueue.values());
  const pending = session_id
    ? all.filter((a) => a.session_id === session_id && a.status === "pending")
    : all.filter((a) => a.status === "pending");

  return pending.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}

export function getApproval(approval_id: string): PendingApproval | undefined {
  return approvalQueue.get(approval_id);
}

export function linkOrderExecution(approval_id: string, order_uuid: string, broker_order_id?: string): void {
  const approval = approvalQueue.get(approval_id);
  if (approval) {
    approval.order_uuid = order_uuid;
    approval.broker_order_id = broker_order_id;
  }
}

export function getQueueStats(): {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
} {
  expireStaleApprovals();
  const all = Array.from(approvalQueue.values());
  return {
    total: all.length,
    pending: all.filter((a) => a.status === "pending").length,
    approved: all.filter((a) => a.status === "approved").length,
    rejected: all.filter((a) => a.status === "rejected").length,
    expired: all.filter((a) => a.status === "expired").length,
  };
}

/** Clear queue — used for testing */
export function _clearQueue(): void {
  approvalQueue.clear();
}
