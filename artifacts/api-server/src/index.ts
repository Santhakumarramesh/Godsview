import app from "./app";
import { logger } from "./lib/logger";
import { trainModel } from "./lib/ml_model";
import { validateEnv } from "./lib/env";
import { setupGracefulShutdown, onShutdown } from "./lib/shutdown";
import { closePool, checkDbHealth } from "@workspace/db";
import { runPreflight } from "./lib/preflight";
import { startSession, endSession } from "./lib/session_manager";
import { alpacaStream } from "./lib/alpaca_stream";
import { MacroContextService } from "./lib/macro_context_service";
import { ScannerScheduler } from "./lib/scanner_scheduler";
import { startReconciler, stopReconciler } from "./lib/fill_reconciler";
import { alpacaAccountStream, wireAccountStreamToReconciler } from "./lib/alpaca_account_stream";
import { startPaperValidationLoop, stopPaperValidationLoop } from "./lib/paper_validation_loop";
import { validateOrExit } from "./lib/ops/startup_validator";
import { initGracefulShutdown } from "./lib/ops/graceful_shutdown";

// ── Validate environment before anything else ───────────────────
validateEnv();

// ── Phase 6: Production startup validation ───────────────────
try { validateOrExit(); } catch (e: any) { logger.warn({ err: e.message }, "Startup validator unavailable (non-fatal)"); }

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Phase 6: Enhanced graceful shutdown with priority hooks
  try { initGracefulShutdown(server); } catch (e: any) { logger.warn({ err: e.message }, "Enhanced graceful shutdown unavailable"); }

  // Phase 95: Self-register the api-server's logical services into the
  // service mesh registry so /api/mesh/services reports something useful
  // out of the box. Each in-process subsystem becomes a registered instance
  // tagged "in-process". External MCP servers can still register themselves
  // via POST /api/mesh/services.
  try {
    const { serviceRegistry } = require("./lib/service_mesh");
    const host = "127.0.0.1";
    const baseUrl = `http://${host}:${port}`;
    const subsystems = [
      { serviceName: "api-server", tags: ["http", "primary"], version: "1.0.0" },
      { serviceName: "tradingview-mcp-webhook", tags: ["webhook", "in-process"], version: "1.0.0" },
      { serviceName: "engine-health", tags: ["health", "in-process"], version: "1.0.0" },
      { serviceName: "self-heal", tags: ["diagnostics", "in-process"], version: "1.0.0" },
      { serviceName: "service-mesh", tags: ["registry", "in-process"], version: "1.0.0" },
    ];
    for (const s of subsystems) {
      serviceRegistry.register({ ...s, host, port });
    }
    logger.info({ count: subsystems.length, baseUrl }, "Service mesh seeded with in-process services");
  } catch (e: any) {
    logger.warn({ err: e.message }, "Service mesh seeding skipped (non-fatal)");
  }

  // Phase 124: Attach WebSocket server for dual-transport real-time streaming
  try {
    const { wsServer } = require("./lib/ws_server");
    wsServer.attach(server);
    logger.info("WebSocket server attached at /ws");
  } catch (wsErr: any) {
    logger.warn({ err: wsErr.message }, "WebSocket server failed to attach (non-fatal)");
  }

  // Run preflight checks (non-blocking — logs results)
  runPreflight()
    .then((result) => {
      if (!!result.passed) {
        logger.warn({ checks: result.checks.filter(c => !c.passed) }, "Preflight checks had failures");
      }
    })
    .catch((err) => logger.error({ err }, "Preflight checks failed"));

  // Verify DB connectivity
  checkDbHealth()
    .then((h: any) => {
      if (h.ok) {
        logger.info({ driver: h.driver, latencyMs: h.latencyMs }, "Database health OK");
      } else {
        logger.error({ error: h.error }, "Database health check failed");
      }
    })
    .catch((err: any) => logger.error({ err }, "DB health check threw"));

  // Start trading session
  const systemMode = process.env.GODSVIEW_SYSTEM_MODE || "paper";
  startSession(systemMode).catch((err) => logger.error({ err }, "Failed to start trading session"));

  // Train ML model from accuracy_results data (non-blocking)
  trainModel().catch((err) => logger.error({ err }, "ML model training failed"));

  // Start Alpaca market data stream (non-blocking — feeds candle SSE)
  if (process.env.ALPACA_API_KEY) {
    alpacaStream.start();
    logger.info("Alpaca market data stream started");
  } else {
    logger.warn("ALPACA_API_KEY not set — market data stream disabled");
  }

  // Start fill reconciler (Phase 11A) — polls Alpaca for fills every 10s,
  // matches to brain positions, computes realized PnL, feeds circuit breaker
  if (process.env.ALPACA_API_KEY || process.env.ALPACA_KEY_ID) {
    startReconciler();
    logger.info("Fill reconciler started (10s poll interval)");

    // Phase 12A — real-time fill events via account WebSocket (supplements polling)
    wireAccountStreamToReconciler();
    alpacaAccountStream.start();
    logger.info("Alpaca account stream started (real-time trade_updates)");
  } else {
    logger.warn("Alpaca not configured — fill reconciler disabled");
  }

  // Start macro intelligence background refresh (YoungTraderWealth Layer 0 + 0.5)
  // Only starts if Alpaca is configured (needs market data for feed)
  if (process.env.ALPACA_API_KEY || process.env.ALPACA_KEY_ID) {
    MacroContextService.getInstance().start();
    logger.info("Macro intelligence feed started (5-min refresh)");
  } else {
    logger.warn("Alpaca not configured — macro feed running in neutral placeholder mode");
  }

  // Start autonomous watchlist scanner (Phase 19)
  // Requires Alpaca keys to fetch live bars; skips gracefully otherwise
  if (process.env.ALPACA_API_KEY || process.env.ALPACA_KEY_ID) {
    ScannerScheduler.getInstance().start();
    logger.info("Watchlist scanner started (auto-scan enabled)");
  } else {
    logger.warn("Alpaca not configured — watchlist scanner requires market data and is disabled");
  }

  // ── Phase 10B: Autonomous Brain Auto-Start ────────────────────────────────
  // Starts the brain automatically if BRAIN_AUTOSTART=true and Alpaca is configured.
  // Loads symbols from the watchlist; brain will boot all Phase 8 subsystems itself.
  if ((process.env.ALPACA_API_KEY || process.env.ALPACA_KEY_ID) &&
      process.env.BRAIN_AUTOSTART === "true") {
    setTimeout(async () => {
      try {
        const { listEnabledSymbols } = await import("./lib/watchlist.js");
        const { autonomousBrain } = await import("./lib/autonomous_brain.js");
        const { runFullBrainCycle, runBacktestAndChartPipeline } = await import("./lib/brain_orchestrator.js");
        const { brainRulebook } = await import("./lib/brain_rulebook.js");

        // Build inputFn inline (mirrors buildCycleInput in routes/brain.ts)
        const buildInput = async (symbol: string) => {
          const alpacaLib = await import("./lib/alpaca.js");
          let bars1m: any[] = [], bars5m: any[] = [];
          try { bars1m = (await alpacaLib.getBars(symbol, "1Min", 200)) ?? []; } catch {}
          try { bars5m = (await alpacaLib.getBars(symbol, "5Min", 200)) ?? []; } catch {}
          return { symbol, bars1m, bars5m, orderbook: null, dna: null, marketStress: null };
        };

        const enabled = listEnabledSymbols().map((e: any) => e.symbol);
        const symbols = enabled.length > 0 ? enabled : ["SPY", "QQQ", "AAPL", "TSLA", "NVDA", "BTC/USD"];

        if (!autonomousBrain.status.running) {
          autonomousBrain.start(symbols, buildInput, runFullBrainCycle, runBacktestAndChartPipeline);
          brainRulebook.start();
          logger.info({ symbols }, "Autonomous Brain auto-started");
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, "Brain auto-start failed — manual start required");
      }
    }, 8_000); // 8s delay — let server fully initialize first
  } else {
    logger.info("Brain auto-start disabled (set BRAIN_AUTOSTART=true to enable)");
  }

  // Phase 15: paper validation loop (predicted vs realized in paper mode)
  if ((process.env.PAPER_VALIDATION_AUTO_START ?? "true") !== "false") {
    startPaperValidationLoop({ runImmediate: true })
      .then((result) => logger.info({ intervalMs: result.interval_ms }, "Paper validation loop started"))
      .catch((err) => logger.error({ err }, "Paper validation loop failed to start"));
  }
});

