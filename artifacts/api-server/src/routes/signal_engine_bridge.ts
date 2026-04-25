/**
 * Signal Engine Bridge — proxies requests to Python crypto signal engine (port 8099)
 * Endpoints:
 *   GET /api/signal-engine/health
 *   GET /api/signal-engine/strategies
 *   GET /api/signal-engine/signals
 *   GET /api/signal-engine/positions
 *   GET /api/signal-engine/performance
 *   GET /api/signal-engine/comparison
 *   GET /api/signal-engine/alerts
 *   POST /api/signal-engine/pause/:strategy
 *   POST /api/signal-engine/resume/:strategy
 *   POST /api/signal-engine/kill
 */

import { Router, type Request, type Response } from "express";
import http from "http";
import { logger } from "../lib/logger";

const router = Router();

const SIGNAL_ENGINE_HOST = process.env.SIGNAL_ENGINE_HOST || "127.0.0.1";
const SIGNAL_ENGINE_PORT = parseInt(process.env.SIGNAL_ENGINE_PORT || "8099", 10);

function proxyToEngine(
  req: Request,
  res: Response,
  enginePath: string,
  method: string = "GET"
): void {
  const options: http.RequestOptions = {
    hostname: SIGNAL_ENGINE_HOST,
    port: SIGNAL_ENGINE_PORT,
    path: enginePath,
    method,
    timeout: 10000,
    headers: { "Content-Type": "application/json" },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let data = "";
    proxyRes.on("data", (chunk) => (data += chunk));
    proxyRes.on("end", () => {
      try {
        const json = JSON.parse(data);
        res.status(proxyRes.statusCode || 200).json(json);
      } catch {
        res.status(proxyRes.statusCode || 200).send(data);
      }
    });
  });

  proxyReq.on("error", (err) => {
    logger.error({ err }, "[signal-engine-bridge] Proxy error");
    res.status(503).json({
      error: "Signal engine unavailable",
      detail: String(err.message),
      timestamp: Date.now(),
    });
  });

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    res.status(504).json({ error: "Signal engine timeout", timestamp: Date.now() });
  });

  if (method === "POST" && req.body) {
    proxyReq.write(JSON.stringify(req.body));
  }

  proxyReq.end();
}

// ── GET endpoints ───────────────────────────────────────────────
router.get("/health", (req, res) => proxyToEngine(req, res, "/health"));
router.get("/strategies", (req, res) => proxyToEngine(req, res, "/strategies"));
router.get("/signals", (req, res) => proxyToEngine(req, res, "/signals"));
router.get("/positions", (req, res) => proxyToEngine(req, res, "/positions"));
router.get("/performance", (req, res) => proxyToEngine(req, res, "/performance"));
router.get("/comparison", (req, res) => proxyToEngine(req, res, "/comparison"));
router.get("/alerts", (req, res) => proxyToEngine(req, res, "/alerts"));

// ── POST endpoints ──────────────────────────────────────────────
router.post("/pause/:strategy", (req, res) =>
  proxyToEngine(req, res, `/pause/${req.params.strategy}`, "POST")
);
router.post("/resume/:strategy", (req, res) =>
  proxyToEngine(req, res, `/resume/${req.params.strategy}`, "POST")
);
router.post("/kill", (req, res) => proxyToEngine(req, res, "/kill", "POST"));

// ── Summary endpoint (aggregated for dashboard) ─────────────────
router.get("/summary", (req: Request, res: Response): void => {
  // Fetch multiple endpoints and combine
  const results: Record<string, any> = {};
  let pending = 3;

  const done = () => {
    pending--;
    if (pending <= 0) {
      res.json({
        ...results,
        mode: "PAPER",
        timestamp: Date.now(),
      });
    }
  };

  // Strategies
  const sReq = http.get(
    { hostname: SIGNAL_ENGINE_HOST, port: SIGNAL_ENGINE_PORT, path: "/strategies", timeout: 5000 },
    (sRes) => {
      let d = "";
      sRes.on("data", (c) => (d += c));
      sRes.on("end", () => {
        try { results.strategies = JSON.parse(d); } catch { results.strategies = []; }
        done();
      });
    }
  );
  sReq.on("error", () => { results.strategies = []; done(); });

  // Positions
  const pReq = http.get(
    { hostname: SIGNAL_ENGINE_HOST, port: SIGNAL_ENGINE_PORT, path: "/positions", timeout: 5000 },
    (pRes) => {
      let d = "";
      pRes.on("data", (c) => (d += c));
      pRes.on("end", () => {
        try { results.positions = JSON.parse(d); } catch { results.positions = []; }
        done();
      });
    }
  );
  pReq.on("error", () => { results.positions = []; done(); });

  // Performance
  const pfReq = http.get(
    { hostname: SIGNAL_ENGINE_HOST, port: SIGNAL_ENGINE_PORT, path: "/performance", timeout: 5000 },
    (pfRes) => {
      let d = "";
      pfRes.on("data", (c) => (d += c));
      pfRes.on("end", () => {
        try { results.performance = JSON.parse(d); } catch { results.performance = {}; }
        done();
      });
    }
  );
  pfReq.on("error", () => { results.performance = {}; done(); });
});

export default router;
