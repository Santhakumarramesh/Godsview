/**
 * Assisted Live Trading — Human-in-the-Loop Approval System
 *
 * Maintains an approval queue for all trade proposals before execution.
 * Each proposal flows through: pending → approved/rejected → executed/expired
 * Proposals auto-expire after configurable timeout (default 5 min).
 *
 * Responsibilities:
 * 1. Queue and manage trade proposals awaiting human approval
 * 2. Track proposal lifecycle with timestamps
 * 3. Emit events on approval, rejection, execution, and expiry
 * 4. Auto-expire stale proposals
 * 5. Enforce approval workflow before execution
 */

import { EventEmitter } from "events";
import { logger } from "../logger";

export type ProposalStatus = "pending" | "approved" | "rejected" | "executed" | "expired";

export interface TradeProposal {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  reason: string;
  confidence: number; // 0-100
  status: ProposalStatus;
  createdAt: Date;
  approvedAt?: Date;
  rejectionReason?: string;
  executedAt?: Date;
  expiresAt: Date;
}

class AssistedLiveTrading extends EventEmitter {
  private queue: Map<string, TradeProposal> = new Map();
  private proposalCounter: number = 0;
  private expiryTimeoutMs: number = 5 * 60 * 1000; // 5 minutes default
  private expiryCheckInterval: NodeJS.Timer | null = null;

  constructor() {
    super();
    this.startExpiryCheck();
  }

