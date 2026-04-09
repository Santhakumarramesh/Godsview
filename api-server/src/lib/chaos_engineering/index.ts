import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino();

// Type definitions
type ExperimentType =
  | "latency_injection"
  | "service_kill"
  | "data_corruption"
  | "network_partition"
  | "resource_exhaustion"
  | "clock_skew"
  | "dependency_failure"
  | "cascade_failure";

type FaultType = "down" | "slow" | "intermittent" | "corrupt_response";
type DependencyType =
  | "database"
  | "broker"
  | "cache"
  | "market_data"
  | "ai_model"
  | "external_api";
type Criticality = "critical" | "high" | "medium" | "low";

interface SafetyGuards {
  maxImpactPercent: number;
  autoRollback: boolean;
  killSwitchEnabled: boolean;
}

interface ExperimentConfig {
  name: string;
  type: ExperimentType;
  target: string;
  parameters: Record<string, any>;
  durationMs: number;
  safetyGuards: SafetyGuards;
}

interface Experiment {
  id: string;
  config: ExperimentConfig;
  status: "created" | "running" | "stopped" | "completed";
  startTime?: number;
  stopTime?: number;
  affectedComponents?: string[];
  degradationLevel?: number;
  recoveryActions?: string[];
}

interface ResilienceAssessment {
  id: string;
  timestamp: number;
  faultTolerance: number;
  recoverySpeed: number;
  degradationGrace: number;
  dataSafety: number;
  cascadeContainment: number;
  overallScore: number;
}

interface RollbackStep {
  order: number;
  action: string;
  verifyCommand: string;
  timeoutMs: number;
}

interface RollbackPlan {
  id: string;
  name: string;
  component: string;
  steps: RollbackStep[];
  triggerConditions: string[];
}

interface RollbackExecution {
  id: string;
  planId: string;
  startTime: number;
  endTime?: number;
  status: "running" | "success" | "failure";
  stepResults: Array<{
    order: number;
    action: string;
    success: boolean;
    duration: number;
  }>;
}

interface Dependency {
  id: string;
  name: string;
  type: DependencyType;
  healthEndpoint?: string;
  criticality: Criticality;
  status: "healthy" | "degraded" | "down";
}

interface SimulatedFault {
  id: string;
  dependencyId: string;
  faultType: FaultType;
  affectedDownstream: string[];
  fallbackActivated: boolean;
  degradationMode: string;
  timestamp: number;
}

// ChaosOrchestrator
class ChaosOrchestrator {
  private experiments: Map<string, Experiment> = new Map();

  createExperiment(config: ExperimentConfig): { id: string; status: string } {
    const id = `chaos_${randomUUID()}`;
    this.experiments.set(id, {
      id,
      config,
      status: "created",
    });
    logger.info({ experimentId: id }, "Experiment created");
    return { id, status: "created" };
  }

  runExperiment(experimentId: string): {
    status: string;
    startTime: number;
    affectedComponents: string[];
    degradationLevel: number;
    recoveryActions: string[];
  } {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    experiment.status = "running";
    experiment.startTime = Date.now();

    // Simulate chaos scenario based on type
    const affectedComponents = this.simulateAffectedComponents(
      experiment.config.type,
      experiment.config.target
    );
    const degradationLevel = this.calculateDegradation(
      experiment.config.type,
      experiment.config.parameters
    );
    const recoveryActions = this.generateRecoveryActions(
      experiment.config.type
    );

    experiment.affectedComponents = affectedComponents;
    experiment.degradationLevel = degradationLevel;
    experiment.recoveryActions = recoveryActions;

    // Simulate the experiment duration
    setTimeout(() => {
      experiment.status = "completed";
      experiment.stopTime = Date.now();
    }, experiment.config.durationMs);

    logger.info(
      { experimentId, affectedComponents, degradationLevel },
      "Experiment running"
    );

    return {
      status: "running",
      startTime: experiment.startTime,
      affectedComponents,
      degradationLevel,
      recoveryActions,
    };
  }

  stopExperiment(experimentId: string): { status: string; stopTime: number } {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    experiment.status = "stopped";
    experiment.stopTime = Date.now();
    logger.info({ experimentId }, "Experiment stopped");

    return { status: "stopped", stopTime: experiment.stopTime };
  }

