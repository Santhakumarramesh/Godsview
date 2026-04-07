#!/usr/bin/env node
/**
 * GodsView News Monitor MCP Server
 *
 * Tools for real-time news monitoring:
 *  - Get news feed with filters (symbol, category, impact)
 *  - Get aggregate sentiment analysis
 *  - Get news by impact level for trading decisions
 *  - Subscribe to breaking news alerts
 */

const API_BASE = process.env.GODSVIEW_API_URL ?? "http://localhost:3000/api";

const TOOLS = [
  {
    name: "get_news_feed",
    description: "Get latest market news with sentiment scores and impact ratings",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Filter by symbol (e.g. AAPL)" },
        category: { type: "string", enum: ["macro","earnings","product","regulation","commodities","crypto","bonds","labor","housing","consumer","strategy"] },
        impact: { type: "string", enum: ["low","medium","high","critical"] },
        limit: { type: "number", description: "Max articles (default 20)" },
      },
    },
  },
  {
    name: "get_sentiment_summary",
    description: "Get aggregate market sentiment — bullish/bearish/neutral split, by category breakdown",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_critical_alerts",
    description: "Get only critical/high impact news that may affect open positions or pending signals",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_news_for_symbol",
    description: "Get all recent news and sentiment for a specific symbol",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
];

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "get_news_feed": {
      const qs = new URLSearchParams();
      if (args.symbol) qs.set("symbol", args.symbol as string);
      if (args.category) qs.set("category", args.category as string);
      if (args.impact) qs.set("impact", args.impact as string);
      qs.set("limit", String((args.limit as number) ?? 20));
      return JSON.stringify(await apiGet(`/news/monitor?${qs}`), null, 2);
    }
    case "get_sentiment_summary":
      return JSON.stringify(await apiGet("/news/sentiment"), null, 2);
    case "get_critical_alerts":
      return JSON.stringify(await apiGet("/news/monitor?impact=critical"), null, 2);
    case "get_news_for_symbol": {
      const sym = args.symbol as string;
      return JSON.stringify(await apiGet(`/news/monitor?symbol=${sym}`), null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

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
      send({ jsonrpc: "2.0", id, result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "godsview-news-monitor-mcp", version: "1.0.0" },
      } });
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
