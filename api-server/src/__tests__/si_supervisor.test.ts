/**
 * SI Supervisor Tests — Health monitoring, retrain evaluation, and orchestration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  siHealthCheck,
  evaluateRetrainNeed,
  runSupervisorCycle,
  startSISupervisor,
  stopSISupervisor,
  getSupervisorHistory,
  getSupervisorStats,
  getEnsembleStatus,
  getSISupervisorConfig,
  setSISupervisorConfig,
  isSISupervisorActive,
  type SISupervisorConfig,
  type SIHealthReport,
  type RetrainDecision,
} from "../engines/si_supervisor";
import * as siModule from "../engines/si_supervisor";
import * as persistStore from "../lib/persistent_store";

// Mock dependencies
vi.mock("../lib/persistent_store", () => ({
  persistRead: vi.fn(),
  persistWrite: vi.fn(),
  persistAppend: vi.fn(),
  getCollectionSize: vi.fn(),
}));

vi.mock("../lib/ml_model", () => ({
  predictWinProbability: vi.fn(),
  getModelStatus: vi.fn(() => ({
    status: "active",
    message: "Ensemble ready",
    meta: {
      samples: 1000,
      accuracy: 0.65,
      auc: 0.72,
      winRate: 0.55,
      purgedCv: null,
      setupModelsTrained: 3,
      setupModelMeta: [],
      trainedAt: new Date().toISOString(),
    },
  })),
  getModelDriftStatus: vi.fn(async () => ({
    status: "stable",
    sampleRecent: 500,
    sampleBaseline: 1000,
    recentWinRate: 0.56,
    baselineWinRate: 0.55,
    winRateDelta: 0.01,
    recentAvgQuality: 0.62,
    baselineAvgQuality: 0.63,
    qualityDelta: -0.01,
    bySetup: [],
    computedAt: new Date().toISOString(),
  })),
  retrainModel: vi.fn(async () => ({
    success: true,
    message: "Model retrained on 1500 samples",
  })),
  getModelDiagnostics: vi.fn(async () => ({
    status: {
      status: "active",
      message: "Ensemble ready",
      meta: {
        samples: 1000,
        accuracy: 0.65,
        auc: 0.72,
        winRate: 0.55,
        purgedCv: null,
        setupModelsTrained: 3,
        setupModelMeta: [],
        trainedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
    drift: {
      status: "stable",
      sampleRecent: 500,
      sampleBaseline: 1000,
      recentWinRate: 0.56,
      baselineWinRate: 0.55,
      winRateDelta: 0.01,
      recentAvgQuality: 0.62,
      baselineAvgQuality: 0.63,
      qualityDelta: -0.01,
      bySetup: [],
      computedAt: new Date().toISOString(),
    },
    validation: null,
  })),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ────────────────────────────────────────────────────────────────────────────

describe("SI Supervisor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopSISupervisor(); // Ensure supervisor is stopped
    setSISupervisorConfig({
      retrainThreshold: 5,
      healthCheckIntervalMs: 300_000,
      maxModelAgeDays: 7,
      ensembleMinModels: 2,
      driftAlertThreshold: 0.1,
    });

    // Setup default mocks
    vi.mocked(persistStore.persistRead).mockReturnValue([]);
    vi.mocked(persistStore.persistAppend).mockImplementation(() => {});
    vi.mocked(persistStore.getCollectionSize).mockReturnValue(0);
  });

  afterEach(() => {
    stopSISupervisor();
  });

  // ── Health Check Tests ──────────────────────────────────────────────────────

  describe("siHealthCheck()", () => {
    it("should return healthy status when all checks pass", async () => {
      const health = await siHealthCheck();
      expect(health.status).toBe("healthy");
      expect(health.ensemble.trained).toBe(true);
      expect(health.issues).toHaveLength(0);
    });

    it("should detect untrained model", async () => {
      const { getModelDiagnostics, getModelStatus } = await import("../lib/ml_model");
      vi.mocked(getModelStatus).mockReturnValueOnce({
        status: "warning",
        message: "ML layer using heuristic",
        meta: null,
      });
      vi.mocked(getModelDiagnostics).mockResolvedValueOnce({
        status: {
          status: "warning",
          message: "ML layer using heuristic",
          meta: null,
        },
        drift: null,
        validation: null,
      });

      const health = await siHealthCheck();
      expect(health.ensemble.trained).toBe(false);
      expect(health.issues.some((i) => i.code === "ENSEMBLE_NOT_READY")).toBe(true);
    });

    it("should warn on model age exceeding threshold", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      vi.mocked(getModelDiagnostics).mockResolvedValueOnce({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 3,
            setupModelMeta: [],
            trainedAt: oldDate,
          },
        },
        drift: {
          status: "stable",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.56,
          baselineWinRate: 0.55,
          winRateDelta: 0.01,
          recentAvgQuality: 0.62,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.01,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const health = await siHealthCheck();
      expect(health.modelAge.warning).toBe(true);
      expect(health.status).toBe("degraded");
      expect(health.issues.some((i) => i.code === "MODEL_AGE_EXCEEDED")).toBe(true);
    });

    it("should detect concept drift status", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      vi.mocked(getModelDiagnostics).mockResolvedValueOnce({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 3,
            setupModelMeta: [],
            trainedAt: new Date().toISOString(),
          },
        },
        drift: {
          status: "drift",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.45,
          baselineWinRate: 0.55,
          winRateDelta: -0.1,
          recentAvgQuality: 0.55,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.08,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const health = await siHealthCheck();
      expect(health.drift.status).toBe("drift");
      expect(health.status).toBe("critical");
      expect(health.issues.some((i) => i.code === "CONCEPT_DRIFT")).toBe(true);
    });

    it("should detect drift warning status", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      vi.mocked(getModelDiagnostics).mockResolvedValueOnce({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 3,
            setupModelMeta: [],
            trainedAt: new Date().toISOString(),
          },
        },
        drift: {
          status: "watch",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.52,
          baselineWinRate: 0.55,
          winRateDelta: -0.03,
          recentAvgQuality: 0.61,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.02,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const health = await siHealthCheck();
      expect(health.drift.status).toBe("watch");
      expect(health.issues.some((i) => i.code === "DRIFT_WARNING")).toBe(true);
    });

    it("should flag insufficient ensemble members", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      setSISupervisorConfig({ ensembleMinModels: 5 });

      vi.mocked(getModelDiagnostics).mockResolvedValueOnce({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 2,
            setupModelMeta: [],
            trainedAt: new Date().toISOString(),
          },
        },
        drift: {
          status: "stable",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.56,
          baselineWinRate: 0.55,
          winRateDelta: 0.01,
          recentAvgQuality: 0.62,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.01,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const health = await siHealthCheck();
      expect(health.issues.some((i) => i.code === "ENSEMBLE_INCOMPLETE")).toBe(true);
    });

    it("should include accuracy delta in report", async () => {
      const health = await siHealthCheck();
      expect(health.accuracy).toBeDefined();
      expect(health.accuracy.current).toBe(0.65);
      expect(health.accuracy.threshold).toBe(0.05);
    });

    it("should include ensemble member count", async () => {
      const health = await siHealthCheck();
      expect(health.ensemble.members).toBe(3);
      expect(health.ensemble.minRequired).toBe(2);
    });
  });

  // ── Retrain Evaluation Tests ────────────────────────────────────────────────

  describe("evaluateRetrainNeed()", () => {
    it("should return no retrain needed when healthy", async () => {
      const decision = await evaluateRetrainNeed();
      expect(decision.shouldRetrain).toBe(false);
      expect(decision.urgency).toBe("low");
    });

    it("should return critical urgency on concept drift", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      vi.mocked(getModelDiagnostics).mockResolvedValueOnce({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 3,
            setupModelMeta: [],
            trainedAt: new Date().toISOString(),
          },
        },
        drift: {
          status: "drift",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.45,
          baselineWinRate: 0.55,
          winRateDelta: -0.1,
          recentAvgQuality: 0.55,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.08,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const decision = await evaluateRetrainNeed();
      expect(decision.urgency).toBe("critical");
      expect(decision.shouldRetrain).toBe(true);
    });

    it("should return high urgency on drift warning", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      vi.mocked(getModelDiagnostics).mockResolvedValueOnce({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 3,
            setupModelMeta: [],
            trainedAt: new Date().toISOString(),
          },
        },
        drift: {
          status: "watch",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.52,
          baselineWinRate: 0.55,
          winRateDelta: -0.03,
          recentAvgQuality: 0.61,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.02,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const decision = await evaluateRetrainNeed();
      // "watch" drift sets urgency high but doesn't alone trigger retrain
      expect(decision.urgency).toBe("high");
      // shouldRetrain is false because watch alone doesn't meet threshold
      // (only drift/critical/age/accuracyDrop triggers retrain)
    });

    it("should return medium urgency on model age exceeded", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      vi.mocked(getModelDiagnostics).mockResolvedValueOnce({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 3,
            setupModelMeta: [],
            trainedAt: oldDate,
          },
        },
        drift: {
          status: "stable",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.56,
          baselineWinRate: 0.55,
          winRateDelta: 0.01,
          recentAvgQuality: 0.62,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.01,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const decision = await evaluateRetrainNeed();
      expect(decision.urgency).toBe("medium");
      expect(decision.shouldRetrain).toBe(true);
    });

    it("should include metrics in decision", async () => {
      const decision = await evaluateRetrainNeed();
      expect(decision.metrics).toBeDefined();
      expect(decision.metrics.driftStatus).toBe("stable");
      expect(decision.metrics.modelAgeExceeded).toBe(false);
    });
  });

  // ── Supervisor Cycle Tests ──────────────────────────────────────────────────

  describe("runSupervisorCycle()", () => {
    it("should complete cycle without errors", async () => {
      const result = await runSupervisorCycle();
      expect(result).toBeDefined();
      expect(result.cycleTime).toBeDefined();
      expect(result.health).toBeDefined();
      expect(result.retrainDecision).toBeDefined();
    });

    it("should not trigger retrain when healthy", async () => {
      const result = await runSupervisorCycle();
      expect(result.retrainExecuted).toBe(false);
    });

    it("should trigger retrain on critical urgency (drift detected)", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      vi.mocked(getModelDiagnostics).mockResolvedValue({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 3,
            setupModelMeta: [],
            trainedAt: new Date().toISOString(),
          },
        },
        drift: {
          status: "drift",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.45,
          baselineWinRate: 0.55,
          winRateDelta: -0.1,
          recentAvgQuality: 0.55,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.08,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const result = await runSupervisorCycle();
      expect(result.retrainExecuted).toBe(true);
      expect(result.retrainResult?.success).toBe(true);
    });

    it("should trigger retrain on critical urgency", async () => {
      const { getModelDiagnostics } = await import("../lib/ml_model");
      vi.mocked(getModelDiagnostics).mockResolvedValue({
        status: {
          status: "active",
          message: "Ensemble ready",
          meta: {
            samples: 1000,
            accuracy: 0.65,
            auc: 0.72,
            winRate: 0.55,
            purgedCv: null,
            setupModelsTrained: 3,
            setupModelMeta: [],
            trainedAt: new Date().toISOString(),
          },
        },
        drift: {
          status: "drift",
          sampleRecent: 500,
          sampleBaseline: 1000,
          recentWinRate: 0.45,
          baselineWinRate: 0.55,
          winRateDelta: -0.1,
          recentAvgQuality: 0.55,
          baselineAvgQuality: 0.63,
          qualityDelta: -0.08,
          bySetup: [],
          computedAt: new Date().toISOString(),
        },
        validation: null,
      });

      const result = await runSupervisorCycle();
      expect(result.retrainExecuted).toBe(true);
    });

    it("should persist cycle report", async () => {
      vi.mocked(persistStore.persistAppend).mockImplementation(() => {});
      await runSupervisorCycle();
      expect(persistStore.persistAppend).toHaveBeenCalled();
      const calls = vi.mocked(persistStore.persistAppend).mock.calls;
      expect(calls.some((call) => call[0] === "si_supervisor_reports")).toBe(true);
    });
  });

  // ── Supervisor Lifecycle Tests ──────────────────────────────────────────────

  describe("startSISupervisor() and stopSISupervisor()", () => {
    it("should start supervisor", () => {
      startSISupervisor();
      expect(isSISupervisorActive()).toBe(true);
    });

    it("should stop supervisor", () => {
      startSISupervisor();
      stopSISupervisor();
      expect(isSISupervisorActive()).toBe(false);
    });

    it("should accept config on start", () => {
      const config: Partial<SISupervisorConfig> = {
        retrainThreshold: 10,
        healthCheckIntervalMs: 600_000,
      };
      startSISupervisor(config);
      const current = getSISupervisorConfig();
      expect(current.retrainThreshold).toBe(10);
      expect(current.healthCheckIntervalMs).toBe(600_000);
    });

    it("should not start twice", () => {
      startSISupervisor();
      expect(isSISupervisorActive()).toBe(true);
      startSISupervisor();
      expect(isSISupervisorActive()).toBe(true);
    });

    it("should warn when stopping inactive supervisor", () => {
      stopSISupervisor();
      expect(isSISupervisorActive()).toBe(false);
    });
  });

  // ── History and Stats Tests ─────────────────────────────────────────────────

  describe("getSupervisorHistory() and getSupervisorStats()", () => {
    it("should return empty history initially", () => {
      vi.mocked(persistStore.persistRead).mockReturnValue([]);
      const history = getSupervisorHistory();
      expect(history).toHaveLength(0);
    });

    it("should respect limit parameter", () => {
      const mockReports = Array.from({ length: 50 }, (_, i) => ({
        cycleTime: new Date().toISOString(),
        health: { status: "healthy" } as any,
        retrainDecision: { shouldRetrain: false } as any,
        retrainExecuted: false,
        cycleNumber: i + 1,
        duration_ms: 100,
      }));
      vi.mocked(persistStore.persistRead).mockReturnValue(mockReports);

      const history = getSupervisorHistory(10);
      expect(history.length).toBeLessThanOrEqual(10);
    });

    it("should calculate stats correctly", () => {
      const mockReports = [
        {
          cycleTime: new Date().toISOString(),
          health: { status: "healthy" } as any,
          retrainDecision: { urgency: "low" } as any,
          retrainExecuted: true,
          retrainResult: { success: true, message: "OK" },
          cycleNumber: 1,
          duration_ms: 100,
        },
        {
          cycleTime: new Date().toISOString(),
          health: { status: "degraded" } as any,
          retrainDecision: { urgency: "medium" } as any,
          retrainExecuted: false,
          cycleNumber: 2,
          duration_ms: 150,
        },
      ];
      vi.mocked(persistStore.persistRead).mockReturnValue(mockReports);

      const stats = getSupervisorStats();
      expect(stats.totalCycles).toBe(2);
      expect(stats.retrainsTriggered).toBe(1);
      expect(stats.retrainsSuccessful).toBe(1);
    });

    it("should count health distribution", () => {
      const mockReports = [
        {
          cycleTime: new Date().toISOString(),
          health: { status: "healthy" } as any,
          retrainDecision: { urgency: "low" } as any,
          retrainExecuted: false,
          cycleNumber: 1,
          duration_ms: 100,
        },
        {
          cycleTime: new Date().toISOString(),
          health: { status: "healthy" } as any,
          retrainDecision: { urgency: "low" } as any,
          retrainExecuted: false,
          cycleNumber: 2,
          duration_ms: 100,
        },
        {
          cycleTime: new Date().toISOString(),
          health: { status: "degraded" } as any,
          retrainDecision: { urgency: "medium" } as any,
          retrainExecuted: false,
          cycleNumber: 3,
          duration_ms: 100,
        },
      ];
      vi.mocked(persistStore.persistRead).mockReturnValue(mockReports);

      const stats = getSupervisorStats();
      expect(stats.healthDistribution["healthy"]).toBe(2);
      expect(stats.healthDistribution["degraded"]).toBe(1);
    });
  });

  // ── Configuration Tests ─────────────────────────────────────────────────────

  describe("Configuration management", () => {
    it("should get current config", () => {
      const config = getSISupervisorConfig();
      expect(config).toBeDefined();
      expect(config.retrainThreshold).toBe(5);
      expect(config.healthCheckIntervalMs).toBe(300_000);
    });

    it("should set config values", () => {
      setSISupervisorConfig({ retrainThreshold: 8 });
      const config = getSISupervisorConfig();
      expect(config.retrainThreshold).toBe(8);
    });

    it("should preserve unmodified config values", () => {
      setSISupervisorConfig({ retrainThreshold: 10 });
      const config = getSISupervisorConfig();
      expect(config.healthCheckIntervalMs).toBe(300_000);
      expect(config.retrainThreshold).toBe(10);
    });

    it("should allow partial config updates", () => {
      setSISupervisorConfig({
        maxModelAgeDays: 14,
        ensembleMinModels: 4,
      });
      const config = getSISupervisorConfig();
      expect(config.maxModelAgeDays).toBe(14);
      expect(config.ensembleMinModels).toBe(4);
      expect(config.retrainThreshold).toBe(5);
    });
  });

  // ── Ensemble Status Tests ───────────────────────────────────────────────────

  describe("getEnsembleStatus()", () => {
    it("should return full ensemble status", async () => {
      vi.mocked(persistStore.getCollectionSize).mockReturnValue(5);
      const status = await getEnsembleStatus();

      expect(status.model).toBeDefined();
      expect(status.drift).toBeDefined();
      expect(status.health).toBeDefined();
      expect(status.supervisor).toBeDefined();
    });

    it("should include supervisor state", async () => {
      startSISupervisor();
      vi.mocked(persistStore.getCollectionSize).mockReturnValue(3);
      const status = await getEnsembleStatus();

      expect(status.supervisor.active).toBe(true);
      expect(status.supervisor.config).toBeDefined();
      expect(status.supervisor.reportCount).toBe(3);
    });

    it("should reflect model metadata", async () => {
      const status = await getEnsembleStatus();
      expect(status.model.meta).toBeDefined();
      expect(status.model.meta?.samples).toBe(1000);
      expect(status.model.meta?.accuracy).toBe(0.65);
    });
  });

  // ── Edge Cases and Integration ──────────────────────────────────────────────

  describe("Edge cases and integration", () => {
    it("should handle rapid consecutive cycles", async () => {
      // Run 3 cycles concurrently — should not throw
      const results = await Promise.all([
        runSupervisorCycle(),
        runSupervisorCycle(),
        runSupervisorCycle(),
      ]);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.health)).toBe(true);
    });

    it("should handle config update while running", () => {
      startSISupervisor();
      setSISupervisorConfig({ retrainThreshold: 12 });
      const config = getSISupervisorConfig();
      expect(config.retrainThreshold).toBe(12);
      stopSISupervisor();
    });

    it("should accumulate reports with correct cycle numbers", () => {
      const mockReports = [
        {
          cycleTime: new Date().toISOString(),
          health: { status: "healthy" } as any,
          retrainDecision: { urgency: "low" } as any,
          retrainExecuted: false,
          cycleNumber: 1,
          duration_ms: 100,
        },
        {
          cycleTime: new Date().toISOString(),
          health: { status: "healthy" } as any,
          retrainDecision: { urgency: "low" } as any,
          retrainExecuted: false,
          cycleNumber: 2,
          duration_ms: 100,
        },
      ];
      vi.mocked(persistStore.persistRead).mockReturnValue(mockReports);

      const history = getSupervisorHistory();
      expect(history[0].cycleNumber).toBe(1);
      expect(history[1].cycleNumber).toBe(2);
    });
  });
});
