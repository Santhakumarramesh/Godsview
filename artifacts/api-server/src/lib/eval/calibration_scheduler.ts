/**
 * calibration_scheduler.ts — Hourly Calibration Snapshot Cron (Phase 5)
 */

import {
  CalibrationTracker,
  type CalibrationReport,
  type DriftAlert,
} from "./calibration_tracker";
import { publishAlert } from "../signal_stream";
import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "calibration" });

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const INTERVAL_MS = parseInt(
  process.env.CALIBRATION_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
  10,
);
const HISTORY_MAX = parseInt(
  process.env.CALIBRATION_HISTORY_MAX ?? "168",
  10,
);
const REPORT_WINDOW_DAYS = parseInt(
  process.env.CALIBRATION_REPORT_WINDOW_DAYS ?? "30",
  10,
);
export interface CalibrationCycleResult {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "error";
  calibrationScore: number;
  driftAlert: DriftAlert | null;
  report: CalibrationReport | null;
  error: string | null;
}

const _history: CalibrationCycleResult[] = [];
let _currentCycle: CalibrationCycleResult | null = null;
let _tracker: CalibrationTracker | null = null;

export function getCalibrationTracker(): CalibrationTracker {
  if (!_tracker) {
    _tracker = new CalibrationTracker(logger as any);
  }
  return _tracker;
}

function recordCycle(cycle: CalibrationCycleResult): void {
  _history.unshift(cycle);
  while (_history.length > HISTORY_MAX) _history.pop();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
export class CalibrationScheduler {
  private static _instance: CalibrationScheduler | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _cycleCount = 0;

  static getInstance(): CalibrationScheduler {
    if (!CalibrationScheduler._instance) {
      CalibrationScheduler._instance = new CalibrationScheduler();
    }
    return CalibrationScheduler._instance;
  }

  isRunning(): boolean { return this._running; }
  getCycleCount(): number { return this._cycleCount; }
  getHistory(): CalibrationCycleResult[] { return [..._history]; }
  getCurrentCycle(): CalibrationCycleResult | null { return _currentCycle; }
  getIntervalMs(): number { return INTERVAL_MS; }

  start(): void {
    if (this._running) return;
    this._running = true;
    logger.info({ intervalMs: INTERVAL_MS, windowDays: REPORT_WINDOW_DAYS },
      "[calibration] Scheduler started");
    void this._runCycle();
    this._timer = setInterval(() => void this._runCycle(), INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._running = false;
  }

  async forceCycle(): Promise<CalibrationCycleResult> {
    return this._runCycle();
  }
  private async _runCycle(): Promise<CalibrationCycleResult> {
    const cycle: CalibrationCycleResult = {
      id: makeId("cal"),
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: "running",
      calibrationScore: 0,
      driftAlert: null,
      report: null,
      error: null,
    };
    _currentCycle = cycle;

    try {
      const tracker = getCalibrationTracker();
      const report = tracker.getCalibrationReport(REPORT_WINDOW_DAYS);
      const score = tracker.getCalibrationScore();
      const driftAlert = tracker.getDriftAlert();

      cycle.report = report;
      cycle.calibrationScore = score;
      cycle.driftAlert = driftAlert;
      cycle.status = "completed";

      publishAlert({
        type: "calibration_snapshot",
        cycleId: cycle.id, score, windowDays: REPORT_WINDOW_DAYS,
        hasDriftAlert: driftAlert !== null,
        driftSeverity: driftAlert?.severity ?? null,
        evaluatedAt: cycle.startedAt,
      });

      if (driftAlert !== null) {
        publishAlert({
          type: "calibration_drift",
          cycleId: cycle.id, severity: driftAlert.severity,
          dimension: driftAlert.dimension, description: driftAlert.description,
          expectedValue: driftAlert.expectedValue, actualValue: driftAlert.actualValue,
          divergence: driftAlert.divergence, score, evaluatedAt: cycle.startedAt,
        });
      }
    } catch (err: any) {
      cycle.status = "error";
      cycle.error = err?.message ?? String(err);
    } finally {
      cycle.completedAt = new Date().toISOString();
      _currentCycle = null;
      this._cycleCount++;
      recordCycle(cycle);
    }
    return cycle;
  }
}
