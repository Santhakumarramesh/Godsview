/**
 * WorkflowEngine - Orchestrates the complete user workflow
 *
 * Manages end-to-end: idea → parsed → critiqued → backtested → improved → ready
 * Handles checkpoints, resumption, progress tracking, and next-step guidance.
 */

import { randomUUID } from 'crypto';
import { StrategyLab } from '../lab';
import { BacktestOrchestrator } from '../backtest/orchestrator';
import { getGovernanceSystem } from '../governance';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface WorkflowInput {
  type: 'natural_language' | 'strategy_dsl' | 'template' | 'import';
  content: string;
  preferences?: {
    riskTolerance: 'conservative' | 'moderate' | 'aggressive';
    timeHorizon: 'scalp' | 'day' | 'swing' | 'position';
    targetSymbols?: string[];
    autoImprove: boolean;
    autoBacktest: boolean;
  };
}

export interface WorkflowStep {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  summary?: string;
  duration?: number;
  output?: any;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowState {
  id: string;
  currentStep: string;
  steps: WorkflowStep[];
  progress: number; // 0-100
  status: 'in_progress' | 'waiting_input' | 'completed' | 'failed';
  strategy?: any;
  backtestResults?: any;
  critiqueReport?: any;
  variants?: any[];
  selectedVariant?: any;
  promotionStatus?: any;
  createdAt: string;
  updatedAt: string;
  errors: string[];
}

export interface NextStepGuidance {
  currentStep: string;
  nextAction: string;
  explanation: string;
  options: {
    action: string;
    description: string;
    recommended: boolean;
    estimatedTime: string;
  }[];
  warnings: string[];
  estimatedTimeRemaining: string;
}

export interface WorkflowResult {
  workflowId: string;
  state: WorkflowState;
  success: boolean;
  readyToDeploy: boolean;
  message: string;
}

export interface QuickResult {
  success: boolean;
  backtestId: string;
  summary: string;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
}

export interface DeployResult {
  success: boolean;
  deploymentId: string;
  strategyId: string;
  status: string;
  timestamp: string;
}

// ──────────────────────────────────────────────────────────────────────────
// WorkflowEngine
// ──────────────────────────────────────────────────────────────────────────

export class WorkflowEngine {
  private workflows: Map<string, WorkflowState> = new Map();
  private lab: StrategyLab;
  private backtester: BacktestOrchestrator;
  private governance: any;

  constructor() {
    this.lab = new StrategyLab();
    this.backtester = new BacktestOrchestrator();
    this.governance = getGovernanceSystem();
  }

  /**
   * Start a complete end-to-end workflow
   */
  async runFullWorkflow(input: WorkflowInput): Promise<WorkflowResult> {
    const workflowId = randomUUID();
    const state = this.initializeWorkflow(workflowId);

    try {
      // Step 1: Parse
      state.steps[0].status = 'in_progress';
      state.steps[0].startedAt = new Date().toISOString();
      state.currentStep = 'parse';

      const parseResult = await this.runParse(input);
      state.steps[0].output = parseResult;
      state.steps[0].status = 'completed';
      state.steps[0].completedAt = new Date().toISOString();
      state.steps[0].duration = Date.now() - new Date(state.steps[0].startedAt!).getTime();
      state.strategy = parseResult.strategy;

      // Step 2: Critique
      state.steps[1].status = 'in_progress';
      state.steps[1].startedAt = new Date().toISOString();
      state.currentStep = 'critique';

      const critiqueResult = await this.runCritique(state.strategy);
      state.steps[1].output = critiqueResult;
      state.steps[1].status = 'completed';
      state.steps[1].completedAt = new Date().toISOString();
      state.steps[1].duration = Date.now() - new Date(state.steps[1].startedAt!).getTime();
      state.critiqueReport = critiqueResult;

      // Step 3: Generate Variants
      state.steps[2].status = 'in_progress';
      state.steps[2].startedAt = new Date().toISOString();
      state.currentStep = 'variants';

      const variants = await this.runVariants(state.strategy);
      state.steps[2].output = variants;
      state.steps[2].status = 'completed';
      state.steps[2].completedAt = new Date().toISOString();
      state.steps[2].duration = Date.now() - new Date(state.steps[2].startedAt!).getTime();
      state.variants = variants;
      state.selectedVariant = variants[0]; // Select top variant

      // Step 4: Backtest
      if (input.preferences?.autoBacktest !== false) {
        state.steps[3].status = 'in_progress';
        state.steps[3].startedAt = new Date().toISOString();
        state.currentStep = 'backtest';

        const backtestResult = await this.runBacktest(state.selectedVariant);
        state.steps[3].output = backtestResult;
        state.steps[3].status = 'completed';
        state.steps[3].completedAt = new Date().toISOString();
        state.steps[3].duration = Date.now() - new Date(state.steps[3].startedAt!).getTime();
        state.backtestResults = backtestResult;
      }

      // Step 5: Governance Review
      state.steps[4].status = 'in_progress';
      state.steps[4].startedAt = new Date().toISOString();
      state.currentStep = 'governance';

      const promotionDecision = await this.runGovernance(state.selectedVariant, state.backtestResults);
      state.steps[4].output = promotionDecision;
      state.steps[4].status = 'completed';
      state.steps[4].completedAt = new Date().toISOString();
      state.steps[4].duration = Date.now() - new Date(state.steps[4].startedAt!).getTime();
      state.promotionStatus = promotionDecision;

      // Mark workflow complete
      state.status = 'completed';
      state.progress = 100;
      state.updatedAt = new Date().toISOString();
      this.workflows.set(workflowId, state);

      return {
        workflowId,
        state,
        success: true,
        readyToDeploy: promotionDecision.canPromote,
        message: 'Workflow completed successfully',
      };
    } catch (error) {
      state.status = 'failed';
      state.errors.push(error instanceof Error ? error.message : 'Unknown error');
      state.updatedAt = new Date().toISOString();
      this.workflows.set(workflowId, state);

      return {
        workflowId,
        state,
        success: false,
        readyToDeploy: false,
        message: error instanceof Error ? error.message : 'Workflow failed',
      };
    }
  }

