import { Router, Request, Response } from "express";
import {
  engine,
  type InternalOrder,
  type BrokerOrder,
  type PnLSnapshot,
} from "../lib/exec_reconciliation";

const router = Router();

// POST /orders/internal — register internal order
router.post("/orders/internal", (req: Request, res: Response) => {
  try {
    const order: InternalOrder = req.body;

    if (
      !order.order_id ||
      !order.symbol ||
      !order.side ||
      order.quantity === undefined ||
      order.filled_quantity === undefined ||
      order.avg_fill_price === undefined ||
      !order.status ||
      !order.strategy_id ||
      !order.submitted_at ||
      !order.last_updated
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields for internal order",
      });
    }

    engine.registerInternalOrder(order);

    res.status(200).json({
      success: true,
      data: { message: "Internal order registered", order_id: order.order_id },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// POST /orders/broker — register broker order
router.post("/orders/broker", (req: Request, res: Response) => {
  try {
    const order: BrokerOrder = req.body;

    if (
      !order.broker_order_id ||
      !order.internal_order_id ||
      !order.symbol ||
      !order.side ||
      order.quantity === undefined ||
      order.filled_quantity === undefined ||
      order.avg_fill_price === undefined ||
      !order.status ||
      !order.reported_at
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields for broker order",
      });
    }

    engine.registerBrokerOrder(order);

    res.status(200).json({
      success: true,
      data: {
        message: "Broker order registered",
        broker_order_id: order.broker_order_id,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// POST /orders/:id/reconcile — reconcile single order
router.post("/orders/:id/reconcile", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = engine.reconcileOrder(id);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// POST /reconcile-all — reconcile all orders
router.post("/reconcile-all", (req: Request, res: Response) => {
  try {
    const results = engine.reconcileAllOrders();

    res.status(200).json({
      success: true,
      data: {
        total: results.length,
        results,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// POST /positions — register position
router.post("/positions", (req: Request, res: Response) => {
  try {
    const {
      symbol,
      internal_quantity,
      broker_quantity,
      internal_cost_basis,
      broker_cost_basis,
    } = req.body;

    if (
      !symbol ||
      internal_quantity === undefined ||
      broker_quantity === undefined ||
      internal_cost_basis === undefined ||
      broker_cost_basis === undefined
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields for position",
      });
    }

    const record = engine.registerPosition(
      symbol,
      internal_quantity,
      broker_quantity,
      internal_cost_basis,
      broker_cost_basis
    );

    res.status(200).json({
      success: true,
      data: record,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// GET /positions/drift — get positions with drift
router.get("/positions/drift", (req: Request, res: Response) => {
  try {
    const driftPositions = engine.reconcilePositions();

    res.status(200).json({
      success: true,
      data: {
        total: driftPositions.length,
        positions: driftPositions,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// POST /pnl — record PnL snapshot
router.post("/pnl", (req: Request, res: Response) => {
  try {
    const snapshot: PnLSnapshot = req.body;

    if (
      !snapshot.strategy_id ||
      snapshot.internal_pnl === undefined ||
      snapshot.broker_pnl === undefined ||
      snapshot.divergence === undefined ||
      snapshot.divergence_pct === undefined ||
      !snapshot.timestamp
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields for PnL snapshot",
      });
    }

    engine.recordPnLSnapshot(snapshot);

    res.status(200).json({
      success: true,
      data: { message: "PnL snapshot recorded", strategy_id: snapshot.strategy_id },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// GET /pnl/:strategy_id — get PnL divergence
router.get("/pnl/:strategy_id", (req: Request, res: Response) => {
  try {
    const { strategy_id } = req.params;
    const snapshots = engine.getPnLDivergence(strategy_id);

    res.status(200).json({
      success: true,
      data: {
        strategy_id,
        snapshots,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// POST /reports — generate reconciliation report
router.post("/reports", (req: Request, res: Response) => {
  try {
    const { period } = req.body;

    if (!period) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: period",
      });
    }

    const report = engine.generateReconciliationReport(period);

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// GET /reports — list reports
router.get("/reports", (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const limitNum = limit ? parseInt(limit as string, 10) : undefined;
    const reports = engine.getAllReports(limitNum);

    res.status(200).json({
      success: true,
      data: {
        total: reports.length,
        reports,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// GET /reports/:id — single report
router.get("/reports/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const report = engine.getReconciliationReport(id);

    if (!report) {
      return res.status(404).json({
        success: false,
        error: `Report with id ${id} not found`,
      });
    }

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// GET /mismatches — unresolved mismatches
router.get("/mismatches", (req: Request, res: Response) => {
  try {
    const mismatches = engine.getUnresolvedMismatches();

    res.status(200).json({
      success: true,
      data: {
        total: mismatches.length,
        mismatches,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

// POST /mismatches/:id/resolve — resolve discrepancy
router.post("/mismatches/:id/resolve", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { resolution } = req.body;

    if (!resolution) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: resolution",
      });
    }

    const result = engine.resolveDiscrepancy(id, resolution);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.status(200).json({
      success: true,
      data: { message: "Discrepancy resolved", recon_id: id },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error });
  }
});

export default router;
