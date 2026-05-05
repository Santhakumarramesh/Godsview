/**
 * Phase 5 — Trade data integrity checker.
 *
 * Pure: takes a list of trade rows and returns a list of violations. Used by
 * the /api/proof/integrity endpoint and (optionally) the data health job.
 */
import type { ExecutedTrade } from "./types.js";

export type IntegrityRule =
  | "missing_audit_id"
  | "missing_broker_order_id"
  | "missing_entry_time"
  | "closed_without_exit_time"
  | "closed_without_pnl"
  | "open_too_long"
  | "negative_quantity"
  | "non_positive_entry_price";

export interface IntegrityViolation {
  trade_id: number;
  rule: IntegrityRule;
  detail: string;
}

export interface IntegrityReport {
  checked_at: string;
  total_trades: number;
  total_violations: number;
  by_rule: Record<IntegrityRule, number>;
  violations: IntegrityViolation[];
}

const ALL_RULES: IntegrityRule[] = [
  "missing_audit_id",
  "missing_broker_order_id",
  "missing_entry_time",
  "closed_without_exit_time",
  "closed_without_pnl",
  "open_too_long",
  "negative_quantity",
  "non_positive_entry_price",
];

export interface CheckOpts {
  /** Trades open longer than this fail "open_too_long". Default 24h. */
  maxOpenAgeMs?: number;
  /** Now (ms since epoch). Inject for deterministic tests. */
  nowMs?: number;
}

export function checkTradeIntegrity(
  trades: ExecutedTrade[],
  opts: CheckOpts = {},
): IntegrityReport {
  const nowMs = opts.nowMs ?? Date.now();
  const maxOpenAge = opts.maxOpenAgeMs ?? 24 * 3600_000;
  const violations: IntegrityViolation[] = [];

  for (const t of trades) {
    if (!t.audit_id) {
      violations.push({ trade_id: t.id, rule: "missing_audit_id", detail: "audit_id is null/empty" });
    }
    if (!t.broker_order_id) {
      violations.push({ trade_id: t.id, rule: "missing_broker_order_id", detail: "broker_order_id is null/empty" });
    }
    if (!t.entry_time) {
      violations.push({ trade_id: t.id, rule: "missing_entry_time", detail: "entry_time is null/empty" });
    }
    if (t.quantity < 0) {
      violations.push({ trade_id: t.id, rule: "negative_quantity", detail: `quantity=${t.quantity}` });
    }
    if (t.entry_price <= 0) {
      violations.push({ trade_id: t.id, rule: "non_positive_entry_price", detail: `entry_price=${t.entry_price}` });
    }
    if (t.status === "closed") {
      if (!t.exit_time) {
        violations.push({ trade_id: t.id, rule: "closed_without_exit_time", detail: "exit_time is null on closed row" });
      }
      if (t.pnl === null) {
        violations.push({ trade_id: t.id, rule: "closed_without_pnl", detail: "pnl is null on closed row" });
      }
    } else {
      // status !== "closed" (open / submitted / etc.)
      const ageMs = nowMs - Date.parse(t.entry_time);
      if (Number.isFinite(ageMs) && ageMs > maxOpenAge) {
        violations.push({
          trade_id: t.id,
          rule: "open_too_long",
          detail: `open ${Math.round(ageMs / 60_000)}min > max ${Math.round(maxOpenAge / 60_000)}min`,
        });
      }
    }
  }

  const byRule = ALL_RULES.reduce((acc, r) => {
    acc[r] = violations.filter((v) => v.rule === r).length;
    return acc;
  }, {} as Record<IntegrityRule, number>);

  return {
    checked_at: new Date(nowMs).toISOString(),
    total_trades: trades.length,
    total_violations: violations.length,
    by_rule: byRule,
    violations,
  };
}
