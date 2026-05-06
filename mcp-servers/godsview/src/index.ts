#!/usr/bin/env node
/**
 * GodsView MCP Server v1 — read-only inspection layer.
 *
 * Hard constraints (do NOT relax without an explicit Milestone bump):
 *  - Read-only: every tool issues HTTP GET only.
 *  - Paper-only: this server cannot place orders, modify positions,
 *    flip the kill switch, or write any state.
 *  - No fake data: when an upstream endpoint is unreachable or returns
 *    a non-2xx, the tool returns a structured `not_connected` payload
 *    (status, reason, base_url, path) — never a fabricated success.
 *  - No browser automation, no chart control, no order book scraping.
 *
 * Five tools:
 *   1. get_brain_state                  → GET /api/brain-state
 *   2. get_active_signals               → GET /api/signals
 *   3. explain_latest_pipeline_decision → GET /api/brain-state, projects pipeline section
 *   4. get_risk_status                  → GET /api/brain-state, projects risk section
 *   5. get_proof_status                 → GET /api/brain-state, projects proof section
 *
 * Configuration:
 *   GODSVIEW_BASE_URL   Base URL of the GodsView API server.
 *                       Defaults to http://localhost:3000.
 *                       Examples: http://54.162.228.136, https://api.godsview.dev
 *   GODSVIEW_HTTP_TIMEOUT_MS  Per-request timeout. Default 6000ms.
 *
 * Transport: stdio (JSON-RPC over stdin/stdout) via the official
 * @modelcontextprotocol/sdk StdioServerTransport.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/* ─────────────────────────────────────────────────────────
 * Config
 * ───────────────────────────────────────────────────────── */

const RAW_BASE_URL = process.env.GODSVIEW_BASE_URL ?? "http://localhost:3000";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, ""); // strip trailing slashes
const HTTP_TIMEOUT_MS = Number(process.env.GODSVIEW_HTTP_TIMEOUT_MS ?? "6000");

const SERVER_NAME = "godsview-mcp";
const SERVER_VERSION = "1.0.0";

/* ─────────────────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────────────────── */

type FetchOk<T> = { ok: true; status: number; data: T };
type FetchErr = {
  ok: false;
  status: number; // 0 if network/timeout
  reason: string;
  body?: string; // optional truncated body for diagnostics
};
type FetchResult<T> = FetchOk<T> | FetchErr;

/** Standard "not_connected" envelope returned to the model as JSON text. */
function notConnected(opts: {
  tool: string;
  path: string;
  status: number;
  reason: string;
  body?: string;
}): Record<string, unknown> {
  return {
    status: "not_connected",
    tool: opts.tool,
    base_url: BASE_URL,
    path: opts.path,
    upstream_status: opts.status,
    reason: opts.reason,
    upstream_body_preview: opts.body,
    note: "This MCP server is read-only. The upstream endpoint was unreachable or returned a non-2xx response. No data was fabricated.",
  };
}

/* ─────────────────────────────────────────────────────────
 * HTTP client (GET-only, never logs secrets)
 * ───────────────────────────────────────────────────────── */

