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
  {
    name: "get_webhook_stats",
    description: "Get TradingView webhook statistics (total received, deduplicated, errors, last signal time)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_webhook_history",
    description: "Get recent signals received from TradingView webhooks",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of signals to return (default 50, max 500)" },
        symbol: { type: "string", description: "Filter by symbol (optional)" },
      },
    },
  },
  {
    name: "get_annotations",
    description: "Get pending chart annotations for a symbol (entry/exit lines, SL/TP, labels)",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol" },
        timeframe: { type: "string", description: "Filter by timeframe (optional)" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "push_annotation",
    description: "Push a chart annotation to TradingView (entry/exit lines, structure markings, confidence labels)",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol" },
        timeframe: { type: "string", description: "Chart timeframe" },
        annotation_type: { type: "string", enum: ["signal", "structure"], description: "Type of annotation" },
        entry_price: { type: "number", description: "Entry price (for signal type)" },
        stop_loss: { type: "number", description: "Stop loss level (for signal type)" },
        take_profit: { type: "number", description: "Take profit level (for signal type)" },
        direction: { type: "string", enum: ["long", "short"], description: "Trade direction (for signal type)" },
        confidence: { type: "number", description: "Confidence score 0-1 (for signal type)" },
        structures: { type: "array", description: "Structure array [{type, price_high, price_low}] (for structure type)" },
      },
      required: ["symbol", "timeframe", "annotation_type"],
    },
  },
  {
    name: "get_annotation_stats",
    description: "Get annotation statistics across all symbols",
    inputSchema: { type: "object", properties: {} },
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
    case "get_webhook_stats": {
      const data = await apiGet("/tv-webhook/stats");
      return JSON.stringify(data, null, 2);
    }
    case "get_webhook_history": {
      const limit = args.limit ? `?limit=${args.limit}` : "";
      const symbol = args.symbol ? `${limit ? "&" : "?"}symbol=${args.symbol}` : "";
      const data = await apiGet(`/tv-webhook/history${limit}${symbol}`);
      return JSON.stringify(data, null, 2);
    }
    case "get_annotations": {
      const sym = args.symbol as string;
      const tf = args.timeframe ? `?timeframe=${args.timeframe}` : "";
      const data = await apiGet(`/tv-sync/${sym}/annotations${tf}`);
      return JSON.stringify(data, null, 2);
    }
    case "push_annotation": {
      const sym = args.symbol as string;
      const type = args.annotation_type as string;
      if (type === "signal") {
        const body = {
          timeframe: args.timeframe,
          entry_price: args.entry_price,
          stop_loss: args.stop_loss,
          take_profit: args.take_profit,
          direction: args.direction,
          confidence: args.confidence,
          setup_type: "mcp_annotation",
        };
        const data = await apiPost(`/tv-sync/${sym}/annotations/signal`, body);
        return JSON.stringify(data, null, 2);
      } else if (type === "structure") {
        const body = {
          timeframe: args.timeframe,
          structures: args.structures,
        };
        const data = await apiPost(`/tv-sync/${sym}/annotations/structures`, body);
        return JSON.stringify(data, null, 2);
      }
      throw new Error("Unknown annotation type");
    }
    case "get_annotation_stats": {
      const data = await apiGet("/tv-sync/stats");
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
