import { EventEmitter } from 'events';

/**
 * Configuration for the trade journal
 */
export interface JournalConfig {
  /** Maximum number of entries to store before circular overwrite */
  maxEntries?: number;
  /** Dimensions for performance attribution analysis */
  attributionDimensions?: string[];
}

/**
 * Individual trade journal entry
 */
export interface JournalEntry {
  /** Unique identifier for the journal entry */
  id: string;
  /** Trade identifier linking to the original trade */
  tradeId: string;
  /** Trading symbol (e.g., "BTC/USD", "AAPL") */
  symbol: string;
  /** Trade direction - long or short */
  side: 'long' | 'short';
  /** Entry price for the trade */
  entryPrice: number;
  /** Exit price for the trade */
  exitPrice: number;
  /** Quantity of the asset traded */
  quantity: number;
  /** ISO timestamp of trade entry */
  entryTime: string;
  /** ISO timestamp of trade exit */
  exitTime: string;
  /** Profit or loss in base currency */
  pnl: number;
  /** Profit or loss as percentage */
  pnlPct: number;
  /** Total fees incurred in this trade */
  fees: number;
  /** Net profit or loss after fees */
  netPnl: number;
  /** Holding period in milliseconds */
  holdingPeriodMs: number;
  /** Strategy name used for this trade */
  strategy: string;
  /** Market regime (e.g., "trending", "ranging", "volatile") */
  regime: string;
  /** Trading timeframe (e.g., "1h", "4h", "1d") */
  timeframe: string;
  /** Setup pattern or trigger name */
  setup: string;
  /** Signal confidence score (0-100) */
  signalScore: number;
  /** Additional notes about the trade */
  notes: string;
  /** Custom tags for categorization */
  tags: string[];
  /** Arbitrary metadata for extensibility */
  metadata: Record<string, unknown>;
}

/**
 * Attribution analysis result for a specific dimension
 */
export interface Attribution {
  /** The dimension being analyzed */
  dimension: string;
  /** Statistics for each value within the dimension */
  values: {
    /** Label for this attribute value */
    label: string;
    /** Number of trades with this attribute */
    trades: number;
    /** Total P&L for trades with this attribute */
    totalPnl: number;
    /** Average P&L per trade */
    avgPnl: number;
    /** Win rate as decimal (0-1) */
    winRate: number;
    /** Profit factor (total wins / total losses) */
    profitFactor: number;
    /** Average holding time in milliseconds */
    avgHoldTime: number;
    /** Best single trade P&L */
    bestTrade: number;
    /** Worst single trade P&L */
    worstTrade: number;
  }[];
}

/**
 * Summary statistics for trade journal performance
 */
export interface PerformanceSummary {
  /** Total number of closed trades */
  totalTrades: number;
  /** Number of winning trades */
  winningTrades: number;
  /** Number of losing trades */
  losingTrades: number;
  /** Win rate as decimal (0-1) */
  winRate: number;
  /** Average profit per winning trade */
  avgWin: number;
  /** Average loss per losing trade */
  avgLoss: number;
  /** Largest single winning trade */
  largestWin: number;
  /** Largest single losing trade */
  largestLoss: number;
  /** Profit factor (total wins / total losses) */
  profitFactor: number;
  /** Expectancy value per trade */
  expectancy: number;
  /** Total profit/loss before fees */
  totalPnl: number;
  /** Total fees paid */
  totalFees: number;
  /** Net profit/loss after fees */
  netPnl: number;
  /** Average holding time in milliseconds */
  avgHoldTimeMs: number;
  /** Average number of trades per calendar day */
  tradesPerDay: number;
  /** Current consecutive winning trades */
  consecutiveWins: number;
  /** Current consecutive losing trades */
  consecutiveLosses: number;
  /** Current streak status */
  currentStreak: {
    type: 'win' | 'loss';
    count: number;
  };
}

/**
 * Daily P&L aggregation
 */
