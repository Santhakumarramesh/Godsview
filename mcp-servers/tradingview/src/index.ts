#!/usr/bin/env node
/**
 * GodsView TradingView MCP Server
 *
 * Provides tools for:
 *  - Fetching OHLCV bar data for any symbol/timeframe
 *  - Getting SMC structural overlays (support/resistance/order blocks)
 *  - Retrieving order flow signals (FVG, CVD divergence)
 *  - Fetching current regime classification
 *  - Getting active signals for chart annotation
 *  - Managing watchlist symbols
 *
 * Connects to the GodsView API server for all data.
 */

const API_BASE = process.env.GODSVIEW_API_URL ?? "http://localhost:3000/api";

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: Tool[] = [
  {
    name: "get_ohlcv_bars",
    description: "Fetch OHLCV candlestick data for a symbol and timeframe",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol (e.g. AAPL, SPY)" },
        timeframe: { type: "string", enum: ["1m","5m","15m","1h","1d"], description: "Bar timeframe" },
        limit: { type: "number", description: "Number of bars (default 200)" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_smc_overlay",
    description: "Get Smart Money Concepts structural overlay — support/resistance levels, order blocks, fair value gaps",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol" },
        timeframe: { type: "string", enum: ["1m","5m","15m","1h","1d"] },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_orderflow_signals",
    description: "Get order flow analysis — CVD, volume delta, absorption zones, sweep levels",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_regime",
    description: "Get current market regime classification (trend_day, mean_reversion, breakout, chop, news_distorted)",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol (optional, defaults to SPY)" },
      },
    },
  },
  {
    name: "get_active_signals",
    description: "Get active trading signals with C4 scores, quality, and setup type for chart annotation",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Filter by symbol (optional)" },
        minQuality: { type: "number", description: "Minimum quality threshold 0-1" },
      },
    },
  },
  {
    name: "get_chart_annotations",
    description: "Get combined chart annotations — trade entries/exits, signal markers, level lines, pattern zones",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol" },
        timeframe: { type: "string", enum: ["1m","5m","15m","1h","1d"] },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_watchlist",
    description: "Get the current watchlist of tracked symbols with attention scores",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_to_watchlist",
    description: "Add a symbol to the watchlist",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
];

/* ── API fetch helper ─────────────────────────────────── */
async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/* ── Tool handlers ────────────────────────────────────── */
async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "get_ohlcv_bars": {
      const sym = args.symbol as string;
      const tf = (args.timeframe as string) ?? "5m";
      const limit = (args.limit as number) ?? 200;
      const data = await apiGet(`/market/bars/${sym}?timeframe=${tf}&limit=${limit}`);
      return JSON.stringify(data, null, 2);
    }
    case "get_smc_overlay": {
      const sym = args.symbol as string;
      const tf = (args.timeframe as string) ?? "15m";
      const data = await apiGet(`/market/smc/${sym}?timeframe=${tf}`);
      return JSON.stringify(data, null, 2);
    }
    case "get_orderflow_signals": {
      const sym = args.symbol as string;
      const data = await apiGet(`/market/orderflow/${sym}`);
      return JSON.stringify(data, null, 2);
    }
    case "get_regime": {
      const sym = (args.symbol as string) ?? "SPY";
      const data = await apiGet(`/market/regime?symbol=${sym}`);
      return JSON.stringify(data, null, 2);
    }
    case "get_active_signals": {
      const sym = args.symbol ? `?symbol=${args.symbol}` : "";
      const mq = args.minQuality ? `${sym ? "&" : "?"}minQuality=${args.minQuality}` : "";
      const data = await apiGet(`/signals${sym}${mq}`);
      return JSON.stringify(data, null, 2);
    }
    case "get_chart_annotations": {
      const sym = args.symbol as string;
      const tf = (args.timeframe as string) ?? "5m";
      const data = await apiGet(`/tradingview/overlay/${sym}?timeframe=${tf}`);
      return JSON.stringify(data, null, 2);
    }
    case "get_watchlist": {
      const data = await apiGet("/watchlist");
      return JSON.stringify(data, null, 2);
    }
    case "add_to_watchlist": {
      const data = await apiPost("/watchlist", { symbol: args.symbol });
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
          serverInfo: { name: "godsview-tradingview-mcp", version: "1.0.0" },
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
