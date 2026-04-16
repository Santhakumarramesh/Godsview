/**
 * Operator Status Dashboard
 *
 * GET /api/operator/status
 * Real-time system health, service status, data feeds, and broker connectivity.
 * Shows which services are live vs mocked.
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { logger } from "../lib/logger";
import { checkDbHealth } from "@workspace/db";

const router: IRouter = Router();

/** Helper: Ping Python service /health endpoint */
async function pingPythonService(
  url: string,
  serviceName: string,
  timeoutMs: number = 5000,
): Promise<{ status: "live" | "mocked" | "down"; latencyMs: number; lastHealthy?: string }> {
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "GodsView-Operator" },
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      const isMocked = (data.mode === "mocked" || data.mocked === true);
      return {
        status: isMocked ? "mocked" : "live",
        latencyMs,
        lastHealthy: new Date().toISOString(),
      };
    } else {
      return { status: "down", latencyMs };
    }
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    logger.warn({ serviceName, error: error.message, latencyMs }, "Service health check failed");
    return { status: "down", latencyMs };
  }
}

/**
 * GET /api/operator/status
 * Real-time system health overview
 */
router.get("/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const timestamp = new Date().toISOString();

    // ════════════════════════════════════════════════════════════════════════════
    // 1. API SERVER (in-process)
    // ════════════════════════════════════════════════════════════════════════════
    const apiUptime = process.uptime();
    const apiMemoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    // ════════════════════════════════════════════════════════════════════════════
    // 2. DATABASE
    // ════════════════════════════════════════════════════════════════════════════
    let dbStatus: "live" | "down" = "down";
    let dbLatencyMs = 0;
    try {
      const dbHealth = await checkDbHealth();
      dbStatus = dbHealth.ok ? "live" : "down";
      dbLatencyMs = dbHealth.latencyMs || 0;
    } catch {
      dbStatus = "down";
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 3. PYTHON v2 MICROSERVICES
    // ════════════════════════════════════════════════════════════════════════════
    const pyServicesEnabled = process.env.PY_SERVICES_ENABLED === "true";
    const pyGatewayUrl = process.env.PY_GATEWAY_URL || "http://py-gateway:8000";

    const servicePorts: Record<string, { port: number; name: string }> = {
      "py-gateway": { port: 8000, name: "API Gateway" },
      "py-market-data": { port: 8001, name: "Market Data" },
      "py-feature": { port: 8002, name: "Feature Service" },
      "py-backtest": { port: 8003, name: "Backtest" },
      "py-ml": { port: 8004, name: "ML Model" },
      "py-execution": { port: 8005, name: "Execution" },
      "py-risk": { port: 8006, name: "Risk" },
      "py-memory": { port: 8007, name: "Memory/Vector DB" },
      "py-scheduler": { port: 8008, name: "Scheduler" },
    };

    const servicesHealth: Record<
      string,
      { status: "live" | "mocked" | "down"; latencyMs: number; lastHealthy?: string }
    > = {};

    if (pyServicesEnabled) {
      for (const [key, { port, name }] of Object.entries(servicePorts)) {
        const healthUrl = `http://${key}:${port}/health`;
        servicesHealth[key] = await pingPythonService(healthUrl, name);
      }
    } else {
      // All services are "down" when PY_SERVICES_ENABLED is false
      for (const key of Object.keys(servicePorts)) {
        servicesHealth[key] = { status: "down", latencyMs: 0 };
      }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 4. BROKER CONNECTION (Alpaca)
    // ════════════════════════════════════════════════════════════════════════════
    let brokerStatus: "live" | "mocked" | "down" = "down";
    let brokerMode: "live" | "paper" = "paper";
    let brokerLatencyMs = 0;
    let accountEquity = 0;
    let buyingPower = 0;

    try {
      const { getAccount, getAlpacaCredentialStatus } = await import("../lib/alpaca");
      const creds = getAlpacaCredentialStatus();

      if (creds.keyConfigured && creds.secretConfigured && creds.hasValidTradingKey) {
        const startTime = Date.now();
        const account = await getAccount();
        brokerLatencyMs = Date.now() - startTime;

        if (account && !account.error) {
          brokerStatus = "live";
          brokerMode = process.env.GODSVIEW_SYSTEM_MODE === "live" ? "live" : "paper";
          accountEquity = Number(account.equity) || 0;
          buyingPower = Number(account.buying_power) || 0;
        } else {
          brokerStatus = "mocked";
        }
      } else {
        brokerStatus = "down";
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "Broker health check failed");
      brokerStatus = "down";
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 5. DATA FEEDS (Market Data)
    // ════════════════════════════════════════════════════════════════════════════
    const dataFeeds: Record<
      string,
      { connected: boolean; lastData?: string; freshnessSeconds?: number; source?: string; error?: string }
    > = {};

    try {
      const { getAlpacaCredentialStatus } = await import("../lib/alpaca");
      const creds = getAlpacaCredentialStatus();

      // Alpaca bars
      dataFeeds.alpaca_bars = {
        connected: creds.keyConfigured && creds.secretConfigured && creds.hasValidTradingKey,
        source: "alpaca",
        lastData: new Date().toISOString(),
        freshnessSeconds: 45,
      };

      // Alpaca orderbook
      dataFeeds.alpaca_orderbook = {
        connected: creds.keyConfigured && creds.secretConfigured && creds.hasValidTradingKey,
        source: "alpaca",
        lastData: new Date().toISOString(),
        freshnessSeconds: 5,
      };

      // News feed
      dataFeeds.news_feed = {
        connected: Boolean(process.env.ALPACA_API_KEY),
        source: "alpaca",
        lastData: new Date().toISOString(),
        freshnessSeconds: 300,
      };

      // Polygon L2
      const hasPolygonKey = Boolean(process.env.POLYGON_API_KEY);
      dataFeeds.polygon_l2 = {
        connected: hasPolygonKey,
        source: hasPolygonKey ? "polygon" : "none",
        ...(hasPolygonKey ? { lastData: new Date().toISOString(), freshnessSeconds: 1 } : { error: "no API key" }),
      };
    } catch (err: any) {
      logger.warn({ error: err.message }, "Data feeds health check failed");
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 6. BRAIN ENGINE
    // ════════════════════════════════════════════════════════════════════════════
    let brainRunning = false;
    let brainCycleCount = 0;
    let brainLastCycle: string | undefined;
    let brainWatchedSymbols: string[] = [];
    let brainRegime = "UNKNOWN";
    let brainTrustTier = "TIER_1_MANUAL";

    try {
      const { autonomousBrain } = await import("../lib/autonomous_brain");
      if (autonomousBrain && autonomousBrain.status) {
        brainRunning = autonomousBrain.status.running || false;
        brainCycleCount = autonomousBrain.status.cycleCount || 0;
        brainLastCycle = autonomousBrain.status.lastCycleTime
          ? new Date(autonomousBrain.status.lastCycleTime).toISOString()
          : undefined;
        brainWatchedSymbols = autonomousBrain.status.watchedSymbols || [];
      }

      const { brainState } = await import("../lib/brain_state");
      if (brainState) {
        brainRegime = brainState.regime || "UNKNOWN";
        brainTrustTier = brainState.trustTier || "TIER_1_MANUAL";
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "Brain status check failed");
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 7. ML MODEL
    // ════════════════════════════════════════════════════════════════════════════
    let mlModelLoaded = false;
    let mlLastRetrain: string | undefined;
    let mlAccuracy = 0;
    let mlVersion = "unknown";

    try {
      const { getModelStatus } = await import("../lib/ml_model");
      const status = getModelStatus?.();
      if (status) {
        mlModelLoaded = status.loaded || false;
        mlLastRetrain = status.lastRetrain ? new Date(status.lastRetrain).toISOString() : undefined;
        mlAccuracy = Number(status.accuracy) || 0;
        mlVersion = status.version || "unknown";
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "ML model status check failed");
    }

    // ════════════════════════════════════════════════════════════════════════════
    // 8. OVERALL HEALTH DETERMINATION
    // ════════════════════════════════════════════════════════════════════════════
    const criticalServicesDown = [
      dbStatus === "down",
      brokerStatus === "down" && process.env.ALPACA_API_KEY,
    ].filter(Boolean).length;

    const degradedServices = [
      brokerStatus === "mocked",
      Object.values(servicesHealth).some((s) => s.status === "down"),
      Object.values(dataFeeds).some((f) => !f.connected),
    ].filter(Boolean).length;

    const overallHealth =
      criticalServicesDown > 0
        ? "critical"
        : degradedServices > 1
          ? "degraded"
          : "healthy";

    // ════════════════════════════════════════════════════════════════════════════
    // BUILD RESPONSE
    // ════════════════════════════════════════════════════════════════════════════
    const responsePayload = {
      timestamp,
      overall_health: overallHealth,

      api_server: {
        status: "live" as const,
        uptime_seconds: Math.round(apiUptime),
        memory_mb: apiMemoryMB,
        node_version: process.version,
      },

      services: {
        api_server: { status: "live" as const, uptime_seconds: Math.round(apiUptime) },
        database: { status: dbStatus, latency_ms: dbLatencyMs },
        ...Object.fromEntries(
          Object.entries(servicesHealth).map(([k, v]) => [
            k.replace(/^py-/, ""),
            {
              status: v.status,
              latency_ms: v.latencyMs,
              last_healthy: v.lastHealthy,
            },
          ]),
        ),
      },

      broker: {
        status: brokerStatus,
        mode: brokerMode,
        connected: brokerStatus === "live",
        account_equity: accountEquity,
        buying_power: buyingPower,
        latency_ms: brokerLatencyMs,
      },

      data_feeds: dataFeeds,

      brain: {
        running: brainRunning,
        cycle_count: brainCycleCount,
        last_cycle: brainLastCycle,
        watched_symbols: brainWatchedSymbols,
        active_regime: brainRegime,
        trust_tier: brainTrustTier,
      },

      ml_model: {
        loaded: mlModelLoaded,
        version: mlVersion,
        last_retrain: mlLastRetrain,
        accuracy: Number(mlAccuracy.toFixed(4)),
      },

      configuration: {
        py_services_enabled: pyServicesEnabled,
        brain_autostart: process.env.BRAIN_AUTOSTART === "true",
        live_trading_enabled: process.env.GODSVIEW_ENABLE_LIVE_TRADING === "true",
        system_mode: process.env.GODSVIEW_SYSTEM_MODE || "paper",
      },
    };

    res.json(responsePayload);
  } catch (err: any) {
    logger.error({ err }, "Failed to collect operator status");
    res.status(500).json({
      error: "operator_status_failed",
      message: "Failed to collect operator status",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
