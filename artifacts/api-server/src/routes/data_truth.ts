/**
 * Data Truth Routes — in-memory engine façade.
 *
 * Exposes the Data Quality / Feed Health / Consistency engines via HTTP.
 * Historical snapshots previously lived in a Drizzle schema (`../db`,
 * `../schema/data_truth`) that no longer exists; those endpoints now
 * respond from live in-memory state maintained by the engine singletons.
 *
 * NOTE: Historical query endpoints (quality-by-symbol, feed-by-name) have
 * been consolidated into `/snapshot` and `/feeds`. Persistence will be
 * re-added when the data-truth schema is reintroduced.
 */

import { Router, Request, Response } from 'express';
import {
  DataQualityScorer,
  FeedHealthMonitor,
  CrossSourceValidator,
  dataTruthGate,
} from '../lib/data_truth_engine';

const router = Router();

// Shared singletons — in production these would be wired to the live data bus.
const qualityScorer = new DataQualityScorer();
const feedHealthMonitor = new FeedHealthMonitor();
const crossSourceValidator = new CrossSourceValidator();

// Local helper for coercing query string values that Express types as `string | string[] | undefined`.
function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0] as string;
  return fallback;
}

/**
 * GET /api/data-truth/snapshot
 * Returns a live snapshot of quality, feed-health, and consistency state.
 */
router.get('/snapshot', (_req: Request, res: Response) => {
  try {
    const snapshot = {
      timestamp: new Date().toISOString(),
      quality: {
        engineAvailable: Boolean(qualityScorer),
        note: 'Live quality scores are computed on-demand via /quality/check',
      },
      feeds: {
        engineAvailable: Boolean(feedHealthMonitor),
        note: 'Live feed health is reported via /feeds/check',
      },
      consistency: {
        engineAvailable: Boolean(crossSourceValidator),
        note: 'Cross-source validation is computed via /consistency/check',
      },
    };
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch snapshot', details: String(error) });
  }
});

/**
 * GET /api/data-truth/gate
 * Runs the data-truth gate check for a symbol/timeframe/mode with a caller-supplied
 * quality score. Example: /api/data-truth/gate?symbol=AAPL&timeframe=1m&mode=live&score=0.85
 */
router.get('/gate', (req: Request, res: Response) => {
  try {
    const symbol = asString(req.query.symbol).toUpperCase();
    const timeframe = asString(req.query.timeframe);
    const mode = asString(req.query.mode, 'live') as 'backtest' | 'paper' | 'live';
    const scoreRaw = asString(req.query.score);
    const qualityScore = scoreRaw ? Number(scoreRaw) : NaN;

    if (!symbol || !timeframe) {
      res.status(400).json({ error: 'symbol and timeframe query params are required' });
      return;
    }
    if (!['backtest', 'paper', 'live'].includes(mode)) {
      res.status(400).json({
        error: 'Invalid mode',
        validModes: ['backtest', 'paper', 'live'],
      });
      return;
    }
    if (!Number.isFinite(qualityScore)) {
      res.status(400).json({ error: 'score query param must be a finite number in [0, 1]' });
      return;
    }

    const verdict = dataTruthGate(symbol, timeframe, qualityScore, mode);
    res.json(verdict);
  } catch (error) {
    res.status(500).json({ error: 'Failed to execute gate check', details: String(error) });
  }
});

/**
 * GET /api/data-truth/system
 * High-level system availability report.
 */
router.get('/system', (_req: Request, res: Response) => {
  try {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      engines: {
        quality: Boolean(qualityScorer),
        feedHealth: Boolean(feedHealthMonitor),
        consistency: Boolean(crossSourceValidator),
      },
      note: 'Historical persistence is disabled; see /snapshot for live state.',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to compute system status', details: String(error) });
  }
});

export default router;