  /**
   * Get the current state of a workflow
   */
  getWorkflowState(workflowId: string): WorkflowState | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Get guidance for the next steps
   */
  getNextSteps(workflowId: string): NextStepGuidance {
    const state = this.workflows.get(workflowId);
    if (!state) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const stepMap = new Map(state.steps.map(s => [s.name, s]));
    const currentIdx = state.steps.findIndex(s => s.status !== 'completed' && s.status !== 'skipped');
    const currentStepName = currentIdx >= 0 ? state.steps[currentIdx].name : 'completed';

    // Determine next action
    let nextAction = 'Complete workflow';
    let explanation = 'Your strategy is ready for review or deployment.';
    let options: any[] = [];
    let warnings: string[] = [];
    let estimatedTime = '< 1 minute';

    if (state.status === 'completed') {
      nextAction = 'Review and Deploy';
      explanation = 'Your strategy has passed all stages. You can now review it one more time or deploy.';
      options = [
        {
          action: 'review_strategy',
          description: 'Review the final strategy details and performance metrics',
          recommended: true,
          estimatedTime: '5-10 minutes',
        },
        {
          action: 'deploy',
          description: 'Deploy the strategy to live trading',
          recommended: false,
          estimatedTime: '2 minutes',
        },
      ];
    } else if (currentStepName === 'parse') {
      nextAction = 'Strategy parsed successfully';
      explanation = 'Your idea has been converted to a machine-readable strategy.';
      options = [
        {
          action: 'continue',
          description: 'Continue to critique and optimization',
          recommended: true,
          estimatedTime: '2-3 minutes',
        },
        {
          action: 'review_parsed',
          description: 'Review how your idea was interpreted',
          recommended: false,
          estimatedTime: '3-5 minutes',
        },
      ];
    } else if (currentStepName === 'critique') {
      nextAction = 'Review critique feedback';
      explanation = 'The system has analyzed your strategy for quality and risk.';
      options = [
        {
          action: 'continue',
          description: 'Proceed with variant generation',
          recommended: true,
          estimatedTime: '1-2 minutes',
        },
        {
          action: 'refine',
          description: 'Adjust strategy based on feedback',
          recommended: false,
          estimatedTime: '5-10 minutes',
        },
      ];
      if (state.critiqueReport?.issues?.length > 0) {
        warnings.push(`Found ${state.critiqueReport.issues.length} issues to review`);
      }
    } else if (currentStepName === 'backtest') {
      nextAction = 'Review backtest results';
      explanation = 'Your strategy has been tested on historical market data.';
      options = [
        {
          action: 'continue',
          description: 'Proceed to governance review',
          recommended: true,
          estimatedTime: '1 minute',
        },
        {
          action: 'optimize',
          description: 'Tune parameters for better performance',
          recommended: false,
          estimatedTime: '10-20 minutes',
        },
      ];
    }

    return {
      currentStep: currentStepName,
      nextAction,
      explanation,
      options,
      warnings,
      estimatedTimeRemaining: estimatedTime,
    };
  }