async function safeGet<T = unknown>(path: string): Promise<FetchResult<T>> {
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      let preview: string | undefined;
      try {
        const t = await res.text();
        preview = t.slice(0, 400);
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        status: res.status,
        reason: `Upstream HTTP ${res.status}`,
        body: preview,
      };
    }
    // We only accept JSON. If the server returned something else, surface it.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      let preview: string | undefined;
      try {
        const t = await res.text();
        preview = t.slice(0, 400);
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        status: res.status,
        reason: `Upstream did not return JSON (content-type: ${contentType || "unknown"})`,
        body: preview,
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout after ${HTTP_TIMEOUT_MS}ms`
          : err.message
        : String(err);
    return { ok: false, status: 0, reason };
  }
}

/* ─────────────────────────────────────────────────────────
 * Tool definitions (single source of truth for ListTools)
 * ───────────────────────────────────────────────────────── */

const TOOLS = [
  {
    name: "get_brain_state",
    description:
      "Read-only. Returns the full GodsView Brain Console aggregator payload — system mode, account, scanner status, proof metrics, signals, risk, macro, MCP layer, and the live pipeline section. Calls GET /api/brain-state on the GodsView API server. If the upstream server is unreachable, returns a structured not_connected envelope. Never places orders, never writes state.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_active_signals",
    description:
      "Read-only. Returns the current list of accepted/active trading signals from the GodsView API. Calls GET /api/signals. Useful for inspecting which setups the engine has flagged. Returns not_connected if upstream is down. Never places orders.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "explain_latest_pipeline_decision",
    description:
      "Read-only. Projects the Milestone 2 pipeline section out of /api/brain-state, including strategy name/version, totals (attempted, evaluated, insufficient_bars, fetch_errors, accepted, no_trade, error, executed, execution_blocked), last decision, last accepted, last no_trade, last_error, last_insufficient_bars_reason, and not_connected_layers. Use this to understand why the strategy did or did not produce a trade on the last bar.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_risk_status",
    description:
      "Read-only. Projects the risk section out of /api/brain-state — risk summary, lockouts, drawdown, daily loss state, and any active risk gates. Returns not_connected if /api/brain-state cannot be reached. Never modifies risk state.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_proof_status",
    description:
      "Read-only. Projects the proof section out of /api/brain-state — paper-trade proof metrics, equity, integrity, and reconciliation status. Use this to check that the trade-execution proof system is healthy. Never writes to proof.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

/* ─────────────────────────────────────────────────────────
 * Tool implementations
 * ───────────────────────────────────────────────────────── */

async function toolGetBrainState(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, unknown>>(path);
  if (!r.ok) {
    return notConnected({
      tool: "get_brain_state",
      path,
      status: r.status,
      reason: r.reason,
      body: r.body,
    });
  }
  return r.data;
}

async function toolGetActiveSignals(): Promise<unknown> {
  const path = "/api/signals";
  const r = await safeGet<unknown>(path);
  if (!r.ok) {
    return notConnected({
      tool: "get_active_signals",
      path,
      status: r.status,
      reason: r.reason,
      body: r.body,
    });
  }
  return r.data;
}

async function toolExplainLatestPipelineDecision(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) {
    return notConnected({
      tool: "explain_latest_pipeline_decision",
      path,
      status: r.status,
      reason: r.reason,
      body: r.body,
    });
  }
  const pipeline = r.data?.pipeline;
  if (!pipeline) {
    return {
      status: "not_connected",
      tool: "explain_latest_pipeline_decision",
      base_url: BASE_URL,
      path,
      reason:
        "Upstream /api/brain-state did not include a `pipeline` section. The Milestone 2 pipeline may not be deployed.",
    };
  }
  // Return JUST the pipeline projection so the model is not flooded.
  return {
    status: "ok",
    tool: "explain_latest_pipeline_decision",
    generated_at: r.data?.generated_at,
    mode: r.data?.mode,
    pipeline,
  };
}

async function toolGetRiskStatus(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) {
    return notConnected({
      tool: "get_risk_status",
      path,
      status: r.status,
      reason: r.reason,
      body: r.body,
    });
  }
  const risk = r.data?.risk;
  if (!risk) {
    return {
      status: "not_connected",
      tool: "get_risk_status",
      base_url: BASE_URL,
      path,
      reason: "Upstream /api/brain-state did not include a `risk` section.",
    };
  }
  return {
    status: "ok",
    tool: "get_risk_status",
    generated_at: r.data?.generated_at,
    mode: r.data?.mode,
    risk,
  };
}

async function toolGetProofStatus(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) {
    return notConnected({
      tool: "get_proof_status",
      path,
      status: r.status,
      reason: r.reason,
      body: r.body,
    });
  }
  const proof = r.data?.proof;
  if (!proof) {
    return {
      status: "not_connected",
      tool: "get_proof_status",
      base_url: BASE_URL,
      path,
      reason: "Upstream /api/brain-state did not include a `proof` section.",
    };
  }
  return {
    status: "ok",
    tool: "get_proof_status",
    generated_at: r.data?.generated_at,
    mode: r.data?.mode,
    proof,
  };
}

/* ─────────────────────────────────────────────────────────
 * Dispatch
 * ───────────────────────────────────────────────────────── */

async function dispatchTool(name: string): Promise<unknown> {
  switch (name) {
    case "get_brain_state":
      return toolGetBrainState();
    case "get_active_signals":
      return toolGetActiveSignals();
    case "explain_latest_pipeline_decision":
      return toolExplainLatestPipelineDecision();
    case "get_risk_status":
      return toolGetRiskStatus();
    case "get_proof_status":
      return toolGetProofStatus();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ─────────────────────────────────────────────────────────
 * Server bootstrap (real Server + StdioServerTransport)
 * ───────────────────────────────────────────────────────── */

async function main() {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    try {
      const data = await dispatchTool(name);
      const text = JSON.stringify(data, null, 2);
      return {
        content: [{ type: "text", text }],
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const errPayload = {
        status: "error",
        tool: name,
        base_url: BASE_URL,
        reason,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(errPayload, null, 2) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // We deliberately log to stderr (NEVER stdout — stdout is the JSON-RPC channel).
  // No env-var values, no secrets — only the configured base URL.
  process.stderr.write(
    `[${SERVER_NAME}@${SERVER_VERSION}] connected. base_url=${BASE_URL} tools=${TOOLS.length}\n`,
  );
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[${SERVER_NAME}] fatal: ${msg}\n`);
  process.exit(1);
});
