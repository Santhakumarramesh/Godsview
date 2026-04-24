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

// In-memory portfolio state tracking positions and capital
interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  sector: string;
}

export const portfolioState = {
  positions: [] as Position[],
  capital: 250000,
  timestamp: Date.now(),
};

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
    res.status(503).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /portfolio/current
router.get("/current", (_req: Request, res: Response): void => {
  try {
    const totalValue = portfolioState.positions.reduce(
      (sum, p) => sum + p.quantity * p.currentPrice,
      0
    );
    const totalExposure = portfolioState.positions.reduce(
      (sum, p) => sum + Math.abs(p.quantity * p.currentPrice),
      0
    );
    const pnl = totalValue - portfolioState.positions.reduce(
      (sum, p) => sum + p.quantity * p.entryPrice,
      0
    );
    
    res.json({
      positions_count: portfolioState.positions.length,
      total_exposure: totalExposure,
      total_value: totalValue,
      capital: portfolioState.capital,
      pnl,
      pnl_pct: portfolioState.capital > 0 ? (pnl / portfolioState.capital) * 100 : 0,
      timestamp: portfolioState.timestamp,
      positions: portfolioState.positions,
    });
  } catch (error) {
    logger.error(`Error retrieving portfolio state: ${error}`);
    res.status(503).json({
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
    res.status(503).json({
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
    res.status(503).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /portfolio/positions - Add a position to the portfolio
router.post("/positions", (req: Request, res: Response): void => {
  try {
    const { symbol, quantity, entryPrice, currentPrice, sector } = req.body;
    
    if (!symbol || typeof quantity !== "number" || typeof entryPrice !== "number" || 
        typeof currentPrice !== "number" || !sector) {
      res.status(400).json({ error: "Missing or invalid position fields" });
      return;
    }

    const newPosition: Position = {
      symbol,
      quantity,
      entryPrice,
      currentPrice,
      sector,
    };

    portfolioState.positions.push(newPosition);
    portfolioState.timestamp = Date.now();
    
    logger.info(`Added position: ${symbol}`);
    res.status(201).json({
      success: true,
      position: newPosition,
      portfolio_size: portfolioState.positions.length,
    });
  } catch (error) {
    logger.error(`Error adding position: ${error}`);
    res.status(503).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

export default router;
