/**
 * persistence.ts — Persistence Management Routes (Phase 51)
 *
 * Endpoints for querying and managing persistent storage:
 *   - Collection status and statistics
 *   - Validation reports
 *   - Monitor events
 *   - Overlay snapshots
 *   - Strategy version history
 */

import { Router } from "express";
import {
  listCollections,
  getCollectionSize,
  getStorePath,
} from "../lib/persistent_store.js";
import {
  getValidationReports,
  getValidationStatistics,
} from "../engines/validation_store.js";
import {
  getMonitorEvents,
  resolveMonitorEvent,
  getEventStatistics,
} from "../engines/monitor_event_store.js";
import {
  getOverlaySnapshots,
  getSnapshotStatistics,
} from "../engines/overlay_store.js";
import { getVersionHistory } from "../lib/strategy_registry_hardened.js";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * GET /api/persistence/status
 * List all collections with item counts
 */
router.get("/api/persistence/status", (req, res) => {
  try {
    const collections = listCollections();
    const status: Record<string, { count: number }> = {};

    for (const collection of collections) {
      status[collection] = { count: getCollectionSize(collection) };
    }

    res.json({
      ok: true,
      storagePath: getStorePath(),
      collections: status,
      collectionCount: collections.length,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get persistence status");
    res.status(500).json({ ok: false, error: "Failed to get status" });
  }
});

/**
 * GET /api/persistence/validation-reports
 * List validation reports (query: strategyId)
 */
router.get("/api/persistence/validation-reports", (req, res) => {
  try {
    const strategyId = req.query.strategyId as string | undefined;
    const reports = getValidationReports(strategyId);
    const stats = getValidationStatistics();

    res.json({
      ok: true,
      reports,
      statistics: stats,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get validation reports");
    res.status(500).json({ ok: false, error: "Failed to get reports" });
  }
});

/**
 * GET /api/persistence/monitor-events
 * List monitor events (query: symbol, type, severity, limit, resolved)
 */
router.get("/api/persistence/monitor-events", (req, res) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const type = req.query.type as string | undefined;
    const severity = req.query.severity as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const resolved =
      req.query.resolved !== undefined
        ? req.query.resolved === "true"
        : undefined;

    const events = getMonitorEvents({
      symbol,
      type,
      severity,
      limit,
      resolved,
    });
    const stats = getEventStatistics();

    res.json({
      ok: true,
      events,
      statistics: stats,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get monitor events");
    res.status(500).json({ ok: false, error: "Failed to get events" });
  }
});

/**
 * POST /api/persistence/monitor-events/:id/resolve
 * Resolve a monitor event
 */
router.post("/api/persistence/monitor-events/:id/resolve", (req, res) => {
  try {
    const { id } = req.params;
    const success = resolveMonitorEvent(id);

    if (success) {
      res.json({ ok: true, message: `Event ${id} resolved` });
    } else {
      res.status(404).json({ ok: false, error: "Event not found" });
    }
  } catch (error) {
    logger.error({ error }, "Failed to resolve monitor event");
    res.status(500).json({ ok: false, error: "Failed to resolve event" });
  }
});

/**
 * GET /api/persistence/overlay-snapshots
 * List overlay snapshots (query: symbol, limit)
 */
router.get("/api/persistence/overlay-snapshots", (req, res) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const snapshots = getOverlaySnapshots(symbol, limit);
    const stats = getSnapshotStatistics();

    res.json({
      ok: true,
      snapshots,
      statistics: stats,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get overlay snapshots");
    res.status(500).json({ ok: false, error: "Failed to get snapshots" });
  }
});

/**
 * GET /api/persistence/strategy-versions/:strategyId
 * Get version history for a strategy
 */
router.get("/api/persistence/strategy-versions/:strategyId", (req, res) => {
  try {
    const { strategyId } = req.params;
    const versions = getVersionHistory(strategyId);

    res.json({
      ok: true,
      strategyId,
      versions,
      versionCount: versions.length,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get strategy versions");
    res.status(500).json({ ok: false, error: "Failed to get versions" });
  }
});

export default router;
