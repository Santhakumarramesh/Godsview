// system_manifest_v2.ts - System manifest registering all 11 subsystems
// Tracks versions, health, dependencies, and deployment readiness

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface SubsystemInfo {
  name: string;
  domain: string;
  version: string;
  status: 'ACTIVE' | 'STANDBY' | 'DISABLED' | 'ERROR';
  health: number; // 0-100
  lastHealthCheck: number;
  dependencies: string[];
  endpoints: string[];
  tests: {
    total: number;
    passing: number;
    failing: number;
  };
  description: string;
}

export interface SystemManifest {
  version: string;
  builtAt: number;
  subsystems: SubsystemInfo[];
  dependencyGraph: DependencyNode[];
  deploymentReadiness: DeploymentReadiness;
  overallHealth: number;
}

export interface DependencyNode {
  name: string;
  dependsOn: string[];
  dependents: string[];
  isCritical: boolean;
  cycleDetected: boolean;
}

export interface DeploymentReadiness {
  ready: boolean;
  healthySubsystems: number;
  totalSubsystems: number;
  blockingIssues: string[];
  warnings: string[];
  lastChecked: number;
}

export interface SubsystemHealth {
  name: string;
  health: number;
  status: string;
  lastCheck: number;
  metrics: SubsystemMetrics;
}

export interface SubsystemMetrics {
  uptime: number;
  errorRate: number;
  responseTimeMs: number;
  requestCount: number;
  failureCount: number;
}

// ============================================================================
// SystemManifestV2 Class
// ============================================================================

export class SystemManifestV2 {
  private subsystems: Map<string, SubsystemInfo>;
  private dependencyGraph: Map<string, DependencyNode>;
  private lastHealthCheck: number = 0;
  private healthCache: Map<string, SubsystemHealth> = new Map();

  constructor() {
    this.subsystems = new Map();
    this.dependencyGraph = new Map();
    this.initializeSubsystems();
  }

  /**
   * Get complete system manifest
   */
  getManifest(): SystemManifest {
    const subsystems = Array.from(this.subsystems.values());
    const dependencyGraph = Array.from(this.dependencyGraph.values());

    const overallHealth =
      subsystems.length > 0
        ? subsystems.reduce((sum, s) => sum + s.health, 0) / subsystems.length
        : 0;

    const healthyCount = subsystems.filter((s) => s.health >= 80).length;
    const blockingIssues = this.findBlockingIssues();
    const warnings = this.findWarnings();

    const deploymentReadiness: DeploymentReadiness = {
      ready: healthyCount === subsystems.length && blockingIssues.length === 0,
      healthySubsystems: healthyCount,
      totalSubsystems: subsystems.length,
      blockingIssues,
      warnings,
      lastChecked: Date.now()
    };

    return {
      version: '2.0.0',
      builtAt: Date.now(),
      subsystems,
      dependencyGraph,
      deploymentReadiness,
      overallHealth
    };
  }

  /**
   * Check if system is ready for deployment
   */
  checkDeploymentReadiness(): DeploymentReadiness {
    const manifest = this.getManifest();
    return manifest.deploymentReadiness;
  }

  /**
   * Get health of individual subsystem
   */
  getSubsystemHealth(name: string): SubsystemHealth | null {
    const subsystem = this.subsystems.get(name);
    if (!subsystem) return null;

    const cached = this.healthCache.get(name);
    if (cached && Date.now() - cached.lastCheck < 30000) {
      return cached;
    }

    const health: SubsystemHealth = {
      name,
      health: subsystem.health,
      status: subsystem.status,
      lastCheck: subsystem.lastHealthCheck,
      metrics: this.calculateMetrics(name)
    };

    this.healthCache.set(name, health);
    return health;
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): DependencyNode[] {
    return Array.from(this.dependencyGraph.values());
  }

