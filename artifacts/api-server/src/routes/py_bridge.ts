/**
 * Python v2 Service Bridge
 *
 * Proxies requests from the Node.js API to the Python v2 microservice stack.
 * Enabled only when PY_SERVICES_ENABLED=true in environment.
 *
 * Route mapping:
 *   /api/v2/health         → py-gateway /health
 *   /api/v2/market-data/*  → py-gateway /market-data/*
 *   /api/v2/features/*     → py-gateway /features/*
 *   /api/v2/backtest/*     → py-gateway /backtest/*
 *   /api/v2/ml/*           → py-gateway /ml/*
 *   /api/v2/execution/*    → py-gateway /execution/*
 *   /api/v2/risk/*         → py-gateway /risk/*
 *   /api/v2/memory/*       → py-gateway /memory/*
 *
 * The Python API Gateway handles internal routing to individual services.
 * This bridge just forwards from the Node.js API to the Python gateway.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router = Router();

const PY_GATEWAY_URL = process.env.PY_GATEWAY_URL || "http://py-gateway:8000";
const PY_ENABLED = process.env.PY_SERVICES_ENABLED === "true";

// ── Guard: return 503 if Python services are not enabled ────────
function requirePyServices(_req: Request, res: Response, next: () => void) {
  if (!PY_ENABLED) {
    res.status(503).json({
      error: "Python v2 services not enabled",
      hint: "Set PY_SERVICES_ENABLED=true and start with: docker compose --profile v2 up",
    });
    return;
  }
  next();
}

router.use(requirePyServices);

// ── Health check for Python gateway ─────────────────────────────
router.get("/health", async (_req, res) => {
  try {
    const response = await fetch(`${PY_GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    res.json({ bridge: "connected", gateway: data });
  } catch (err) {
    logger.warn({ err }, "[py-bridge] Python gateway unreachable");
    res.status(503).json({
      bridge: "disconnected",
      error: "Python gateway unreachable",
      gateway_url: PY_GATEWAY_URL,
    });
  }
});

// ── Generic proxy for all v2 sub-routes ─────────────────────────
const PROXY_PREFIXES = [
  "market-data",
  "features",
  "backtest",
  "ml",
  "execution",
  "risk",
  "memory",
  "signals",
  "trades",
  "scheduler",
] as const;

for (const prefix of PROXY_PREFIXES) {
  router.all(`/${prefix}/{*rest}`, async (req: Request, res: Response) => {
    const targetPath = req.originalUrl.replace(/^\/api\/v2/, "");
    const targetUrl = `${PY_GATEWAY_URL}${targetPath}`;

    try {
      const headers: Record<string, string> = {
        "content-type": req.headers["content-type"] || "application/json",
      };

      // Forward auth header if present
      if (req.headers.authorization) {
        headers.authorization = req.headers.authorization;
      }

      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
        signal: AbortSignal.timeout(30000),
      };

      // Forward body for non-GET requests
      if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl, fetchOptions);

      // Forward status and headers
      res.status(response.status);

      const contentType = response.headers.get("content-type");
      if (contentType) {
        res.setHeader("content-type", contentType);
      }

      // Stream response body
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        res.json(data);
      } else {
        const text = await response.text();
        res.send(text);
      }
    } catch (err) {
      logger.error({ err, targetUrl, method: req.method }, "[py-bridge] Proxy error");
      res.status(502).json({
        error: "Bad Gateway",
        message: `Failed to proxy to Python service: ${prefix}`,
        target: targetUrl,
      });
    }
  });
}

// ── Service status endpoint ─────────────────────────────────────
router.get("/status", async (_req, res) => {
  const services = [
    { name: "gateway", port: 8000 },
    { name: "market-data", port: 8001 },
    { name: "feature", port: 8002 },
    { name: "backtest", port: 8003 },
    { name: "ml", port: 8004 },
    { name: "execution", port: 8005 },
    { name: "risk", port: 8006 },
    { name: "memory", port: 8007 },
    { name: "scheduler", port: 8008 },
  ];

  const results = await Promise.allSettled(
    services.map(async (svc) => {
      const url = `${PY_GATEWAY_URL.replace(":8000", `:${svc.port}`)}/health`;
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return { ...svc, status: resp.ok ? "healthy" : "degraded", code: resp.status };
      } catch {
        return { ...svc, status: "offline" as const, code: 0 };
      }
    })
  );

  const statuses = results.map((r) =>
    r.status === "fulfilled" ? r.value : { name: "unknown", port: 0, status: "error", code: 0 }
  );

  const healthy = statuses.filter((s) => s.status === "healthy").length;

  res.json({
    enabled: PY_ENABLED,
    gateway_url: PY_GATEWAY_URL,
    services: statuses,
    summary: `${healthy}/${services.length} healthy`,
  });
});

export default router;
