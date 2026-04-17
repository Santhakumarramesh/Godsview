/**
 * replay_engine.ts — Interactive Market Replay Engine
 *
 * Bar-by-bar market replay for trade verification and education:
 *   - Pre-computed states for all bars
 *   - State snapshots at each bar (price, volume, indicators)
 *   - Trade annotation layer (entries, exits, signals)
 *   - Interactive playback controls (play, pause, step, seek)
 *   - Performance-optimized state retrieval
 *
 * Enables manual verification and pattern discovery in backtests.
 */

import { logger } from "../logger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BarData {
  barIndex: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp?: number | Date;
}

export interface Confirmation {
  barIndex: number;
  type: "entry" | "exit" | "signal";
  price: number;
  volume?: number;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface TradeOutcome {
  barIndex: number;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnlPrice: number;
  pnlR: number;
  exitBarIndex?: number;
}

export interface ReplayState {
  barIndex: number;
  bar: BarData;
  currentPrice: number;
  timestamp?: number | Date;
  activeConfirmations: Confirmation[];
  recentTrades: TradeOutcome[];
  indicators?: Record<string, number>;
}

export interface ReplayControl {
  playing: boolean;
  paused: boolean;
  currentBarIndex: number;
  totalBars: number;
  speed: number; // 1.0 = normal, 0.5 = half speed, 2.0 = 2x
}

export interface ReplayEvent {
  type: "bar_change" | "confirmation" | "trade_executed" | "playback_stopped";
  barIndex: number;
  data?: any;
}

// ── Replay Engine ──────────────────────────────────────────────────────────

export class ReplayEngine {
  private bars: BarData[];
  private confirmations: Confirmation[];
  private outcomes: TradeOutcome[];

  private currentBarIndex: number = 0;
  private playing: boolean = false;
  private paused: boolean = false;
  private speed: number = 1.0;
  private playbackInterval: NodeJS.Timeout | null = null;

  // Pre-computed state cache
  private stateCache: Map<number, ReplayState> = new Map();
  private confirmationIndex: Map<number, Confirmation[]> = new Map();
  private tradeIndex: Map<number, TradeOutcome[]> = new Map();

  constructor(bars: BarData[], confirmations: Confirmation[], outcomes: TradeOutcome[]) {
    this.bars = bars.sort((a, b) => a.barIndex - b.barIndex);
    this.confirmations = confirmations.sort((a, b) => a.barIndex - b.barIndex);
    this.outcomes = outcomes.sort((a, b) => a.barIndex - b.barIndex);

    this.buildIndex();
    logger.debug(
      { bars: bars.length, confirmations: confirmations.length, trades: outcomes.length },
      "ReplayEngine initialized"
    );
  }

  /**
   * Get state at specific bar (pre-computed)
   */
  getStateAtBar(barIndex: number): ReplayState {
    if (barIndex < 0 || barIndex >= this.bars.length) {
      throw new Error(`Invalid bar index: ${barIndex}`);
    }

    // Check cache
    if (this.stateCache.has(barIndex)) {
      return this.stateCache.get(barIndex)!;
    }

    const bar = this.bars[barIndex];
    const activeConfirmations = this.confirmationIndex.get(barIndex) || [];
    const recentTrades = this.tradeIndex.get(barIndex) || [];

    const state: ReplayState = {
      barIndex,
      bar,
      currentPrice: bar.close,
      timestamp: bar.timestamp,
      activeConfirmations,
      recentTrades,
    };

    this.stateCache.set(barIndex, state);
    return state;
  }

  /**
   * Start playback
   */
  play(): void {
    this.playing = true;
    this.paused = false;

    this.playbackInterval = setInterval(() => {
      if (!this.paused && this.currentBarIndex < this.bars.length - 1) {
        this.currentBarIndex++;
        this.getStateAtBar(this.currentBarIndex); // Ensure cached
      } else if (this.currentBarIndex >= this.bars.length - 1) {
        this.stop();
      }
    }, Math.max(100, Math.floor(100 / this.speed)));
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (this.playing && this.paused) {
      this.paused = false;
    }
  }

