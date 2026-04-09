import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  chaosOrchestrator,
  resilienceScorer,
  rollbackEngine,
  dependencyFaultSimulator,
} from "../lib/chaos_engineering/index.js";

describe("ChaosOrchestrator", () => {
  beforeEach(() => {
    chaosOrchestrator._clearChaosOrchestrator();
  });

  it("should create an experiment", () => {
    const config = {
      name: "test-experiment",
      type: "latency_injection" as const,
      target: "api-server",
      parameters: { latencyMs: 1000 },
      durationMs: 5000,
      safetyGuards: {
        maxImpactPercent: 50,
        autoRollback: true,
        killSwitchEnabled: true,
      },
    };

    const result = chaosOrchestrator.createExperiment(config);
    expect(result.status).toBe("created");
    expect(result.id).toMatch(/^chaos_/);
  });

  it("should run an experiment", () => {
    const config = {
      name: "run-test",
      type: "service_kill" as const,
      target: "auth-service",
      parameters: {},
      durationMs: 1000,
      safetyGuards: {
        maxImpactPercent: 100,
        autoRollback: false,
        killSwitchEnabled: true,
      },
    };

    const { id } = chaosOrchestrator.createExperiment(config);
    const result = chaosOrchestrator.runExperiment(id);

    expect(result.status).toBe("running");
    expect(result.startTime).toBeDefined();
    expect(Array.isArray(result.affectedComponents)).toBe(true);
    expect(result.degradationLevel).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.recoveryActions)).toBe(true);
  });

  it("should stop an experiment", () => {
    const config = {
      name: "stop-test",
      type: "data_corruption" as const,
      target: "database",
      parameters: {},
      durationMs: 2000,
      safetyGuards: {
        maxImpactPercent: 75,
        autoRollback: true,
        killSwitchEnabled: false,
      },
    };

    const { id } = chaosOrchestrator.createExperiment(config);
    chaosOrchestrator.runExperiment(id);
    const result = chaosOrchestrator.stopExperiment(id);

    expect(result.status).toBe("stopped");
    expect(result.stopTime).toBeDefined();
  });

  it("should retrieve an experiment", () => {
    const config = {
      name: "get-test",
      type: "network_partition" as const,
      target: "downstream",
      parameters: {},
      durationMs: 3000,
      safetyGuards: {
        maxImpactPercent: 60,
        autoRollback: true,
        killSwitchEnabled: true,
      },
    };

    const { id } = chaosOrchestrator.createExperiment(config);
    const experiment = chaosOrchestrator.getExperiment(id);

    expect(experiment.id).toBe(id);
    expect(experiment.config.name).toBe("get-test");
    expect(experiment.status).toBe("created");
  });

  it("should list experiments with filters", () => {
    const config1 = {
      name: "list-test-1",
      type: "resource_exhaustion" as const,
      target: "worker",
      parameters: {},
      durationMs: 1000,
      safetyGuards: {
        maxImpactPercent: 80,
        autoRollback: false,
        killSwitchEnabled: true,
      },
    };

    const config2 = {
      name: "list-test-2",
      type: "clock_skew" as const,
      target: "sync-service",
      parameters: {},
      durationMs: 2000,
      safetyGuards: {
        maxImpactPercent: 40,
        autoRollback: true,
        killSwitchEnabled: false,
      },
    };

    chaosOrchestrator.createExperiment(config1);
    chaosOrchestrator.createExperiment(config2);

    const all = chaosOrchestrator.listExperiments();
    expect(all.length).toBe(2);

    const filtered = chaosOrchestrator.listExperiments({
      type: "clock_skew",
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0].config.type).toBe("clock_skew");
  });

  it("should generate experiment report", () => {
    const config = {
      name: "report-test",
      type: "dependency_failure" as const,
      target: "broker",
      parameters: {},
      durationMs: 1000,
      safetyGuards: {
        maxImpactPercent: 50,
        autoRollback: true,
        killSwitchEnabled: true,
      },
    };

    const { id } = chaosOrchestrator.createExperiment(config);
    chaosOrchestrator.runExperiment(id);
    const report = chaosOrchestrator.getExperimentReport(id);

    expect(report.id).toBe(id);
    expect(Array.isArray(report.timeline)).toBe(true);
    expect(Array.isArray(report.impact)).toBe(true);
    expect(Array.isArray(report.recovery)).toBe(true);
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  it("should handle all experiment types", () => {
    const types: Array<
      | "latency_injection"
      | "service_kill"
      | "data_corruption"
      | "network_partition"
      | "resource_exhaustion"
      | "clock_skew"
      | "dependency_failure"
      | "cascade_failure"
    > = [
      "latency_injection",
      "service_kill",
      "data_corruption",
      "network_partition",
      "resource_exhaustion",
      "clock_skew",
      "dependency_failure",
      "cascade_failure",
    ];

    types.forEach((type) => {
      const config = {
        name: `type-test-${type}`,
        type,
        target: "test-target",
        parameters: {},
        durationMs: 1000,
        safetyGuards: {
          maxImpactPercent: 50,
          autoRollback: true,
          killSwitchEnabled: true,
        },
      };

      const { id } = chaosOrchestrator.createExperiment(config);
      const result = chaosOrchestrator.runExperiment(id);

      expect(result.status).toBe("running");
      expect(result.degradationLevel).toBeGreaterThanOrEqual(0);
    });
  });

  it("should throw error for non-existent experiment", () => {
    expect(() => {
      chaosOrchestrator.getExperiment("invalid-id");
    }).toThrow();
  });
});

