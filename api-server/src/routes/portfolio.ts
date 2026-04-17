import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  computePortfolio,
  getPortfolioState,
  updatePortfolioState,
  DEFAULT_CONSTRAINTS,
  PortfolioConstraints,
  ComputeInput,
} from "../lib/portfolio_engine";

const router = Router();

// POST /portfolio/compute
router.post("/compute", (req: Request, res: Response): void => {
  try {
    const { positions, equity, constraints } = req.body;

    if (!positions || !Array.isArray(positions)) {
      logger.error(`Invalid positions in request body`);
      res.status(400).json({ error: "positions array required" });
      return;
    }

    if (!equity || typeof equity !== "number" || equity <= 0) {
      logger.error(`Invalid equity in request body`);
      res.status(400).json({ error: "equity must be positive number" });
      return;
    }

    // Validate position inputs
    const validPositions: ComputeInput[] = positions.map((p: any) => {
      if (
        !p.symbol ||
        typeof p.conviction !== "number" ||
        typeof p.realized_vol !== "number" ||
        !p.sector ||
        typeof p.current_qty !== "number" ||
        typeof p.current_price !== "number"
      ) {
        throw new Error(
          `Invalid position: ${JSON.stringify(p)}`
        );
      }
      return {
        symbol: p.symbol,
        conviction: Math.max(0, Math.min(1, p.conviction)),
        realized_vol: Math.max(0, p.realized_vol),
        sector: p.sector,
        current_qty: p.current_qty,
        current_price: p.current_price,
      };
    });

    const state = computePortfolio({
      positions: validPositions,
      equity,
      constraints,
    });

    logger.info(`Computed portfolio for ${validPositions.length} positions`);
    res.json(state);
  } catch (error) {
    logger.error(`Error computing portfolio: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /portfolio/current
router.get("/current", (_req: Request, res: Response): void => {
  try {
    const state = getPortfolioState();
    if (!state) {
      logger.info(`No cached portfolio state available`);
      res.status(404).json({ error: "No portfolio state cached" });
      return;
    }
    res.json(state);
  } catch (error) {
    logger.error(`Error retrieving portfolio state: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /portfolio/constraints
router.get("/constraints", (req: Request, res: Response) => {
  try {
    res.json(DEFAULT_CONSTRAINTS);
  } catch (error) {
    logger.error(`Error retrieving constraints: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /portfolio/constraints
router.post("/constraints", (req: Request, res: Response): void => {
  try {
    const partialConstraints = req.body as Partial<PortfolioConstraints>;
    const state = getPortfolioState();

    if (!state) {
      logger.error(`Cannot update constraints without cached state`);
      res.status(400).json({ error: "No portfolio state to update constraints" });
      return;
    }

    const updated = {
      ...state,
      constraints: {
        ...state.constraints,
        ...partialConstraints,
      },
    };

    updatePortfolioState(updated);
    logger.info(`Updated portfolio constraints`);
    res.json(updated);
  } catch (error) {
    logger.error(`Error updating constraints: ${error}`);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

export default router;