  getExperiment(experimentId: string): Experiment {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }
    return experiment;
  }

  listExperiments(filters?: {
    type?: ExperimentType;
    status?: string;
    since?: number;
  }): Experiment[] {
    let results = Array.from(this.experiments.values());

    if (filters?.type) {
      results = results.filter((e) => e.config.type === filters.type);
    }
    if (filters?.status) {
      results = results.filter((e) => e.status === filters.status);
    }
    if (filters?.since) {
      results = results.filter((e) => (e.startTime || 0) >= filters.since);
    }

    return results;
  }

  getExperimentReport(experimentId: string): {
    id: string;
    timeline: { event: string; timestamp: number }[];
    impact: { component: string; degradation: number }[];
    recovery: string[];
    recommendations: string[];
  } {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    const timeline = [
      {
        event: "created",
        timestamp: experiment.startTime || Date.now(),
      },
      {
        event: experiment.status,
        timestamp: experiment.stopTime || Date.now(),
      },
    ];

    const impact = (experiment.affectedComponents || []).map((c) => ({
      component: c,
      degradation: experiment.degradationLevel || 0,
    }));

    const recommendations = this.generateRecommendations(experiment.config);

    return {
      id: experimentId,
      timeline,
      impact,
      recovery: experiment.recoveryActions || [],
      recommendations,
    };
  }

  private simulateAffectedComponents(
    type: ExperimentType,
    target: string
  ): string[] {
    const componentMap: Record<ExperimentType, string[]> = {
      latency_injection: [`${target}-api`, `${target}-db`],
      service_kill: [`${target}-service`],
      data_corruption: [`${target}-cache`, `${target}-db`],
      network_partition: [`${target}-upstream`, `${target}-downstream`],
      resource_exhaustion: [`${target}-worker-pool`],
      clock_skew: [`${target}-sync-service`],
      dependency_failure: [`${target}-dependency`],
      cascade_failure: [`${target}-chain1`, `${target}-chain2`],
    };
    return componentMap[type] || [target];
  }

  private calculateDegradation(
    type: ExperimentType,
    params: Record<string, any>
  ): number {
    const baseMap: Record<ExperimentType, number> = {
      latency_injection: 35,
      service_kill: 100,
      data_corruption: 50,
      network_partition: 80,
      resource_exhaustion: 70,
      clock_skew: 40,
      dependency_failure: 60,
      cascade_failure: 90,
    };
    return baseMap[type] || 50;
  }

  private generateRecoveryActions(type: ExperimentType): string[] {
    const actionMap: Record<ExperimentType, string[]> = {
      latency_injection: ["scale-up-instances", "optimize-queries"],
      service_kill: ["restart-service", "failover-to-backup"],
      data_corruption: ["rollback-data", "repair-integrity"],
      network_partition: ["restore-connectivity", "sync-data"],
      resource_exhaustion: ["clear-cache", "scale-workers"],
      clock_skew: ["resync-clocks", "verify-timestamps"],
      dependency_failure: ["switch-provider", "activate-fallback"],
      cascade_failure: ["stop-propagation", "restore-sequentially"],
    };
    return actionMap[type] || [];
  }

  private generateRecommendations(config: ExperimentConfig): string[] {
    const recs = [
      "Review component dependencies",
      "Enhance monitoring and alerting",
      "Implement circuit breakers",
    ];
    if (config.safetyGuards.autoRollback) {
      recs.push("Test rollback automation regularly");
    }
    return recs;
  }

  _clearChaosOrchestrator(): void {
    this.experiments.clear();
    logger.info("ChaosOrchestrator cleared");
  }
}

// ResilienceScorer
class ResilienceScorer {
  private assessments: Map<string, ResilienceAssessment> = new Map();

  runResilienceAssessment(): { id: string } {
    const id = `assess_${randomUUID()}`;
    const assessment: ResilienceAssessment = {
      id,
      timestamp: Date.now(),
      faultTolerance: this.randomScore(),
      recoverySpeed: this.randomScore(),
      degradationGrace: this.randomScore(),
      dataSafety: this.randomScore(),
      cascadeContainment: this.randomScore(),
      overallScore: 0,
    };

    assessment.overallScore =
      (assessment.faultTolerance +
        assessment.recoverySpeed +
        assessment.degradationGrace +
        assessment.dataSafety +
        assessment.cascadeContainment) /
      5;

    this.assessments.set(id, assessment);
    logger.info({ assessmentId: id, score: assessment.overallScore }, "Assessment completed");

    return { id };
  }

