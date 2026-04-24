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
import { startLearningLoop, stopLearningLoop } from "./lib/continuous_learning";
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

  // ── Historical data seeder: populate accuracy_results with real market data ──
  (async () => {
    try {
      const { seedHistoricalData } = await import("./lib/historical_seeder.js");
      const result = await seedHistoricalData();
      if (result.skipped) {
        logger.info({ existingRows: result.existingRows }, "Historical seeder: sufficient data exists — skipped");
      } else {
        logger.info({ seeded: result.seededRows, symbols: result.symbols_processed, real: result.has_real_data, ms: result.durationMs },
          "Historical seeder: real data bootstrap complete");
      }
    } catch (err: any) {
      logger.error({ err: err?.message }, "Historical seeder failed (non-fatal)");
    }
    // After seeding, also seed brain entities
    try {
      const { seedBrainEntities } = await import("./lib/brain_seeder.js");
      await seedBrainEntities();
      logger.info("Brain entities seeded");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Brain entity seeder failed (non-fatal)");
    }
  })();

  // Train ML model from accuracy_results data (non-blocking)
  trainModel().catch((err) => logger.error({ err }, "ML model training failed"));

  // ── Market data mode detection ─────────────────────────────────────────────
  // Crypto data is FREE (no keys needed) via Alpaca v1beta3/crypto/us
  // Stock data requires PK/AK-prefixed trading API keys
  const hasAlpacaKeys = !!(process.env.ALPACA_API_KEY || process.env.ALPACA_KEY_ID);
  const CRYPTO_SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD", "AVAX/USD", "LINK/USD"];
  const STOCK_SYMBOLS = ["SPY", "QQQ", "AAPL", "TSLA", "NVDA", "AMZN"];

  // Start Alpaca market data stream (non-blocking — feeds candle SSE)
  if (hasAlpacaKeys) {
    alpacaStream.start();
    logger.info("Alpaca market data stream started (full: stocks + crypto)");
  } else {
    logger.info("No Alpaca trading keys — running in CRYPTO-ONLY mode (free data)");
  }

  // Start fill reconciler — requires trading keys for order matching
  if (hasAlpacaKeys) {
    startReconciler();
    logger.info("Fill reconciler started (10s poll interval)");
    wireAccountStreamToReconciler();
    alpacaAccountStream.start();
    logger.info("Alpaca account stream started (real-time trade_updates)");
  } else {
    logger.info("Fill reconciler disabled (no trading keys — paper mode only)");
  }

  // Start macro intelligence — works in both modes (crypto provides market context)
  MacroContextService.getInstance().start();
  logger.info("Macro intelligence feed started (5-min refresh)");

  // Start watchlist scanner — works with crypto symbols even without stock keys
  ScannerScheduler.getInstance().start();
  logger.info("Watchlist scanner started (auto-scan enabled)");

  // ── Autonomous Brain Auto-Start ────────────��──────────────────────────────
  // Now starts automatically even without Alpaca trading keys.
  // In crypto-only mode, uses free crypto symbols. With keys, uses full watchlist.
  const brainAutoStart = (process.env.BRAIN_AUTOSTART ?? "true") !== "false";
  if (brainAutoStart) {
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
        let symbols: string[];
        if (enabled.length > 0) {
          symbols = enabled;
        } else if (hasAlpacaKeys) {
          symbols = [...STOCK_SYMBOLS, ...CRYPTO_SYMBOLS];
        } else {
          // Crypto-only mode — free market data, no API keys needed
          symbols = CRYPTO_SYMBOLS;
        }

        if (!autonomousBrain.status.running) {
          autonomousBrain.start(symbols, buildInput, runFullBrainCycle, runBacktestAndChartPipeline);
          brainRulebook.start();
          logger.info({ symbols, mode: hasAlpacaKeys ? "full" : "crypto-only" }, "Autonomous Brain auto-started");
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, "Brain auto-start failed — manual start required");
      }
    }, 8_000); // 8s delay — let server fully initialize first
  } else {
    logger.info("Brain auto-start disabled (set BRAIN_AUTOSTART=false to disable)");
  }

  // Phase 15: paper validation loop (predicted vs realized in paper mode)
  if ((process.env.PAPER_VALIDATION_AUTO_START ?? "true") !== "false") {
    startPaperValidationLoop({ runImmediate: true })
      .then((result) => logger.info({ intervalMs: result.interval_ms }, "Paper validation loop started"))
      .catch((err) => logger.error({ err }, "Paper validation loop failed to start"));
  }

  // Continuous Learning Loop — auto-retrain ML model, reconcile trade outcomes,
  // ingest backtest results, detect drift, promote strategies
  startLearningLoop();
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

// Register cleanup: stop continuous learning loop
onShutdown(async () => {
  logger.info("Stopping continuous learning loop...");
  stopLearningLoop();
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
