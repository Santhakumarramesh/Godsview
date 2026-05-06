# GodsView MCP Server v1

A read-only Model Context Protocol (MCP) server that exposes a small set of
inspection tools over the GodsView API. It lets Claude (or any MCP-compatible
client) ask **honest** questions about a running GodsView system — Brain
Console state, active signals, the latest pipeline decision, risk status, and
proof status.

> **This server is read-only by design.** It cannot place orders, modify
> positions, flip the kill switch, change risk rules, write to the proof
> database, or control charts. Every tool issues HTTP `GET` only.

---

## Why this server exists

GodsView already exposes a single honest aggregator endpoint at
`GET /api/brain-state` and a real signals endpoint at `GET /api/signals`.
This MCP server is a thin, transport-correct adapter so Claude can:

- pull the live Brain Console state without scraping the dashboard,
- inspect why the Milestone 2 pipeline did or did not trade,
- check risk lockouts before recommending a manual action,
- check that the paper-trade proof system is healthy.

When an upstream endpoint is unreachable or returns a non-2xx response,
the tool returns a structured `not_connected` envelope. **It never fabricates
data.**

---

## Tools

All tools take no arguments.

| Tool                                | HTTP call                              | Returns                                           |
| ----------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `get_brain_state`                   | `GET /api/brain-state`                 | full aggregator payload                           |
| `get_active_signals`                | `GET /api/signals`                     | accepted/active signals                           |
| `explain_latest_pipeline_decision`  | `GET /api/brain-state` → `pipeline`    | strategy meta, totals, last_decision, last_error  |
| `get_risk_status`                   | `GET /api/brain-state` → `risk`        | risk summary + lockouts                           |
| `get_proof_status`                  | `GET /api/brain-state` → `proof`       | trades / metrics / equity / integrity / reconciler |

Each response is JSON, pretty-printed, returned as a single `text` content
block. On failure, the JSON body looks like:

```json
{
  "status": "not_connected",
  "tool": "get_brain_state",
  "base_url": "http://54.162.228.136",
  "path": "/api/brain-state",
  "upstream_status": 0,
  "reason": "Timeout after 6000ms",
  "note": "This MCP server is read-only. The upstream endpoint was unreachable or returned a non-2xx response. No data was fabricated."
}
```

---

## Configuration

| Env var                    | Default                  | Notes                                              |
| -------------------------- | ------------------------ | -------------------------------------------------- |
| `GODSVIEW_BASE_URL`        | `http://localhost:3000`  | Base URL of the GodsView API server.               |
| `GODSVIEW_HTTP_TIMEOUT_MS` | `6000`                   | Per-request timeout in ms.                         |

The server logs **only** to stderr (stdout is reserved for the JSON-RPC
channel). It never logs request/response bodies in full and never logs env
values other than `GODSVIEW_BASE_URL`.

---

## Install & build

This package is intentionally **not** part of the GodsView pnpm workspace
(`mcp-servers/*` is excluded from `pnpm-workspace.yaml`). Treat it as a
standalone npm project.

```bash
cd mcp-servers/godsview
npm install
npm run build
```

Smoke-run against your local API:

```bash
GODSVIEW_BASE_URL=http://localhost:3000 npm start
# or against production:
GODSVIEW_BASE_URL=http://54.162.228.136 npm start
```

The server reads JSON-RPC frames on stdin and writes them on stdout. To poke
at it manually you can use the official MCP inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

---

## Claude Desktop configuration

Edit Claude Desktop's `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows: `%APPDATA%\Claude\claude_desktop_config.json`).

```json
{
  "mcpServers": {
    "godsview": {
      "command": "node",
      "args": ["C:/Users/Santhakumar Ramesh/Desktop/Godsview/mcp-servers/godsview/dist/index.js"],
      "env": {
        "GODSVIEW_BASE_URL": "http://54.162.228.136",
        "GODSVIEW_HTTP_TIMEOUT_MS": "6000"
      }
    }
  }
}
```

After saving, fully quit and relaunch Claude Desktop. Open a new chat and
ask:

> Use the godsview tools and tell me what the Milestone 2 pipeline did on
> the last bar.

Claude should call `explain_latest_pipeline_decision` and respond with
real values from `/api/brain-state` (or a clear `not_connected` reason).

---

## Hard rules (do not relax)

- **Read-only.** No `POST`, `PUT`, `PATCH`, `DELETE`. Adding any of these
  requires a Milestone bump and a written safety review.
- **Paper-only.** Even if the API server is later wired for live writes,
  this MCP server must never carry an order intent.
- **No fake data.** Upstream failures return a structured `not_connected`
  envelope. Never invent a value.
- **No secrets in stdout.** stdout is JSON-RPC. Diagnostic logging goes to
  stderr and never includes API keys, tokens, or full request bodies.
- **No browser automation, no chart control, no order book scraping.**
  Future surfaces (TradingView control, Bookmap-style feeds) belong in
  separate MCP servers behind their own milestones.

---

## Roadmap (out of scope for v1)

- Optional bearer-token auth header pass-through (only after auth is added
  to the API).
- Per-tool rate limiting (currently the API server's own limits apply).
- Additional read-only inspection tools (e.g. `get_paper_positions`,
  `get_phase6_health`) once their endpoints are stable.
- A separate `tradingview` MCP server for chart-control tools — kept as a
  scaffold-only sibling under `mcp-servers/tradingview/`.
