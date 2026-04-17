import { EventEmitter } from 'events';

// Type definitions
export interface LiquidityConfig {
  priceResolution?: number;
  timeResolution?: number;
  maxLevels?: number;
  heatmapBuckets?: number;
}

export interface LiquidityZone {
  priceFrom: number;
  priceTo: number;
  totalVolume: number;
  averageSize: number;
  touchCount: number;
  lastTouched: string;
  type: 'support' | 'resistance' | 'congestion';
  strength: number;
}

export interface HeatmapBucket {
  priceLevel: number;
  timeSlot: string;
  volume: number;
  intensity: number;
  color: string;
}

export interface LiquidityHeatmap {
  symbol: string;
  buckets: HeatmapBucket[];
  priceRange: {
    min: number;
    max: number;
  };
  timeRange: {
    start: string;
    end: string;
  };
  hotZones: Array<{
    price: number;
    intensity: number;
  }>;
  coldZones: Array<{
    price: number;
    intensity: number;
  }>;
  generated_at: string;
}

export interface SlippageEstimate {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  estimatedSlippageBps: number;
  estimatedAvgPrice: number;
  liquidityScore: number;
  levelsConsumed: number;
  recommendation: 'proceed' | 'split' | 'delay' | 'abort';
}

export interface LiquidityReport {
  symbol: string;
  overallScore: number;
  bidLiquidity: number;
  askLiquidity: number;
  symmetry: number;
  depth: number;
  resilience: number;
  zones: LiquidityZone[];
  topSupportLevels: number[];
  topResistanceLevels: number[];
  timestamp: string;
}

// Internal structures for tracking
interface PriceLevel {
  price: number;
  bidVolume: number;
  askVolume: number;
  touchCount: number;
  lastTouched: string;
  tradeSizes: number[];
}

interface TimeSlotData {
  timestamp: string;
  volume: number;
  trades: number;
}

interface SymbolData {
  priceLevels: Map<string, PriceLevel>;
  timeSlots: Map<string, TimeSlotData>;
  trades: Array<{
    price: number;
    volume: number;
    timestamp: string;
  }>;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  lastUpdate: string;
}

export class LiquidityMapper extends EventEmitter {
  private config: Required<LiquidityConfig>;
  private symbolData: Map<string, SymbolData>;

  constructor(config: LiquidityConfig = {}) {
    super();
    this.config = {
      priceResolution: config.priceResolution ?? 0.01,
      timeResolution: config.timeResolution ?? 60000,
      maxLevels: config.maxLevels ?? 50,
      heatmapBuckets: config.heatmapBuckets ?? 20,
    };
    this.symbolData = new Map();
  }

  /**
   * Record a trade execution
   */
  public recordTrade(
    symbol: string,
    price: number,
    volume: number,
    timestamp: string = new Date().toISOString()
  ): void {
    const data = this.getOrCreateSymbolData(symbol);
    const roundedPrice = this.roundPrice(price);

    // Record trade
    data.trades.push({ price: roundedPrice, volume, timestamp });

    // Update price level
    const levelKey = roundedPrice.toFixed(this.getPrecisionDigits());
    let level = data.priceLevels.get(levelKey);
    if (!level) {
      level = {
        price: roundedPrice,
        bidVolume: 0,
        askVolume: 0,
        touchCount: 0,
        lastTouched: timestamp,
        tradeSizes: [],
      };
      data.priceLevels.set(levelKey, level);
    }

    level.touchCount++;
    level.lastTouched = timestamp;
    level.tradeSizes.push(volume);

    // Update time slot
    const timeSlotKey = this.getTimeSlotKey(timestamp);
    let slot = data.timeSlots.get(timeSlotKey);
    if (!slot) {
      slot = {
        timestamp: timeSlotKey,
        volume: 0,
        trades: 0,
      };
      data.timeSlots.set(timeSlotKey, slot);
    }
    slot.volume += volume;
    slot.trades++;

    data.lastUpdate = timestamp;

    // Emit events for detected patterns
    this.checkAndEmitEvents(symbol, roundedPrice, data);
  }

