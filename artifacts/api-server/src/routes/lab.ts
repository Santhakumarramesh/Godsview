/**
 * Strategy Lab API Routes
 *
 * POST /api/lab/parse     - parse natural language → StrategyDSL
 * POST /api/lab/critique  - critique a strategy
 * POST /api/lab/variants  - generate + rank variants
 * POST /api/lab/process   - end-to-end pipeline (parse → critique → variants)
 * POST /api/lab/refine    - refine a strategy with natural-language feedback
 * POST /api/lab/compare   - compare two strategies head-to-head
 * POST /api/lab/validate  - schema validate a strategy
 * GET  /api/lab/health    - health probe
 *
 * Response shapes wrap the underlying lab classes with stable, documented
 * fields so the dashboard does not see the internal interface drift.
 */

import { Router, type IRouter, Request, Response } from 'express';
import { StrategyLab } from '../lib/lab/index';
import { NaturalLanguageStrategyParser } from '../lib/lab/strategy_parser';
import { StrategyCritique, type CritiqueResult } from '../lib/lab/strategy_critique';
import { VariantGenerator } from '../lib/lab/variant_generator';
import { StrategyDSL, validateStrategyDSL } from '../lib/lab/strategy_dsl';

const router: IRouter = Router();
const lab = new StrategyLab();
const parser = new NaturalLanguageStrategyParser();
const critique = new StrategyCritique();
const variants = new VariantGenerator();

/**
 * Compact summary that the dashboard renders. We derive it from the rich
 * `CritiqueResult` shape so callers get a stable view even as internals evolve.
 */
function summarizeCritique(report: CritiqueResult) {
  return {
    score: report.overallScore,
    grade: report.overallGrade,
    verdict: gradeToVerdict(report.overallGrade),
    recommendations: report.recommendations,
    redFlags: report.redFlags,
    strengths: report.strengths,
  };
}

function gradeToVerdict(grade: CritiqueResult['overallGrade']): string {
  switch (grade) {
    case 'A':
      return 'strong-edge';
    case 'B':
      return 'viable';
    case 'C':
      return 'marginal';
    case 'D':
      return 'weak';
    case 'F':
    default:
      return 'unfit';
  }
}

function nextStepsFromCritique(report: CritiqueResult): string[] {
  const steps: string[] = [];
  if (report.redFlags.length > 0) {
    steps.push(`Address red flags: ${report.redFlags.slice(0, 3).join('; ')}`);
  }
  if (report.recommendations.length > 0) {
    steps.push(...report.recommendations.slice(0, 3));
  }
  if (report.overallGrade === 'A' || report.overallGrade === 'B') {
    steps.push('Promote to paper-trading replay for verification');
  } else {
    steps.push('Iterate on the weakest dimension before paper-trading');
  }
  return steps;
}

/**
 * POST /api/lab/parse
 * Parse natural language description to StrategyDSL
 */
router.post('/parse', (req: Request, res: Response) => {
  try {
    const { description } = req.body ?? {};

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid description field' });
    }

    if (description.length > 10000) {
      return res.status(400).json({ error: 'Description too long (max 10000 chars)' });
    }

    const strategy = parser.parse(description);
    const validation = validateStrategyDSL(strategy);

    return res.json({
      success: true,
      strategy,
      valid: validation.valid,
      warnings: validation.warnings,
      errors: validation.errors,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Parse failed',
    });
  }
});

/**
 * POST /api/lab/critique
 * Critique an existing strategy
 */
router.post('/critique', (req: Request, res: Response) => {
  try {
    const { strategy } = req.body ?? {};

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy' });
    }

    const validation = validateStrategyDSL(strategy as StrategyDSL);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid strategy',
        details: validation.errors,
      });
    }

    const report = critique.fullCritique(strategy as StrategyDSL);

    return res.json({
      success: true,
      report,
      summary: summarizeCritique(report),
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Critique failed',
    });
  }
});

/**
 * POST /api/lab/variants
 * Generate variants for a strategy and return them ranked by overall score
 */
