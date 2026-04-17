import { EventEmitter } from 'events';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface NormalizedTimestamp {
  utcMs: number;
  utcIso: string;
  exchangeLocal: string;
  exchangeTz: string;
  sessionState: 'pre_market' | 'regular' | 'after_hours' | 'closed' | 'always_on';
  tradingDay: string; // YYYY-MM-DD
  weekday: string;
  isHoliday: boolean;
}

export interface NormalizedSymbol {
  canonical: string; // "BTC/USD"
  alpaca: string; // "BTC/USD"
  exchange: string; // "CRYPTO", "NYSE", etc
  assetClass: 'crypto' | 'stocks' | 'forex' | 'futures' | 'options';
  baseCurrency: string;
  quoteCurrency: string;
  aliases: string[];
}

export interface ExchangeSession {
  exchangeCode: string;
  exchangeName: string;
  timezone: string;
  preMarket: { start: string; end: string } | null;
  regular: { start: string; end: string };
  afterHours: { start: string; end: string } | null;
  tradingDays: number[]; // 0=Sunday, 6=Saturday
  isAlwaysOn: boolean;
}

export interface SkewStats {
  source: string;
  currentSkew: number; // milliseconds
  averageSkew: number;
  maxSkew: number;
  minSkew: number;
  sampleCount: number;
  lastUpdate: number;
}

export interface SessionBounds {
  preMarketOpen: Date | null;
  marketOpen: Date;
  marketClose: Date;
  afterHoursClose: Date | null;
}

// ============================================================================
// EXCHANGE DEFINITIONS
// ============================================================================

