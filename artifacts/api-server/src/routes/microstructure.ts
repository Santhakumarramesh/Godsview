import { Router, type IRouter } from "express";
import { orderBookRecorder } from "../lib/market/orderbook_recorder";
import {
  buildMicrostructureSnapshot,
  normalizeMicrostructureSymbol,
  orderflowSnapshotStore,
  validateMicrostructureSymbol,
} from "../lib/market_microstructure";
import type { MicrostructureCurrentSnapshot, MicrostructureEventRecord } from "../lib/market_microstructure";

const router: IRouter = Router();

function parseIntInRange(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseFloatInRange(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseBool(raw: unknown, fallback = false): boolean {
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(value)) return true;
  if (["0", "false", "no", "n", "off"].includes(value)) return false;
  return fallback;
}

function parseTimeMs(raw: unknown, fallbackMs: number): number {
  const value = String(raw ?? "").trim();
  if (!value) return fallbackMs;
  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? dateMs : Number.NaN;
}

function unwrapErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function asMicrostructureError(err: unknown): { status: number; code: string; message: string } {
  const message = unwrapErrorMessage(err);
  if (message.startsWith("unsupported_symbol:")) {
    return {
      status: 400,
      code: "unsupported_symbol",
      message,
    };
  }
  return {
    status: 503,
    code: "microstructure_failed",
    message,
  };
}

async function getSnapshot(
  symbolInput: string,
  options: {
    depth?: number;
    top_levels?: number;
    tape_window_sec?: number;
    heatmap_bucket_pct?: number;
    heatmap_top_n?: number;
    force_fresh?: boolean;
    max_age_ms?: number;
  },
): Promise<{ snapshot: MicrostructureCurrentSnapshot; emitted: MicrostructureEventRecord[] }> {
  const symbol = validateMicrostructureSymbol(symbolInput);
  const maxAgeMs = Math.max(250, Math.min(30_000, options.max_age_ms ?? 5_000));

  const cached = orderflowSnapshotStore.latestSnapshot(symbol);
  if (!options.force_fresh && cached) {
    const age = Date.now() - Date.parse(cached.generated_at);
    if (Number.isFinite(age) && age >= 0 && age <= maxAgeMs) {
      return { snapshot: cached, emitted: [] };
    }
  }

  const { snapshot, events } = await buildMicrostructureSnapshot(symbol, {
    depth: options.depth,
    top_levels: options.top_levels,
    tape_window_sec: options.tape_window_sec,
    heatmap_bucket_pct: options.heatmap_bucket_pct,
    heatmap_top_n: options.heatmap_top_n,
    force_fresh: options.force_fresh,
  });

  return {
    snapshot,
    emitted: events,
  };
}

router.get("/microstructure/:symbol/current", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const depth = parseIntInRange(req.query.depth, 40, 10, 120);
    const topLevels = parseIntInRange(req.query.top_levels, 10, 3, 25);
    const tapeWindowSec = parseIntInRange(req.query.window_sec, 120, 10, 900);
    const forceFresh = parseBool(req.query.force_fresh, false);

    const { snapshot, emitted } = await getSnapshot(symbol, {
      depth,
      top_levels: topLevels,
      tape_window_sec: tapeWindowSec,
      force_fresh: forceFresh,
      max_age_ms: parseIntInRange(req.query.max_age_ms, 5_000, 250, 30_000),
    });

    res.json({
      symbol: normalizeMicrostructureSymbol(symbol),
      generated_at: snapshot.generated_at,
      snapshot,
      emitted_events: emitted,
      status: orderflowSnapshotStore.status(symbol),
    });
  } catch (err) {
    const parsed = asMicrostructureError(err);
    req.log.error({ err }, "Failed to build microstructure snapshot");
    res.status(parsed.status).json({ error: parsed.code, message: parsed.message });
  }
});

router.get("/microstructure/:symbol/orderbook", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const depth = parseIntInRange(req.query.depth, 40, 10, 120);
    const { snapshot } = await getSnapshot(symbol, {
      depth,
      top_levels: parseIntInRange(req.query.top_levels, 10, 3, 25),
      force_fresh: parseBool(req.query.force_fresh, false),
      max_age_ms: parseIntInRange(req.query.max_age_ms, 5_000, 250, 30_000),
    });

    res.json({
      symbol: snapshot.symbol,
      generated_at: snapshot.generated_at,
      orderbook: snapshot.orderbook,
      imbalance: snapshot.imbalance,
      absorption: snapshot.absorption,
    });
  } catch (err) {
    const parsed = asMicrostructureError(err);
    req.log.error({ err }, "Failed to load microstructure orderbook");
    res.status(parsed.status).json({ error: parsed.code, message: parsed.message });
  }
});

router.get("/microstructure/:symbol/heatmap", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const depth = parseIntInRange(req.query.depth, 40, 10, 120);
    const { snapshot } = await getSnapshot(symbol, {
      depth,
      heatmap_bucket_pct: parseFloatInRange(req.query.bucket_pct, 0.1, 0.02, 2),
      heatmap_top_n: parseIntInRange(req.query.top_n, 20, 5, 40),
      force_fresh: parseBool(req.query.force_fresh, false),
      max_age_ms: parseIntInRange(req.query.max_age_ms, 5_000, 250, 30_000),
    });

    res.json({
      symbol: snapshot.symbol,
      generated_at: snapshot.generated_at,
      heatmap: snapshot.heatmap,
      orderbook_mid_price: snapshot.orderbook.mid_price,
    });
  } catch (err) {
    const parsed = asMicrostructureError(err);
    req.log.error({ err }, "Failed to load microstructure heatmap");
    res.status(parsed.status).json({ error: parsed.code, message: parsed.message });
  }
});