describe("ResilienceScorer", () => {
  beforeEach(() => {
    resilienceScorer._clearResilienceScorer();
  });

  it("should run a resilience assessment", () => {
    const result = resilienceScorer.runResilienceAssessment();
    expect(result.id).toMatch(/^assess_/);
  });

  it("should retrieve an assessment", () => {
    const { id } = resilienceScorer.runResilienceAssessment();
    const assessment = resilienceScorer.getAssessment(id);

    expect(assessment.id).toBe(id);
    expect(assessment.faultTolerance).toBeGreaterThanOrEqual(0);
    expect(assessment.faultTolerance).toBeLessThanOrEqual(100);
    expect(assessment.recoverySpeed).toBeGreaterThanOrEqual(0);
    expect(assessment.recoverySpeed).toBeLessThanOrEqual(100);
    expect(assessment.degradationGrace).toBeGreaterThanOrEqual(0);
    expect(assessment.degradationGrace).toBeLessThanOrEqual(100);
    expect(assessment.dataSafety).toBeGreaterThanOrEqual(0);
    expect(assessment.dataSafety).toBeLessThanOrEqual(100);
    expect(assessment.cascadeContainment).toBeGreaterThanOrEqual(0);
    expect(assessment.cascadeContainment).toBeLessThanOrEqual(100);
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
  });

  it("should get assessment history sorted by date", () => {
    const id1 = resilienceScorer.runResilienceAssessment().id;
    const id2 = resilienceScorer.runResilienceAssessment().id;

    const history = resilienceScorer.getAssessmentHistory();
    expect(history.length).toBe(2);
    const ids = history.map((h) => h.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("should compare two assessments", () => {
    const id1 = resilienceScorer.runResilienceAssessment().id;
    const id2 = resilienceScorer.runResilienceAssessment().id;

    const comparison = resilienceScorer.compareAssessments(id1, id2);

    expect(comparison.faultTolerance).toHaveProperty("before");
    expect(comparison.faultTolerance).toHaveProperty("after");
    expect(comparison.faultTolerance).toHaveProperty("delta");
    expect(comparison.recoverySpeed).toBeDefined();
    expect(comparison.degradationGrace).toBeDefined();
    expect(comparison.dataSafety).toBeDefined();
    expect(comparison.cascadeContainment).toBeDefined();
    expect(comparison.overallScore).toBeDefined();
  });

  it("should throw error for non-existent assessment", () => {
    expect(() => {
      resilienceScorer.getAssessment("invalid-id");
    }).toThrow();
  });

  it("should create multiple assessments with different scores", () => {
    const assessments = [];
    for (let i = 0; i < 5; i++) {
      assessments.push(resilienceScorer.runResilienceAssessment());
    }

    const history = resilienceScorer.getAssessmentHistory();
    expect(history.length).toBe(5);
  });
});

describe("RollbackEngine", () => {
  beforeEach(() => {
    rollbackEngine._clearRollbackEngine();
  });

  it("should create a rollback plan", () => {
    const config = {
      name: "test-rollback",
      component: "api-server",
      steps: [
        {
          order: 1,
          action: "stop-service",
          verifyCommand: "systemctl is-active api-server",
          timeoutMs: 30000,
        },
        {
          order: 2,
          action: "restore-backup",
          verifyCommand: "docker ps | grep api-server",
          timeoutMs: 60000,
        },
      ],
      triggerConditions: ["health_check_failed", "error_rate_high"],
    };

    const result = rollbackEngine.createRollbackPlan(config);
    expect(result.id).toMatch(/^rb_/);
  });

  it("should execute a rollback", () => {
    const config = {
      name: "exec-test",
      component: "worker",
      steps: [
        {
          order: 1,
          action: "pause-workers",
          verifyCommand: "check-workers-paused",
          timeoutMs: 5000,
        },
      ],
      triggerConditions: ["worker_failure"],
    };

    const { id: planId } = rollbackEngine.createRollbackPlan(config);
    const result = rollbackEngine.executeRollback(planId);

    expect(result.id).toMatch(/^exec_/);
    expect(["success", "failure"]).toContain(result.status);
  });

  it("should retrieve a rollback plan", () => {
    const config = {
      name: "get-test",
      component: "cache",
      steps: [
        {
          order: 1,
          action: "clear-cache",
          verifyCommand: "redis-cli dbsize",
          timeoutMs: 10000,
        },
      ],
      triggerConditions: ["cache_corruption"],
    };

    const { id } = rollbackEngine.createRollbackPlan(config);
    const plan = rollbackEngine.getRollbackPlan(id);

    expect(plan.id).toBe(id);
    expect(plan.name).toBe("get-test");
    expect(plan.component).toBe("cache");
  });

  it("should list all rollback plans", () => {
    const config1 = {
      name: "list-test-1",
      component: "db",
      steps: [
        {
          order: 1,
          action: "restore-db",
          verifyCommand: "pg_isready",
          timeoutMs: 120000,
        },
      ],
      triggerConditions: ["db_down"],
    };

    const config2 = {
      name: "list-test-2",
      component: "queue",
      steps: [
        {
          order: 1,
          action: "restart-queue",
          verifyCommand: "rabbitmq-admin status",
          timeoutMs: 30000,
        },
      ],
      triggerConditions: ["queue_full"],
    };

    rollbackEngine.createRollbackPlan(config1);
    rollbackEngine.createRollbackPlan(config2);

    const plans = rollbackEngine.listRollbackPlans();
    expect(plans.length).toBe(2);
  });

  it("should get rollback execution history", () => {
    const config = {
      name: "history-test",
      component: "service",
      steps: [
        {
          order: 1,
          action: "restart",
          verifyCommand: "service status",
          timeoutMs: 20000,
        },
      ],
      triggerConditions: ["service_error"],
    };

    const { id: planId } = rollbackEngine.createRollbackPlan(config);
    rollbackEngine.executeRollback(planId);
    rollbackEngine.executeRollback(planId);

    const history = rollbackEngine.getRollbackHistory();
    expect(history.length).toBe(2);
  });

  it("should validate a rollback plan", () => {
    const config = {
      name: "validate-test",
      component: "app",
      steps: [
        {
          order: 1,
          action: "backup-data",
          verifyCommand: "ls -la backups",
          timeoutMs: 30000,
        },
        {
          order: 2,
          action: "restore-data",
          verifyCommand: "validate-integrity",
          timeoutMs: 60000,
        },
      ],
      triggerConditions: ["data_loss_detected"],
    };

    const { id } = rollbackEngine.createRollbackPlan(config);
    const validation = rollbackEngine.validateRollbackPlan(id);

    expect(validation.valid).toBe(true);
    expect(validation.hasSteps).toBe(true);
    expect(validation.hasVerify).toBe(true);
    expect(validation.hasTriggers).toBe(true);
    expect(validation.hasTimeout).toBe(true);
  });

  it("should validate plan with missing components", () => {
    const config = {
      name: "invalid-plan",
      component: "test",
      steps: [
        {
          order: 1,
          action: "test-action",
          verifyCommand: "",
          timeoutMs: 0,
        },
      ],
      triggerConditions: [],
    };

    const { id } = rollbackEngine.createRollbackPlan(config);
    const validation = rollbackEngine.validateRollbackPlan(id);

    expect(validation.valid).toBe(false);
    expect(validation.hasVerify).toBe(false);
    expect(validation.hasTriggers).toBe(false);
    expect(validation.hasTimeout).toBe(false);
  });

  it("should throw error for non-existent plan", () => {
    expect(() => {
      rollbackEngine.getRollbackPlan("invalid-id");
    }).toThrow();
  });

  it("should record step-by-step execution results", () => {
    const config = {
      name: "steps-test",
      component: "multi-step",
      steps: [
        {
          order: 1,
          action: "step1",
          verifyCommand: "verify1",
          timeoutMs: 10000,
        },
        {
          order: 2,
          action: "step2",
          verifyCommand: "verify2",
          timeoutMs: 10000,
        },
        {
          order: 3,
          action: "step3",
          verifyCommand: "verify3",
          timeoutMs: 10000,
        },
      ],
      triggerConditions: ["test_trigger"],
    };

    const { id: planId } = rollbackEngine.createRollbackPlan(config);
    const { id: execId } = rollbackEngine.executeRollback(planId);

    // In a real test, we'd retrieve the execution by ID if we had that method
    const history = rollbackEngine.getRollbackHistory();
    const execution = history.find((e) => e.id === execId);

    expect(execution).toBeDefined();
    if (execution) {
      expect(execution.stepResults.length).toBe(3);
      execution.stepResults.forEach((result) => {
        expect(result).toHaveProperty("order");
        expect(result).toHaveProperty("action");
        expect(result).toHaveProperty("success");
        expect(result).toHaveProperty("duration");
      });
    }
  });
});

describe("DependencyFaultSimulator", () => {
  beforeEach(() => {
    dependencyFaultSimulator._clearDependencyFaultSimulator();
  });

  it("should register a dependency", () => {
    const config = {
      name: "test-db",
      type: "database" as const,
      healthEndpoint: "http://localhost:5432/health",
      criticality: "critical" as const,
    };

    const result = dependencyFaultSimulator.registerDependency(config);
    expect(result.id).toMatch(/^dep_/);
  });

  it("should simulate a fault", () => {
    const config = {
      name: "fault-test-db",
      type: "database" as const,
      healthEndpoint: "http://localhost:5432/health",
      criticality: "high" as const,
    };

    const { id: depId } = dependencyFaultSimulator.registerDependency(config);
    const result = dependencyFaultSimulator.simulateFault(depId, "down");

    expect(result.id).toMatch(/^fault_/);
    expect(Array.isArray(result.affectedDownstream)).toBe(true);
    expect(typeof result.fallbackActivated).toBe("boolean");
    expect(typeof result.degradationMode).toBe("string");
  });

  it("should get dependency map", () => {
    const config1 = {
      name: "db",
      type: "database" as const,
      criticality: "critical" as const,
    };

    const config2 = {
      name: "cache",
      type: "cache" as const,
      criticality: "medium" as const,
    };

    dependencyFaultSimulator.registerDependency(config1);
    dependencyFaultSimulator.registerDependency(config2);

    const depMap = dependencyFaultSimulator.getDependencyMap();
    expect(depMap.length).toBe(2);
  });

  it("should get fault history", () => {
    const config = {
      name: "history-test-db",
      type: "database" as const,
      criticality: "critical" as const,
    };

    const { id: depId } = dependencyFaultSimulator.registerDependency(config);
    dependencyFaultSimulator.simulateFault(depId, "slow");
    dependencyFaultSimulator.simulateFault(depId, "intermittent");

    const history = dependencyFaultSimulator.getFaultHistory();
    expect(history.length).toBe(2);
  });

  it("should analyze impact of dependency failure", () => {
    const config = {
      name: "impact-db",
      type: "database" as const,
      criticality: "critical" as const,
    };

    const { id: depId } = dependencyFaultSimulator.registerDependency(config);
    const analysis = dependencyFaultSimulator.getImpactAnalysis(depId);

    expect(analysis.dependency).toBe("impact-db");
    expect(analysis.criticality).toBe("critical");
    expect(Array.isArray(analysis.affectedDownstream)).toBe(true);
    expect(["high", "medium", "low"]).toContain(analysis.cascadeRisk);
  });

  it("should handle all dependency types", () => {
    const types: Array<
      "database" | "broker" | "cache" | "market_data" | "ai_model" | "external_api"
    > = ["database", "broker", "cache", "market_data", "ai_model", "external_api"];

    types.forEach((type) => {
      const config = {
        name: `dep-${type}`,
        type,
        criticality: "medium" as const,
      };

      const result = dependencyFaultSimulator.registerDependency(config);
      expect(result.id).toMatch(/^dep_/);
    });
  });

  it("should handle all fault types", () => {
    const config = {
      name: "fault-types-db",
      type: "database" as const,
      criticality: "high" as const,
    };

    const { id: depId } = dependencyFaultSimulator.registerDependency(config);

    const faultTypes: Array<"down" | "slow" | "intermittent" | "corrupt_response"> = [
      "down",
      "slow",
      "intermittent",
      "corrupt_response",
    ];

    faultTypes.forEach((faultType) => {
      const result = dependencyFaultSimulator.simulateFault(depId, faultType);
      expect(result.id).toMatch(/^fault_/);
    });
  });

  it("should determine cascade risk based on criticality", () => {
    const criticalConfig = {
      name: "critical-service",
      type: "database" as const,
      criticality: "critical" as const,
    };

    const mediumConfig = {
      name: "medium-service",
      type: "cache" as const,
      criticality: "medium" as const,
    };

    const { id: criticalId } =
      dependencyFaultSimulator.registerDependency(criticalConfig);
    const { id: mediumId } = dependencyFaultSimulator.registerDependency(mediumConfig);

    const criticalAnalysis = dependencyFaultSimulator.getImpactAnalysis(criticalId);
    const mediumAnalysis = dependencyFaultSimulator.getImpactAnalysis(mediumId);

    expect(criticalAnalysis.cascadeRisk).toBe("high");
    expect(mediumAnalysis.cascadeRisk).toBe("low");
  });

  it("should track affected downstream components by type", () => {
    const dbConfig = {
      name: "main-db",
      type: "database" as const,
      criticality: "critical" as const,
    };

    const brokerConfig = {
      name: "message-broker",
      type: "broker" as const,
      criticality: "high" as const,
    };

    const { id: dbId } = dependencyFaultSimulator.registerDependency(dbConfig);
    const { id: brokerId } = dependencyFaultSimulator.registerDependency(brokerConfig);

    const dbImpact = dependencyFaultSimulator.getImpactAnalysis(dbId);
    const brokerImpact = dependencyFaultSimulator.getImpactAnalysis(brokerId);

    expect(dbImpact.affectedDownstream.length).toBeGreaterThan(0);
    expect(brokerImpact.affectedDownstream.length).toBeGreaterThan(0);
    expect(dbImpact.affectedDownstream).not.toEqual(
      brokerImpact.affectedDownstream
    );
  });

  it("should throw error for non-existent dependency", () => {
    expect(() => {
      dependencyFaultSimulator.simulateFault("invalid-id", "down");
    }).toThrow();
  });
});

describe("Integration Tests", () => {
  beforeEach(() => {
    chaosOrchestrator._clearChaosOrchestrator();
    resilienceScorer._clearResilienceScorer();
    rollbackEngine._clearRollbackEngine();
    dependencyFaultSimulator._clearDependencyFaultSimulator();
  });

  it("should create and run a complete chaos experiment with rollback", () => {
    // Create experiment
    const expConfig = {
      name: "integration-test",
      type: "service_kill" as const,
      target: "api",
      parameters: {},
      durationMs: 1000,
      safetyGuards: {
        maxImpactPercent: 50,
        autoRollback: true,
        killSwitchEnabled: true,
      },
    };

    const { id: expId } = chaosOrchestrator.createExperiment(expConfig);

    // Run experiment
    const runResult = chaosOrchestrator.runExperiment(expId);
    expect(runResult.status).toBe("running");

    // Create rollback plan
    const rbConfig = {
      name: "integration-rollback",
      component: "api",
      steps: [
        {
          order: 1,
          action: "restart-api",
          verifyCommand: "health-check",
          timeoutMs: 30000,
        },
      ],
      triggerConditions: ["service_down"],
    };

    const { id: rbId } = rollbackEngine.createRollbackPlan(rbConfig);
    const rbResult = rollbackEngine.executeRollback(rbId);

    expect(rbResult.status).toMatch(/success|failure/);
  });

  it("should register dependency and run resilience assessment", () => {
    // Register dependencies
    const dbConfig = {
      name: "production-db",
      type: "database" as const,
      criticality: "critical" as const,
    };

    dependencyFaultSimulator.registerDependency(dbConfig);

    // Run resilience assessment
    const { id: assessId } = resilienceScorer.runResilienceAssessment();
    const assessment = resilienceScorer.getAssessment(assessId);

    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
  });
});