// ── Graceful shutdown with connection draining ──────────────────
setupGracefulShutdown(server);

// Register cleanup: close SSE connections
onShutdown(async () => {
  logger.info("Cleaning up SSE connections...");
  try {
    const { closeAllClients } = await import("./lib/signal_stream");
    closeAllClients();
  } catch {
    // signal_stream may not be loaded
  }
});

// Phase 124: Register cleanup: close WebSocket connections
onShutdown(async () => {
  logger.info("Shutting down WebSocket server...");
  try {
    const { wsServer } = await import("./lib/ws_server");
    wsServer.shutdown();
  } catch {
    // ws_server may not be loaded
  }
});

// Register cleanup: stop Alpaca market data stream
onShutdown(async () => {
  logger.info("Stopping Alpaca market data stream...");
  alpacaStream.stop();
});

// Register cleanup: stop macro intelligence feed
onShutdown(async () => {
  logger.info("Stopping macro intelligence feed...");
  MacroContextService.getInstance().stop();
});

// Register cleanup: stop watchlist scanner
onShutdown(async () => {
  logger.info("Stopping watchlist scanner...");
  ScannerScheduler.getInstance().stop();
});

// Register cleanup: stop autonomous brain + rulebook
onShutdown(async () => {
  try {
    const { autonomousBrain } = await import("./lib/autonomous_brain.js");
    const { brainRulebook } = await import("./lib/brain_rulebook.js");
    if (autonomousBrain.status.running) {
      logger.info("Stopping autonomous brain...");
      autonomousBrain.stop();
    }
    brainRulebook.stop();
  } catch {
    // May not be loaded if auto-start was disabled
  }
});

// Register cleanup: stop fill reconciler + account stream
onShutdown(async () => {
  logger.info("Stopping fill reconciler + account stream...");
  stopReconciler();
  alpacaAccountStream.stop();
});

// Register cleanup: stop paper validation loop
onShutdown(async () => {
  logger.info("Stopping paper validation loop...");
  stopPaperValidationLoop();
});

// Register cleanup: end trading session
onShutdown(async () => {
  logger.info("Ending trading session...");
  await endSession("server_shutdown");
});

// Register cleanup: drain database pool (must be last)
onShutdown(async () => {
  logger.info("Draining database connection pool...");
  await closePool();
});