  /**
   * Stop playback
   */
  stop(): void {
    this.playing = false;
    this.paused = false;
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  /**
   * Step to next bar
   */
  stepNext(): ReplayState {
    if (this.currentBarIndex < this.bars.length - 1) {
      this.currentBarIndex++;
    }
    return this.getStateAtBar(this.currentBarIndex);
  }

  /**
   * Step to previous bar
   */
  stepPrev(): ReplayState {
    if (this.currentBarIndex > 0) {
      this.currentBarIndex--;
    }
    return this.getStateAtBar(this.currentBarIndex);
  }

  /**
   * Seek to specific bar
   */
  seek(barIndex: number): ReplayState {
    if (barIndex < 0 || barIndex >= this.bars.length) {
      throw new Error(`Invalid seek target: ${barIndex}`);
    }
    this.currentBarIndex = barIndex;
    return this.getStateAtBar(this.currentBarIndex);
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(speed, 4.0)); // 0.1x to 4x
    if (this.playing && !this.paused) {
      this.stop();
      this.play();
    }
  }

  /**
   * Advance playback and return events
   */
  advancePlayback(): ReplayEvent[] {
    const events: ReplayEvent[] = [];

    if (!this.playing || this.paused) {
      return events;
    }

    const prevIndex = this.currentBarIndex;
    this.stepNext();

    events.push({
      type: "bar_change",
      barIndex: this.currentBarIndex,
      data: this.getStateAtBar(this.currentBarIndex),
    });

    const confirmations = this.confirmationIndex.get(this.currentBarIndex) || [];
    confirmations.forEach((conf) => {
      events.push({
        type: "confirmation",
        barIndex: this.currentBarIndex,
        data: conf,
      });
    });

    const trades = this.tradeIndex.get(this.currentBarIndex) || [];
    trades.forEach((trade) => {
      events.push({
        type: "trade_executed",
        barIndex: this.currentBarIndex,
        data: trade,
      });
    });

    if (this.currentBarIndex >= this.bars.length - 1) {
      this.stop();
      events.push({
        type: "playback_stopped",
        barIndex: this.currentBarIndex,
      });
    }

    return events;
  }

  /**
   * Get current control state
   */
  getControl(): ReplayControl {
    return {
      playing: this.playing,
      paused: this.paused,
      currentBarIndex: this.currentBarIndex,
      totalBars: this.bars.length,
      speed: this.speed,
    };
  }

  /**
   * Get bar range
   */
  getBarRange(): { first: BarData; last: BarData; count: number } {
    return {
      first: this.bars[0],
      last: this.bars[this.bars.length - 1],
      count: this.bars.length,
    };
  }

  /**
   * Get all confirmations in range
   */
  getConfirmationsInRange(startIdx: number, endIdx: number): Confirmation[] {
    return this.confirmations.filter((c) => c.barIndex >= startIdx && c.barIndex <= endIdx);
  }

  /**
   * Get all trades in range
   */
  getTradesInRange(startIdx: number, endIdx: number): TradeOutcome[] {
    return this.outcomes.filter((t) => t.barIndex >= startIdx && t.barIndex <= endIdx);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private buildIndex(): void {
    // Index confirmations by bar
    this.confirmations.forEach((conf) => {
      if (!this.confirmationIndex.has(conf.barIndex)) {
        this.confirmationIndex.set(conf.barIndex, []);
      }
      this.confirmationIndex.get(conf.barIndex)!.push(conf);
    });

    // Index trades by bar
    this.outcomes.forEach((trade) => {
      if (!this.tradeIndex.has(trade.barIndex)) {
        this.tradeIndex.set(trade.barIndex, []);
      }
      this.tradeIndex.get(trade.barIndex)!.push(trade);
    });

    logger.debug(
      { confirmationBars: this.confirmationIndex.size, tradeBars: this.tradeIndex.size },
      "ReplayEngine index built"
    );
  }
}

/**
 * Factory function for creating replay engine
 */
export function createReplayEngine(
  bars: BarData[],
  confirmations: Confirmation[],
  outcomes: TradeOutcome[]
): ReplayEngine {
  return new ReplayEngine(bars, confirmations, outcomes);
}