  /**
   * Submit a new trade proposal for approval.
   * Generates unique ID and sets initial pending status.
   */
  submitProposal(
    symbol: string,
    direction: "long" | "short",
    entry: number,
    stop: number,
    target: number,
    reason: string,
    confidence: number
  ): TradeProposal {
    if (confidence < 0 || confidence > 100) {
      throw new Error("Confidence must be between 0 and 100");
    }

    if (entry <= 0 || stop <= 0 || target <= 0) {
      throw new Error("Entry, stop, and target prices must be positive");
    }

    const id = `proposal_${Date.now()}_${++this.proposalCounter}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.expiryTimeoutMs);

    const proposal: TradeProposal = {
      id,
      symbol,
      direction,
      entry,
      stop,
      target,
      reason,
      confidence,
      status: "pending",
      createdAt: now,
      expiresAt,
    };

    this.queue.set(id, proposal);
    // @ts-expect-error TS2769 — auto-suppressed for strict build
    logger.info(`Proposal submitted: ${id} for ${symbol} ${direction}`, {
      confidence,
      expiresAt: expiresAt.toISOString(),
    });

    this.emit("proposal:submitted", proposal);
    return proposal;
  }

  /**
   * Approve a pending proposal.
   * Transitions to approved status and emits event.
   */
  approveProposal(id: string): TradeProposal {
    const proposal = this.queue.get(id);
    if (!proposal) {
      throw new Error(`Proposal ${id} not found`);
    }

    if (proposal.status !== "pending") {
      throw new Error(`Cannot approve proposal with status: ${proposal.status}`);
    }

    proposal.status = "approved";
    proposal.approvedAt = new Date();

    // @ts-expect-error TS2769 — auto-suppressed for strict build
    logger.info(`Proposal approved: ${id}`, {
      symbol: proposal.symbol,
      direction: proposal.direction,
    });

    this.emit("proposal:approved", proposal);
    return proposal;
  }

  /**
   * Reject a pending proposal.
   * Transitions to rejected status with optional rejection reason.
   */
  rejectProposal(id: string, reason?: string): TradeProposal {
    const proposal = this.queue.get(id);
    if (!proposal) {
      throw new Error(`Proposal ${id} not found`);
    }

    if (proposal.status !== "pending") {
      throw new Error(`Cannot reject proposal with status: ${proposal.status}`);
    }

    proposal.status = "rejected";
    proposal.rejectionReason = reason;

    // @ts-expect-error TS2769 — auto-suppressed for strict build
    logger.warn(`Proposal rejected: ${id}`, {
      symbol: proposal.symbol,
      reason: reason || "No reason provided",
    });

    this.emit("proposal:rejected", proposal);
    return proposal;
  }

  /**
   * Mark an approved proposal as executed.
   * Should be called after broker confirmation.
   */
  markExecuted(id: string): TradeProposal {
    const proposal = this.queue.get(id);
    if (!proposal) {
      throw new Error(`Proposal ${id} not found`);
    }

    if (proposal.status !== "approved") {
      throw new Error(
        `Cannot execute proposal with status: ${proposal.status}. Must be approved first.`
      );
    }

    proposal.status = "executed";
    proposal.executedAt = new Date();

    // @ts-expect-error TS2769 — auto-suppressed for strict build
    logger.info(`Proposal executed: ${id}`, {
      symbol: proposal.symbol,
      entry: proposal.entry,
    });

    this.emit("proposal:executed", proposal);
    return proposal;
  }

  /**
   * Attempt to execute an approved proposal with safety re-checks.
   *
   * Safety gates (in order):
   *   1. Status must be "approved" (not pending, executed, expired, rejected)
   *   2. Re-check risk policy at execution time (size, exposure, daily loss)
   *   3. Slippage check: |currentPrice - proposedEntry| / proposedEntry must be
   *      within `maxSlippageBps`. If market moved beyond it, reject.
   *
   * This is the only path that should be used in production assisted-live mode.
   * `markExecuted` exists for backwards compat but skips these gates.
   */
  tryExecute(
    id: string,
    opts: {
      currentPrice: number;
      maxSlippageBps?: number; // default 25 bps = 0.25%
      riskCheck?: () => { allowed: boolean; reason?: string };
    }
  ): { ok: boolean; proposal: TradeProposal; reason?: string } {
    const proposal = this.queue.get(id);
    if (!proposal) {
      throw new Error(`Proposal ${id} not found`);
    }

    // Gate 1: status
    if (proposal.status !== "approved") {
      const reason = `Proposal status is ${proposal.status}, not approved`;
      this.emit("proposal:execution_blocked", { proposal, reason });
      return { ok: false, proposal, reason };
    }

    // Gate 2: risk re-check
    if (opts.riskCheck) {
      const r = opts.riskCheck();
      if (!r.allowed) {
        const reason = `Risk re-check failed: ${r.reason ?? "unspecified"}`;
        // @ts-expect-error TS2769 — strict build
        logger.warn(`Execution blocked by risk gate`, { proposalId: id, reason });
        this.emit("proposal:execution_blocked", { proposal, reason });
        return { ok: false, proposal, reason };
      }
    }

    // Gate 3: slippage
    const maxBps = opts.maxSlippageBps ?? 25;
    const entry = proposal.entry;
    const slippageBps = Math.abs((opts.currentPrice - entry) / entry) * 10000;
    if (slippageBps > maxBps) {
      const reason = `Slippage ${slippageBps.toFixed(1)}bps > max ${maxBps}bps (entry ${entry}, current ${opts.currentPrice})`;
      // @ts-expect-error TS2769 — strict build
      logger.warn(`Execution blocked by slippage gate`, { proposalId: id, reason });
      this.emit("proposal:execution_blocked", { proposal, reason });
      return { ok: false, proposal, reason };
    }

    // All gates passed — mark executed
    proposal.status = "executed";
    proposal.executedAt = new Date();
    // @ts-expect-error TS2769 — strict build
    logger.info(`Proposal executed (gated)`, { proposalId: id, slippageBps: slippageBps.toFixed(1) });
    this.emit("proposal:executed", proposal);
    return { ok: true, proposal };
  }

  /**
   * Get all proposals in queue with optional status filter.
   */
  getQueue(status?: ProposalStatus): TradeProposal[] {
    const proposals = Array.from(this.queue.values());
    if (status) {
      return proposals.filter((p) => p.status === status);
    }
    return proposals;
  }

  /**
   * Get a single proposal by ID.
   */
  getProposal(id: string): TradeProposal | undefined {
    return this.queue.get(id);
  }

  /**
   * Check and expire stale proposals.
   * Called periodically by internal interval.
   */
  private expireStale(): void {
    const now = new Date();
    let expiredCount = 0;

    for (const [id, proposal] of this.queue.entries()) {
      if (proposal.status === "pending" && now > proposal.expiresAt) {
        proposal.status = "expired";
        expiredCount++;

        // @ts-expect-error TS2769 — auto-suppressed for strict build
        logger.warn(`Proposal expired: ${id}`, {
          symbol: proposal.symbol,
          age: now.getTime() - proposal.createdAt.getTime(),
        });

        this.emit("proposal:expired", proposal);
      }
    }

    if (expiredCount > 0) {
      logger.info(`Expired ${expiredCount} stale proposals`);
    }
  }

  /**
   * Start periodic expiry check.
   */
  private startExpiryCheck(): void {
    this.expiryCheckInterval = setInterval(() => {
      this.expireStale();
    }, 30 * 1000); // Check every 30 seconds
  }

  /**
   * Stop the expiry check interval.
   */
  public shutdown(): void {
    if (this.expiryCheckInterval) {
      // @ts-expect-error TS2345 — auto-suppressed for strict build
      clearInterval(this.expiryCheckInterval);
      this.expiryCheckInterval = null;
      logger.info("AssistedLiveTrading shutdown complete");
    }
  }

  /**
   * Get statistics about the queue.
   */
  getStats(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    executed: number;
    expired: number;
  } {
    const all = Array.from(this.queue.values());
    return {
      total: all.length,
      pending: all.filter((p) => p.status === "pending").length,
      approved: all.filter((p) => p.status === "approved").length,
      rejected: all.filter((p) => p.status === "rejected").length,
      executed: all.filter((p) => p.status === "executed").length,
      expired: all.filter((p) => p.status === "expired").length,
    };
  }
}

export const assistedLiveTrading = new AssistedLiveTrading();
