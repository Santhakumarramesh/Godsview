import { EventEmitter } from 'events';

export type RoutingStrategy = 'best_price' | 'lowest_fee' | 'fastest' | 'smart' | 'twap' | 'vwap';

export interface VenueConfig {
  id: string;
  name: string;
  type: 'exchange' | 'darkpool' | 'otc' | 'dex';
  fees: {
    maker: number;
    taker: number;
  };
  minSize: number;
  maxSize: number;
  latencyMs: number;
  reliabilityScore: number;
  supportedAssets: string[];
  enabled: boolean;
}

export interface RouterConfig {
  venues: VenueConfig[];
  defaultStrategy: RoutingStrategy;
  maxSplitParts?: number;
  minOrderSize?: number;
}

export interface RouteLeg {
  venueId: string;
  venueName: string;
  quantity: number;
  estimatedPrice: number;
  estimatedFee: number;
  priority: number;
}

export interface RouteDecision {
  orderId: string;
  strategy: RoutingStrategy;
  legs: RouteLeg[];
  estimatedCost: number;
  estimatedLatency: number;
  reasoning: string;
  timestamp: string;
}

export interface VenueHealth {
  venueId: string;
  status: 'healthy' | 'degraded' | 'offline';
  latency: number;
  fillRate: number;
  lastCheck: string;
  errorCount: number;
}

interface VenueScore {
  venue: VenueConfig;
  score: number;
  priceScore: number;
  feeScore: number;
  reliabilityScore: number;
  latencyScore: number;
}

interface RoutingStats {
  totalRouted: number;
  byVenue: Record<string, number>;
  byStrategy: Record<string, number>;
  avgCost: number;
  avgLatency: number;
}

export class SmartOrderRouter extends EventEmitter {
  private config: RouterConfig;
  private venues: Map<string, VenueConfig>;
  private venueHealth: Map<string, VenueHealth>;
  private routingStats: RoutingStats;
  private orderIdCounter: number;

  constructor(config: RouterConfig) {
    super();
    this.config = {
      maxSplitParts: config.maxSplitParts ?? 3,
      minOrderSize: config.minOrderSize ?? 10,
      ...config,
    };

    this.venues = new Map();
    this.venueHealth = new Map();
    this.orderIdCounter = 0;
    this.routingStats = {
      totalRouted: 0,
      byVenue: {},
      byStrategy: {},
      avgCost: 0,
      avgLatency: 0,
    };

    this.initializeVenues();
  }

  private initializeVenues(): void {
    const defaultVenues: VenueConfig[] = [
      {
        id: 'alpaca',
        name: 'Alpaca',
        type: 'exchange',
        fees: { maker: 0.0001, taker: 0.0001 },
        minSize: 1,
        maxSize: 1000000,
        latencyMs: 25,
        reliabilityScore: 0.98,
        supportedAssets: ['stocks', 'crypto'],
        enabled: true,
      },
      {
        id: 'iex',
        name: 'IEX',
        type: 'exchange',
        fees: { maker: 0.0, taker: 0.0005 },
        minSize: 100,
        maxSize: 500000,
        latencyMs: 15,
        reliabilityScore: 0.99,
        supportedAssets: ['stocks'],
        enabled: true,
      },
      {
        id: 'darkpool_alpha',
        name: 'DarkPool_Alpha',
        type: 'darkpool',
        fees: { maker: 0.0002, taker: 0.0002 },
        minSize: 10000,
        maxSize: 5000000,
        latencyMs: 50,
        reliabilityScore: 0.95,
        supportedAssets: ['stocks'],
        enabled: true,
      },
      {
        id: 'dex_uniswap',
        name: 'DEX_Uniswap',
        type: 'dex',
        fees: { maker: 0.003, taker: 0.003 },
        minSize: 0.1,
        maxSize: 100000,
        latencyMs: 3000,
        reliabilityScore: 0.92,
        supportedAssets: ['crypto'],
        enabled: true,
      },
    ];

    for (const venue of defaultVenues) {
      this.addVenue(venue);
    }
  }

  public addVenue(config: VenueConfig): void {
    this.venues.set(config.id, config);
    this.venueHealth.set(config.id, {
      venueId: config.id,
      status: 'healthy',
      latency: config.latencyMs,
      fillRate: 0.95,
      lastCheck: new Date().toISOString(),
      errorCount: 0,
    });
  }

  public removeVenue(venueId: string): void {
    this.venues.delete(venueId);
    this.venueHealth.delete(venueId);
  }

