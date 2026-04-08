/**
 * Phase 26 — Terminal Routes
 *
 * Routes for terminal layout, command palette, watchlist, and overlay signals.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import {
  getTerminalLayout,
  CommandPalette,
  WatchlistManager,
} from "../lib/terminal/terminal_adapter.js";
import { TradingViewMCPBridge } from "../lib/terminal/mcp_bridge.js";

const router = Router();

// Initialize singletons
const commandPalette = new CommandPalette();
const watchlistManager = new WatchlistManager();
const mcpBridge = new TradingViewMCPBridge({
  enabled: true,
  logSignals: true,
});

// ── GET /terminal/layout — Terminal layout configuration ────────────────────

router.get("/layout", (_req: Request, res: Response) => {
  try {
    const layout = getTerminalLayout();
    res.json({ ok: true, layout });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to get terminal layout"
    );
    res.status(500).json({
      ok: false,
      error: "Failed to get terminal layout",
    });
  }
});

// ── GET /terminal/commands — List all commands ──────────────────────────────

router.get("/commands", (_req: Request, res: Response) => {
  try {
    const commands = commandPalette.getCommands();
    res.json({
      ok: true,
      count: commands.length,
      commands,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to list commands"
    );
    res.status(500).json({
      ok: false,
      error: "Failed to list commands",
    });
  }
});

// ── GET /terminal/commands/search — Search commands ────────────────────────

router.get("/commands/search", (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Search query 'q' is required",
      });
    }

    const results = commandPalette.searchCommands(query);
    res.json({
      ok: true,
      query,
      count: results.length,
      results,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Command search failed"
    );
    res.status(500).json({
      ok: false,
      error: "Command search failed",
    });
  }
});

// ── POST /terminal/commands/execute — Execute a command ─────────────────────

router.post("/commands/execute", (req: Request, res: Response) => {
  try {
    const { commandName, args } = req.body;

    if (!commandName) {
      return res.status(400).json({
        ok: false,
        error: "commandName is required",
      });
    }

    const command = commandPalette.getCommandByName(commandName);
    if (!command) {
      return res.status(404).json({
        ok: false,
        error: `Command not found: ${commandName}`,
      });
    }

    // In a real implementation, dispatch to handlers by handlerKey
    // For now, return a successful execution record
    const executionId = `exec_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    logger.info(
      {
        executionId,
        command: command.name,
        handlerKey: command.handlerKey,
        args,
      },
      "Command executed"
    );

    res.json({
      ok: true,
      executionId,
      command: command.name,
      status: "completed",
      result: {
        message: `${command.name} command executed successfully`,
      },
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Command execution failed"
    );
    res.status(500).json({
      ok: false,
      error: "Command execution failed",
    });
  }
});

// ── GET /terminal/watchlist — Get watchlist ────────────────────────────────

router.get("/watchlist", (_req: Request, res: Response) => {
  try {
    const symbols = watchlistManager.getWatchlist();
    res.json({
      ok: true,
      count: symbols.length,
      watchlist: symbols,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to get watchlist"
    );
    res.status(500).json({
      ok: false,
      error: "Failed to get watchlist",
    });
  }
});

// ── POST /terminal/watchlist — Add symbol ──────────────────────────────────

router.post("/watchlist", (req: Request, res: Response) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({
        ok: false,
        error: "symbol is required",
      });
    }

    const added = watchlistManager.addToWatchlist(symbol.toUpperCase());

    if (!added) {
      return res.status(409).json({
        ok: false,
        error: `Symbol already in watchlist: ${symbol}`,
      });
    }

    logger.info({ symbol }, "Symbol added to watchlist");

    res.json({
      ok: true,
      message: `Added ${symbol} to watchlist`,
      watchlist: watchlistManager.getWatchlist(),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to add to watchlist"
    );
    res.status(500).json({
      ok: false,
      error: "Failed to add to watchlist",
    });
  }
});

// ── DELETE /terminal/watchlist/:symbol — Remove symbol ─────────────────────

router.delete("/watchlist/:symbol", (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!symbol) {
      return res.status(400).json({
        ok: false,
        error: "symbol is required",
      });
    }

    const removed = watchlistManager.removeFromWatchlist(symbol.toUpperCase());

    if (!removed) {
      return res.status(404).json({
        ok: false,
        error: `Symbol not in watchlist: ${symbol}`,
      });
    }

    logger.info({ symbol }, "Symbol removed from watchlist");

    res.json({
      ok: true,
      message: `Removed ${symbol} from watchlist`,
      watchlist: watchlistManager.getWatchlist(),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to remove from watchlist"
    );
    res.status(500).json({
      ok: false,
      error: "Failed to remove from watchlist",
    });
  }
});

// ── GET /terminal/overlay/state — Overlay state ────────────────────────────

router.get("/overlay/state", (_req: Request, res: Response) => {
  try {
    const state = mcpBridge.getOverlayState();
    res.json({
      ok: true,
      state,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to get overlay state"
    );
    res.status(500).json({
      ok: false,
      error: "Failed to get overlay state",
    });
  }
});

// ── POST /terminal/overlay/signal — Process overlay signal ──────────────────

router.post("/overlay/signal", (req: Request, res: Response) => {
  try {
    const overlayData = req.body;

    if (!overlayData) {
      return res.status(400).json({
        ok: false,
        error: "Overlay data is required",
      });
    }

    const signal = mcpBridge.processOverlaySignal(overlayData);

    res.json({
      ok: true,
      signal,
      status: "processed",
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(
      { error: errorMsg, overlayData: req.body },
      "Failed to process overlay signal"
    );
    res.status(400).json({
      ok: false,
      error: errorMsg,
    });
  }
});

// ── POST /terminal/overlay/config — Update overlay config ───────────────────

router.post("/overlay/config", (req: Request, res: Response) => {
  try {
    const { enabled, updateIntervalMs, bufferSize, logSignals } = req.body;

    mcpBridge.updateOverlayConfig({
      enabled,
      updateIntervalMs,
      bufferSize,
      logSignals,
    });

    logger.info(
      { config: req.body },
      "Overlay configuration updated"
    );

    res.json({
      ok: true,
      message: "Overlay configuration updated",
      state: mcpBridge.getOverlayState(),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to update overlay config"
    );
    res.status(500).json({
      ok: false,
      error: "Failed to update overlay config",
    });
  }
});

// ── GET /terminal/mcp/status — MCP bridge status ───────────────────────────

router.get("/mcp/status", (_req: Request, res: Response) => {
  try {
    const status = mcpBridge.bridgeStatus();
    res.json({
      ok: true,
      status,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to get MCP status"
    );
    res.status(500).json({
      ok: false,
      error: "Failed to get MCP status",
    });
  }
});

export default router;
