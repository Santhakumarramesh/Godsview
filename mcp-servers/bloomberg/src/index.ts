#!/usr/bin/env node
/**
 * GodsView Bloomberg MCP Server
 *
 * Bloomberg-style terminal data provider via MCP:
 *  - Real-time quotes and market snapshots
 *  - Multi-asset portfolio analytics
 *  - Economic indicators and macro data
 *  - News feed with sentiment scoring
 *  - Sector heat maps and correlation matrices
 *  - Risk analytics (VaR, exposure, Greeks)
 */

const API_BASE = process.env.GODSVIEW_API_URL ?? "http://localhost:3000/api";

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: Tool[] = [
  {
    name: "market_snapshot",
    description: "Get real-time market snapshot — price, change, volume, bid/ask for one or more symbols",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "array", items: { type: "string" }, description: "List of ticker symbols" },
      },
      required: ["symbols"],
    },
  },
  {
    name: "portfolio_analytics",
    description: "Get portfolio-level analytics — total value, P&L, allocation breakdown, risk metrics",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sector_heatmap",
    description: "Get sector performance heatmap — S&P 500 sectors with daily/weekly change",
    inputSchema: { type: "object", properties: {
      period: { type: "string", enum: ["1d","1w","1m","3m"], description: "Lookback period" },
    } },
  },
  {
    name: "economic_indicators",
    description: "Get key economic indicators — GDP, CPI, unemployment, fed funds rate, yield curve",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "news_feed",
    description: "Get market news feed with sentiment scores, filtered by symbol or sector",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Filter by symbol (optional)" },
        sector: { type: "string", description: "Filter by sector (optional)" },
        limit: { type: "number", description: "Number of articles (default 20)" },
      },
    },
  },
  {
    name: "correlation_matrix",
    description: "Get correlation matrix for a set of symbols over a given period",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "array", items: { type: "string" } },
        period: { type: "string", enum: ["1w","1m","3m","6m","1y"] },
      },
      required: ["symbols"],
    },
  },
  {
    name: "risk_analytics",
    description: "Get risk analytics — VaR, CVaR, max drawdown, Sharpe, Sortino, beta, exposure breakdown",
    inputSchema: { type: "object", properties: {
      horizon: { type: "string", enum: ["1d","5d","10d","21d"] },
    } },
  },
  {
    name: "yield_curve",
    description: "Get current US Treasury yield curve data (1M to 30Y)",
    inputSchema: { type: "object", properties: {} },
  },
];

/* ── API helpers ──────────────────────────────────────── */
async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/* ── Tool handlers ────────────────────────────────────── */
async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "market_snapshot": {
      const syms = (args.symbols as string[]).join(",");
      const data = await apiGet(`/market/snapshot?symbols=${syms}`);
      return JSON.stringify(data, null, 2);
    }
    case "portfolio_analytics": {
      const data = await apiGet("/portfolio/analytics");
      return JSON.stringify(data, null, 2);
    }
    case "sector_heatmap": {
      const period = (args.period as string) ?? "1d";
      const data = await apiGet(`/market/sectors?period=${period}`);
      return JSON.stringify(data, null, 2);
    }
    case "economic_indicators": {
      const data = await apiGet("/market/economic-indicators");
      return JSON.stringify(data, null, 2);
    }
    case "news_feed": {
      const qs = new URLSearchParams();
      if (args.symbol) qs.set("symbol", args.symbol as string);
      if (args.sector) qs.set("sector", args.sector as string);
      qs.set("limit", String((args.limit as number) ?? 20));
      const data = await apiGet(`/news/feed?${qs}`);
      return JSON.stringify(data, null, 2);
    }
    case "correlation_matrix": {
      const syms = (args.symbols as string[]).join(",");
      const period = (args.period as string) ?? "3m";
      const data = await apiGet(`/market/correlation?symbols=${syms}&period=${period}`);
      return JSON.stringify(data, null, 2);
    }
    case "risk_analytics": {
      const horizon = (args.horizon as string) ?? "1d";
      const data = await apiGet(`/risk/analytics?horizon=${horizon}`);
      return JSON.stringify(data, null, 2);
    }
    case "yield_curve": {
      const data = await apiGet("/market/yield-curve");
      return JSON.stringify(data, null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ── MCP Server (stdio transport) ─────────────────────── */
async function main() {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin });

  function send(msg: Record<string, unknown>) {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }

  for await (const line of rl) {
    let req: any;
    try { req = JSON.parse(line); } catch { continue; }
    const { id, method, params } = req;

    if (method === "initialize") {
      send({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "godsview-bloomberg-mcp", version: "1.0.0" },
        },
      });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    } else if (method === "tools/call") {
      try {
        const text = await handleTool(params.name, params.arguments ?? {});
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (err: any) {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true } });
      }
    } else {
      send({ jsonrpc: "2.0", id, result: {} });
    }
  }
}

main().catch(console.error);
