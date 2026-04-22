/**
 * Graceful Shutdown Handler
 *
 * Drains active HTTP connections on SIGTERM / SIGINT, runs
 * registered cleanup callbacks (DB pool, SSE, Alpaca stream),
 * and force-exits after a configurable timeout.
 */

import type { Server } from "node:http";
import { logger } from "./logger";
import { runtimeConfig } from "./runtime_config";

type ShutdownCallback = () => Promise<void>;

const callbacks: ShutdownCallback[] = [];
let shuttingDown = false;
let handlersRegistered = false;
let activeServer: Server | null = null;
let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

/** Register a cleanup function to run during shutdown (LIFO order). */
export function onShutdown(cb: ShutdownCallback): void {
  callbacks.push(cb);
}

/** Wire up SIGTERM / SIGINT + uncaught handlers on the given server. */
export function setupGracefulShutdown(server: Server): void {
  activeServer = server;
  if (handlersRegistered) {
    logger.debug("Graceful shutdown handlers already registered; updated active server reference");
    return;
  }

  const timeout = runtimeConfig.shutdownTimeoutMs ?? 15_000;
  const perCallbackTimeout = 5_000;

  async function drainAndExit(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated");

    // Stop accepting new connections
    activeServer?.close(() => {
      logger.info("HTTP server closed — no more connections");
    });

    // Run registered callbacks in reverse order (LIFO)
    for (let i = callbacks.length - 1; i >= 0; i--) {
      try {
        await Promise.race([
          callbacks[i]!(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("Callback timeout")), perCallbackTimeout),
          ),
        ]);
      } catch (err) {
        logger.warn({ err, index: i }, "Shutdown callback failed or timed out");
      }
    }

    logger.info("Shutdown complete — exiting");
    process.exit(0);
  }

  // Force exit after total timeout
  const forceExit = (): void => {
    if (forceExitTimer) return;
    forceExitTimer = setTimeout(() => {
      logger.fatal("Force exit — shutdown timeout exceeded");
      process.exit(1);
    }, timeout).unref();
  };

  process.on("SIGTERM", () => { forceExit(); drainAndExit("SIGTERM"); });
  process.on("SIGINT", () => { forceExit(); drainAndExit("SIGINT"); });

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    drainAndExit("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled rejection");
    drainAndExit("unhandledRejection");
  });

  handlersRegistered = true;
}
