/**
 * Graceful Shutdown — Handles SIGTERM/SIGINT for clean container shutdown.
 *
 * When the container receives a stop signal (Docker, ECS, K8s):
 * 1. Stop accepting new HTTP connections
 * 2. Cancel any pending orders (safety first)
 * 3. Close WebSocket connections
 * 4. Flush pending writes (logs, metrics, audit)
 * 5. Close database pool
 * 6. Exit with code 0
 *
 * Timeout: if shutdown takes >30s, force exit with code 1.
 */
import { logger } from "../logger.js";
import type { Server } from "http";

const SHUTDOWN_TIMEOUT_MS = 30_000;

interface ShutdownHook {
  name: string;
  fn: () => Promise<void>;
  priority: number; // lower = runs first
}

const hooks: ShutdownHook[] = [];
let isShuttingDown = false;

/**
 * Register a shutdown hook. Hooks run in priority order (lower first).
 */
export function onShutdown(name: string, fn: () => Promise<void>, priority = 50): void {
  hooks.push({ name, fn, priority });
  hooks.sort((a, b) => a.priority - b.priority);
}

/**
 * Initialize graceful shutdown for an HTTP server.
 * Registers SIGTERM and SIGINT handlers.
 */
export function initGracefulShutdown(server: Server): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn({ signal }, "Duplicate shutdown signal — already shutting down");
      return;
    }
    isShuttingDown = true;

    logger.info({ signal, hooks: hooks.length }, "🛑 Graceful shutdown initiated");

    // Set a hard timeout
    const timer = setTimeout(() => {
      logger.error("Shutdown timeout exceeded — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref(); // don't prevent exit

    try {
      // 1. Stop accepting new connections
      await new Promise<void>((resolve) => {
        server.close(() => {
          logger.info("HTTP server closed — no new connections");
          resolve();
        });
      });

      // 2. Run registered hooks in order
      for (const hook of hooks) {
        try {
          logger.info({ hook: hook.name }, `Running shutdown hook: ${hook.name}`);
          await hook.fn();
          logger.info({ hook: hook.name }, `Shutdown hook complete: ${hook.name}`);
        } catch (err: any) {
          logger.error({ hook: hook.name, err: err.message }, `Shutdown hook failed: ${hook.name}`);
        }
      }

      logger.info("✅ Graceful shutdown complete");
      process.exit(0);
    } catch (err: any) {
      logger.error({ err: err.message }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("Graceful shutdown handlers registered (SIGTERM, SIGINT)");
}

/** Check if server is shutting down (for request rejection) */
export function isServerShuttingDown(): boolean {
  return isShuttingDown;
}
