import { Router, type Request, type Response } from "express";

const router = Router();

// Mock state for orchestrator simulation
let pipelineMode: "paper" | "live" = "paper";

interface PipelineStatus {
  dataEngine: {
    status: "operational" | "degraded" | "offline";
    sourcesActive: number;
    sourcesTotal: number;
    qualityScore: number;
  };
  mcpPipeline: {
    status: "operational" | "degraded" | "offline";
    signalsProcessed: number;
    approvalRate: number;
    avgLatencyMs: number;
  };
  execution: {
    status: "operational" | "degraded" | "offline";
    mode: "paper" | "live";
    activePositions: number;
    dailyPnLUsd: number;
  };
  learning: {
    status: "operational" | "degraded" | "offline";
    lessonsExtracted: number;
    strategiesPROVEN: number;
  };
  risk: {
    status: "operational" | "degraded" | "offline";
    utilizationPercent: number;
    circuitBreakerTripped: boolean;
  };
}

interface FlowMetrics {
  signalsPerMinute: number;
  avgLatencyMs: number;
  approvalRate: number;
  activePositions: number;
  dailyPnl: number;
  riskUtilization: number;
}

interface Position {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  openTime: string;
}

interface Exposure {
  gross: number;
  net: number;
  concentration: number;
}

interface MCPDecision {
  accepted: boolean;
  reasoning: string;
  riskScore: number;
  expectedReturn: number;
}

interface LearningStats {
  lessons: Array<{
    id: string;
    category: string;
    insight: string;
    confidence: number;
    extractedAt: string;
  }>;
  strategyTiers: {
    PROVEN: number;
    PROVEN_PLUS: number;
    EXPERIMENTAL: number;
  };
  experiments: {
    active: number;
    completed: number;
    avgWinRate: number;
  };
}

// GET /pipeline/status - Overall pipeline health
router.get("/status", (_req: Request, res: Response) => {
  const status: PipelineStatus = {
    dataEngine: {
      status: "operational",
      sourcesActive: 4,
      sourcesTotal: 5,
      qualityScore: 92,
    },
    mcpPipeline: {
      status: "operational",
      signalsProcessed: 847,
      approvalRate: 62,
      avgLatencyMs: 12,
    },
    execution: {
      status: "operational",
      mode: pipelineMode,
      activePositions: 3,
      dailyPnLUsd: 2340,
    },
    learning: {
      status: "operational",
      lessonsExtracted: 156,
      strategiesPROVEN: 8,
    },
    risk: {
      status: "operational",
      utilizationPercent: 34,
      circuitBreakerTripped: false,
    },
  };

  res.json({
    ok: true,
    status,
  });
});

// GET /pipeline/flow - Live signal flow metrics
router.get("/flow", (_req: Request, res: Response) => {
  const flow: FlowMetrics = {
    signalsPerMinute: 12.4,
    avgLatencyMs: 12,
    approvalRate: 62,
    activePositions: 3,
    dailyPnl: 2340,
    riskUtilization: 34,
  };

  res.json({
    ok: true,
    flow,
  });
});

// POST /pipeline/signal - Submit a signal to the live pipeline
router.post("/signal", (req: Request, res: Response) => {
  const {
    symbol,
    direction,
    signalType,
    timeframe,
    price,
    stopLoss,
    takeProfit,
    strategyName,
  } = req.body;

  // Validate required fields
  if (!symbol || !direction || !signalType || !timeframe || !price) {
    res.status(400).json({
      ok: false,
      error: "Missing required fields",
    });
    return;
  }

  // Mock MCP decision
  const decision: MCPDecision = {
    accepted: false,
    reasoning:
      "Signal meets risk and correlation thresholds for " +
      (pipelineMode === "live" ? "live" : "paper") +
      " execution",
    riskScore: 0,
    expectedReturn: 0,
  };

  res.json({
    ok: true,
    decision,
    submitted: {
      symbol,
      direction,
      signalType,
      timeframe,
      price,
      stopLoss,
      takeProfit,
      strategyName,
      mode: pipelineMode,
      timestamp: new Date().toISOString(),
    },
  });
});

// POST /pipeline/mode - Switch between paper/live mode
router.post("/mode", (req: Request, res: Response) => {
  const { mode } = req.body;

  if (mode !== "paper" && mode !== "live") {
    res.status(400).json({
      ok: false,
      error: 'Mode must be "paper" or "live"',
    });
    return;
  }

  // Safety check: require explicit confirmation for live mode
  if (mode === "live" && pipelineMode === "paper") {
    res.json({
      ok: true,
      mode,
      warning: "Switching to LIVE mode. Real capital at risk.",
      timestamp: new Date().toISOString(),
    });
  } else {
    pipelineMode = mode;
    res.json({
      ok: true,
      mode,
      timestamp: new Date().toISOString(),
    });
  }

  pipelineMode = mode;
});

// GET /pipeline/positions - Active positions from PortfolioTracker
router.get("/positions", (_req: Request, res: Response) => {
  const positions: Position[] = [
    {
      symbol: "AAPL",
      direction: "long",
      entryPrice: 185.25,
      currentPrice: 187.45,
      quantity: 50,
      pnl: 110,
      pnlPercent: 1.19,
      openTime: "2026-04-02T09:30:00Z",
    },
    {
      symbol: "TSLA",
      direction: "short",
      entryPrice: 248.75,
      currentPrice: 245.30,
      quantity: 30,
      pnl: 103.5,
      pnlPercent: 1.39,
      openTime: "2026-04-03T14:15:00Z",
    },
    {
      symbol: "NVDA",
      direction: "long",
      entryPrice: 892.5,
      currentPrice: 896.75,
      quantity: 10,
      pnl: 42.5,
      pnlPercent: 0.48,
      openTime: "2026-04-04T11:45:00Z",
    },
  ];

  const exposure: Exposure = {
    gross: 68450,
    net: 58220,
    concentration: 35,
  };

  res.json({
    ok: true,
    positions,
    exposure,
  });
});

// GET /pipeline/learning - Learning system stats
router.get("/learning", (_req: Request, res: Response) => {
  const recentLessons = [
    {
      id: "lesson_001",
      category: "execution",
      insight: "Slippage increases 40% in final 30 min of RTH sessions",
      confidence: 0.94,
      extractedAt: "2026-04-05T16:30:00Z",
    },
    {
      id: "lesson_002",
      category: "risk",
      insight: "Correlation between ES and NQ breaks down at >20% VIX",
      confidence: 0.88,
      extractedAt: "2026-04-05T14:20:00Z",
    },
    {
      id: "lesson_003",
      category: "strategy",
      insight:
        "Mean-reversion strategies outperform trending 3:1 in choppy markets",
      confidence: 0.91,
      extractedAt: "2026-04-04T18:15:00Z",
    },
  ];

  const stats: LearningStats = {
    lessons: recentLessons,
    strategyTiers: {
      PROVEN: 8,
      PROVEN_PLUS: 5,
      EXPERIMENTAL: 12,
    },
    experiments: {
      active: 6,
      completed: 24,
      avgWinRate: 58,
    },
  };

  res.json({
    ok: true,
    lessons: stats.lessons,
    strategyTiers: stats.strategyTiers,
    experiments: stats.experiments,
  });
});

// POST /pipeline/circuit-breaker/reset - Reset circuit breaker
router.post("/circuit-breaker/reset", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    message: "Circuit breaker reset",
    timestamp: new Date().toISOString(),
    status: "ready",
  });
});

export default router;