export interface DailyPnl {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Number of trades on this date */
  trades: number;
  /** Daily profit/loss */
  pnl: number;
  /** Cumulative profit/loss up to this date */
  cumPnl: number;
  /** Win rate for this day */
  winRate: number;
}

/**
 * TradeJournal - Comprehensive trade tracking with performance attribution
 *
 * Manages a journal of trades with full performance analytics, attribution analysis,
 * and streak tracking. Emits events for milestones and notable occurrences.
 *
 * @example
 * ```ts
 * const journal = new TradeJournal({ maxEntries: 10000 });
 * journal.on('entry:added', (entry) => console.log('Trade added:', entry.id));
 * journal.on('milestone:reached', (count) => console.log('Reached', count, 'trades'));
 * ```
 */
export class TradeJournal extends EventEmitter {
  private entries: Map<string, JournalEntry> = new Map();
  private config: Required<JournalConfig>;
  private entryIds: string[] = [];

  /**
   * Create a new trade journal instance
   * @param config Configuration options
   */
  constructor(config: JournalConfig = {}) {
    super();
    this.config = {
      maxEntries: config.maxEntries ?? 10000,
      attributionDimensions: config.attributionDimensions ?? [
        'strategy',
        'regime',
        'timeframe',
        'setup',
        'symbol',
      ],
    };
  }

  /**
   * Add a new trade entry to the journal
   *
   * Calculates derived fields (pnl, pnlPct, netPnl, holdingPeriodMs) automatically.
   * Emits 'entry:added' event and may emit 'milestone:reached' for trade milestones.
   *
   * @param entry Trade entry data (id, pnl, pnlPct, netPnl, holdingPeriodMs are computed)
   * @returns The complete journal entry with calculated fields
   */
  addEntry(
    entry: Omit<
      JournalEntry,
      'id' | 'pnl' | 'pnlPct' | 'netPnl' | 'holdingPeriodMs'
    >
  ): JournalEntry {
    // Generate ID if not provided
    const id = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Calculate derived fields
    const entryDate = new Date(entry.entryTime).getTime();
    const exitDate = new Date(entry.exitTime).getTime();
    const holdingPeriodMs = exitDate - entryDate;

    const priceDiff =
      entry.side === 'long'
        ? entry.exitPrice - entry.entryPrice
        : entry.entryPrice - entry.exitPrice;

    const pnl = priceDiff * entry.quantity;
    const pnlPct = (priceDiff / entry.entryPrice) * 100;
    const netPnl = pnl - entry.fees;

    const completeEntry: JournalEntry = {
      ...entry,
      id,
      pnl,
      pnlPct,
      netPnl,
      holdingPeriodMs,
    };

    // Check if we need to evict oldest entry
    if (this.entries.size >= this.config.maxEntries) {
      const oldestId = this.entryIds.shift();
      if (oldestId) {
        this.entries.delete(oldestId);
      }
    }

    this.entries.set(id, completeEntry);
    this.entryIds.push(id);

    // Emit entry added event
    this.emit('entry:added', completeEntry);

    // Check for milestones (every 100 trades)
    if (this.entries.size % 100 === 0) {
      this.emit('milestone:reached', this.entries.size);
    }

    // Check for streak changes
    this._checkStreakChange();

    return completeEntry;
  }

  /**
   * Retrieve a specific journal entry by ID
   *
   * @param id The entry ID to retrieve
   * @returns The journal entry or undefined if not found
   */
  getEntry(id: string): JournalEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get filtered journal entries
   *
   * @param filters Optional filter criteria
   * @returns Array of matching journal entries
   */
  getEntries(filters?: {
    symbol?: string;
    strategy?: string;
    regime?: string;
    fromDate?: string;
    toDate?: string;
    side?: 'long' | 'short';
    minPnl?: number;
  }): JournalEntry[] {
    let result = Array.from(this.entries.values());

    if (!filters) {
      return result;
    }

    if (filters.symbol) {
      result = result.filter((e) => e.symbol === filters.symbol);
    }

    if (filters.strategy) {
      result = result.filter((e) => e.strategy === filters.strategy);
    }

    if (filters.regime) {
      result = result.filter((e) => e.regime === filters.regime);
    }

    if (filters.side) {
      result = result.filter((e) => e.side === filters.side);
    }

    if (filters.minPnl !== undefined) {
      result = result.filter((e) => e.netPnl >= filters.minPnl!);
    }

    if (filters.fromDate) {
      const fromTime = new Date(filters.fromDate).getTime();
      result = result.filter((e) => new Date(e.entryTime).getTime() >= fromTime);
    }

    if (filters.toDate) {
      const toTime = new Date(filters.toDate).getTime();
      result = result.filter((e) => new Date(e.exitTime).getTime() <= toTime);
    }

    return result;
  }

