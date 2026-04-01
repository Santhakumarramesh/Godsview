import app from "./app";
import { logger } from "./lib/logger";
import { trainModel } from "./lib/ml_model";
import { validateEnv } from "./lib/env";
import { setupGracefulShutdown, onShutdown } from "./lib/shutdown";
import { closePool, checkDbHealth } from "@workspace/db";
import { runPreflight } from "./lib/preflight";
import { startSession, endSession } from "./lib/session_manager";
import { alpacaStream } from "./lib/alpaca_stream";

// ── Validate environment before anything else ───────────────────
validateEnv();

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
    .then((h) => {
      if (h.ok) {
        logger.info({ driver: h.driver, latencyMs: h.latencyMs }, "Database health OK");
      } else {
        logger.error({ error: h.error }, "Database health check failed");
      }
    })
    .catch((err) => logger.error({ err }, "DB health check threw"));

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

// Register cleanup: stop Alpaca market data stream
onShutdown(async () => {
  logger.info("Stopping Alpaca market data stream...");
  alpacaStream.stop();
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