  getAssessment(assessmentId: string): ResilienceAssessment {
    const assessment = this.assessments.get(assessmentId);
    if (!assessment) {
      throw new Error(`Assessment ${assessmentId} not found`);
    }
    return assessment;
  }

  getAssessmentHistory(): ResilienceAssessment[] {
    return Array.from(this.assessments.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  compareAssessments(
    id1: string,
    id2: string
  ): Record<string, { before: number; after: number; delta: number }> {
    const a1 = this.getAssessment(id1);
    const a2 = this.getAssessment(id2);

    return {
      faultTolerance: {
        before: a1.faultTolerance,
        after: a2.faultTolerance,
        delta: a2.faultTolerance - a1.faultTolerance,
      },
      recoverySpeed: {
        before: a1.recoverySpeed,
        after: a2.recoverySpeed,
        delta: a2.recoverySpeed - a1.recoverySpeed,
      },
      degradationGrace: {
        before: a1.degradationGrace,
        after: a2.degradationGrace,
        delta: a2.degradationGrace - a1.degradationGrace,
      },
      dataSafety: {
        before: a1.dataSafety,
        after: a2.dataSafety,
        delta: a2.dataSafety - a1.dataSafety,
      },
      cascadeContainment: {
        before: a1.cascadeContainment,
        after: a2.cascadeContainment,
        delta: a2.cascadeContainment - a1.cascadeContainment,
      },
      overallScore: {
        before: a1.overallScore,
        after: a2.overallScore,
        delta: a2.overallScore - a1.overallScore,
      },
    };
  }

  private randomScore(): number {
    return Math.round(Math.random() * 100);
  }

  _clearResilienceScorer(): void {
    this.assessments.clear();
    logger.info("ResilienceScorer cleared");
  }
}

// RollbackEngine
class RollbackEngine {
  private plans: Map<string, RollbackPlan> = new Map();
  private executions: Map<string, RollbackExecution> = new Map();

  createRollbackPlan(config: {
    name: string;
    component: string;
    steps: RollbackStep[];
    triggerConditions: string[];
  }): { id: string } {
    const id = `rb_${randomUUID()}`;
    this.plans.set(id, {
      id,
      name: config.name,
      component: config.component,
      steps: config.steps,
      triggerConditions: config.triggerConditions,
    });
    logger.info({ planId: id }, "Rollback plan created");
    return { id };
  }

  executeRollback(planId: string): { id: string; status: string } {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Rollback plan ${planId} not found`);
    }

    const execId = `exec_${randomUUID()}`;
    const execution: RollbackExecution = {
      id: execId,
      planId,
      startTime: Date.now(),
      status: "running",
      stepResults: [],
    };

    // Simulate step-by-step execution
    plan.steps.forEach((step) => {
      const success = Math.random() > 0.1; // 90% success rate
      execution.stepResults.push({
        order: step.order,
        action: step.action,
        success,
        duration: Math.random() * step.timeoutMs,
      });
    });

    execution.status =
      execution.stepResults.every((r) => r.success) ? "success" : "failure";
    execution.endTime = Date.now();

    this.executions.set(execId, execution);
    logger.info(
      { executionId: execId, status: execution.status },
      "Rollback executed"
    );

    return { id: execId, status: execution.status };
  }

  getRollbackPlan(planId: string): RollbackPlan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Rollback plan ${planId} not found`);
    }
    return plan;
  }

  listRollbackPlans(): RollbackPlan[] {
    return Array.from(this.plans.values());
  }

  getRollbackHistory(): RollbackExecution[] {
    return Array.from(this.executions.values()).sort(
      (a, b) => b.startTime - a.startTime
    );
  }

