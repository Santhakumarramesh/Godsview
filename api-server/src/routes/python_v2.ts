/**
 * python_v2.ts — Proxy routes to Python v2 microservices (FastAPI gateway, port 8000)
 *
 * These routes coexist with the existing Node.js routes and progressively
 * delegate computation to the Python v2 stack. The dashboard can use either
 * the classic Node endpoints or the /v2/* shadow routes.
 *
 * Route map:
 *   GET  /v2/health            → Python gateway /health
 *   GET  /v2/health/services   → Python gateway /health/services
 *   POST /v2/signals           → Python gateway /api/signals (SK detect + ML filter)
 *   GET  /v2/signals/live      → Python gateway /api/signals/live
 *   GET  /v2/signals/history   → Python gateway /api/signals/history
 *   POST /v2/backtest          → Python gateway /api/backtest/run
 *   GET  /v2/backtest/:id      → Python gateway /api/backtest/:id
 *   GET  /v2/market/bars/:sym  → Python gateway /api/market/bars/:symbol
 *   POST /v2/ml/predict        → Python gateway /api/ml/predict
 *   GET  /v2/ml/model          → Python gateway /api/ml/model
 *   POST /v2/trades            → Python gateway /api/trades
 *   GET  /v2/trades            → Python gateway /api/trades
 *   GET  /v2/scheduler/status  → Python scheduler /scheduler/status
 *   POST /v2/scheduler/scan    → Python scheduler /scheduler/scan/trigger
 */

import { Router, Request, Response, NextFunction } from "express";

const router = Router();

// ─── Config ──────────────────────────────────────────────────────────────────

const PY_GATEWAY_URL   = process.env.PYTHON_GATEWAY_URL   || "http://localhost:8000";
const PY_SCHEDULER_URL = process.env.PYTHON_SCHEDULER_URL || "http://localhost:8008";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY     || "internal-dev-key";
const PROXY_TIMEOUT_MS = parseInt(process.env.PROXY_TIMEOUT_MS || "10000", 10);

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ProxyOptions {
  targetBase: string;
  targetPath: string;
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
}

async function proxyToService(
  res: Response,
  opts: ProxyOptions
): Promise<void> {
  const { targetBase, targetPath, method = "GET", body, query } = opts;

  // Build URL with optional query params
  const url = new URL(`${targetBase}${targetPath}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const fetchOpts: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": INTERNAL_API_KEY,
        "X-Forwarded-From": "node-gateway",
      },
    };
    if (body) {
      fetchOpts.body = JSON.stringify(body);
    }

    const upstream = await fetch(url.toString(), fetchOpts);
    const data = await upstream.json().catch(() => ({}));

    res.status(upstream.status).json(data);
  } catch (err: any) {
    if (err.name === "AbortError") {
      res.status(504).json({ error: "Python gateway timeout", target: url.toString() });
    } else {
      res.status(502).json({ error: "Python gateway unreachable", detail: err.message });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function extractQuery(req: Request, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = req.query[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

// ─── Health ───────────────────────────────────────────────────────────────────

router.get("/v2/health", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/health",
  });
});

router.get("/v2/health/services", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/health/services",
  });
});

// ─── Signals ──────────────────────────────────────────────────────────────────

router.post("/v2/signals", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/signals",
    method: "POST",
    body: req.body,
  });
});

router.get("/v2/signals/live", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/signals/live",
    query: extractQuery(req, ["limit"]),
  });
});

router.get("/v2/signals/history", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/signals/history",
    query: extractQuery(req, ["symbol", "timeframe", "limit", "outcome"]),
  });
});

// ─── Backtest ─────────────────────────────────────────────────────────────────

router.post("/v2/backtest", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/backtest/run",
    method: "POST",
    body: req.body,
  });
});

router.get("/v2/backtest/:runId", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: `/api/backtest/${String(req.params.runId ?? "")}`,
  });
});

// ─── Market Data ──────────────────────────────────────────────────────────────

router.get("/v2/market/bars/:symbol", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: `/api/market/bars/${String(req.params.symbol ?? "")}`,
    query: extractQuery(req, ["timeframe", "count", "start", "end"]),
  });
});

router.get("/v2/market/price/:symbol", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: `/api/market/price/${String(req.params.symbol ?? "")}`,
  });
});

// ─── ML ───────────────────────────────────────────────────────────────────────

router.post("/v2/ml/predict", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/ml/predict",
    method: "POST",
    body: req.body,
  });
});

router.get("/v2/ml/model", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/ml/model",
  });
});

router.post("/v2/ml/train", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/ml/train",
    method: "POST",
    body: req.body,
  });
});

// ─── Trades ───────────────────────────────────────────────────────────────────

router.post("/v2/trades", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/trades",
    method: "POST",
    body: req.body,
  });
});

router.get("/v2/trades", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/trades",
    query: extractQuery(req, ["symbol", "limit", "outcome"]),
  });
});

router.delete("/v2/trades/:id", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: `/api/trades/${String(req.params.id ?? "")}`,
    method: "DELETE",
  });
});

router.get("/v2/trades/pnl", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/trades/pnl",
  });
});

// ─── Scheduler ────────────────────────────────────────────────────────────────

router.get("/v2/scheduler/status", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_SCHEDULER_URL,
    targetPath: "/scheduler/status",
  });
});

router.post("/v2/scheduler/scan", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_SCHEDULER_URL,
    targetPath: "/scheduler/scan/trigger",
    method: "POST",
    body: req.body,
  });
});

router.post("/v2/scheduler/retrain", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_SCHEDULER_URL,
    targetPath: "/scheduler/retrain/trigger",
    method: "POST",
  });
});

router.get("/v2/scheduler/watchlist", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_SCHEDULER_URL,
    targetPath: "/scheduler/watchlist",
  });
});

// ─── Circuit breaker status ───────────────────────────────────────────────────

router.get("/v2/system/circuit-breakers", async (req: Request, res: Response) => {
  await proxyToService(res, {
    targetBase: PY_GATEWAY_URL,
    targetPath: "/api/system/circuit-breakers",
  });
});

router.get("/v2/system/metrics", async (req: Request, res: Response) => {
  // Fetch Prometheus text metrics and convert to JSON summary
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`${PY_GATEWAY_URL}/metrics`, {
      signal: controller.signal,
      headers: { "X-API-Key": INTERNAL_API_KEY },
    });
    const text = await r.text();
    res.type("text/plain").send(text);
  } catch {
    res.status(502).json({ error: "Metrics unavailable" });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
