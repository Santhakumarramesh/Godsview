import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import { requireOperator } from "../lib/auth_guard";
import {
  portfolioManager,
  Allocation,
  ExposureSnapshot,
  CorrelationSnapshot,
  RegimeAllocation,
} from "../lib/portfolio";

const router = Router();

// GET /api/portfolio-intelligence/summary
// Returns full portfolio summary
router.get("/summary", (req: Request, res: Response): void => {
  try {
    const portfolio_id = (req.query.portfolio_id as string) || "default";
    const summary = portfolioManager.getPortfolioSummary(portfolio_id);
    res.json(summary);
  } catch (error) {
    logger.error(`Error fetching portfolio summary: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /api/portfolio-intelligence/allocations
// List all allocations for a portfolio
router.get("/allocations", (req: Request, res: Response): void => {
  try {
    const portfolio_id = (req.query.portfolio_id as string) || "default";
    const summary = portfolioManager.getPortfolioSummary(portfolio_id);
    res.json(summary.allocations);
  } catch (error) {
    logger.error(`Error fetching allocations: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /api/portfolio-intelligence/allocations
// Add or update an allocation
router.post("/allocations", requireOperator, (req: Request, res: Response): void => {
  try {
    const {
      portfolio_id = "default",
      strategy_id,
      strategy_name,
      target_weight,
      min_weight,
      max_weight,
      allocated_capital,
    } = req.body;

    if (!strategy_id || target_weight === undefined || allocated_capital === undefined) {
      res.status(400).json({
        error: "strategy_id, target_weight, and allocated_capital are required",
      });
      return;
    }

    const allocation = portfolioManager.registerAllocation({
      portfolio_id,
      strategy_id,
      strategy_name,
      target_weight,
      min_weight,
      max_weight,
      allocated_capital,
    });

    logger.info(`Created allocation ${allocation.allocation_id}`);
    res.json(allocation);
  } catch (error) {
    logger.error(`Error registering allocation: ${error}`);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to register allocation",
    });
  }
});

// GET /api/portfolio-intelligence/exposure
// Get current exposure snapshot
router.get("/exposure", (req: Request, res: Response): void => {
  try {
    const portfolio_id = (req.query.portfolio_id as string) || "default";
    const summary = portfolioManager.getPortfolioSummary(portfolio_id);

    if (!summary.latest_exposure) {
      res.status(404).json({ error: "No exposure snapshot available" });
      return;
    }

    res.json(summary.latest_exposure);
  } catch (error) {
    logger.error(`Error fetching exposure: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /api/portfolio-intelligence/exposure
// Update exposure snapshot
router.post("/exposure", requireOperator, (req: Request, res: Response): void => {
  try {
    const {
      portfolio_id = "default",
      long_exposure_usd,
      short_exposure_usd,
      net_exposure_usd,
      total_positions,
      total_strategies,
      total_capital,
      cash_remaining,
      portfolio_var_95,
      portfolio_var_99,
      max_single_position_pct,
      concentration_score,
      sector_exposure,
      symbol_exposure,
    } = req.body;

    if (
      long_exposure_usd === undefined ||
      short_exposure_usd === undefined ||
      net_exposure_usd === undefined ||
      total_positions === undefined ||
      total_strategies === undefined ||
      total_capital === undefined ||
      cash_remaining === undefined
    ) {
      res.status(400).json({
        error:
          "long_exposure_usd, short_exposure_usd, net_exposure_usd, total_positions, total_strategies, total_capital, and cash_remaining are required",
      });
      return;
    }

    const snapshot = portfolioManager.updateExposure({
      portfolio_id,
      long_exposure_usd,
      short_exposure_usd,
      net_exposure_usd,
      total_positions,
      total_strategies,
      total_capital,
      cash_remaining,
      portfolio_var_95,
      portfolio_var_99,
      max_single_position_pct,
      concentration_score,
      sector_exposure,
      symbol_exposure,
    });

    logger.info(`Created exposure snapshot ${snapshot.snapshot_id}`);
    res.json(snapshot);
  } catch (error) {
    logger.error(`Error updating exposure: ${error}`);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to update exposure",
    });
  }
});

// GET /api/portfolio-intelligence/correlations
// Get correlation data
router.get("/correlations", (req: Request, res: Response): void => {
  try {
    const portfolio_id = (req.query.portfolio_id as string) || "default";
    const summary = portfolioManager.getPortfolioSummary(portfolio_id);

    if (!summary.latest_correlation) {
      res.status(404).json({ error: "No correlation snapshot available" });
      return;
    }

    res.json(summary.latest_correlation);
  } catch (error) {
    logger.error(`Error fetching correlations: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /api/portfolio-intelligence/correlations
// Update correlations
router.post(
  "/correlations",
  requireOperator,
  (req: Request, res: Response): void => {
    try {
      const {
        portfolio_id = "default",
        strategy_correlation_matrix,
        asset_correlation_matrix,
        max_correlation,
        avg_correlation,
        highly_correlated_pairs,
        lookback_days,
        sample_count,
      } = req.body;

      if (
        max_correlation === undefined ||
        avg_correlation === undefined ||
        !highly_correlated_pairs
      ) {
        res.status(400).json({
          error:
            "max_correlation, avg_correlation, and highly_correlated_pairs are required",
        });
        return;
      }

      const snapshot = portfolioManager.updateCorrelation({
        portfolio_id,
        strategy_correlation_matrix,
        asset_correlation_matrix,
        max_correlation,
        avg_correlation,
        highly_correlated_pairs,
        lookback_days,
        sample_count,
      });

      logger.info(`Created correlation snapshot ${snapshot.snapshot_id}`);
      res.json(snapshot);
    } catch (error) {
      logger.error(`Error updating correlations: ${error}`);
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update correlations",
      });
    }
  }
);

// GET /api/portfolio-intelligence/regime
// Get regime-based allocations
router.get("/regime", (req: Request, res: Response): void => {
  try {
    const portfolio_id = (req.query.portfolio_id as string) || "default";
    const summary = portfolioManager.getPortfolioSummary(portfolio_id);
    res.json(summary.regime_allocations);
  } catch (error) {
    logger.error(`Error fetching regime allocations: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /api/portfolio-intelligence/regime
// Update regime allocations
router.post("/regime", requireOperator, (req: Request, res: Response): void => {
  try {
    const {
      portfolio_id = "default",
      regime,
      strategy_weights,
      regime_confidence,
      regime_indicators,
    } = req.body;

    if (!regime || !strategy_weights) {
      res.status(400).json({
        error: "regime and strategy_weights are required",
      });
      return;
    }

    const allocation = portfolioManager.registerRegimeAllocation({
      portfolio_id,
      regime,
      strategy_weights,
      regime_confidence,
      regime_indicators,
    });

    logger.info(`Created regime allocation ${allocation.allocation_id}`);
    res.json(allocation);
  } catch (error) {
    logger.error(`Error registering regime allocation: ${error}`);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to register regime allocation",
    });
  }
});

// GET /api/portfolio-intelligence/risk
// Get portfolio risk assessment
router.get("/risk", (req: Request, res: Response): void => {
  try {
    const portfolio_id = (req.query.portfolio_id as string) || "default";
    const summary = portfolioManager.getPortfolioSummary(portfolio_id);
    res.json(summary.risk_assessment);
  } catch (error) {
    logger.error(`Error fetching risk assessment: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /api/portfolio-intelligence/rebalance
// Trigger rebalance check
router.post("/rebalance", requireOperator, (req: Request, res: Response): void => {
  try {
    const portfolio_id = (req.body.portfolio_id as string) || "default";
    const weights = (req.body.weights as Record<string, number>) || {};

    // Update actual weights if provided
    if (Object.keys(weights).length > 0) {
      portfolioManager.updateAllocationWeights(portfolio_id, weights);
    }

    const summary = portfolioManager.getPortfolioSummary(portfolio_id);
    res.json({
      rebalance_status: summary.rebalance_status,
      risk_assessment: summary.risk_assessment,
    });
  } catch (error) {
    logger.error(`Error triggering rebalance: ${error}`);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to trigger rebalance",
    });
  }
});

export default router;
