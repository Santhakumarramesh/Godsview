import type { AddressInfo } from "node:net";
import app from "./app";
import { logger } from "./lib/logger";
import { trainModel } from "./lib/ml_model";
import { trainEnsemble } from "./lib/super_intelligence";
import { runtimeConfig, getRuntimeConfigForLog } from "./lib/runtime_config";
import {
  markMlBootstrapFailed,
  markMlBootstrapReady,
  markMlBootstrapRunning,
} from "./lib/startup_state";
import { pool } from "@workspace/db";
import { closeAllClients as closeSSEClients } from "./lib/signal_stream";

const server = app.listen(runtimeConfig.port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  const address = server.address() as AddressInfo | null;
  logger.info(
    {
      port: address?.port ?? runtimeConfig.port,
      config: getRuntimeConfigForLog(),
    },
    "Server listening",
  );

  markMlBootstrapRunning();
  trainModel()
    .then(() => {
      markMlBootstrapReady();
      logger.info("ML bootstrap completed — training super intelligence ensemble...");
      return trainEnsemble();
    })
    .then(() => {
      logger.info("Super Intelligence ensemble ready");
    })
    .catch((bootstrapErr) => {
      markMlBootstrapFailed(bootstrapErr);
      logger.error({ err: bootstrapErr }, "ML/ensemble training failed during bootstrap");
    });
});

server.requestTimeout = runtimeConfig.requestTimeoutMs;
server.keepAliveTimeout = runtimeConfig.keepAliveTimeoutMs;
server.headersTimeout = runtimeConfig.headersTimeoutMs;
server.maxRequestsPerSocket = runtimeConfig.maxRequestsPerSocket;

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logger.warn({ signal }, "Graceful shutdown initiated");

  const forceExitTimer = setTimeout(() => {
    logger.error(
      { timeoutMs: runtimeConfig.shutdownTimeoutMs, signal },
      "Graceful shutdown timeout exceeded; forcing exit",
    );
    process.exit(1);
  }, runtimeConfig.shutdownTimeoutMs);
  forceExitTimer.unref();

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  // Close all SSE client connections
  try {
    closeSSEClients();
    logger.info("SSE clients disconnected");
  } catch { /* best effort */ }

  try {
    await pool.end();
    logger.info("Database pool closed");
  } catch (err) {
    logger.error({ err }, "Failed to close database pool during shutdown");
  } finally {
    clearTimeout(forceExitTimer);
  }

  logger.info({ signal }, "Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