const EXCHANGE_SESSIONS: Record<string, ExchangeSession> = {
  NYSE: {
    exchangeCode: 'NYSE',
    exchangeName: 'New York Stock Exchange',
    timezone: 'America/New_York',
    preMarket: { start: '04:00', end: '09:30' },
    regular: { start: '09:30', end: '16:00' },
    afterHours: { start: '16:00', end: '20:00' },
    tradingDays: [1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
  NASDAQ: {
    exchangeCode: 'NASDAQ',
    exchangeName: 'NASDAQ',
    timezone: 'America/New_York',
    preMarket: { start: '04:00', end: '09:30' },
    regular: { start: '09:30', end: '16:00' },
    afterHours: { start: '16:00', end: '20:00' },
    tradingDays: [1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
  CBOE: {
    exchangeCode: 'CBOE',
    exchangeName: 'Chicago Board Options Exchange',
    timezone: 'America/Chicago',
    preMarket: null,
    regular: { start: '08:30', end: '15:15' },
    afterHours: null,
    tradingDays: [1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
  CME: {
    exchangeCode: 'CME',
    exchangeName: 'Chicago Mercantile Exchange',
    timezone: 'America/Chicago',
    preMarket: null,
    regular: { start: '17:00', end: '16:00' }, // Note: spans midnight
    afterHours: null,
    tradingDays: [0, 1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
  CRYPTO: {
    exchangeCode: 'CRYPTO',
    exchangeName: 'Cryptocurrency Markets',
    timezone: 'UTC',
    preMarket: null,
    regular: { start: '00:00', end: '23:59' },
    afterHours: null,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
    isAlwaysOn: true,
  },
  FOREX: {
    exchangeCode: 'FOREX',
    exchangeName: 'Foreign Exchange Market',
    timezone: 'UTC',
    preMarket: null,
    regular: { start: '00:00', end: '23:59' },
    afterHours: null,
    tradingDays: [0, 1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
  LSE: {
    exchangeCode: 'LSE',
    exchangeName: 'London Stock Exchange',
    timezone: 'Europe/London',
    preMarket: null,
    regular: { start: '08:00', end: '16:30' },
    afterHours: null,
    tradingDays: [1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
  TSE: {
    exchangeCode: 'TSE',
    exchangeName: 'Tokyo Stock Exchange',
    timezone: 'Asia/Tokyo',
    preMarket: null,
    regular: { start: '09:00', end: '15:00' },
    afterHours: null,
    tradingDays: [1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
  ASX: {
    exchangeCode: 'ASX',
    exchangeName: 'Australian Securities Exchange',
    timezone: 'Australia/Sydney',
    preMarket: null,
    regular: { start: '10:00', end: '16:00' },
    afterHours: null,
    tradingDays: [1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
  HKEX: {
    exchangeCode: 'HKEX',
    exchangeName: 'Hong Kong Exchanges and Clearing',
    timezone: 'Asia/Hong_Kong',
    preMarket: null,
    regular: { start: '09:30', end: '16:00' },
    afterHours: null,
    tradingDays: [1, 2, 3, 4, 5],
    isAlwaysOn: false,
  },
};

// ============================================================================
// SYMBOL MAPPING
// ============================================================================

const SYMBOL_MAP: Record<string, NormalizedSymbol> = {
  // Crypto
  BTC: {
    canonical: 'BTC/USD',
    alpaca: 'BTC/USD',
    exchange: 'CRYPTO',
    assetClass: 'crypto',
    baseCurrency: 'BTC',
    quoteCurrency: 'USD',
    aliases: ['BTCUSD', 'BTC-USD', 'XBT/USD', 'BTC', 'bitcoin'],
  },
  ETH: {
    canonical: 'ETH/USD',
    alpaca: 'ETH/USD',
    exchange: 'CRYPTO',
    assetClass: 'crypto',
    baseCurrency: 'ETH',
    quoteCurrency: 'USD',
    aliases: ['ETHUSD', 'ETH-USD', 'ETH', 'ethereum'],
  },
  SOL: {
    canonical: 'SOL/USD',
    alpaca: 'SOL/USD',
    exchange: 'CRYPTO',
    assetClass: 'crypto',
    baseCurrency: 'SOL',
    quoteCurrency: 'USD',
    aliases: ['SOLUSD', 'SOL-USD', 'SOL', 'solana'],
  },
  AVAX: {
    canonical: 'AVAX/USD',
    alpaca: 'AVAX/USD',
    exchange: 'CRYPTO',
    assetClass: 'crypto',
    baseCurrency: 'AVAX',
    quoteCurrency: 'USD',
    aliases: ['AVAXUSD', 'AVAX-USD', 'AVAX'],
  },
  DOGE: {
    canonical: 'DOGE/USD',
    alpaca: 'DOGE/USD',
    exchange: 'CRYPTO',
    assetClass: 'crypto',
    baseCurrency: 'DOGE',
    quoteCurrency: 'USD',
    aliases: ['DOGEUSD', 'DOGE-USD', 'DOGE'],
  },
  XRP: {
    canonical: 'XRP/USD',
    alpaca: 'XRP/USD',
    exchange: 'CRYPTO',
    assetClass: 'crypto',
    baseCurrency: 'XRP',
    quoteCurrency: 'USD',
    aliases: ['XRPUSD', 'XRP-USD', 'XRP', 'ripple'],
  },

  // Stocks
  AAPL: {
    canonical: 'AAPL',
    alpaca: 'AAPL',
    exchange: 'NASDAQ',
    assetClass: 'stocks',
    baseCurrency: 'AAPL',
    quoteCurrency: 'USD',
    aliases: ['AAPL', 'apple'],
  },
  MSFT: {
    canonical: 'MSFT',
    alpaca: 'MSFT',
    exchange: 'NASDAQ',
    assetClass: 'stocks',
    baseCurrency: 'MSFT',
    quoteCurrency: 'USD',
    aliases: ['MSFT', 'microsoft'],
  },
  NVDA: {
    canonical: 'NVDA',
    alpaca: 'NVDA',
    exchange: 'NASDAQ',
    assetClass: 'stocks',
    baseCurrency: 'NVDA',
    quoteCurrency: 'USD',
    aliases: ['NVDA', 'nvidia'],
  },
  TSLA: {
    canonical: 'TSLA',
    alpaca: 'TSLA',
    exchange: 'NASDAQ',
    assetClass: 'stocks',
    baseCurrency: 'TSLA',
    quoteCurrency: 'USD',
    aliases: ['TSLA', 'tesla'],
  },
  GOOGL: {
    canonical: 'GOOGL',
    alpaca: 'GOOGL',
    exchange: 'NASDAQ',
    assetClass: 'stocks',
    baseCurrency: 'GOOGL',
    quoteCurrency: 'USD',
    aliases: ['GOOGL', 'google'],
  },
  META: {
    canonical: 'META',
    alpaca: 'META',
    exchange: 'NASDAQ',
    assetClass: 'stocks',
    baseCurrency: 'META',
    quoteCurrency: 'USD',
    aliases: ['META', 'facebook'],
  },
  AMZN: {
    canonical: 'AMZN',
    alpaca: 'AMZN',
    exchange: 'NASDAQ',
    assetClass: 'stocks',
    baseCurrency: 'AMZN',
    quoteCurrency: 'USD',
    aliases: ['AMZN', 'amazon'],
  },
  JPM: {
    canonical: 'JPM',
    alpaca: 'JPM',
    exchange: 'NYSE',
    assetClass: 'stocks',
    baseCurrency: 'JPM',
    quoteCurrency: 'USD',
    aliases: ['JPM', 'jpmorgan'],
  },

  // Forex
  EURUSD: {
    canonical: 'EUR/USD',
    alpaca: 'EURUSD',
    exchange: 'FOREX',
    assetClass: 'forex',
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    aliases: ['EUR/USD', 'EURUSD', 'euro-dollar'],
  },
  GBPUSD: {
    canonical: 'GBP/USD',
    alpaca: 'GBPUSD',
    exchange: 'FOREX',
    assetClass: 'forex',
    baseCurrency: 'GBP',
    quoteCurrency: 'USD',
    aliases: ['GBP/USD', 'GBPUSD', 'sterling'],
  },
  USDJPY: {
    canonical: 'USD/JPY',
    alpaca: 'USDJPY',
    exchange: 'FOREX',
    assetClass: 'forex',
    baseCurrency: 'USD',
    quoteCurrency: 'JPY',
    aliases: ['USD/JPY', 'USDJPY', 'dollar-yen'],
  },

  // Futures
  ES: {
    canonical: 'ES',
    alpaca: 'ES',
    exchange: 'CME',
    assetClass: 'futures',
    baseCurrency: 'ES',
    quoteCurrency: 'USD',
    aliases: ['ES', 'sp500', 'e-mini s&p 500'],
  },
  NQ: {
    canonical: 'NQ',
    alpaca: 'NQ',
    exchange: 'CME',
    assetClass: 'futures',
    baseCurrency: 'NQ',
    quoteCurrency: 'USD',
    aliases: ['NQ', 'nasdaq100', 'e-mini nasdaq 100'],
  },
  CL: {
    canonical: 'CL',
    alpaca: 'CL',
    exchange: 'CME',
    assetClass: 'futures',
    baseCurrency: 'CL',
    quoteCurrency: 'USD',
    aliases: ['CL', 'crude oil', 'wti'],
  },
  GC: {
    canonical: 'GC',
    alpaca: 'GC',
    exchange: 'CME',
    assetClass: 'futures',
    baseCurrency: 'GC',
    quoteCurrency: 'USD',
    aliases: ['GC', 'gold', 'comex gold'],
  },
};

// ============================================================================
// TRADING CALENDAR (US Markets)
// ============================================================================

const US_HOLIDAYS_2024_2026 = [
  // 2024
  '2024-01-01', // New Year's Day
  '2024-01-15', // MLK Day
  '2024-02-19', // Presidents Day
  '2024-03-29', // Good Friday
  '2024-05-27', // Memorial Day
  '2024-06-19', // Juneteenth
  '2024-07-04', // Independence Day
  '2024-09-02', // Labor Day
  '2024-11-28', // Thanksgiving
  '2024-12-25', // Christmas
  // 2025
  '2025-01-01', // New Year's Day
  '2025-01-20', // MLK Day
  '2025-02-17', // Presidents Day
  '2025-04-18', // Good Friday
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving
  '2025-12-25', // Christmas
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-04', // Independence Day (Sunday, observed Mon)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
];

const HALF_DAYS_2024_2026 = [
  '2024-07-03', // Day before Independence Day
  '2024-11-29', // Day after Thanksgiving
  '2024-12-24', // Christmas Eve
  '2025-07-03', // Day before Independence Day
  '2025-11-28', // Day after Thanksgiving
  '2025-12-24', // Christmas Eve
  '2026-07-03', // Day before Independence Day
  '2026-11-27', // Day after Thanksgiving
  '2026-12-24', // Christmas Eve
];

// ============================================================================
// TIMESTAMP NORMALIZER CLASS
// ============================================================================

export class TimestampNormalizer extends EventEmitter {
  private skewTracking: Map<string, SkewStats>;
  private skewThreshold: number;
  private maxSkewSamples: number;

  constructor(skewThresholdMs: number = 2000, maxSamples: number = 100) {
    super();
    this.skewTracking = new Map();
    this.skewThreshold = skewThresholdMs;
    this.maxSkewSamples = maxSamples;
  }

  /**
   * Normalize a timestamp to exchange-aware format
   */
  normalizeTimestamp(
    timestamp: number | string | Date,
    exchangeCode: string
  ): NormalizedTimestamp {
    const utcMs =
      typeof timestamp === 'number'
        ? timestamp
        : new Date(timestamp).getTime();

    const exchange = EXCHANGE_SESSIONS[exchangeCode];
    if (!exchange) {
      throw new Error(`Unknown exchange: ${exchangeCode}`);
    }

    // Create UTC date
    const utcDate = new Date(utcMs);
    const utcIso = utcDate.toISOString();

    // Convert to exchange local time (simplified - using timezone offset)
    const exchangeLocal = this.formatExchangeLocal(utcDate, exchange.timezone);

    // Determine session state
    const sessionState = this.getSessionState(exchangeCode, utcMs);

    // Get trading day (in exchange local time)
    const tradingDay = this.getTradingDay(utcDate, exchange.timezone);

    // Get weekday name
    const weekday = this.getWeekdayName(
      new Date(utcDate.toLocaleString('en-US', { timeZone: exchange.timezone }))
    );

    // Check if it's a holiday
    const isHoliday = this.isMarketHoliday(tradingDay, exchangeCode);

    return {
      utcMs,
      utcIso,
      exchangeLocal,
      exchangeTz: exchange.timezone,
      sessionState,
      tradingDay,
      weekday,
      isHoliday,
    };
  }

  /**
   * Normalize a symbol to canonical form
   */
  normalizeSymbol(raw: string): NormalizedSymbol | null {
    const cleaned = raw.toUpperCase().trim();

    // Direct lookup
    if (SYMBOL_MAP[cleaned]) {
      return SYMBOL_MAP[cleaned];
    }

    // Alias lookup
    for (const [key, symbol] of Object.entries(SYMBOL_MAP)) {
      if (symbol.aliases.includes(cleaned)) {
        return symbol;
      }
    }

    return null;
  }

  /**
   * Resolve a symbol input to best match
   */
  resolveSymbol(input: string): NormalizedSymbol | null {
    const normalized = this.normalizeSymbol(input);

    if (normalized) {
      this.emit('symbol:resolved', {
        input,
        canonical: normalized.canonical,
        confidence: 1.0,
      });
    }

    return normalized;
  }

  /**
   * Get current session state for an exchange at a given time
   */
  getSessionState(
    exchangeCode: string,
    timestamp: number
  ): 'pre_market' | 'regular' | 'after_hours' | 'closed' | 'always_on' {
    const exchange = EXCHANGE_SESSIONS[exchangeCode];
    if (!exchange) {
      throw new Error(`Unknown exchange: ${exchangeCode}`);
    }

    if (exchange.isAlwaysOn) {
      return 'always_on';
    }

    const date = new Date(timestamp);
    const localDateStr = date.toLocaleString('en-US', {
      timeZone: exchange.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const [month, day, year] = localDateStr.split('/');
    const tradingDay = `${year}-${month}-${day}`;

    const weekday = this.getWeekday(
      new Date(date.toLocaleString('en-US', { timeZone: exchange.timezone }))
    );

    // Check if trading day for this exchange
    if (!exchange.tradingDays.includes(weekday)) {
      return 'closed';
    }

    // Check holidays
    if (this.isMarketHoliday(tradingDay, exchangeCode)) {
      return 'closed';
    }

    const timeStr = date
      .toLocaleString('en-US', {
        timeZone: exchange.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      .padStart(5, '0');

    // Pre-market
    if (
      exchange.preMarket &&
      this.isTimeBetween(
        timeStr,
        exchange.preMarket.start,
        exchange.preMarket.end
      )
    ) {
      return 'pre_market';
    }

    // Regular hours
    if (
      this.isTimeBetween(
        timeStr,
        exchange.regular.start,
        exchange.regular.end
      )
    ) {
      return 'regular';
    }

    // After hours
    if (
      exchange.afterHours &&
      this.isTimeBetween(
        timeStr,
        exchange.afterHours.start,
        exchange.afterHours.end
      )
    ) {
      return 'after_hours';
    }

    return 'closed';
  }

  /**
   * Align timestamp to candle boundary
   */
  alignToCandle(timestamp: number, timeframeMinutes: number): number {
    const remainder = timestamp % (timeframeMinutes * 60 * 1000);
    return timestamp - remainder;
  }

  /**
   * Track clock skew from a data source
   */
  trackClockSkew(source: string, incomingTimestamp: number): void {
    const serverNow = Date.now();
    const skew = incomingTimestamp - serverNow;

    let stats = this.skewTracking.get(source);

    if (!stats) {
      stats = {
        source,
        currentSkew: skew,
        averageSkew: skew,
        maxSkew: skew,
        minSkew: skew,
        sampleCount: 1,
        lastUpdate: serverNow,
      };
    } else {
      stats.currentSkew = skew;
      stats.maxSkew = Math.max(stats.maxSkew, skew);
      stats.minSkew = Math.min(stats.minSkew, skew);
      stats.sampleCount = Math.min(
        stats.sampleCount + 1,
        this.maxSkewSamples
      );
      stats.averageSkew =
        (stats.averageSkew * (stats.sampleCount - 1) + skew) /
        stats.sampleCount;
      stats.lastUpdate = serverNow;
    }

    this.skewTracking.set(source, stats);

    // Alert if skew exceeds threshold
    if (Math.abs(skew) > this.skewThreshold) {
      this.emit('skew:detected', {
        source,
        skew,
        threshold: this.skewThreshold,
      });
    }
  }

  /**
   * Get current clock skew for a source
   */
  getClockSkew(source: string): number | null {
    const stats = this.skewTracking.get(source);
    return stats ? stats.currentSkew : null;
  }

  /**
   * Get comprehensive skew report
   */
  getSkewReport(): SkewStats[] {
    return Array.from(this.skewTracking.values());
  }

  /**
   * Check if a date is a trading day for an exchange
   */
  isTradingDay(date: string | Date, exchangeCode: string): boolean {
    const exchange = EXCHANGE_SESSIONS[exchangeCode];
    if (!exchange) {
      throw new Error(`Unknown exchange: ${exchangeCode}`);
    }

    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const dateStr = dateObj.toISOString().split('T')[0];

    // Check if holiday
    if (this.isMarketHoliday(dateStr, exchangeCode)) {
      return false;
    }

    const weekday = this.getWeekday(dateObj);
    return exchange.tradingDays.includes(weekday);
  }

  /**
   * Get next market open time
   */
  getNextOpen(exchangeCode: string): Date {
    const exchange = EXCHANGE_SESSIONS[exchangeCode];
    if (!exchange) {
      throw new Error(`Unknown exchange: ${exchangeCode}`);
    }

    const now = new Date();
    let searchDate = new Date(now);

    // Search for up to 30 days
    for (let i = 0; i < 30; i++) {
      searchDate.setDate(searchDate.getDate() + 1);
      const dateStr = searchDate.toISOString().split('T')[0];

      if (this.isTradingDay(dateStr, exchangeCode)) {
        // Parse open time and create date
        const [hours, minutes] = exchange.regular.start.split(':');
        const openDate = new Date(searchDate);
        openDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        // Adjust for timezone (simplified)
        return openDate;
      }
    }

    throw new Error(
      `Could not find next open for ${exchangeCode} within 30 days`
    );
  }

  /**
   * Get session bounds for a specific date
   */
  getSessionBounds(
    exchangeCode: string,
    date: string | Date
  ): SessionBounds {
    const exchange = EXCHANGE_SESSIONS[exchangeCode];
    if (!exchange) {
      throw new Error(`Unknown exchange: ${exchangeCode}`);
    }

    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const dateStr = dateObj.toISOString().split('T')[0];

    const createTime = (timeStr: string): Date => {
      const [hours, minutes] = timeStr.split(':');
      const d = new Date(dateStr);
      d.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      return d;
    };

    const preMarketOpen = exchange.preMarket
      ? createTime(exchange.preMarket.start)
      : null;
    const marketOpen = createTime(exchange.regular.start);
    const marketClose = createTime(exchange.regular.end);
    const afterHoursClose = exchange.afterHours
      ? createTime(exchange.afterHours.end)
      : null;

    return {
      preMarketOpen,
      marketOpen,
      marketClose,
      afterHoursClose,
    };
  }

  // ========================================================================
  // PRIVATE HELPERS
  // ========================================================================

  private formatExchangeLocal(date: Date, timezone: string): string {
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  private getTradingDay(date: Date, timezone: string): string {
    const localStr = date.toLocaleString('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const [month, day, year] = localStr.split('/');
    return `${year}-${month}-${day}`;
  }

  private getWeekdayName(date: Date): string {
    const days = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    return days[date.getDay()];
  }

  private getWeekday(date: Date): number {
    return date.getDay();
  }

  private isTimeBetween(current: string, start: string, end: string): boolean {
    const curr = current.replace(':', '');
    const s = start.replace(':', '');
    const e = end.replace(':', '');

    if (s <= e) {
      return curr >= s && curr <= e;
    } else {
      // Spans midnight
      return curr >= s || curr <= e;
    }
  }

  private isMarketHoliday(dateStr: string, exchangeCode: string): boolean {
    // For now, US holidays apply to US exchanges
    if (
      ['NYSE', 'NASDAQ', 'CME', 'CBOE'].includes(exchangeCode) &&
      US_HOLIDAYS_2024_2026.includes(dateStr)
    ) {
      return true;
    }

    return false;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default TimestampNormalizer;
export { EXCHANGE_SESSIONS, SYMBOL_MAP, US_HOLIDAYS_2024_2026 };
