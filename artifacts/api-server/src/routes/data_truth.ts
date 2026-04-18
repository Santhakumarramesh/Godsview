import { Router, type IRouter, Request, Response } from 'express';
import { db } from '../db';
import {
  dataQualityScores,
  dataFeedHealth,
  dataConsistencyChecks,
  type DataFeedHealth,
  type DataQualityScore,
  type DataConsistencyCheck,
} from '../schema/data_truth';
import { desc, eq, and } from "@workspace/db";
import {
  DataQualityScorer,
  FeedHealthMonitor,
  CrossSourceValidator,
  dataTruthGate,
  type Candle,
} from '../lib/data_truth_engine';

const router: IRouter = Router();

// Shared instances (in production, these would be injected or managed globally)
const qualityScorer = new DataQualityScorer();
const feedHealthMonitor = new FeedHealthMonitor();
const crossSourceValidator = new CrossSourceValidator();

/**
 * Coerce a route param into a non-empty string. Express types this as
 * `string | string[]` because middleware can swap in array params; for our
 * single-value paths we always want the first scalar string.
 */
function paramString(value: unknown, fallback = ''): string {
  if (Array.isArray(value)) return String(value[0] ?? fallback);
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/**
 * GET /api/data-truth/quality/:symbol/:timeframe
 * Returns quality score for a specific symbol and timeframe
 */
router.get('/quality/:symbol/:timeframe', async (req: Request, res: Response) => {
  try {
    const symbol = paramString(req.params.symbol).toUpperCase();
    const timeframe = paramString(req.params.timeframe);

    const latestScore = (await db
      .select()
      .from(dataQualityScores)
      .where(
        and(
          eq(dataQualityScores.symbol, symbol),
          eq(dataQualityScores.timeframe, timeframe)
        )
      )
      .orderBy(desc(dataQualityScores.scoredAt))
      .limit(1)) as DataQualityScore[];

    if (latestScore.length === 0) {
      return res.status(404).json({
        error: 'No quality score found',
        symbol,
        timeframe,
      });
    }

    const score = latestScore[0];
    return res.json({
      symbol: score.symbol,
      timeframe: score.timeframe,
      source: score.source,
      qualityScore: score.qualityScore,
      freshnessScore: score.freshnessScore,
      completenessScore: score.completenessScore,
      consistencyScore: score.consistencyScore,
      gapCount: score.gapCount,
      staleBarCount: score.staleBarCount,
      totalBars: score.totalBars,
      scoredAt: score.scoredAt,
      metadata: score.metadata,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch quality score', details: String(error) });
  }
});

/**
 * GET /api/data-truth/feeds
 * Returns health status for all data feeds
 */
router.get('/feeds', async (_req: Request, res: Response) => {
  try {
    const allFeeds = (await db
      .select()
      .from(dataFeedHealth)
      .orderBy(desc(dataFeedHealth.checkedAt))) as DataFeedHealth[];

    const feeds = allFeeds.map((feed) => ({
      feedName: feed.feedName,
      status: feed.status,
      lastTickAt: feed.lastTickAt,
      avgLatencyMs: feed.avgLatencyMs,
      gapEvents24h: feed.gapEvents24h,
      uptime24hPct: feed.uptime24hPct,
      checkedAt: feed.checkedAt,
      details: feed.details,
    }));

    return res.json({ feeds, count: feeds.length });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch feed health', details: String(error) });
  }
});

/**
 * GET /api/data-truth/feeds/:feedName
 * Returns health status for a specific feed
 */
router.get('/feeds/:feedName', async (req: Request, res: Response) => {
  try {
    const feedName = paramString(req.params.feedName);

    const feed = (await db
      .select()
      .from(dataFeedHealth)
      .where(eq(dataFeedHealth.feedName, feedName))
      .limit(1)) as DataFeedHealth[];

    if (feed.length === 0) {
      return res.status(404).json({
        error: 'Feed not found',
        feedName,
      });
    }

    const f = feed[0];
    return res.json({
      feedName: f.feedName,
      status: f.status,
      lastTickAt: f.lastTickAt,
      avgLatencyMs: f.avgLatencyMs,
      gapEvents24h: f.gapEvents24h,
      uptime24hPct: f.uptime24hPct,
      checkedAt: f.checkedAt,
      details: f.details,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch feed health', details: String(error) });
  }
});

/**
 * GET /api/data-truth/consistency/:symbol
 * Returns cross-source consistency check for a symbol
 */
router.get('/consistency/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = paramString(req.params.symbol).toUpperCase();

    const checks = (await db
      .select()
      .from(dataConsistencyChecks)
      .where(eq(dataConsistencyChecks.symbol, symbol))
      .orderBy(desc(dataConsistencyChecks.checkedAt))
      .limit(10)) as DataConsistencyCheck[];

    if (checks.length === 0) {
      return res.status(404).json({
        error: 'No consistency checks found',
        symbol,
      });
    }

    const results = checks.map((check) => ({
      symbol: check.symbol,
      timeframe: check.timeframe,
      checkType: check.checkType,
      sourceA: check.sourceA,
      sourceB: check.sourceB,
      divergenceScore: check.divergenceScore,
      divergenceDetails: check.divergenceDetails,
      checkedAt: check.checkedAt,
    }));

    return res.json({
      symbol,
      checks: results,
      count: results.length,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch consistency checks', details: String(error) });
  }
});

/**
 * GET /api/data-truth/gate/:symbol/:timeframe
 * Returns pass/fail/warn gate check for a symbol and mode
 */
router.get('/gate/:symbol/:timeframe', async (req: Request, res: Response) => {
  try {
    const symbol = paramString(req.params.symbol).toUpperCase();
    const timeframe = paramString(req.params.timeframe);
    const mode = paramString(req.query.mode, 'live');

    if (!['backtest', 'paper', 'live'].includes(mode)) {
      return res.status(400).json({
        error: 'Invalid mode',
        validModes: ['backtest', 'paper', 'live'],
      });
    }

    const latestScore = (await db
      .select()
      .from(dataQualityScores)
      .where(
        and(
          eq(dataQualityScores.symbol, symbol),
          eq(dataQualityScores.timeframe, timeframe)
        )
      )
      .orderBy(desc(dataQualityScores.scoredAt))
      .limit(1)) as DataQualityScore[];

    if (latestScore.length === 0) {
      return res.status(404).json({
        error: 'No quality score found',
        symbol,
        timeframe,
      });
    }

    const score = latestScore[0];
    const verdict = dataTruthGate(
      score.symbol,
      score.timeframe,
      score.qualityScore,
      mode as 'backtest' | 'paper' | 'live'
    );

    return res.json(verdict);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to execute gate check', details: String(error) });
  }
});

/**
 * GET /api/data-truth/system
 * Returns overall system data truth status (aggregate)
 */
router.get('/system', async (_req: Request, res: Response) => {
  try {
    // Aggregate feed health
    const allFeeds = (await db.select().from(dataFeedHealth)) as DataFeedHealth[];

    const healthyCount = allFeeds.filter((f) => f.status === 'healthy').length;
    const degradedCount = allFeeds.filter((f) => f.status === 'degraded').length;
    const staleCount = allFeeds.filter((f) => f.status === 'stale').length;
    const deadCount = allFeeds.filter((f) => f.status === 'dead').length;

    const avgLatency =
      allFeeds.length > 0
        ? allFeeds.reduce((sum: number, f: DataFeedHealth) => sum + (f.avgLatencyMs ?? 0), 0) /
          allFeeds.length
        : 0;

    const avgUptime =
      allFeeds.length > 0
        ? allFeeds.reduce((sum: number, f: DataFeedHealth) => sum + (f.uptime24hPct ?? 0), 0) /
          allFeeds.length
        : 0;

    // Aggregate quality scores
    const latestQualityScores = (await db
      .select()
      .from(dataQualityScores)
      .orderBy(desc(dataQualityScores.scoredAt))
      .limit(50)) as DataQualityScore[];

    const symbolQuality = new Map<string, number[]>();
    latestQualityScores.forEach((score) => {
      if (!symbolQuality.has(score.symbol)) {
        symbolQuality.set(score.symbol, []);
      }
      symbolQuality.get(score.symbol)!.push(score.qualityScore);
    });

    const avgQuality =
      latestQualityScores.length > 0
        ? latestQualityScores.reduce((sum: number, s: DataQualityScore) => sum + s.qualityScore, 0) /
          latestQualityScores.length
        : 0;

    // Determine overall system status
    let systemStatus = 'healthy';
    if (deadCount > 0) {
      systemStatus = 'degraded';
    }
    if (deadCount > allFeeds.length * 0.25) {
      systemStatus = 'stale';
    }

    return res.json({
      status: systemStatus,
      timestamp: new Date(),
      feeds: {
        total: allFeeds.length,
        healthy: healthyCount,
        degraded: degradedCount,
        stale: staleCount,
        dead: deadCount,
        avgLatencyMs: parseFloat(avgLatency.toFixed(2)),
        avgUptime24hPct: parseFloat(avgUptime.toFixed(2)),
      },
      quality: {
        dataPoints: latestQualityScores.length,
        symbols: symbolQuality.size,
        avgQuality: parseFloat(avgQuality.toFixed(3)),
      },
      lastUpdate: allFeeds.length > 0 ? allFeeds[0].checkedAt : new Date(),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to compute system status', details: String(error) });
  }
});

export default router;