  validateRollbackPlan(planId: string): {
    valid: boolean;
    hasSteps: boolean;
    hasVerify: boolean;
    hasTriggers: boolean;
    hasTimeout: boolean;
  } {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Rollback plan ${planId} not found`);
    }

    const hasSteps = plan.steps.length > 0;
    const hasVerify = plan.steps.every((s) => s.verifyCommand.length > 0);
    const hasTriggers = plan.triggerConditions.length > 0;
    const hasTimeout = plan.steps.every((s) => s.timeoutMs > 0);

    return {
      valid: hasSteps && hasVerify && hasTriggers && hasTimeout,
      hasSteps,
      hasVerify,
      hasTriggers,
      hasTimeout,
    };
  }

  _clearRollbackEngine(): void {
    this.plans.clear();
    this.executions.clear();
    logger.info("RollbackEngine cleared");
  }
}

// DependencyFaultSimulator
class DependencyFaultSimulator {
  private dependencies: Map<string, Dependency> = new Map();
  private faults: Map<string, SimulatedFault> = new Map();

  registerDependency(config: {
    name: string;
    type: DependencyType;
    healthEndpoint?: string;
    criticality: Criticality;
  }): { id: string } {
    const id = `dep_${randomUUID()}`;
    this.dependencies.set(id, {
      id,
      name: config.name,
      type: config.type,
      healthEndpoint: config.healthEndpoint,
      criticality: config.criticality,
      status: "healthy",
    });
    logger.info({ dependencyId: id }, "Dependency registered");
    return { id };
  }

  simulateFault(
    depId: string,
    faultType: FaultType
  ): {
    id: string;
    affectedDownstream: string[];
    fallbackActivated: boolean;
    degradationMode: string;
  } {
    const dep = this.dependencies.get(depId);
    if (!dep) {
      throw new Error(`Dependency ${depId} not found`);
    }

    const faultId = `fault_${randomUUID()}`;
    const affectedDownstream = this.getDownstreamComponents(depId);
    const fallbackActivated = faultType !== "down";
    const degradationMode = `${faultType}_mode`;

    this.faults.set(faultId, {
      id: faultId,
      dependencyId: depId,
      faultType,
      affectedDownstream,
      fallbackActivated,
      degradationMode,
      timestamp: Date.now(),
    });

    // Update dependency status
    dep.status =
      faultType === "down"
        ? "down"
        : faultType === "slow"
          ? "degraded"
          : "degraded";

    logger.info(
      { faultId, dependencyId: depId, faultType },
      "Fault simulated"
    );

    return {
      id: faultId,
      affectedDownstream,
      fallbackActivated,
      degradationMode,
    };
  }

  getDependencyMap(): Dependency[] {
    return Array.from(this.dependencies.values());
  }

  getFaultHistory(): SimulatedFault[] {
    return Array.from(this.faults.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  getImpactAnalysis(depId: string): {
    dependency: string;
    criticality: string;
    affectedDownstream: string[];
    cascadeRisk: string;
  } {
    const dep = this.dependencies.get(depId);
    if (!dep) {
      throw new Error(`Dependency ${depId} not found`);
    }

    const affectedDownstream = this.getDownstreamComponents(depId);
    const cascadeRisk =
      dep.criticality === "critical"
        ? "high"
        : dep.criticality === "high"
          ? "medium"
          : "low";

    return {
      dependency: dep.name,
      criticality: dep.criticality,
      affectedDownstream,
      cascadeRisk,
    };
  }

  private getDownstreamComponents(depId: string): string[] {
    const dep = this.dependencies.get(depId);
    if (!dep) return [];

    const downstream: Record<DependencyType, string[]> = {
      database: ["api-server", "worker-service", "reporting-engine"],
      broker: ["notification-service", "order-processor"],
      cache: ["api-server", "dashboard"],
      market_data: ["pricing-engine", "portfolio-service"],
      ai_model: ["recommendation-service"],
      external_api: ["integration-service"],
    };

    return downstream[dep.type] || [];
  }

  _clearDependencyFaultSimulator(): void {
    this.dependencies.clear();
    this.faults.clear();
    logger.info("DependencyFaultSimulator cleared");
  }
}

// Export singletons
export const chaosOrchestrator = new ChaosOrchestrator();
export const resilienceScorer = new ResilienceScorer();
export const rollbackEngine = new RollbackEngine();
export const dependencyFaultSimulator = new DependencyFaultSimulator();

export {
  ChaosOrchestrator,
  ResilienceScorer,
  RollbackEngine,
  DependencyFaultSimulator,
};
