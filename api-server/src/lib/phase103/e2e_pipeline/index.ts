/**
 * Phase 103 — Full E2E Pipeline orchestrator
 * ===========================================
 * Wires Signal → Validation → Risk → Governance → Execution → Reconciliation
 * into a single function call so the UI, MCP, and tests can drive the
 * whole brain through one entry point.
 */

import {
  bootstrapAgentSystem,
  RawSignal,
  ExecutionPlan,
  AgentPipelineResult,
} from "../agents/agents.js";
import { getOrderLifecycle, OrderRequest } from "../broker_reality/order_lifecycle.js";
import { getRecallStore } from "../recall_engine/recall_store.js";
import { getFusionExplain, SignalContribution } from "../fusion_explain/index.js";
import { getOrderFlowL2 } from "../orderflow_l2/index.js";

export interface E2EInput {
  raw_signal: RawSignal;
  contributions: SignalContribution[];
  regime?: string;
  governance_veto?: string;
  /** When true, do not call the broker; produce a plan only. */
  dry_run?: boolean;
}

export interface E2EResult {
  decision_id: string;
  explain: ReturnType<ReturnType<typeof getFusionExplain>["fuse"]>;
  pipeline?: AgentPipelineResult;
  order_request?: OrderRequest;
  orderflow?: ReturnType<ReturnType<typeof getOrderFlowL2>["computeState"]>;
  status: "approved" | "reduced" | "rejected" | "vetoed";
}

export async function runE2E(input: E2EInput): Promise<E2EResult> {
  const fusion = getFusionExplain();
  const recall = getRecallStore();
  const lifecycle = getOrderLifecycle();
  const orderflow = getOrderFlowL2();

  const recallSummary = recall.summarize({
    symbol: input.raw_signal.symbol,
    setup_type: input.raw_signal.setup_type,
    trend: input.raw_signal.trend,
    rr: input.raw_signal.rr,
    confidence: input.raw_signal.confidence,
    tags: input.raw_signal.tags,
  });

  const explain = fusion.fuse({
    decision_id: input.raw_signal.decision_id,
    symbol: input.raw_signal.symbol,
    side: input.raw_signal.side,
    contributions: input.contributions,
    recall:
      recallSummary.matches > 0
        ? { matches: recallSummary.matches, win_rate: recallSummary.win_rate }
        : undefined,
    regime: input.regime,
    governance_veto: input.governance_veto,
  });

  const ofState = orderflow.computeState(input.raw_signal.symbol);

  if (explain.outcome === "rejected" || explain.outcome === "vetoed") {
    return {
      decision_id: input.raw_signal.decision_id,
      explain,
      orderflow: ofState,
      status: explain.outcome,
    };
  }

  let pipelineResult: AgentPipelineResult | undefined;
  let plan: ExecutionPlan | undefined;

  const sys = bootstrapAgentSystem({
    governance: () =>
      input.governance_veto
        ? { veto: true, reason: input.governance_veto }
        : { veto: false },
    submitOrder: async (p) => {
      plan = p;
      if (input.dry_run) {
        return { accepted: true, broker_order_id: `dry-${p.client_order_id}` };
      }
      lifecycle.submit({
        client_order_id: p.client_order_id,
        symbol: p.symbol,
        side: p.side,
        qty: p.final_qty,
        type: "market",
        tif: "day",
        reference_price: p.reference_price,
        source: "e2e_pipeline",
        decision_id: p.decision_id,
      });
      lifecycle.accept(p.client_order_id, `live-${p.client_order_id}`);
      return { accepted: true, broker_order_id: `live-${p.client_order_id}` };
    },
    learn: (r) => {
      pipelineResult = r;
    },
  });

  await sys.signal.ingest(input.raw_signal);
  // Allow event loop to drain async listeners
  await new Promise((res) => setImmediate(res));

  return {
    decision_id: input.raw_signal.decision_id,
    explain,
    pipeline: pipelineResult,
    order_request: plan
      ? {
          client_order_id: plan.client_order_id,
          symbol: plan.symbol,
          side: plan.side,
          qty: plan.final_qty,
          type: "market",
          tif: "day",
          reference_price: plan.reference_price,
          source: "e2e_pipeline",
          decision_id: plan.decision_id,
        }
      : undefined,
    orderflow: ofState,
    status: explain.outcome,
  };
}