router.post('/variants', (req: Request, res: Response) => {
  try {
    const { strategy, count = 5 } = req.body ?? {};

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy' });
    }

    if (typeof count !== 'number' || count < 1 || count > 20) {
      return res.status(400).json({ error: 'Count must be a number between 1 and 20' });
    }

    const generated = variants.generateVariants(strategy as StrategyDSL).slice(0, count);
    const ranked = lab.rankVariants(generated);

    return res.json({
      success: true,
      count: ranked.length,
      variants: ranked,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Variant generation failed',
    });
  }
});

/**
 * POST /api/lab/process
 * End-to-end pipeline: parse → critique → generate variants → rank
 */
router.post('/process', (req: Request, res: Response) => {
  try {
    const { description } = req.body ?? {};

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid description field' });
    }

    if (description.length > 10000) {
      return res.status(400).json({ error: 'Description too long (max 10000 chars)' });
    }

    const result = lab.processIdea(description);
    const ranked = lab.rankVariants(result.variants);

    return res.json({
      success: true,
      strategy: result.strategy,
      critique: result.critique,
      critiqueSummary: summarizeCritique(result.critique),
      bestVariant: ranked[0] ?? null,
      allVariants: ranked,
      nextSteps: nextStepsFromCritique(result.critique),
      processingTimeMs: result.processingTime,
      timestamp: result.timestamp,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Processing failed',
    });
  }
});

/**
 * POST /api/lab/refine
 * Refine a strategy based on natural-language feedback
 */
router.post('/refine', (req: Request, res: Response) => {
  try {
    const { strategy, feedback } = req.body ?? {};

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy' });
    }

    if (!feedback || typeof feedback !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid feedback' });
    }

    if (feedback.length > 1000) {
      return res.status(400).json({ error: 'Feedback too long (max 1000 chars)' });
    }

    const result = lab.refineStrategy(strategy as StrategyDSL, feedback);

    return res.json({
      success: true,
      originalStrategy: result.originalStrategy,
      refinedStrategy: result.refinedStrategy,
      changesSummary: result.changesSummary,
      newCritique: result.newCritique,
      critiqueSummary: summarizeCritique(result.newCritique),
      nextSteps: nextStepsFromCritique(result.newCritique),
      timestamp: result.timestamp,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Refinement failed',
    });
  }
});

/**
 * POST /api/lab/compare
 * Compare two strategies head-to-head
 */
router.post('/compare', (req: Request, res: Response) => {
  try {
    const { strategies } = req.body ?? {};

    if (!Array.isArray(strategies) || strategies.length !== 2) {
      return res.status(400).json({
        error: 'Provide exactly 2 strategies in the `strategies` array',
      });
    }

    const [a, b] = strategies as [StrategyDSL, StrategyDSL];
    const comparison = lab.compareStrategies(a, b);

    return res.json({
      success: true,
      strategyA: { name: a.name, critique: comparison.critiqueA },
      strategyB: { name: b.name, critique: comparison.critiqueB },
      differences: comparison.differences,
      recommendation: comparison.recommendation,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Comparison failed',
    });
  }
});

/**
 * POST /api/lab/validate
 * Validate a strategy for completeness
 */
router.post('/validate', (req: Request, res: Response) => {
  try {
    const { strategy } = req.body ?? {};

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy' });
    }

    const validation = validateStrategyDSL(strategy as StrategyDSL);

    return res.json({
      success: true,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Validation failed',
    });
  }
});

/**
 * GET /api/lab/health
 * Health check for lab service
 */
router.get('/health', (_req: Request, res: Response) => {
  return res.json({
    status: 'healthy',
    service: 'Strategy Lab',
    version: '1.0.0',
    capabilities: [
      'parse natural language',
      'critique strategies',
      'generate variants',
      'end-to-end processing',
      'compare strategies',
      'refine with feedback',
    ],
    stats: lab.getLabStatus(),
  });
});

export default router;
