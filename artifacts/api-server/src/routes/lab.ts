/**
 * Strategy Lab API Routes
 *
 * POST /api/lab/parse - parse natural language to StrategyDSL
 * POST /api/lab/critique - critique a strategy
 * POST /api/lab/variants - generate variants for a strategy
 * POST /api/lab/process - end-to-end pipeline
 * POST /api/lab/refine - refine strategy with feedback
 * POST /api/lab/compare - compare multiple strategies
 */

import { Router, Request, Response } from 'express';
import { StrategyLab } from '../lib/lab/index';
import { StrategyParser } from '../lib/lab/strategy_parser';
import { StrategyCritique } from '../lib/lab/strategy_critique';
import { VariantGenerator } from '../lib/lab/variant_generator';
import { StrategyDSL, validateStrategyDSL } from '../lib/lab/strategy_dsl';

const router = Router();
const lab = new StrategyLab();
const parser = new StrategyParser();
const critique = new StrategyCritique();
const variants = new VariantGenerator();

/**
 * POST /api/lab/parse
 * Parse natural language description to StrategyDSL
 */
router.post('/parse', (req: Request, res: Response) => {
  try {
    const { description } = req.body;

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid description field' });
    }

    if (description.length > 10000) {
      return res.status(400).json({ error: 'Description too long (max 10000 chars)' });
    }

    const result = parser.parse(description);

    return res.json({
      success: true,
      strategy: result.strategy,
      confidence: result.confidence,
      ambiguities: result.ambiguities,
      suggestions: result.suggestions,
      interpretations: result.interpretations,
    });
  } catch (error) {
    return res.status(503).json({
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
    const { strategy } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy' });
    }

    // Validate strategy structure
    const validation = validateStrategyDSL(strategy as StrategyDSL);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid strategy',
        details: validation.errors,
      });
    }

    const report = critique.critique(strategy as StrategyDSL);

    return res.json({
      success: true,
      report,
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Critique failed',
    });
  }
});

/**
 * POST /api/lab/variants
 * Generate variants for a strategy
 */
router.post('/variants', (req: Request, res: Response) => {
  try {
    const { strategy, count = 5 } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy' });
    }

    if (count < 1 || count > 20) {
      return res.status(400).json({ error: 'Count must be between 1 and 20' });
    }

    const generated = variants.generateVariants(strategy as StrategyDSL, count);
    const ranked = variants.rankVariants(generated);

    return res.json({
      success: true,
      count: ranked.length,
      variants: ranked,
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Variant generation failed',
    });
  }
});

/**
 * POST /api/lab/process
 * End-to-end: parse → critique → variants → rank
 */
router.post('/process', async (req: Request, res: Response) => {
  try {
    const { description } = req.body;

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid description field' });
    }

    if (description.length > 10000) {
      return res.status(400).json({ error: 'Description too long (max 10000 chars)' });
    }

    const result = await lab.processIdea(description);

    return res.json({
      success: true,
      strategy: result.strategy,
      parseConfidence: result.parseResult.confidence,
      critiqueSummary: {
        score: result.critique.overallScore,
        grade: result.critique.grade,
        verdict: result.critique.verdict,
        recommendation: result.critique.recommendation,
        dealBreakers: result.critique.dealBreakers,
        strengths: result.critique.strengths,
        improvements: result.critique.improvements.slice(0, 3),
      },
      bestVariant: result.variants[0],
      allVariants: result.variants,
      nextSteps: result.nextSteps,
      timestamp: result.timestamp,
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Processing failed',
    });
  }
});

/**
 * POST /api/lab/refine
 * Refine a strategy based on user feedback
 */
router.post('/refine', async (req: Request, res: Response) => {
  try {
    const { strategy, feedback } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy' });
    }

    if (!feedback || typeof feedback !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid feedback' });
    }

    if (feedback.length > 1000) {
      return res.status(400).json({ error: 'Feedback too long (max 1000 chars)' });
    }

    const result = await lab.refineStrategy(strategy as StrategyDSL, feedback);

    return res.json({
      success: true,
      refinedStrategy: result.strategy,
      critiqueSummary: {
        score: result.critique.overallScore,
        grade: result.critique.grade,
        verdict: result.critique.verdict,
        recommendation: result.critique.recommendation,
      },
      improvements: result.critique.improvements.slice(0, 3),
      bestVariant: result.variants[0],
      nextSteps: result.nextSteps,      timestamp: result.timestamp,
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Refinement failed',
    });
  }
});

/**
 * POST /api/lab/compare
 * Compare multiple strategies
 */
router.post('/compare', async (req: Request, res: Response) => {
  try {
    const { strategies } = req.body;

    if (!Array.isArray(strategies) || strategies.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 strategies to compare' });
    }

    if (strategies.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 strategies to compare' });
    }

    const comparison = await lab.compareStrategies(strategies as StrategyDSL[]);

    return res.json({
      success: true,
      strategies: comparison.strategies.map(s => ({
        id: s.id,
        name: s.name,
        complexity: s.complexity,
      })),
      comparisons: comparison.pairwiseComparisons.map(c => ({
        strategyAName: c.strategyA.name,
        strategyBName: c.strategyB.name,
        similarities: c.similarities,
        differences: c.differences,
        recommendation: c.recommendation,
      })),
      bestCandidate: comparison.bestCandidate?.name,
      recommendation: comparison.recommendation,
    });
  } catch (error) {
    return res.status(503).json({
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
    const { strategy } = req.body;

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
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Validation failed',
    });
  }
});

/**
 * GET /api/lab/health
 * Health check for lab service
 */
router.get('/health', (req: Request, res: Response) => {
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
  });
});

export default router;