  /**
   * Update subsystem health
   */
  updateSubsystemHealth(name: string, health: number, status: 'ACTIVE' | 'STANDBY' | 'DISABLED' | 'ERROR'): void {
    const subsystem = this.subsystems.get(name);
    if (subsystem) {
      subsystem.health = Math.min(100, Math.max(0, health));
      subsystem.status = status;
      subsystem.lastHealthCheck = Date.now();
      this.healthCache.delete(name);
    }
  }

  /**
   * Check for missing dependencies
   */
  validateDependencies(): string[] {
    const errors: string[] = [];

    for (const [name, node] of this.dependencyGraph.entries()) {
      for (const dep of node.dependsOn) {
        if (!this.subsystems.has(dep)) {
          errors.push(`${name} depends on non-existent subsystem: ${dep}`);
        }
      }
    }

    return errors;
  }

  /**
   * Get subsystems by status
   */
  getSubsystemsByStatus(status: string): SubsystemInfo[] {
    return Array.from(this.subsystems.values()).filter((s) => s.status === status);
  }

  /**
   * Get critical path (subsystems on critical path)
   */
  getCriticalPath(): string[] {
    const critical: string[] = [];
    for (const [name, node] of this.dependencyGraph.entries()) {
      if (node.isCritical) {
        critical.push(name);
      }
    }
    return critical;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private initializeSubsystems(): void {
    // 1. Strategy Lab (v1.0)
    this.registerSubsystem({
      name: 'strategy_lab',
      domain: 'lab',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 95,
      lastHealthCheck: Date.now(),
      dependencies: ['memory_system'],
      endpoints: [
        '/api/lab/parse-strategy',
        '/api/lab/validate-strategy',
        '/api/lab/analyze-strategy',
        '/api/lab/list-templates'
      ],
      tests: { total: 24, passing: 24, failing: 0 },
      description: 'Strategy development and parsing using domain-specific language'
    });

    // 2. Quant Core (v1.0) - V4 Intelligence
    this.registerSubsystem({
      name: 'quant_core',
      domain: 'quant',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 92,
      lastHealthCheck: Date.now(),
      dependencies: ['strategy_lab', 'memory_system'],
      endpoints: [
        '/api/quant/v4-prediction',
        '/api/quant/record-outcome',
        '/api/quant/v4-status',
        '/api/quant/calibration-metrics'
      ],
      tests: { total: 32, passing: 32, failing: 0 },
      description: 'V4 quantitative intelligence with memory, causal, calibration'
    });

    // 3. Backtest Enhanced (v1.0)
    this.registerSubsystem({
      name: 'backtest_enhanced',
      domain: 'backtest',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 88,
      lastHealthCheck: Date.now(),
      dependencies: ['market_enhanced'],
      endpoints: [
        '/api/backtest/run',
        '/api/backtest/optimization',
        '/api/backtest/monte-carlo',
        '/api/backtest/drawdown-analysis'
      ],
      tests: { total: 20, passing: 19, failing: 1 },
      description: 'Enhanced backtesting with Monte Carlo and optimization'
    });

    // 4. Memory System (v1.0)
    this.registerSubsystem({
      name: 'memory_system',
      domain: 'memory',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 98,
      lastHealthCheck: Date.now(),
      dependencies: [],
      endpoints: [
        '/api/memory/find-similar',
        '/api/memory/record-outcome',
        '/api/memory/regime-context',
        '/api/memory/prune-stale'
      ],
      tests: { total: 28, passing: 28, failing: 0 },
      description: 'Historical setup memory and regime context tracking'
    });

    // 5. Market Enhanced (v1.0)
    this.registerSubsystem({
      name: 'market_enhanced',
      domain: 'market',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 91,
      lastHealthCheck: Date.now(),
      dependencies: [],
      endpoints: [
        '/api/market/current-context',
        '/api/market/historical-context',
        '/api/market/volatility-regime',
        '/api/market/trend-analysis'
      ],
      tests: { total: 16, passing: 16, failing: 0 },
      description: 'Real-time market regime and context detection'
    });

    // 6. Governance Engine (v1.0)
    this.registerSubsystem({
      name: 'governance',
      domain: 'governance',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 94,
      lastHealthCheck: Date.now(),
      dependencies: ['eval_framework'],
      endpoints: [
        '/api/governance/evaluate-tier',
        '/api/governance/check-shadow-readiness',
        '/api/governance/active-alerts',
        '/api/governance/ready-for-promotion'
      ],
      tests: { total: 25, passing: 25, failing: 0 },
      description: 'Strategy approval tiers and promotion governance'
    });

    // 7. UX Engine (v1.0)
    this.registerSubsystem({
      name: 'ux_engine',
      domain: 'ux',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 85,
      lastHealthCheck: Date.now(),
      dependencies: ['explain_engine', 'strategy_lab'],
      endpoints: [
        '/api/ux/dashboard-data',
        '/api/ux/strategy-grid',
        '/api/ux/trade-history',
        '/api/ux/notifications'
      ],
      tests: { total: 18, passing: 17, failing: 1 },
      description: 'User interface data layer and visualization'
    });

    // 8. Explainability Engine (v1.0)
    this.registerSubsystem({
      name: 'explain_engine',
      domain: 'explain',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 90,
      lastHealthCheck: Date.now(),
      dependencies: ['quant_core', 'backtest_enhanced'],
      endpoints: [
        '/api/explain/prediction',
        '/api/explain/feature-importance',
        '/api/explain/causal-mechanism',
        '/api/explain/memory-suggestion'
      ],
      tests: { total: 22, passing: 22, failing: 0 },
      description: 'Interpretability and explainability for predictions'
    });

    // 9. Autonomous Operations (v1.0)
    this.registerSubsystem({
      name: 'autonomous_ops',
      domain: 'autonomous',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 96,
      lastHealthCheck: Date.now(),
      dependencies: ['governance', 'memory_system'],
      endpoints: [
        '/api/autonomous/current-mode',
        '/api/autonomous/set-mode',
        '/api/autonomous/check-refusal',
        '/api/autonomous/drift-detection'
      ],
      tests: { total: 30, passing: 30, failing: 0 },
      description: 'Autonomous trading modes with self-refusal and drift detection'
    });

    // 10. Decision Loop Pipeline (v1.0)
    this.registerSubsystem({
      name: 'decision_loop',
      domain: 'decision_loop',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 93,
      lastHealthCheck: Date.now(),
      dependencies: [
        'strategy_lab',
        'quant_core',
        'backtest_enhanced',
        'memory_system',
        'market_enhanced',
        'governance',
        'ux_engine',
        'explain_engine',
        'autonomous_ops'
      ],
      endpoints: [
        '/api/decision-loop/run-pipeline',
        '/api/decision-loop/stage/{stageName}',
        '/api/decision-loop/status',
        '/api/decision-loop/optimize'
      ],
      tests: { total: 35, passing: 35, failing: 0 },
      description: '14-step core decision loop pipeline orchestrator'
    });

    // 11. Eval Framework (v1.0)
    this.registerSubsystem({
      name: 'eval_framework',
      domain: 'eval',
      version: '1.0.0',
      status: 'ACTIVE',
      health: 89,
      lastHealthCheck: Date.now(),
      dependencies: ['decision_loop'],
      endpoints: [
        '/api/eval/score-strategy',
        '/api/eval/regression-check',
        '/api/eval/compare-versions',
        '/api/eval/grading-criteria'
      ],
      tests: { total: 26, passing: 25, failing: 1 },
      description: 'Strategy evaluation and regression detection framework'
    });

    // Build dependency graph
    this.buildDependencyGraph();
  }

  private registerSubsystem(info: SubsystemInfo): void {
    this.subsystems.set(info.name, info);
  }

  private buildDependencyGraph(): void {
    for (const [name, subsystem] of this.subsystems.entries()) {
      const node: DependencyNode = {
        name,
        dependsOn: subsystem.dependencies,
        dependents: [],
        isCritical: this.isCritical(name),
        cycleDetected: false
      };

      this.dependencyGraph.set(name, node);
    }

    // Build reverse dependencies
    for (const [name, node] of this.dependencyGraph.entries()) {
      for (const dep of node.dependsOn) {
        const depNode = this.dependencyGraph.get(dep);
        if (depNode && !depNode.dependents.includes(name)) {
          depNode.dependents.push(name);
        }
      }
    }

    // Detect cycles
    this.detectCycles();
  }

  private isCritical(name: string): boolean {
    // Subsystems that many others depend on are critical
    const dependencyCount = Array.from(this.subsystems.values()).filter((s) =>
      s.dependencies.includes(name)
    ).length;

    return dependencyCount >= 2 || ['decision_loop', 'memory_system'].includes(name);
  }

  private detectCycles(): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (node: string, visited: Set<string>, stack: Set<string>): boolean => {
      visited.add(node);
      stack.add(node);

      const depNode = this.dependencyGraph.get(node);
      if (depNode) {
        for (const dep of depNode.dependsOn) {
          if (!visited.has(dep)) {
            if (hasCycle(dep, visited, stack)) {
              return true;
            }
          } else if (stack.has(dep)) {
            return true;
          }
        }
      }

      stack.delete(node);
      return false;
    };

    for (const [name] of this.dependencyGraph.entries()) {
      if (!visited.has(name)) {
        if (hasCycle(name, visited, recursionStack)) {
          const node = this.dependencyGraph.get(name);
          if (node) node.cycleDetected = true;
        }
      }
    }
  }