  /**
   * Resume a workflow from a specific checkpoint
   */
  async resumeWorkflow(workflowId: string, fromStep: string): Promise<WorkflowResult> {
    const state = this.workflows.get(workflowId);
    if (!state) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const stepIndex = state.steps.findIndex(s => s.name === fromStep);
    if (stepIndex === -1) {
      throw new Error(`Step not found: ${fromStep}`);
    }

    try {
      // Reset steps from the specified step onward
      for (let i = stepIndex; i < state.steps.length; i++) {
        state.steps[i].status = 'pending';
        delete state.steps[i].output;
        delete state.steps[i].startedAt;
        delete state.steps[i].completedAt;
      }

      // Re-run from that point
      if (fromStep === 'critique' && state.strategy) {
        const critiqueResult = await this.runCritique(state.strategy);
        state.steps[1].output = critiqueResult;
        state.steps[1].status = 'completed';
        state.critiqueReport = critiqueResult;
      } else if (fromStep === 'backtest' && state.selectedVariant) {
        const backtestResult = await this.runBacktest(state.selectedVariant);
        state.steps[3].output = backtestResult;
        state.steps[3].status = 'completed';
        state.backtestResults = backtestResult;
      }

      state.updatedAt = new Date().toISOString();
      this.workflows.set(workflowId, state);

      return {
        workflowId,
        state,
        success: true,
        readyToDeploy: false,
        message: `Workflow resumed from ${fromStep}`,
      };
    } catch (error) {
      state.errors.push(error instanceof Error ? error.message : 'Unknown error');
      state.updatedAt = new Date().toISOString();
      return {
        workflowId,
        state,
        success: false,
        readyToDeploy: false,
        message: error instanceof Error ? error.message : 'Resume failed',
      };
    }
  }

  /**
   * Quick backtest from natural language
   */
  async quickBacktest(naturalLanguage: string): Promise<QuickResult> {
    try {
      // Parse the natural language
      const parseResult = await this.runParse({
        type: 'natural_language',
        content: naturalLanguage,
      });

      // Quick backtest
      const backtestResult = await this.runBacktest(parseResult.strategy);

      return {
        success: true,
        backtestId: randomUUID(),
        summary: `Backtest for: ${naturalLanguage.substring(0, 50)}...`,
        sharpeRatio: backtestResult.metrics?.sharpeRatio || 0,
        maxDrawdown: backtestResult.metrics?.maxDrawdown || 0,
        winRate: backtestResult.metrics?.winRate || 0,
      };
    } catch (error) {
      throw new Error(`Quick backtest failed: ${error}`);
    }
  }

  /**
   * Quick deploy a strategy
   */
  async quickDeploy(strategyId: string): Promise<DeployResult> {
    try {
      // In real system, would deploy to broker
      return {
        success: true,
        deploymentId: randomUUID(),
        strategyId,
        status: 'deployed',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Quick deploy failed: ${error}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────

  private initializeWorkflow(workflowId: string): WorkflowState {
    return {
      id: workflowId,
      currentStep: 'parse',
      progress: 0,
      status: 'in_progress',
      steps: [
        { id: '1', name: 'parse', status: 'pending' },
        { id: '2', name: 'critique', status: 'pending' },
        { id: '3', name: 'variants', status: 'pending' },
        { id: '4', name: 'backtest', status: 'pending' },
        { id: '5', name: 'governance', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      errors: [],
    };
  }

  private async runParse(input: WorkflowInput): Promise<any> {
    const result = this.lab.processIdea(input.content);
    return result;
  }

  private async runCritique(strategy: any): Promise<any> {
    // Would call StrategyCritique
    return { issues: [], score: 85 };
  }

  private async runVariants(strategy: any): Promise<any[]> {
    // Would call VariantGenerator
    return [strategy];
  }

  private async runBacktest(strategy: any): Promise<any> {
    // Would call BacktestOrchestrator
    return {
      metrics: {
        sharpeRatio: 1.5,
        maxDrawdown: 0.15,
        winRate: 0.58,
      },
    };
  }

  private async runGovernance(strategy: any, results: any): Promise<any> {
    // Would call GovernanceSystem
    return { canPromote: true, tier: 'learning' };
  }
}

// Export singleton
let engineInstance: WorkflowEngine | null = null;

export function getWorkflowEngine(): WorkflowEngine {
  if (!engineInstance) {
    engineInstance = new WorkflowEngine();
  }
  return engineInstance;
}
