/**
 * Strategy Lab API Routes
 *
 * POST /api/lab/parse     - parse natural language to StrategyDSL
 * POST /api/lab/critique  - critique an existing strategy
 * POST /api/lab/variants  - generate variants for a strategy
 * POST /api/lab/process   - end-to-end pipeline (parse → critique → variants)
 * POST /api/lab/refine    - refine strategy with feedback
 * POST /api/lab/compare   - compare two strategies pairwise
 * POST /api/lab/validate  - validate a strategy for completeness
 * GET  /api/lab/health    - health check
 */

import { Router, Request, Response } from 'express';
import { StrategyLab } from '../lib/lab/index';
import { NaturalLanguageStrategyParser } from '../lib/lab/strategy_parser';
import { StrategyCritique } from '../lib/lab/strategy_critique';
import { VariantGenerator } from '../lib/lab/variant_generator';
import { StrategyDSL, validateStrategyDSL } from '../lib/lab/strategy_dsl';

const router = Router();
const lab = new StrategyLab();
const parser = new NaturalLanguageStrategyParser();
const critique = new StrategyCritique();
const variants = new VariantGenerator();

/**
 * POST /api/lab/parse
 * Parse natural language description to StrategyDSL.
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

    const strategy = parser.parse(description);

    return res.json({
      success: true,
      strategy,
      parseConfidence: strategy.parseConfidence,
      ambiguities: strategy.ambiguities,
      warnings: strategy.warnings,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Parse failed',
    });
  }
});

/**
 * POST /api/lab/critique
 * Critique an existing strategy.
 */
router.post('/critique', (req: Request, res: Response) => {
  try {
    const { strategy } = req.body;

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
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Critique failed',
    });
  }
});

/**
 * POST /api/lab/variants
 * Generate variants for a strategy.
 */
router.post('/variants', (req: Request, res: Response) => {
  try {
    const { strategy } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy' });
    }

    const generated = variants.generateVariants(strategy as StrategyDSL);
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
 * End-to-end: parse → critique → variants → rank.
 */
router.post('/process', (req: Request, res: Response) => {
  try {
    const { description } = req.body;

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid description field' });
    }
    if (description.length > 10000) {
      return res.status(400).json({ error: 'Description too long (max 10000 chars)' });
    }

    const result = lab.processIdea(description);

    return res.json({
      success: true,
      strategy: result.strategy,
      parseConfidence: result.strategy.parseConfidence,
      critiqueSummary: {
        score: result.critique.overallScore,
        grade: result.critique.overallGrade,
        recommendations: result.critique.recommendations,
        redFlags: result.critique.redFlags,
        strengths: result.critique.strengths,
      },
      bestVariant: result.variants[0],
      allVariants: result.variants,
      processingTime: result.processingTime,
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
 * Refine a strategy based on user feedback.
 */
router.post('/refine', (req: Request, res: Response) => {
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

    const result = lab.refineStrategy(strategy as StrategyDSL, feedback);

    return res.json({
      success: true,
      refinedStrategy: result.refinedStrategy,
      changesSummary: result.changesSummary,
      critiqueSummary: {
        score: result.newCritique.overallScore,
        grade: result.newCritique.overallGrade,
        recommendations: result.newCritique.recommendations,
      },
      strengths: result.newCritique.strengths,
      redFlags: result.newCritique.redFlags,
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
 * Compare multiple strategies. Performs pairwise comparisons between each pair.
 */
router.post('/compare', (req: Request, res: Response) => {
  try {
    const { strategies } = req.body;

    if (!Array.isArray(strategies) || strategies.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 strategies to compare' });
    }
    if (strategies.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 strategies to compare' });
    }

    const list = strategies as StrategyDSL[];
    const pairwise: ReturnType<StrategyLab['compareStrategies']>[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        pairwise.push(lab.compareStrategies(list[i]!, list[j]!));
      }
    }

    // Select best overall: whichever strategy wins the most pairwise comparisons
    const winCounts = new Map<string, number>();
    for (const cmp of pairwise) {
      const winnerName =
        cmp.critiqueA.overallScore >= cmp.critiqueB.overallScore
          ? cmp.strategyA.name
          : cmp.strategyB.name;
      winCounts.set(winnerName, (winCounts.get(winnerName) ?? 0) + 1);
    }
    let bestCandidate: StrategyDSL | undefined;
    let bestWins = -1;
    for (const s of list) {
      const wins = winCounts.get(s.name) ?? 0;
      if (wins > bestWins) {
        bestWins = wins;
        bestCandidate = s;
      }
    }

    return res.json({
      success: true,
      strategies: list.map((s) => ({
        id: s.id,
        name: s.name,
        complexity: s.complexity,
      })),
      comparisons: pairwise.map((c) => ({
        strategyAName: c.strategyA.name,
        strategyBName: c.strategyB.name,
        differences: c.differences,
        recommendation: c.recommendation,
      })),
      bestCandidate: bestCandidate?.name,
      bestCandidateWins: bestWins,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Comparison failed',
    });
  }
});

/**
 * POST /api/lab/validate
 * Validate a strategy for completeness.
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
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Validation failed',
    });
  }
});

/**
 * GET /api/lab/health
 * Health check for lab service.
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
  });
});

export default router;
