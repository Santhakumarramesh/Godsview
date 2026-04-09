import { describe, it, expect, beforeEach, vi } from "vitest";
import { execQualityService } from "../lib/exec_quality";

vi.mock("pino", () => ({ default: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }));
vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));
vi.mock("../../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

describe("Execution Quality Service", () => {
  beforeEach(() => {
    execQualityService._clearExecutions();
  });

  describe("recordExecution", () => {
    it("should record an execution", () => {
      const result = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      expect(result.success).toBe(true);
      expect(result.data?.symbol).toBe("AAPL");
      expect(result.data?.side).toBe("buy");
      expect(result.data?.quantity).toBe(100);
    });

    it("should calculate slippage in basis points", () => {
      const result = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.5, 50, "brk_1");
      // |150.5 - 150.0| / 150.0 * 10000 = 33.33 bps
      expect(result.data?.slippage_bps).toBeCloseTo(33.33, 1);
    });

    it("should set timestamp", () => {
      const before = Date.now();
      const result = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      const after = Date.now();

      expect(result.data?.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.data?.timestamp).toBeLessThanOrEqual(after);
    });

    it("should include optional fields", () => {
      const result = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1", "NASDAQ", "strat_1");
      expect(result.data?.venue).toBe("NASDAQ");
      expect(result.data?.strategy_id).toBe("strat_1");
    });
  });

  describe("scoreExecution", () => {
    it("should score an execution", () => {
      const recorded = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      const execId = recorded.data?.id ?? "";

      const result = execQualityService.scoreExecution(execId);
      expect(result.success).toBe(true);
      expect(result.data?.overall).toBeGreaterThan(0);
      expect(result.data?.overall).toBeLessThanOrEqual(100);
      expect(result.data?.grade).toBeDefined();
    });

    it("should assign grade A for excellent execution", () => {
      // Very low slippage and fast fill time
      const recorded = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.0, 25, "brk_1");
      const execId = recorded.data?.id ?? "";

      const result = execQualityService.scoreExecution(execId);
      expect(result.data?.grade).toBe("A");
      expect(result.data?.overall).toBeGreaterThanOrEqual(90);
    });

    it("should assign grade F for poor execution", () => {
      // High slippage and slow fill
      const recorded = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 155.0, 2000, "brk_1");
      const execId = recorded.data?.id ?? "";

      const result = execQualityService.scoreExecution(execId);
      expect(result.data?.grade).toBe("F");
      expect(result.data?.overall).toBeLessThan(60);
    });

    it("should fail for non-existent execution", () => {
      const result = execQualityService.scoreExecution("exec_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should calculate slippage score correctly", () => {
      const recorded = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 100.0, 100.01, 50, "brk_1");
      const execId = recorded.data?.id ?? "";

      const result = execQualityService.scoreExecution(execId);
      expect(result.data?.slippage_score).toBe(100);
    });

    it("should calculate speed score correctly", () => {
      const recorded = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 25, "brk_1");
      const execId = recorded.data?.id ?? "";

      const result = execQualityService.scoreExecution(execId);
      expect(result.data?.speed_score).toBe(100);
    });
  });

  describe("getExecution", () => {
    it("should retrieve an execution", () => {
      const recorded = execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      const execId = recorded.data?.id ?? "";

      const result = execQualityService.getExecution(execId);
      expect(result.success).toBe(true);
      expect(result.data?.order_id).toBe("ord_1");
    });

    it("should fail for non-existent execution", () => {
      const result = execQualityService.getExecution("exec_nonexistent");
      expect(result.success).toBe(false);
    });
  });

  describe("getExecutionsBySymbol", () => {
    it("should retrieve executions by symbol", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      execQualityService.recordExecution("ord_2", "AAPL", "sell", 50, 151.0, 150.9, 60, "brk_1");
      execQualityService.recordExecution("ord_3", "TSLA", "buy", 10, 200.0, 200.5, 70, "brk_1");

      const result = execQualityService.getExecutionsBySymbol("AAPL");
      expect(result.data.length).toBe(2);
      expect(result.data.every((e) => e.symbol === "AAPL")).toBe(true);
    });

    it("should return empty array for no matches", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");

      const result = execQualityService.getExecutionsBySymbol("TSLA");
      expect(result.data.length).toBe(0);
    });
  });

  describe("getExecutionsByStrategy", () => {
    it("should retrieve executions by strategy", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1", undefined, "strat_1");
      execQualityService.recordExecution("ord_2", "TSLA", "buy", 10, 200.0, 200.5, 70, "brk_1", undefined, "strat_1");
      execQualityService.recordExecution("ord_3", "MSFT", "buy", 50, 300.0, 300.5, 60, "brk_1", undefined, "strat_2");

      const result = execQualityService.getExecutionsByStrategy("strat_1");
      expect(result.data.length).toBe(2);
      expect(result.data.every((e) => e.strategy_id === "strat_1")).toBe(true);
    });
  });

  describe("getAllExecutions", () => {
    it("should return all executions", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      execQualityService.recordExecution("ord_2", "TSLA", "buy", 10, 200.0, 200.5, 70, "brk_1");

      const result = execQualityService.getAllExecutions();
      expect(result.data.length).toBe(2);
    });

    it("should return empty array when no executions", () => {
      const result = execQualityService.getAllExecutions();
      expect(result.data.length).toBe(0);
    });
  });

  describe("generateSlippageReport", () => {
    it("should generate slippage report", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      execQualityService.recordExecution("ord_2", "AAPL", "sell", 50, 151.0, 150.9, 60, "brk_1");

      const result = execQualityService.generateSlippageReport("daily");
      expect(result.success).toBe(true);
      expect(result.data?.period).toBe("daily");
      expect(result.data?.total_trades).toBe(2);
      expect(result.data?.avg_slippage).toBeGreaterThan(0);
      expect(result.data?.median_slippage).toBeGreaterThan(0);
      expect(result.data?.worst_slippage).toBeGreaterThan(0);
      expect(result.data?.best_slippage).toBeGreaterThan(0);
    });

    it("should calculate positive and negative count", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1"); // positive
      execQualityService.recordExecution("ord_2", "AAPL", "sell", 50, 151.0, 150.9, 60, "brk_1"); // negative

      const result = execQualityService.generateSlippageReport("daily");
      expect(result.data?.positive_count).toBe(1);
      expect(result.data?.negative_count).toBe(1);
    });

    it("should aggregate by symbol", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      execQualityService.recordExecution("ord_2", "TSLA", "buy", 10, 200.0, 200.5, 70, "brk_1");

      const result = execQualityService.generateSlippageReport("daily");
      expect(result.data?.by_symbol["AAPL"]).toBeDefined();
      expect(result.data?.by_symbol["TSLA"]).toBeDefined();
    });

    it("should fail when no executions", () => {
      const result = execQualityService.generateSlippageReport("daily");
      expect(result.success).toBe(false);
      expect(result.error).toContain("No executions found");
    });
  });

  describe("compareVenues", () => {
    it("should compare venues", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1", "NASDAQ");
      execQualityService.recordExecution("ord_2", "AAPL", "buy", 100, 150.0, 150.5, 60, "brk_1", "NYSE");

      const result = execQualityService.compareVenues();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(2);
      expect(result.data[0].venue).toBeDefined();
      expect(result.data[0].avg_slippage_bps).toBeGreaterThan(0);
      expect(result.data[0].trade_count).toBeGreaterThan(0);
    });

    it("should sort by score descending", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.01, 50, "brk_1", "NASDAQ");
      execQualityService.recordExecution("ord_2", "AAPL", "buy", 100, 150.0, 151.0, 60, "brk_1", "NYSE");

      const result = execQualityService.compareVenues();
      expect(result.data[0].score).toBeGreaterThanOrEqual(result.data[1].score);
    });
  });

  describe("analyzeExecutionCosts", () => {
    it("should analyze execution costs", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      execQualityService.recordExecution("ord_2", "TSLA", "buy", 10, 200.0, 200.5, 70, "brk_1");

      const result = execQualityService.analyzeExecutionCosts(1.0);
      expect(result.success).toBe(true);
      expect(result.data?.total_commission).toBe(2.0);
      expect(result.data?.total_slippage_cost).toBeGreaterThan(0);
      expect(result.data?.total_cost).toBeGreaterThan(0);
      expect(result.data?.cost_per_trade).toBeGreaterThan(0);
      expect(result.data?.cost_as_pct_of_volume).toBeGreaterThan(0);
    });

    it("should fail when no executions", () => {
      const result = execQualityService.analyzeExecutionCosts(1.0);
      expect(result.success).toBe(false);
      expect(result.error).toContain("No executions found");
    });

    it("should use default commission of 0", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");

      const result = execQualityService.analyzeExecutionCosts();
      expect(result.success).toBe(true);
      expect(result.data?.total_commission).toBe(0);
    });
  });

  describe("getBestVenue", () => {
    it("should return best venue", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.01, 50, "brk_1", "NASDAQ");
      execQualityService.recordExecution("ord_2", "AAPL", "buy", 100, 150.0, 151.0, 60, "brk_1", "NYSE");

      const result = execQualityService.getBestVenue();
      expect(result.success).toBe(true);
      expect(result.data?.venue).toBe("NASDAQ");
    });

    it("should fail when no venues", () => {
      const result = execQualityService.getBestVenue();
      expect(result.success).toBe(false);
      expect(result.error).toContain("No venues found");
    });
  });

  describe("_clearExecutions", () => {
    it("should clear all executions", () => {
      execQualityService.recordExecution("ord_1", "AAPL", "buy", 100, 150.0, 150.1, 50, "brk_1");
      execQualityService.recordExecution("ord_2", "TSLA", "buy", 10, 200.0, 200.5, 70, "brk_1");

      execQualityService._clearExecutions();

      const result = execQualityService.getAllExecutions();
      expect(result.data.length).toBe(0);
    });
  });
});
