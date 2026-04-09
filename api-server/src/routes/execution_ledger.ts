/**
 * execution_ledger.ts — Phase 28: Execution Ledger Router
 *
 * Endpoints:
 *  - POST   /execution-ledger/entries              → create ledger entry
 *  - GET    /execution-ledger/entries              → list all (with filters)
 *  - GET    /execution-ledger/entries/:id          → get by ID
 *  - PUT    /execution-ledger/entries/:id/status   → update lifecycle status
 *  - GET    /execution-ledger/entries/open         → get open entries
 *  - POST   /execution-ledger/reconcile            → run reconciliation
 *  - GET    /execution-ledger/reconciliations      → list reconciliation runs
 *  - GET    /execution-ledger/reconciliations/:id  → get reconciliation by ID
 *  - GET    /execution-ledger/reconciliations/daily → daily summary report
 *  - GET    /execution-ledger/mismatches           → get open mismatches
 *  - GET    /execution-ledger/summary              → system summary
 */

import { Router, type Request, type Response } from "express";
import {
  executionLedgerStore,
  reconciliationService,
  type CreateEntryInput,
  type OrderLifecycleStatus,
  type BrokerOrder,
  type BrokerPosition,
} from "../lib/execution_ledger/index.js";

const router = Router();

// ============================================================================
// LEDGER ENTRY ENDPOINTS
// ============================================================================

/**
 * POST /execution-ledger/entries
 * Create a new ledger entry
 */
router.post("/execution-ledger/entries", (req: Request, res: Response) => {
  try {
    const { strategy_id, symbol, side, quantity, signal_price, decision_packet_id, session_id, metadata } = req.body;

    if (!strategy_id || !symbol || !side || !quantity || signal_price === undefined || !decision_packet_id || !session_id) {
      res.status(400).json({
        success: false,
        error: "Missing required fields: strategy_id, symbol, side, quantity, signal_price, decision_packet_id, session_id",
      });
      return;
    }

    const input: CreateEntryInput = {
      strategy_id,
      symbol,
      side,
      quantity,
      signal_price,
      decision_packet_id,
      session_id,
      metadata,
    };

    const entry = executionLedgerStore.createEntry(input);

    res.status(201).json({
      success: true,
      data: entry,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /execution-ledger/entries
 * List all entries (with optional filters: strategy_id, symbol, status)
 */
router.get("/execution-ledger/entries", (req: Request, res: Response) => {
  try {
    const { strategy_id, symbol, status } = req.query;

    let entries = executionLedgerStore.getAllEntries();

    if (strategy_id) {
      entries = entries.filter((e) => e.strategy_id === strategy_id);
    }

    if (symbol) {
      entries = entries.filter((e) => e.symbol === symbol);
    }

    if (status) {
      entries = entries.filter((e) => e.order_lifecycle_status === status);
    }

    res.json({
      success: true,
      data: {
        count: entries.length,
        entries,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /execution-ledger/entries/:id
 * Get entry by ID
 */
router.get("/execution-ledger/entries/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const entry = executionLedgerStore.getEntry(id);

    if (!entry) {
      res.status(404).json({
        success: false,
        error: "Entry not found",
      });
      return;
    }

    res.json({
      success: true,
      data: entry,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * PUT /execution-ledger/entries/:id/status
 * Update entry status (with optional updates for fill data)
 */
router.put("/execution-ledger/entries/:id/status", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, broker_order_id, submitted_price, fill_price, fill_quantity } = req.body;

    if (!status) {
      res.status(400).json({
        success: false,
        error: "status required in body",
      });
      return;
    }

    const updated = executionLedgerStore.updateEntryStatus(id, status as OrderLifecycleStatus, {
      broker_order_id,
      submitted_price,
      fill_price,
      fill_quantity,
    });

    if (!updated) {
      res.status(400).json({
        success: false,
        error: "Failed to update entry status (invalid transition or not found)",
      });
      return;
    }

    res.json({
      success: true,
      data: updated,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /execution-ledger/entries/open
 * Get all open entries (not yet closed)
 */
router.get("/execution-ledger/entries/open", (_req: Request, res: Response) => {
  try {
    const entries = executionLedgerStore.getOpenEntries();

    res.json({
      success: true,
      data: {
        count: entries.length,
        entries,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ============================================================================
// RECONCILIATION ENDPOINTS
// ============================================================================

/**
 * POST /execution-ledger/reconcile
 * Run reconciliation against broker state
 */
router.post("/execution-ledger/reconcile", (req: Request, res: Response) => {
  try {
    const { broker_orders, broker_positions } = req.body;

    if (!Array.isArray(broker_orders) || !Array.isArray(broker_positions)) {
      res.status(400).json({
        success: false,
        error: "broker_orders and broker_positions arrays required",
      });
      return;
    }

    const result = reconciliationService.runReconciliation(
      broker_orders as BrokerOrder[],
      broker_positions as BrokerPosition[]
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /execution-ledger/reconciliations
 * List all reconciliation runs
 */
router.get("/execution-ledger/reconciliations", (req: Request, res: Response) => {
  try {
    // Note: In a full implementation, we'd have getReconciliations()
    // For now, return empty list - caller should use specific recon_id
    res.json({
      success: true,
      data: {
        count: 0,
        reconciliations: [],
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /execution-ledger/reconciliations/:id
 * Get reconciliation by ID
 */
router.get("/execution-ledger/reconciliations/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const recon = reconciliationService.getReconciliation(id);

    if (!recon) {
      res.status(404).json({
        success: false,
        error: "Reconciliation not found",
      });
      return;
    }

    res.json({
      success: true,
      data: recon,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /execution-ledger/reconciliations/daily
 * Get daily summary report
 */
router.get("/execution-ledger/reconciliations/daily", (_req: Request, res: Response) => {
  try {
    const report = reconciliationService.getDailyReport();

    res.json({
      success: true,
      data: report,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /execution-ledger/mismatches
 * Get open mismatches
 */
router.get("/execution-ledger/mismatches", (_req: Request, res: Response) => {
  try {
    const mismatches = reconciliationService.getOpenMismatches();

    res.json({
      success: true,
      data: {
        count: mismatches.length,
        mismatches,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /execution-ledger/summary
 * System summary (counts, open entries, mismatches)
 */
router.get("/execution-ledger/summary", (_req: Request, res: Response) => {
  try {
    const allEntries = executionLedgerStore.getAllEntries();
    const openEntries = executionLedgerStore.getOpenEntries();
    const mismatches = reconciliationService.getOpenMismatches();
    const dailyReport = reconciliationService.getDailyReport();

    res.json({
      success: true,
      data: {
        total_entries: allEntries.length,
        open_entries: openEntries.length,
        open_mismatches: mismatches.length,
        critical_mismatches: mismatches.filter((m) => m.severity === "critical").length,
        high_mismatches: mismatches.filter((m) => m.severity === "high").length,
        daily_report: dailyReport,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

export default router;