  /**
   * Record a market book snapshot
   */
  public recordBookSnapshot(
    symbol: string,
    bids: Array<{ price: number; size: number }>,
    asks: Array<{ price: number; size: number }>
  ): void {
    const data = this.getOrCreateSymbolData(symbol);
    const timestamp = new Date().toISOString();

    data.bids = bids.map((b) => ({ price: this.roundPrice(b.price), size: b.size }));
    data.asks = asks.map((a) => ({ price: this.roundPrice(a.price), size: a.size }));
    data.lastUpdate = timestamp;

    // Update price levels with bid/ask volumes
    for (const bid of data.bids) {
      const levelKey = bid.price.toFixed(this.getPrecisionDigits());
      let level = data.priceLevels.get(levelKey);
      if (!level) {
        level = {
          price: bid.price,
          bidVolume: 0,
          askVolume: 0,
          touchCount: 0,
          lastTouched: timestamp,
          tradeSizes: [],
        };
        data.priceLevels.set(levelKey, level);
      }
      level.bidVolume = bid.size;
    }

    for (const ask of data.asks) {
      const levelKey = ask.price.toFixed(this.getPrecisionDigits());
      let level = data.priceLevels.get(levelKey);
      if (!level) {
        level = {
          price: ask.price,
          bidVolume: 0,
          askVolume: 0,
          touchCount: 0,
          lastTouched: timestamp,
          tradeSizes: [],
        };
        data.priceLevels.set(levelKey, level);
      }
      level.askVolume = ask.size;
    }

    // Check for thin liquidity
    if ((data.bids[0]?.size ?? 0) < 100 || (data.asks[0]?.size ?? 0) < 100) {
      this.emit('liquidity:thin', { symbol, timestamp });
    }
  }

  /**
   * Get identified liquidity zones for a symbol
   */
  public getLiquidityZones(symbol: string): LiquidityZone[] {
    const data = this.symbolData.get(symbol);
    if (!data) return [];

    const zones: LiquidityZone[] = [];
    const sorted = Array.from(data.priceLevels.values()).sort((a, b) => a.price - b.price);

    // Group consecutive price levels with significant volume
    let currentZone: LiquidityZone | null = null;

    for (const level of sorted) {
      const totalVolume = level.bidVolume + level.askVolume;
      const avgSize = level.tradeSizes.length > 0
        ? level.tradeSizes.reduce((a, b) => a + b, 0) / level.tradeSizes.length
        : 0;
      const strength = Math.min(1, (totalVolume / 1000) + (level.touchCount / 50));

      if (totalVolume > 0 && level.touchCount > 2) {
        if (!currentZone || Math.abs(level.price - currentZone.priceTo) > this.config.priceResolution * 10) {
          if (currentZone) zones.push(currentZone);
          currentZone = {
            priceFrom: level.price,
            priceTo: level.price,
            totalVolume,
            averageSize: avgSize,
            touchCount: level.touchCount,
            lastTouched: level.lastTouched,
            type: this.zoneType(level.price, sorted),
            strength,
          };
        } else if (currentZone) {
          currentZone.priceTo = level.price;
          currentZone.totalVolume += totalVolume;
          currentZone.touchCount += level.touchCount;
          currentZone.lastTouched = level.lastTouched;
          currentZone.strength = Math.min(1, currentZone.strength + 0.1);
        }
      }
    }

    if (currentZone) zones.push(currentZone);

    // Emit zone:formed event for high-strength zones
    for (const zone of zones) {
      if (zone.strength > 0.7) {
        this.emit('zone:formed', { symbol, zone });
      }
    }

    return zones;
  }