  /**
   * Calculate performance summary statistics
   *
   * @param filters Optional filter criteria (same as getEntries)
   * @returns Performance summary statistics
   */
  getSummary(
    filters?: {
      symbol?: string;
      strategy?: string;
      regime?: string;
      fromDate?: string;
      toDate?: string;
      side?: 'long' | 'short';
      minPnl?: number;
    }
  ): PerformanceSummary {
    const trades = this.getEntries(filters);

    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        profitFactor: 0,
        expectancy: 0,
        totalPnl: 0,
        totalFees: 0,
        netPnl: 0,
        avgHoldTimeMs: 0,
        tradesPerDay: 0,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        currentStreak: { type: 'loss', count: 0 },
      };
    }

    // Separate wins and losses
    const wins = trades.filter((t) => t.netPnl > 0);
    const losses = trades.filter((t) => t.netPnl < 0);

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
    const netPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);

    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.netPnl, 0) / wins.length : 0;
    const avgLoss =
      losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0) / losses.length) : 0;

    const largestWin =
      wins.length > 0 ? Math.max(...wins.map((t) => t.netPnl)) : 0;
    const largestLoss =
      losses.length > 0 ? Math.abs(Math.min(...losses.map((t) => t.netPnl))) : 0;

    const profitFactor =
      losses.length > 0
        ? Math.abs(
            wins.reduce((sum, t) => sum + t.netPnl, 0) /
              losses.reduce((sum, t) => sum + t.netPnl, 0)
          )
        : wins.length > 0
          ? Infinity
          : 0;

    const avgHoldTimeMs =
      trades.reduce((sum, t) => sum + t.holdingPeriodMs, 0) / trades.length;

    // Calculate days between first and last trade
    const firstTradeTime = new Date(trades[0].entryTime).getTime();
    const lastTradeTime = new Date(trades[trades.length - 1].exitTime).getTime();
    const daysSpan = Math.max(1, (lastTradeTime - firstTradeTime) / (1000 * 60 * 60 * 24));
    const tradesPerDay = trades.length / daysSpan;

    // Current streak
    const currentStreak = this._getCurrentStreak(trades);
    const consecutiveWins =
      currentStreak.type === 'win' ? currentStreak.count : 0;
    const consecutiveLosses =
      currentStreak.type === 'loss' ? currentStreak.count : 0;

    const expectancy = netPnl / trades.length;

    return {
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: wins.length / trades.length,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
      expectancy,
      totalPnl,
      totalFees,
      netPnl,
      avgHoldTimeMs,
      tradesPerDay,
      consecutiveWins,
      consecutiveLosses,
      currentStreak,
    };
  }

  /**
   * Get performance attribution for a specific dimension
   *
   * Analyzes performance across different attribute values (e.g., all trades
   * with strategy "RSI Divergence") to identify which attributes are most profitable.
   *
   * @param dimension The dimension to analyze (must be in config.attributionDimensions)
   * @returns Attribution analysis with statistics per dimension value
   */
  getAttribution(dimension: string): Attribution {
    const trades = Array.from(this.entries.values());

    // Group trades by dimension value
    const grouped = new Map<string, JournalEntry[]>();

    for (const trade of trades) {
      const value = (trade as unknown as Record<string, unknown>)[dimension] as string;
      if (!grouped.has(value)) {
        grouped.set(value, []);
      }
      grouped.get(value)!.push(trade);
    }

    // Calculate statistics for each group
    const values = Array.from(grouped.entries()).map(([label, groupTrades]) => {
      const wins = groupTrades.filter((t) => t.netPnl > 0);
      const losses = groupTrades.filter((t) => t.netPnl < 0);

      const totalPnl = groupTrades.reduce((sum, t) => sum + t.netPnl, 0);
      const avgPnl = totalPnl / groupTrades.length;
      const winRate = groupTrades.length > 0 ? wins.length / groupTrades.length : 0;

      const totalWins = wins.reduce((sum, t) => sum + t.netPnl, 0);
      const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0));
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : wins.length > 0 ? Infinity : 0;

      const avgHoldTime =
        groupTrades.reduce((sum, t) => sum + t.holdingPeriodMs, 0) /
        groupTrades.length;

      const bestTrade = Math.max(...groupTrades.map((t) => t.netPnl));
      const worstTrade = Math.min(...groupTrades.map((t) => t.netPnl));

      return {
        label,
        trades: groupTrades.length,
        totalPnl,
        avgPnl,
        winRate,
        profitFactor,
        avgHoldTime,
        bestTrade,
        worstTrade,
      };
    });

    // Sort by total P&L descending
    values.sort((a, b) => b.totalPnl - a.totalPnl);

    return {
      dimension,
      values,
    };
  }

  /**
   * Get daily P&L aggregation
   *
   * @param days Number of recent days to include (default: all)
   * @returns Array of daily P&L data
   */
  getDailyPnl(days?: number): DailyPnl[] {
    const trades = Array.from(this.entries.values());

    if (trades.length === 0) {
      return [];
    }

    // Group trades by date
    const dailyMap = new Map<string, JournalEntry[]>();

    for (const trade of trades) {
      const date = new Date(trade.exitTime).toISOString().split('T')[0];
      if (!dailyMap.has(date)) {
        dailyMap.set(date, []);
      }
      dailyMap.get(date)!.push(trade);
    }

    // Convert to array and sort chronologically
    const dates = Array.from(dailyMap.keys()).sort();

    // Apply day limit if specified
    const datesFiltered = days ? dates.slice(-days) : dates;

    let cumPnl = 0;
    const result: DailyPnl[] = [];

    for (const date of datesFiltered) {
      const dayTrades = dailyMap.get(date)!;
      const pnl = dayTrades.reduce((sum, t) => sum + t.netPnl, 0);
      cumPnl += pnl;

      const winningTrades = dayTrades.filter((t) => t.netPnl > 0).length;
      const winRate =
        dayTrades.length > 0 ? winningTrades / dayTrades.length : 0;

      result.push({
        date,
        trades: dayTrades.length,
        pnl,
        cumPnl,
        winRate,
      });
    }

    return result;
  }

  /**
   * Get historical winning and losing streaks
   *
   * @returns Object containing all win streaks, loss streaks, and current streak
   */
  getStreaks(): {
    winStreaks: number[];
    lossStreaks: number[];
    currentStreak: { type: 'win' | 'loss'; count: number };
  } {
    const trades = Array.from(this.entries.values());

    if (trades.length === 0) {
      return {
        winStreaks: [],
        lossStreaks: [],
        currentStreak: { type: 'loss', count: 0 },
      };
    }

    const winStreaks: number[] = [];
    const lossStreaks: number[] = [];
    let currentStreakType: 'win' | 'loss' | null = null;
    let currentStreakCount = 0;

    for (const trade of trades) {
      const isWin = trade.netPnl > 0;
      const streakType: 'win' | 'loss' = isWin ? 'win' : 'loss';

      if (currentStreakType === streakType) {
        currentStreakCount++;
      } else {
        // Streak changed
        if (currentStreakType === 'win' && currentStreakCount > 0) {
          winStreaks.push(currentStreakCount);
        } else if (currentStreakType === 'loss' && currentStreakCount > 0) {
          lossStreaks.push(currentStreakCount);
        }

        currentStreakType = streakType;
        currentStreakCount = 1;
      }
    }

    // Add final streak
    if (currentStreakType === 'win' && currentStreakCount > 0) {
      winStreaks.push(currentStreakCount);
    } else if (currentStreakType === 'loss' && currentStreakCount > 0) {
      lossStreaks.push(currentStreakCount);
    }

    const currentStreak: { type: 'win' | 'loss'; count: number } = {
      type: currentStreakType || 'loss',
      count: currentStreakCount,
    };

    return {
      winStreaks,
      lossStreaks,
      currentStreak,
    };
  }

  /**
   * Export all journal entries as CSV
   *
   * Generates a CSV file with all trade entries. All fields are included
   * with proper escaping for complex values.
   *
   * @returns CSV string representation of all entries
   */
  exportCSV(): string {
    const trades = Array.from(this.entries.values());

    if (trades.length === 0) {
      return '';
    }

    // Define CSV headers
    const headers = [
      'id',
      'tradeId',
      'symbol',
      'side',
      'entryPrice',
      'exitPrice',
      'quantity',
      'entryTime',
      'exitTime',
      'pnl',
      'pnlPct',
      'fees',
      'netPnl',
      'holdingPeriodMs',
      'strategy',
      'regime',
      'timeframe',
      'setup',
      'signalScore',
      'notes',
      'tags',
    ];

    // Escape CSV field value
    const escapeField = (value: unknown): string => {
      if (value === null || value === undefined) {
        return '';
      }

      let str = String(value);

      // Quote if contains comma, newline, or quote
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        str = `"${str.replace(/"/g, '""')}"`;
      }

      return str;
    };

    // Build CSV
    let csv = headers.join(',') + '\n';

    for (const trade of trades) {
      const row = [
        trade.id,
        trade.tradeId,
        trade.symbol,
        trade.side,
        trade.entryPrice,
        trade.exitPrice,
        trade.quantity,
        trade.entryTime,
        trade.exitTime,
        trade.pnl,
        trade.pnlPct,
        trade.fees,
        trade.netPnl,
        trade.holdingPeriodMs,
        trade.strategy,
        trade.regime,
        trade.timeframe,
        trade.setup,
        trade.signalScore,
        trade.notes,
        trade.tags.join(';'),
      ];

      csv += row.map(escapeField).join(',') + '\n';
    }

    return csv;
  }

  /**
   * Clear all entries from the journal
   *
   * Removes all trades and resets internal state.
   */
  clear(): void {
    this.entries.clear();
    this.entryIds = [];
  }

  /**
   * Get the number of entries in the journal
   *
   * @returns Current entry count
   */
  getSize(): number {
    return this.entries.size;
  }

  /**
   * Check if current streak has changed and emit event if so
   *
   * @private
   */
  private _checkStreakChange(): void {
    const trades = Array.from(this.entries.values());

    if (trades.length < 2) {
      return;
    }

    // Get last two trades
    const lastTrade = trades[trades.length - 1];
    const prevTrade = trades[trades.length - 2];

    const lastIsWin = lastTrade.netPnl > 0;
    const prevIsWin = prevTrade.netPnl > 0;

    // If streak changed, emit event
    if (lastIsWin !== prevIsWin) {
      const streak = this._getCurrentStreak(trades);
      this.emit('streak:broken', streak);
    }
  }

  /**
   * Calculate current streak from trade array
   *
   * @private
   */
  private _getCurrentStreak(
    trades: JournalEntry[]
  ): { type: 'win' | 'loss'; count: number } {
    if (trades.length === 0) {
      return { type: 'loss', count: 0 };
    }

    let count = 1;
    const isWin = trades[trades.length - 1].netPnl > 0;

    for (let i = trades.length - 2; i >= 0; i--) {
      const tradeIsWin = trades[i].netPnl > 0;
      if (tradeIsWin === isWin) {
        count++;
      } else {
        break;
      }
    }

    return {
      type: isWin ? 'win' : 'loss',
      count,
    };
  }
}