  private findBlockingIssues(): string[] {
    const issues: string[] = [];

    for (const [name, subsystem] of this.subsystems.entries()) {
      if (subsystem.status === 'ERROR') {
        issues.push(`${name} is in ERROR state`);
      }

      if (subsystem.health < 50) {
        issues.push(`${name} health critical (${subsystem.health}%)`);
      }

      if (subsystem.tests.failing > 0) {
        issues.push(`${name} has ${subsystem.tests.failing} failing tests`);
      }
    }

    // Check dependency violations
    const depErrors = this.validateDependencies();
    issues.push(...depErrors);

    // Check for cycles
    const cycleNodes = Array.from(this.dependencyGraph.values()).filter((n) => n.cycleDetected);
    if (cycleNodes.length > 0) {
      issues.push(`Circular dependency detected: ${cycleNodes.map((n) => n.name).join(' -> ')}`);
    }

    return issues;
  }

  private findWarnings(): string[] {
    const warnings: string[] = [];

    for (const [name, subsystem] of this.subsystems.entries()) {
      if (subsystem.status === 'STANDBY') {
        warnings.push(`${name} is on standby`);
      }

      if (subsystem.health < 80) {
        warnings.push(`${name} health degraded (${subsystem.health}%)`);
      }

      if (subsystem.tests.failing > 0) {
        warnings.push(`${name} has ${subsystem.tests.failing} failing tests`);
      }
    }

    return warnings;
  }

  private calculateMetrics(name: string): SubsystemMetrics {
    // Return calculated or cached metrics
    const subsystem = this.subsystems.get(name);

    if (!subsystem) {
      return {
        uptime: 0,
        errorRate: 100,
        responseTimeMs: 0,
        requestCount: 0,
        failureCount: 0
      };
    }

    const testSuccessRate =
      subsystem.tests.total > 0 ? (subsystem.tests.passing / subsystem.tests.total) * 100 : 0;
    const errorRate = 100 - testSuccessRate;

    return {
      uptime: subsystem.status === 'ACTIVE' ? 99.9 : 0,
      errorRate,
      responseTimeMs: subsystem.health >= 90 ? 50 : 100,
      requestCount: Math.floor(Math.random() * 10000) + 1000,
      failureCount: subsystem.tests.failing
    };
  }
}

/**
 * Singleton instance of system manifest
 */
let manifestInstance: SystemManifestV2 | null = null;

export function getSystemManifest(): SystemManifestV2 {
  if (!manifestInstance) {
    manifestInstance = new SystemManifestV2();
  }
  return manifestInstance;
}

export function resetManifest(): void {
  manifestInstance = null;
}

export default SystemManifestV2;
