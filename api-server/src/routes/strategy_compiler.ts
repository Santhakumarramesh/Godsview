/**
 * routes/strategy_compiler.ts — Phase 32 Strategy Compiler Routes
 *
 * REST API for natural language strategy compilation.
 *
 * Routes:
 *   POST /api/strategy-compiler/compile — Compile natural language to DSL
 *   POST /api/strategy-compiler/validate — Validate DSL
 *   POST /api/strategy-compiler/execution-plan — Generate execution plan
 *   GET  /api/strategy-compiler/results — List compilation results
 *   GET  /api/strategy-compiler/results/:id — Get specific result
 *   GET  /api/strategy-compiler/dsl-schema — Return DSL schema
 *   GET  /api/strategy-compiler/examples — Example prompts and compiled DSLs
 */

import { Router, Request, Response } from "express";
import { strategyCompiler } from "../lib/strategy_compiler";
import { logger } from "../lib/logger";
import { authGuard } from "../lib/auth_guard";

const router = Router();

/**
 * POST /api/strategy-compiler/compile
 * Compile a natural language strategy prompt into DSL
 */
router.post("/compile", authGuard, (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Prompt is required and must be a non-empty string",
      });
    }

    const result = strategyCompiler.compile(prompt.trim());

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to compile strategy");
    res.status(500).json({
      success: false,
      error: error.message || "Compilation failed",
    });
  }
});

/**
 * POST /api/strategy-compiler/validate
 * Validate an existing DSL
 */
router.post("/validate", authGuard, (req: Request, res: Response) => {
  try {
    const { dsl } = req.body;

    if (!dsl) {
      return res.status(400).json({
        success: false,
        error: "DSL is required",
      });
    }

    const validation = strategyCompiler.validateDSL(dsl);

    res.json({
      success: true,
      data: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
      },
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to validate DSL");
    res.status(500).json({
      success: false,
      error: error.message || "Validation failed",
    });
  }
});

/**
 * POST /api/strategy-compiler/execution-plan
 * Generate execution plan from DSL
 */
router.post(
  "/execution-plan",
  authGuard,
  (req: Request, res: Response) => {
    try {
      const { dsl } = req.body;

      if (!dsl) {
        return res.status(400).json({
          success: false,
          error: "DSL is required",
        });
      }

      // Validate DSL first
      const validation = strategyCompiler.validateDSL(dsl);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: "DSL validation failed",
          data: {
            errors: validation.errors,
          },
        });
      }

      const plan = strategyCompiler.generateExecutionPlan(dsl);

      res.json({
        success: true,
        data: plan,
      });
    } catch (error: any) {
      logger.error(
        { error },
        "Failed to generate execution plan"
      );
      res.status(500).json({
        success: false,
        error:
          error.message ||
          "Execution plan generation failed",
      });
    }
  }
);

/**
 * GET /api/strategy-compiler/results
 * List all compilation results
 */
router.get("/results", authGuard, (req: Request, res: Response) => {
  try {
    const results = strategyCompiler.getAllResults();

    res.json({
      success: true,
      data: {
        total: results.length,
        results: results.sort(
          (a, b) => b.compiled_at - a.compiled_at
        ),
      },
    });
  } catch (error: any) {
    logger.error(
      { error },
      "Failed to retrieve compilation results"
    );
    res.status(500).json({
      success: false,
      error: error.message || "Failed to retrieve results",
    });
  }
});

/**
 * GET /api/strategy-compiler/results/:id
 * Get specific compilation result
 */
router.get(
  "/results/:id",
  authGuard,
  (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = strategyCompiler.getCompilationResult(id);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: "Result not found",
        });
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logger.error(
        { error },
        "Failed to retrieve compilation result"
      );
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve result",
      });
    }
  }
);

/**
 * GET /api/strategy-compiler/dsl-schema
 * Return DSL schema documentation
 */