  public route(
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; type: string; price?: number },
    strategy?: RoutingStrategy
  ): RouteDecision {
    const orderId = `order_${++this.orderIdCounter}`;
    const selectedStrategy = strategy || this.config.defaultStrategy;

    let legs: RouteLeg[] = [];
    let estimatedCost = 0;
    let estimatedLatency = 0;
    let reasoning = '';

    switch (selectedStrategy) {
      case 'best_price':
        ({ legs, estimatedCost, estimatedLatency, reasoning } = this.routeByBestPrice(
          order,
          orderId
        ));
        break;
      case 'lowest_fee':
        ({ legs, estimatedCost, estimatedLatency, reasoning } = this.routeByLowestFee(
          order,
          orderId
        ));
        break;
      case 'fastest':
        ({ legs, estimatedCost, estimatedLatency, reasoning } = this.routeByFastest(order, orderId));
        break;
      case 'smart':
        ({ legs, estimatedCost, estimatedLatency, reasoning } = this.routeSmart(order, orderId));
        break;
      case 'twap':
        ({ legs, estimatedCost, estimatedLatency, reasoning } = this.routeTWAP(order, orderId));
        break;
      case 'vwap':
        ({ legs, estimatedCost, estimatedLatency, reasoning } = this.routeVWAP(order, orderId));
        break;
      default:
        throw new Error(`Unknown routing strategy: ${selectedStrategy}`);
    }

    const decision: RouteDecision = {
      orderId,
      strategy: selectedStrategy,
      legs,
      estimatedCost,
      estimatedLatency,
      reasoning,
      timestamp: new Date().toISOString(),
    };

    this.updateStats(decision);
    this.emit('route:decided', decision);

    if (legs.length > 1) {
      this.emit('route:split', { orderId, legCount: legs.length });
    }

    return decision;
  }

  private routeByBestPrice(
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; type: string; price?: number },
    orderId: string
  ): { legs: RouteLeg[]; estimatedCost: number; estimatedLatency: number; reasoning: string } {
    const eligibleVenues = this.getEligibleVenues(order.symbol, order.quantity);

    if (eligibleVenues.length === 0) {
      return { legs: [], estimatedCost: 0, estimatedLatency: 0, reasoning: 'No eligible venues' };
    }

    const sorted = eligibleVenues.sort((a, b) => {
      const priceImpactA = order.price ? order.price * (order.side === 'buy' ? 1.001 : 0.999) : 0;
      const priceImpactB = order.price ? order.price * (order.side === 'buy' ? 1.001 : 0.999) : 0;
      return priceImpactA - priceImpactB;
    });

    const bestVenue = sorted[0];
    const leg: RouteLeg = {
      venueId: bestVenue.id,
      venueName: bestVenue.name,
      quantity: order.quantity,
      estimatedPrice: order.price || 100,
      estimatedFee: order.quantity * (order.side === 'buy' ? bestVenue.fees.taker : bestVenue.fees.maker),
      priority: 1,
    };

    return {
      legs: [leg],
      estimatedCost: leg.estimatedFee,
      estimatedLatency: bestVenue.latencyMs,
      reasoning: `Routed to ${bestVenue.name} for best price improvement`,
    };
  }

  private routeByLowestFee(
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; type: string; price?: number },
    orderId: string
  ): { legs: RouteLeg[]; estimatedCost: number; estimatedLatency: number; reasoning: string } {
    const eligibleVenues = this.getEligibleVenues(order.symbol, order.quantity);

    if (eligibleVenues.length === 0) {
      return { legs: [], estimatedCost: 0, estimatedLatency: 0, reasoning: 'No eligible venues' };
    }

    const sorted = eligibleVenues.sort((a, b) => {
      const feeA = order.side === 'buy' ? a.fees.taker : a.fees.maker;
      const feeB = order.side === 'buy' ? b.fees.taker : b.fees.maker;
      return feeA - feeB;
    });

    const bestVenue = sorted[0];
    const fee = order.side === 'buy' ? bestVenue.fees.taker : bestVenue.fees.maker;
    const leg: RouteLeg = {
      venueId: bestVenue.id,
      venueName: bestVenue.name,
      quantity: order.quantity,
      estimatedPrice: order.price || 100,
      estimatedFee: order.quantity * fee,
      priority: 1,
    };

    return {
      legs: [leg],
      estimatedCost: leg.estimatedFee,
      estimatedLatency: bestVenue.latencyMs,
      reasoning: `Routed to ${bestVenue.name} for lowest fees (${(fee * 100).toFixed(2)}%)`,
    };
  }

  private routeByFastest(
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; type: string; price?: number },
    orderId: string
  ): { legs: RouteLeg[]; estimatedCost: number; estimatedLatency: number; reasoning: string } {
    const eligibleVenues = this.getEligibleVenues(order.symbol, order.quantity);

    if (eligibleVenues.length === 0) {
      return { legs: [], estimatedCost: 0, estimatedLatency: 0, reasoning: 'No eligible venues' };
    }

    const sorted = eligibleVenues.sort((a, b) => a.latencyMs - b.latencyMs);
    const bestVenue = sorted[0];
    const fee = order.side === 'buy' ? bestVenue.fees.taker : bestVenue.fees.maker;

    const leg: RouteLeg = {
      venueId: bestVenue.id,
      venueName: bestVenue.name,
      quantity: order.quantity,
      estimatedPrice: order.price || 100,
      estimatedFee: order.quantity * fee,
      priority: 1,
    };

    return {
      legs: [leg],
      estimatedCost: leg.estimatedFee,
      estimatedLatency: bestVenue.latencyMs,
      reasoning: `Routed to ${bestVenue.name} for fastest execution (${bestVenue.latencyMs}ms)`,
    };
  }

  private routeSmart(
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; type: string; price?: number },
    orderId: string
  ): { legs: RouteLeg[]; estimatedCost: number; estimatedLatency: number; reasoning: string } {
    const eligibleVenues = this.getEligibleVenues(order.symbol, order.quantity);

    if (eligibleVenues.length === 0) {
      return { legs: [], estimatedCost: 0, estimatedLatency: 0, reasoning: 'No eligible venues' };
    }

    const scored = this.scoreVenues(eligibleVenues, order);
    scored.sort((a, b) => b.score - a.score);

    const bestVenue = scored[0].venue;
    const fee = order.side === 'buy' ? bestVenue.fees.taker : bestVenue.fees.maker;

    const leg: RouteLeg = {
      venueId: bestVenue.id,
      venueName: bestVenue.name,
      quantity: order.quantity,
      estimatedPrice: order.price || 100,
      estimatedFee: order.quantity * fee,
      priority: 1,
    };

    return {
      legs: [leg],
      estimatedCost: leg.estimatedFee,
      estimatedLatency: bestVenue.latencyMs,
      reasoning: `Smart routing to ${bestVenue.name} (weighted: 40% price, 30% fee, 20% reliability, 10% latency)`,
    };
  }

  private routeTWAP(
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; type: string; price?: number },
    orderId: string
  ): { legs: RouteLeg[]; estimatedCost: number; estimatedLatency: number; reasoning: string } {
    const eligibleVenues = this.getEligibleVenues(order.symbol, order.quantity);

    if (eligibleVenues.length === 0) {
      return { legs: [], estimatedCost: 0, estimatedLatency: 0, reasoning: 'No eligible venues' };
    }

    const numParts = Math.min(
      this.config.maxSplitParts!,
      Math.ceil(order.quantity / 1000)
    );
    const partSize = Math.floor(order.quantity / numParts);
    const legs: RouteLeg[] = [];
    let totalCost = 0;
    let maxLatency = 0;

    for (let i = 0; i < numParts; i++) {
      const qty = i === numParts - 1 ? order.quantity - (partSize * (numParts - 1)) : partSize;
      const venue = eligibleVenues[i % eligibleVenues.length];
      const fee = order.side === 'buy' ? venue.fees.taker : venue.fees.maker;

      const leg: RouteLeg = {
        venueId: venue.id,
        venueName: venue.name,
        quantity: qty,
        estimatedPrice: order.price || 100,
        estimatedFee: qty * fee,
        priority: i + 1,
      };

      legs.push(leg);
      totalCost += leg.estimatedFee;
      maxLatency = Math.max(maxLatency, venue.latencyMs);
    }

    return {
      legs,
      estimatedCost: totalCost,
      estimatedLatency: maxLatency,
      reasoning: `TWAP execution split into ${numParts} parts across ${new Set(legs.map(l => l.venueId)).size} venues`,
    };
  }

  private routeVWAP(
    order: { symbol: string; side: 'buy' | 'sell'; quantity: number; type: string; price?: number },
    orderId: string
  ): { legs: RouteLeg[]; estimatedCost: number; estimatedLatency: number; reasoning: string } {
    const eligibleVenues = this.getEligibleVenues(order.symbol, order.quantity);

    if (eligibleVenues.length === 0) {
      return { legs: [], estimatedCost: 0, estimatedLatency: 0, reasoning: 'No eligible venues' };
    }

    const scored = this.scoreVenues(eligibleVenues, order);
    const totalScore = scored.reduce((sum, v) => sum + v.score, 0);

    const legs: RouteLeg[] = [];
    let totalCost = 0;
    let maxLatency = 0;

    scored.forEach((scoredVenue, index) => {
      const ratio = scoredVenue.score / totalScore;
      const qty = Math.floor(order.quantity * ratio);

      if (qty > 0) {
        const fee = order.side === 'buy' ? scoredVenue.venue.fees.taker : scoredVenue.venue.fees.maker;
        const leg: RouteLeg = {
          venueId: scoredVenue.venue.id,
          venueName: scoredVenue.venue.name,
          quantity: qty,
          estimatedPrice: order.price || 100,
          estimatedFee: qty * fee,
          priority: index + 1,
        };

        legs.push(leg);
        totalCost += leg.estimatedFee;
        maxLatency = Math.max(maxLatency, scoredVenue.venue.latencyMs);
      }
    });

    if (legs.length === 0) {
      const bestVenue = scored[0].venue;
      const fee = order.side === 'buy' ? bestVenue.fees.taker : bestVenue.fees.maker;
      const leg: RouteLeg = {
        venueId: bestVenue.id,
        venueName: bestVenue.name,
        quantity: order.quantity,
        estimatedPrice: order.price || 100,
        estimatedFee: order.quantity * fee,
        priority: 1,
      };
      legs.push(leg);
      totalCost = leg.estimatedFee;
      maxLatency = bestVenue.latencyMs;
    }

    return {
      legs,
      estimatedCost: totalCost,
      estimatedLatency: maxLatency,
      reasoning: `VWAP execution proportionally distributed across ${legs.length} venues based on quality scores`,
    };
  }

  private scoreVenues(venues: VenueConfig[], order: { quantity: number; price?: number; side: string }): VenueScore[] {
    return venues.map(venue => {
      const health = this.venueHealth.get(venue.id);
      const latencyFactor = 1 - Math.min(venue.latencyMs / 1000, 1);
      const fee = order.side === 'buy' ? venue.fees.taker : venue.fees.maker;
      const feeFactor = 1 - Math.min(fee * 10, 1);
      const reliabilityFactor = (health?.fillRate || 0.95) * venue.reliabilityScore;

      const score =
        feeFactor * 0.3 +
        reliabilityFactor * 0.2 +
        latencyFactor * 0.1 +
        0.4;

      return {
        venue,
        score,
        priceScore: 0.4,
        feeScore: feeFactor * 0.3,
        reliabilityScore: reliabilityFactor * 0.2,
        latencyScore: latencyFactor * 0.1,
      };
    });
  }

  private getEligibleVenues(symbol: string, quantity: number): VenueConfig[] {
    return Array.from(this.venues.values()).filter(venue => {
      if (!venue.enabled) return false;
      if (!venue.supportedAssets.includes('stocks') && !venue.supportedAssets.includes('crypto')) return false;
      if (quantity < venue.minSize || quantity > venue.maxSize) return false;

      const health = this.venueHealth.get(venue.id);
      if (health?.status === 'offline') return false;

      return true;
    });
  }

  public selectBestVenue(symbol: string, quantity: number, side: string): VenueConfig | null {
    const eligibleVenues = this.getEligibleVenues(symbol, quantity);
    if (eligibleVenues.length === 0) return null;

    const scored = this.scoreVenues(eligibleVenues, { quantity, side });
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.venue || null;
  }

  public getVenueHealth(): VenueHealth[] {
    return Array.from(this.venueHealth.values());
  }

  public updateVenueHealth(venueId: string, metrics: Partial<VenueHealth>): void {
    const health = this.venueHealth.get(venueId);
    if (!health) return;

    const updated = { ...health, ...metrics, lastCheck: new Date().toISOString() };
    this.venueHealth.set(venueId, updated);

    const previousStatus = health.status;
    if (updated.status !== previousStatus) {
      if (updated.status === 'degraded') {
        this.emit('venue:degraded', { venueId, health: updated });
      } else if (updated.status === 'offline') {
        this.emit('venue:offline', { venueId, health: updated });
      }
    }
  }

  public getRoutingStats(): RoutingStats {
    return { ...this.routingStats };
  }

  private updateStats(decision: RouteDecision): void {
    this.routingStats.totalRouted++;
    this.routingStats.byStrategy[decision.strategy] =
      (this.routingStats.byStrategy[decision.strategy] || 0) + 1;

    for (const leg of decision.legs) {
      this.routingStats.byVenue[leg.venueId] = (this.routingStats.byVenue[leg.venueId] || 0) + 1;
    }

    const totalCost = this.routingStats.avgCost * (this.routingStats.totalRouted - 1);
    this.routingStats.avgCost = (totalCost + decision.estimatedCost) / this.routingStats.totalRouted;

    const totalLatency = this.routingStats.avgLatency * (this.routingStats.totalRouted - 1);
    this.routingStats.avgLatency =
      (totalLatency + decision.estimatedLatency) / this.routingStats.totalRouted;
  }
}