router.get("/microstructure/:symbol/tape", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const depth = parseIntInRange(req.query.depth, 40, 10, 120);
    const { snapshot } = await getSnapshot(symbol, {
      depth,
      tape_window_sec: parseIntInRange(req.query.window_sec, 120, 10, 900),
      force_fresh: parseBool(req.query.force_fresh, false),
      max_age_ms: parseIntInRange(req.query.max_age_ms, 5_000, 250, 30_000),
    });

    res.json({
      symbol: snapshot.symbol,
      generated_at: snapshot.generated_at,
      tape: snapshot.tape,
    });
  } catch (err) {
    const parsed = asMicrostructureError(err);
    req.log.error({ err }, "Failed to load microstructure tape");
    res.status(parsed.status).json({ error: parsed.code, message: parsed.message });
  }
});

router.get("/microstructure/:symbol/events", async (req, res) => {
  try {
    const symbol = validateMicrostructureSymbol(req.params.symbol);
    const limit = parseIntInRange(req.query.limit, 150, 1, 2000);
    const events = orderflowSnapshotStore.listEvents(symbol, limit);
    res.json({
      symbol,
      count: events.length,
      events,
      status: orderflowSnapshotStore.status(symbol),
    });
  } catch (err) {
    const parsed = asMicrostructureError(err);
    req.log.error({ err }, "Failed to load microstructure events");
    res.status(parsed.status).json({ error: parsed.code, message: parsed.message });
  }
});

router.get("/microstructure/:symbol/score", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const { snapshot } = await getSnapshot(symbol, {
      depth: parseIntInRange(req.query.depth, 40, 10, 120),
      top_levels: parseIntInRange(req.query.top_levels, 10, 3, 25),
      tape_window_sec: parseIntInRange(req.query.window_sec, 120, 10, 900),
      force_fresh: parseBool(req.query.force_fresh, false),
      max_age_ms: parseIntInRange(req.query.max_age_ms, 5_000, 250, 30_000),
    });

    res.json({
      symbol: snapshot.symbol,
      generated_at: snapshot.generated_at,
      score: snapshot.score,
      imbalance: snapshot.imbalance,
      absorption: snapshot.absorption,
      tape_summary: {
        score: snapshot.tape.score,
        bias: snapshot.tape.bias,
        normalized_delta: snapshot.tape.normalized_delta,
      },
      heatmap_summary: {
        zone_score: snapshot.heatmap.zone_score,
        zones: snapshot.heatmap.zones.length,
      },
    });
  } catch (err) {
    const parsed = asMicrostructureError(err);
    req.log.error({ err }, "Failed to load microstructure score");
    res.status(parsed.status).json({ error: parsed.code, message: parsed.message });
  }
});

router.post("/microstructure/:symbol/replay", async (req, res) => {
  try {
    const symbol = validateMicrostructureSymbol(req.params.symbol);
    const endMs = parseTimeMs(req.body?.end ?? req.query.end, Date.now());
    const startMs = parseTimeMs(req.body?.start ?? req.query.start, endMs - 15 * 60_000);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      res.status(400).json({
        error: "invalid_time_window",
        message: "start/end must be valid and start must be lower than end",
      });
      return;
    }

    const maxDurationMs = 48 * 60 * 60 * 1000;
    if (endMs - startMs > maxDurationMs) {
      res.status(400).json({
        error: "window_too_large",
        message: "maximum replay window is 48 hours",
        duration_ms: endMs - startMs,
        max_duration_ms: maxDurationMs,
      });
      return;
    }

    const downsampleMsRaw = req.body?.downsample_ms ?? req.query.downsample_ms;
    const downsampleMs = downsampleMsRaw === undefined || downsampleMsRaw === null || downsampleMsRaw === ""
      ? undefined
      : parseIntInRange(downsampleMsRaw, 1_000, 1, 60_000);

    const replay = orderBookRecorder.getReplayWindow({
      symbol,
      startMs,
      endMs,
      downsampleMs,
      maxFrames: parseIntInRange(req.body?.max_frames ?? req.query.max_frames, 1_500, 50, 10_000),
      maxTicks: parseIntInRange(req.body?.max_ticks ?? req.query.max_ticks, 5_000, 50, 25_000),
      includeTicks: parseBool(req.body?.include_ticks ?? req.query.include_ticks, true),
    });

    const events = orderflowSnapshotStore.listEventsInRange(symbol, startMs, endMs);
    const snapshots = orderflowSnapshotStore
      .listSnapshots(symbol, parseIntInRange(req.body?.snapshot_limit ?? req.query.snapshot_limit, 500, 1, 5000))
      .filter((snapshot) => {
        const ts = Date.parse(snapshot.generated_at);
        return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
      });

    res.json({
      symbol,
      replay_window: {
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        duration_ms: endMs - startMs,
      },
      replay,
      microstructure_events: events,
      snapshots,
      status: orderflowSnapshotStore.status(symbol),
    });
  } catch (err) {
    const parsed = asMicrostructureError(err);
    req.log.error({ err }, "Failed to replay microstructure window");
    res.status(parsed.status).json({ error: parsed.code, message: parsed.message });
  }
});

export default router;