  /**
   * Get heatmap data for visualization
   */
  public getHeatmap(symbol: string, periodMs: number = 3600000): LiquidityHeatmap {
    const data = this.symbolData.get(symbol);
    const now = new Date();
    const start = new Date(now.getTime() - periodMs);

    if (!data) {
      return {
        symbol,
        buckets: [],
        priceRange: { min: 0, max: 0 },
        timeRange: { start: start.toISOString(), end: now.toISOString() },
        hotZones: [],
        coldZones: [],
        generated_at: now.toISOString(),
      };
    }

    // Collect relevant trades
    const relevantTrades = data.trades.filter(
      (t) => new Date(t.timestamp) >= start && new Date(t.timestamp) <= now
    );

    if (relevantTrades.length === 0) {
      return {
        symbol,
        buckets: [],
        priceRange: { min: 0, max: 0 },
        timeRange: { start: start.toISOString(), end: now.toISOString() },
        hotZones: [],
        coldZones: [],
        generated_at: now.toISOString(),
      };
    }

    const prices = relevantTrades.map((t) => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceStep = (maxPrice - minPrice) / this.config.heatmapBuckets;

    const buckets: HeatmapBucket[] = [];
    const intensityMap: Map<string, number> = new Map();
    let maxIntensity = 0;

    for (const trade of relevantTrades) {
      const priceBucket = Math.floor((trade.price - minPrice) / priceStep) * priceStep + minPrice;
      const timeSlot = this.getTimeSlotKey(trade.timestamp);
      const bucketKey = `${priceBucket.toFixed(4)}_${timeSlot}`;

      intensityMap.set(bucketKey, (intensityMap.get(bucketKey) ?? 0) + trade.volume);
      maxIntensity = Math.max(maxIntensity, intensityMap.get(bucketKey) ?? 0);
    }

    for (const [key, volume] of intensityMap.entries()) {
      const [price, timeSlot] = key.split('_');
      const intensity = maxIntensity > 0 ? volume / maxIntensity : 0;
      buckets.push({
        priceLevel: parseFloat(price),
        timeSlot,
        volume,
        intensity,
        color: this.intensityToColor(intensity),
      });
    }

    // Find hot and cold zones
    const priceIntensities: Map<number, number> = new Map();
    for (const bucket of buckets) {
      priceIntensities.set(
        bucket.priceLevel,
        Math.max(priceIntensities.get(bucket.priceLevel) ?? 0, bucket.intensity)
      );
    }

    const sorted = Array.from(priceIntensities.entries()).sort((a, b) => b[1] - a[1]);
    const hotZones = sorted.slice(0, Math.ceil(this.config.heatmapBuckets / 5)).map(([price, intensity]) => ({
      price,
      intensity,
    }));
    const coldZones = sorted.slice(-Math.ceil(this.config.heatmapBuckets / 5)).map(([price, intensity]) => ({
      price,
      intensity,
    }));

    return {
      symbol,
      buckets,
      priceRange: { min: minPrice, max: maxPrice },
      timeRange: { start: start.toISOString(), end: now.toISOString() },
      hotZones,
      coldZones,
      generated_at: now.toISOString(),
    };
  }

  /**
   * Estimate slippage for an order
   */
  public estimateSlippage(symbol: string, side: 'buy' | 'sell', quantity: number): SlippageEstimate {
    const data = this.symbolData.get(symbol);
    const now = new Date().toISOString();

    if (!data || data.asks.length === 0 || data.bids.length === 0) {
      return {
        symbol,
        side,
        quantity,
        estimatedSlippageBps: 0,
        estimatedAvgPrice: 0,
        liquidityScore: 0,
        levelsConsumed: 0,
        recommendation: 'abort',
      };
    }

    const levels = side === 'buy' ? data.asks : data.bids;
    let remainingQty = quantity;
    let totalCost = 0;
    let levelsConsumed = 0;
    let liquidityScore = 0;

    for (const level of levels.slice(0, this.config.maxLevels)) {
      if (remainingQty <= 0) break;
      const levelQty = Math.min(remainingQty, level.size);
      totalCost += levelQty * level.price;
      remainingQty -= levelQty;
      levelsConsumed++;
      liquidityScore += level.size / quantity;
    }

    const estimatedAvgPrice = remainingQty <= 0 ? totalCost / quantity : 0;
    const reference = side === 'buy' ? levels[0]?.price ?? 0 : levels[0]?.price ?? 0;
    const slippageBps = reference > 0 ? Math.abs((estimatedAvgPrice - reference) / reference) * 10000 : 0;

    let recommendation: 'proceed' | 'split' | 'delay' | 'abort' = 'proceed';
    if (remainingQty > 0) {
      recommendation = 'abort';
    } else if (slippageBps > 100) {
      recommendation = 'split';
    } else if (liquidityScore < 0.3) {
      recommendation = 'delay';
    }

    return {
      symbol,
      side,
      quantity,
      estimatedSlippageBps: slippageBps,
      estimatedAvgPrice,
      liquidityScore: Math.min(1, liquidityScore),
      levelsConsumed,
      recommendation,
    };
  }

  /**
   * Get comprehensive liquidity report
   */
  public getLiquidityReport(symbol: string): LiquidityReport {
    const data = this.symbolData.get(symbol);
    const zones = this.getLiquidityZones(symbol);
    const { support, resistance } = this.getSupportResistance(symbol, 5);

    if (!data) {
      return {
        symbol,
        overallScore: 0,
        bidLiquidity: 0,
        askLiquidity: 0,
        symmetry: 0,
        depth: 0,
        resilience: 0,
        zones: [],
        topSupportLevels: [],
        topResistanceLevels: [],
        timestamp: new Date().toISOString(),
      };
    }

    const bidLiquidity = data.bids.reduce((sum, b) => sum + b.size, 0);
    const askLiquidity = data.asks.reduce((sum, a) => sum + a.size, 0);
    const totalLiquidity = bidLiquidity + askLiquidity;
    const symmetry = totalLiquidity > 0 ? 1 - Math.abs(bidLiquidity - askLiquidity) / totalLiquidity : 0;
    const depth = Math.min(data.bids.length, data.asks.length);
    const resilience = zones.reduce((sum, z) => sum + z.strength, 0) / Math.max(zones.length, 1);
    const overallScore = (symmetry * 0.3 + (depth / this.config.maxLevels) * 0.3 + resilience * 0.4) * 100;

    return {
      symbol,
      overallScore,
      bidLiquidity,
      askLiquidity,
      symmetry,
      depth,
      resilience,
      zones,
      topSupportLevels: support,
      topResistanceLevels: resistance,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get support and resistance levels
   */
  public getSupportResistance(
    symbol: string,
    count: number = 5
  ): { support: number[]; resistance: number[] } {
    const zones = this.getLiquidityZones(symbol);
    const support: number[] = [];
    const resistance: number[] = [];

    for (const zone of zones) {
      if (zone.type === 'support' || zone.type === 'congestion') {
        support.push(zone.priceFrom);
      }
      if (zone.type === 'resistance' || zone.type === 'congestion') {
        resistance.push(zone.priceTo);
      }
    }

    return {
      support: support.slice(0, count),
      resistance: resistance.slice(0, count),
    };
  }

  /**
   * Get all tracked symbols
   */
  public getSymbols(): string[] {
    return Array.from(this.symbolData.keys());
  }

  /**
   * Reset data for a symbol or all symbols
   */
  public reset(symbol?: string): void {
    if (symbol) {
      this.symbolData.delete(symbol);
    } else {
      this.symbolData.clear();
    }
  }

  // Private helper methods

  private getOrCreateSymbolData(symbol: string): SymbolData {
    if (!this.symbolData.has(symbol)) {
      this.symbolData.set(symbol, {
        priceLevels: new Map(),
        timeSlots: new Map(),
        trades: [],
        bids: [],
        asks: [],
        lastUpdate: new Date().toISOString(),
      });
    }
    return this.symbolData.get(symbol)!;
  }

  private roundPrice(price: number): number {
    const factor = Math.pow(10, this.getPrecisionDigits());
    return Math.round(price * factor) / factor;
  }

  private getPrecisionDigits(): number {
    return Math.ceil(-Math.log10(this.config.priceResolution));
  }

  private getTimeSlotKey(timestamp: string): string {
    const date = new Date(timestamp);
    const slotMs = Math.floor(date.getTime() / this.config.timeResolution) * this.config.timeResolution;
    return new Date(slotMs).toISOString();
  }

  private intensityToColor(intensity: number): string {
    // Map 0→1 to dark blue→cyan→green→yellow→red
    if (intensity < 0.2) return '#001a4d'; // dark blue
    if (intensity < 0.4) return '#0066cc'; // blue
    if (intensity < 0.6) return '#00ccff'; // cyan
    if (intensity < 0.75) return '#00ff00'; // green
    if (intensity < 0.9) return '#ffff00'; // yellow
    return '#ff0000'; // red
  }

  private zoneType(
    price: number,
    sorted: PriceLevel[]
  ): 'support' | 'resistance' | 'congestion' {
    const index = sorted.findIndex((l) => l.price === price);
    const isLow = index < sorted.length / 3;
    const isHigh = index > (sorted.length * 2) / 3;

    if (isLow) return 'support';
    if (isHigh) return 'resistance';
    return 'congestion';
  }

  private checkAndEmitEvents(symbol: string, price: number, data: SymbolData): void {
    const levelKey = price.toFixed(this.getPrecisionDigits());
    const level = data.priceLevels.get(levelKey);

    if (!level) return;

    const zones = this.getLiquidityZones(symbol);
    const { support, resistance } = this.getSupportResistance(symbol);

    if (support.includes(price)) {
      this.emit('support:tested', { symbol, price, timestamp: level.lastTouched });
    }

    if (resistance.includes(price)) {
      this.emit('resistance:tested', { symbol, price, timestamp: level.lastTouched });
    }
  }
}