router.get(
  "/dsl-schema",
  authGuard,
  (req: Request, res: Response) => {
    try {
      const schema = {
        StrategyDSL: {
          strategy_id: { type: "string", description: "Unique strategy ID" },
          name: { type: "string", description: "Strategy name" },
          version: {
            type: "string",
            description: "Semantic version (e.g., 1.0.0)",
          },
          entry_conditions: {
            type: "EntryCondition[]",
            description: "At least one required",
          },
          exit_conditions: {
            type: "ExitCondition[]",
            description: "At least one required (stop loss mandatory)",
          },
          invalidation_rules: {
            type: "EntryCondition[]",
            description:
              "Optional conditions that cancel entry setup",
          },
          stop_loss: {
            type: "number",
            description: "Stop loss percentage (0.5-20%)",
          },
          take_profit: {
            type: "number",
            description: "Take profit percentage (optional)",
          },
          time_filters: {
            type: "TimeFilter[]",
            description: "Market session and day constraints",
          },
          volatility_filters: {
            type: "VolatilityFilter[]",
            description: "Optional volatility conditions",
          },
          position_sizing: {
            type: "PositionSizing",
            description: "Position size configuration",
          },
          metadata: {
            type: "object",
            description: "Optional metadata",
          },
        },
        EntryCondition: {
          id: { type: "string" },
          indicator: {
            type: "string",
            enum: [
              "rsi",
              "ema",
              "sma",
              "price",
              "macd",
              "bollinger_bands",
            ],
          },
          comparator: {
            type: "string",
            enum: [
              "gt",
              "lt",
              "gte",
              "lte",
              "crosses_above",
              "crosses_below",
              "equals",
            ],
          },
          value: { type: "number" },
          timeframe: {
            type: "string",
            enum: ["1m", "5m", "15m", "30m", "1h", "4h", "daily", "weekly"],
          },
          logic_operator: {
            type: "string",
            enum: ["and", "or"],
          },
          description: { type: "string" },
        },
        ExitCondition: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: [
              "stop_loss",
              "take_profit",
              "trailing_stop",
              "time_exit",
              "signal_exit",
            ],
          },
          value: { type: "number" },
          unit: {
            type: "string",
            enum: ["percent", "dollars", "points", "bars", "minutes"],
          },
        },
        PositionSizing: {
          type: {
            type: "string",
            enum: ["fixed", "percent_equity", "volatility_adjusted", "kelly"],
          },
          value: { type: "number" },
          max_position_pct: { type: "number" },
        },
      };

      res.json({
        success: true,
        data: schema,
      });
    } catch (error: any) {
      logger.error({ error }, "Failed to retrieve DSL schema");
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve schema",
      });
    }
  }
);

/**
 * GET /api/strategy-compiler/examples
 * Return example strategy prompts and their compiled DSLs
 */
router.get(
  "/examples",
  authGuard,
  (req: Request, res: Response) => {
    try {
      const examples = [
        {
          title: "RSI Oversold Long",
          prompt:
            "Buy SPY when RSI < 30 with 2% stop loss and 5% take profit on 1h chart",
          description: "Mean reversion strategy on oversold RSI",
        },
        {
          title: "EMA Crossover Short",
          prompt:
            "Short QQQ when price crosses below 200 EMA, take profit at 3%, stop at 4%",
          description: "Trend-following strategy using EMA",
        },
        {
          title: "Bollinger Band Bounce",
          prompt:
            "Long position when price touches lower Bollinger Band, 1.5% risk per trade, exit at 2% profit",
          description:
            "Mean reversion using Bollinger Bands",
        },
        {
          title: "MACD Signal Crossover",
          prompt:
            "Go long when MACD crosses above signal line, position size 1% of equity, stop loss 2%, take profit 4%",
          description: "MACD-based momentum strategy",
        },
        {
          title: "Multi-timeframe Confirmation",
          prompt:
            "Buy when RSI < 30 on 5m AND price is above 50 EMA on 1h, risk 1% per trade with 3% stop loss",
          description:
            "Multi-timeframe strategy with confluence signals",
        },
      ];

      // Compile one example to show compilation result
      const examplePrompt =
        "Buy SPY when RSI < 30 with 2% stop loss and 5% take profit on 1h chart";
      const compiledExample = strategyCompiler.compile(examplePrompt);

      res.json({
        success: true,
        data: {
          example_prompts: examples,
          sample_compilation: compiledExample,
        },
      });
    } catch (error: any) {
      logger.error(
        { error },
        "Failed to retrieve examples"
      );
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve examples",
      });
    }
  }
);

export default router;
