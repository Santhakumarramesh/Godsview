import { EventEmitter } from 'events';

// Type definitions for exposure tracking
interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  sector: string;
  assetClass: string;
  direction: 'long' | 'short';
  timeframe: string;
  geography: string;
}

interface SectorExposure {
  gross: number;
  net: number;
  positionCount: number;
  pctOfPortfolio: number;
  limit: number;
  utilization: number;
}

interface ExposureSnapshot {
  timestamp: number;
  totalGross: number;
  totalNet: number;
  longExposure: number;
  shortExposure: number;
  cashAvailable: number;
  marginUsed: number;
  marginAvailable: number;
  leverage: number;
  bySector: Record<string, SectorExposure>;
  byAssetClass: Record<string, number>;
  byDirection: { long: number; short: number };
  byTimeframe: Record<string, number>;
  byGeography: Record<string, number>;
  concentrationHHI: number;
}

interface ExposureLimits {
  maxGrossLeverage: number;
  maxNetExposure: number;
  maxSingleSector: number;
  maxSinglePosition: number;
  maxLongExposure: number;
  maxShortExposure: number;
  maxConcentrationHHI: number;
}

interface ProposedTrade {
  symbol: string;
  quantity: number;
  price: number;
  side: 'buy' | 'sell';
  sector: string;
  assetClass: string;
  timeframe: string;
  geography: string;
}

interface ExposureCheckResult {
  approved: boolean;
  breachedLimits: string[];
  suggestedSize: number;
  reasons: string[];
  utilizationAfter: Record<string, number>;
}

export class ExposureManager extends EventEmitter {
  private positions: Map<string, Position> = new Map();
  private exposureHistory: ExposureSnapshot[] = [];
  private limits: ExposureLimits;
  private baseEquity: number;
  private cashBalance: number;
  private marginLimit: number;

  constructor(baseEquity: number = 100000, marginLimit: number = 50000) {
    super();
    this.baseEquity = baseEquity;
    this.cashBalance = baseEquity;
    this.marginLimit = marginLimit;

    this.limits = {
      maxGrossLeverage: 2.0,
      maxNetExposure: 1.5,
      maxSingleSector: 0.3,
      maxSinglePosition: 0.1,
      maxLongExposure: 1.2,
      maxShortExposure: 0.5,
      maxConcentrationHHI: 0.25
    };

    this.initializeMockPortfolio();
  }

  private initializeMockPortfolio(): void {
    const mockPositions: Position[] = [
      {
        symbol: 'AAPL',
        quantity: 100,
        entryPrice: 150,
        currentPrice: 155,
        sector: 'Technology',
        assetClass: 'Equity',
        direction: 'long',
        timeframe: 'position',
        geography: 'US'
      },
      {
        symbol: 'TSLA',
        quantity: 50,
        entryPrice: 200,
        currentPrice: 210,
        sector: 'Technology',
        assetClass: 'Equity',
        direction: 'long',
        timeframe: 'swing',
        geography: 'US'
      },
      {
        symbol: 'XOM',
        quantity: -150,
        entryPrice: 110,
        currentPrice: 108,
        sector: 'Energy',
        assetClass: 'Equity',
        direction: 'short',
        timeframe: 'position',
        geography: 'US'
      },
      {
        symbol: 'JPM',
        quantity: 80,
        entryPrice: 170,
        currentPrice: 175,
        sector: 'Financials',
        assetClass: 'Equity',
        direction: 'long',
        timeframe: 'position',
        geography: 'US'
      },
      {
        symbol: 'GLD',
        quantity: 200,
        entryPrice: 185,
        currentPrice: 188,
        sector: 'Commodities',
        assetClass: 'ETF',
        direction: 'long',
        timeframe: 'position',
        geography: 'US'
      },
      {
        symbol: 'EUNX',
        quantity: 60,
        entryPrice: 95,
        currentPrice: 97,
        sector: 'Technology',
        assetClass: 'Equity',
        direction: 'long',
        timeframe: 'swing',
        geography: 'EU'
      },
      {
        symbol: 'NIFTY',
        quantity: -100,
        entryPrice: 80,
        currentPrice: 79,
        sector: 'Technology',
        assetClass: 'Index',
        direction: 'short',
        timeframe: 'intraday',
        geography: 'Asia'
      },
      {
        symbol: 'BTC',
        quantity: 0.5,
        entryPrice: 45000,
        currentPrice: 47000,
        sector: 'Digital Assets',
        assetClass: 'Crypto',
        direction: 'long',
        timeframe: 'position',
        geography: 'Crypto'
      }
    ];

    mockPositions.forEach(pos => this.positions.set(pos.symbol, pos));
    this.updateCashBalance();
    this.recordSnapshot();
  }

  private calculatePositionValue(position: Position): number {
    return Math.abs(position.quantity * position.currentPrice);
  }

  private calculatePositionSignedValue(position: Position): number {
    return position.quantity * position.currentPrice;
  }

  private updateCashBalance(): void {
    let totalValueUsed = 0;
    this.positions.forEach(pos => {
      const signedValue = this.calculatePositionSignedValue(pos);
      if (signedValue < 0) {
        totalValueUsed += Math.abs(signedValue);
      }
    });
    this.cashBalance = this.baseEquity - totalValueUsed;
  }

  private calculateHerfindahlIndex(snapshot: ExposureSnapshot): number {
    let hhi = 0;
    const totalGross = snapshot.totalGross;

    if (totalGross === 0) return 0;

    Object.values(snapshot.bySector).forEach(exposure => {
      const weightSquared = Math.pow(exposure.pctOfPortfolio, 2);
      hhi += weightSquared;
    });

    return Math.min(hhi, 1.0);
  }

  public getSnapshot(): ExposureSnapshot {
    const snapshot: ExposureSnapshot = {
      timestamp: Date.now(),
      totalGross: 0,
      totalNet: 0,
      longExposure: 0,
      shortExposure: 0,
      cashAvailable: this.cashBalance,
      marginUsed: 0,
      marginAvailable: this.marginLimit,
      leverage: 0,
      bySector: {},
      byAssetClass: {},
      byDirection: { long: 0, short: 0 },
      byTimeframe: {},
      byGeography: {},
      concentrationHHI: 0
    };

    const currentEquity = this.calculateCurrentEquity();

    this.positions.forEach(position => {
      const absValue = this.calculatePositionValue(position);
      const signedValue = this.calculatePositionSignedValue(position);

      snapshot.totalGross += absValue;
      snapshot.totalNet += signedValue;

      if (position.direction === 'long') {
        snapshot.longExposure += absValue;
        snapshot.byDirection.long += absValue;
      } else {
        snapshot.shortExposure += absValue;
        snapshot.byDirection.short += absValue;
      }

      if (!snapshot.bySector[position.sector]) {
        snapshot.bySector[position.sector] = {
          gross: 0,
          net: 0,
          positionCount: 0,
          pctOfPortfolio: 0,
          limit: currentEquity * this.limits.maxSingleSector,
          utilization: 0
        };
      }

      snapshot.bySector[position.sector].gross += absValue;
      snapshot.bySector[position.sector].net += signedValue;
      snapshot.bySector[position.sector].positionCount++;

      if (!snapshot.byAssetClass[position.assetClass]) {
        snapshot.byAssetClass[position.assetClass] = 0;
      }
      snapshot.byAssetClass[position.assetClass] += absValue;

      if (!snapshot.byTimeframe[position.timeframe]) {
        snapshot.byTimeframe[position.timeframe] = 0;
      }
      snapshot.byTimeframe[position.timeframe] += absValue;

      if (!snapshot.byGeography[position.geography]) {
        snapshot.byGeography[position.geography] = 0;
      }
      snapshot.byGeography[position.geography] += absValue;
    });

    Object.values(snapshot.bySector).forEach(exposure => {
      exposure.pctOfPortfolio = currentEquity > 0 ? exposure.gross / currentEquity : 0;
      exposure.utilization = exposure.limit > 0 ? exposure.gross / exposure.limit : 0;
    });

    snapshot.leverage = currentEquity > 0 ? snapshot.totalGross / currentEquity : 0;
    snapshot.concentrationHHI = this.calculateHerfindahlIndex(snapshot);

    const totalShortValue = snapshot.shortExposure;
    snapshot.marginUsed = Math.max(0, totalShortValue - this.cashBalance);
    snapshot.marginAvailable = Math.max(
      0,
      this.marginLimit - snapshot.marginUsed
    );

    return snapshot;
  }

  private calculateCurrentEquity(): number {
    let totalValue = this.baseEquity;
    let shortValue = 0;

    this.positions.forEach(pos => {
      const signedValue = this.calculatePositionSignedValue(pos);
      if (signedValue > 0) {
        totalValue += signedValue - (pos.quantity * pos.entryPrice);
      } else {
        shortValue += Math.abs(signedValue);
      }
    });

    return Math.max(100, totalValue);
  }

  public checkExposure(trade: ProposedTrade): ExposureCheckResult {
    const currentEquity = this.calculateCurrentEquity();
    const currentSnapshot = this.getSnapshot();
    const projectedSnapshot = this.projectSnapshot(trade);

    const result: ExposureCheckResult = {
      approved: true,
      breachedLimits: [],
      suggestedSize: trade.quantity,
      reasons: [],
      utilizationAfter: {}
    };

    const tradeValue = trade.quantity * trade.price;

    // Check gross leverage
    if (projectedSnapshot.leverage > this.limits.maxGrossLeverage) {
      result.breachedLimits.push('maxGrossLeverage');
      result.approved = false;
      result.reasons.push(
        `Gross leverage would reach ${projectedSnapshot.leverage.toFixed(2)}x (limit: ${this.limits.maxGrossLeverage}x)`
      );
      result.utilizationAfter['maxGrossLeverage'] =
        projectedSnapshot.leverage / this.limits.maxGrossLeverage;
    }

    // Check net exposure
    const netExposureRatio = Math.abs(projectedSnapshot.totalNet) / currentEquity;
    if (netExposureRatio > this.limits.maxNetExposure) {
      result.breachedLimits.push('maxNetExposure');
      result.approved = false;
      result.reasons.push(
        `Net exposure would reach ${(netExposureRatio * 100).toFixed(1)}% (limit: ${(this.limits.maxNetExposure * 100).toFixed(1)}%)`
      );
      result.utilizationAfter['maxNetExposure'] = netExposureRatio / this.limits.maxNetExposure;
    }

    // Check single sector
    const sectorExposure = projectedSnapshot.bySector[trade.sector];
    if (sectorExposure && sectorExposure.utilization > 1.0) {
      result.breachedLimits.push('maxSingleSector');
      result.approved = false;
      result.reasons.push(
        `Sector exposure would reach ${(sectorExposure.pctOfPortfolio * 100).toFixed(1)}% (limit: ${(this.limits.maxSingleSector * 100).toFixed(1)}%)`
      );
      result.utilizationAfter['maxSingleSector'] = sectorExposure.utilization;
    }

    // Check single position
    const positionRatio = tradeValue / currentEquity;
    if (positionRatio > this.limits.maxSinglePosition) {
      result.breachedLimits.push('maxSinglePosition');
      result.approved = false;
      result.reasons.push(
        `Position size would be ${(positionRatio * 100).toFixed(1)}% of portfolio (limit: ${(this.limits.maxSinglePosition * 100).toFixed(1)}%)`
      );
      result.utilizationAfter['maxSinglePosition'] = positionRatio / this.limits.maxSinglePosition;
    }

    // Check long/short limits
    if (trade.side === 'buy') {
      const newLongExp = projectedSnapshot.longExposure / currentEquity;
      if (newLongExp > this.limits.maxLongExposure) {
        result.breachedLimits.push('maxLongExposure');
        result.approved = false;
        result.reasons.push(
          `Long exposure would reach ${(newLongExp * 100).toFixed(1)}% (limit: ${(this.limits.maxLongExposure * 100).toFixed(1)}%)`
        );
        result.utilizationAfter['maxLongExposure'] = newLongExp / this.limits.maxLongExposure;
      }
    } else {
      const newShortExp = projectedSnapshot.shortExposure / currentEquity;
      if (newShortExp > this.limits.maxShortExposure) {
        result.breachedLimits.push('maxShortExposure');
        result.approved = false;
        result.reasons.push(
          `Short exposure would reach ${(newShortExp * 100).toFixed(1)}% (limit: ${(this.limits.maxShortExposure * 100).toFixed(1)}%)`
        );
        result.utilizationAfter['maxShortExposure'] = newShortExp / this.limits.maxShortExposure;
      }
    }

    // Check HHI concentration
    if (projectedSnapshot.concentrationHHI > this.limits.maxConcentrationHHI) {
      result.breachedLimits.push('maxConcentrationHHI');
      result.approved = false;
      result.reasons.push(
        `Concentration HHI would reach ${projectedSnapshot.concentrationHHI.toFixed(3)} (limit: ${this.limits.maxConcentrationHHI.toFixed(3)})`
      );
      result.utilizationAfter['maxConcentrationHHI'] =
        projectedSnapshot.concentrationHHI / this.limits.maxConcentrationHHI;
    }

    // Calculate suggested size if trade breached limits
    if (!result.approved) {
      result.suggestedSize = this.calculateMaxAllowableSize(
        trade.symbol,
        trade.side,
        trade.price,
        trade.sector
      );
    }

    return result;
  }

  private projectSnapshot(trade: ProposedTrade): ExposureSnapshot {
    const tempPos: Position = {
      symbol: trade.symbol,
      quantity: trade.side === 'buy' ? trade.quantity : -trade.quantity,
      entryPrice: trade.price,
      currentPrice: trade.price,
      sector: trade.sector,
      assetClass: 'Equity',
      direction: trade.side === 'buy' ? 'long' : 'short',
      timeframe: trade.timeframe,
      geography: 'US'
    };

    const savedPositions = new Map(this.positions);
    const existingPos = this.positions.get(trade.symbol);

    if (existingPos) {
      existingPos.quantity += tempPos.quantity;
      existingPos.currentPrice = trade.price;
    } else {
      this.positions.set(trade.symbol, tempPos);
    }

    const projected = this.getSnapshot();

    this.positions.clear();
    savedPositions.forEach((pos, symbol) => {
      this.positions.set(symbol, pos);
    });

    return projected;
  }

  public calculateMaxAllowableSize(
    symbol: string,
    side: 'buy' | 'sell',
    price: number,
    sector: string
  ): number {
    const currentEquity = this.calculateCurrentEquity();
    const currentSnapshot = this.getSnapshot();

    let maxSize = Number.MAX_SAFE_INTEGER;

    // Based on max single position limit
    const positionLimit = (this.limits.maxSinglePosition * currentEquity) / price;
    maxSize = Math.min(maxSize, positionLimit);

    // Based on sector limit
    const sectorExposure = currentSnapshot.bySector[sector] || { gross: 0, net: 0, positionCount: 0, pctOfPortfolio: 0, limit: 0, utilization: 0 };
    const sectorCapacity = (
      (this.limits.maxSingleSector * currentEquity - sectorExposure.gross) / price
    );
    maxSize = Math.min(maxSize, Math.max(0, sectorCapacity));

    // Based on long/short limits
    if (side === 'buy') {
      const longCapacity = (
        (this.limits.maxLongExposure * currentEquity - currentSnapshot.longExposure) / price
      );
      maxSize = Math.min(maxSize, Math.max(0, longCapacity));
    } else {
      const shortCapacity = (
        (this.limits.maxShortExposure * currentEquity - currentSnapshot.shortExposure) / price
      );
      maxSize = Math.min(maxSize, Math.max(0, shortCapacity));
    }

    // Based on gross leverage
    const leverageCapacity = (
      (this.limits.maxGrossLeverage * currentEquity - currentSnapshot.totalGross) / price
    );
    maxSize = Math.min(maxSize, Math.max(0, leverageCapacity));

    return Math.floor(Math.max(0, maxSize));
  }

  public getPositionAttribution(symbol: string): { risk: number; contribution: number; marginalRisk: number; riskAdjustedReturn: number } | null {
    const position = this.positions.get(symbol);
    if (!position) return null;

    const snapshot = this.getSnapshot();
    const positionValue = this.calculatePositionValue(position);
    const contribution = snapshot.totalGross > 0 ? positionValue / snapshot.totalGross : 0;

    const signedValue = this.calculatePositionSignedValue(position);
    const pnl = signedValue - (position.quantity * position.entryPrice);
    const riskAdjustedReturn = positionValue > 0 ? pnl / positionValue : 0;

    const volatilityEstimate = 0.02;
    const marginalRisk = positionValue * volatilityEstimate;

    return {
      risk: positionValue,
      contribution,
      marginalRisk,
      riskAdjustedReturn
    };
  }

  public getExposureHeatmap(): Record<string, Record<string, number>> {
    const snapshot = this.getSnapshot();
    const heatmap: Record<string, Record<string, number>> = {};

    Object.keys(snapshot.bySector).forEach(sector => {
      heatmap[sector] = {
        long: 0,
        short: 0
      };
    });

    this.positions.forEach(position => {
      if (heatmap[position.sector]) {
        const value = this.calculatePositionValue(position);
        if (position.direction === 'long') {
          heatmap[position.sector].long += value;
        } else {
          heatmap[position.sector].short += value;
        }
      }
    });

    return heatmap;
  }

  public getExposureTrend(hours: number = 24): ExposureSnapshot[] {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return this.exposureHistory.filter(snap => snap.timestamp >= cutoff);
  }

  public updatePosition(symbol: string, newPrice: number): void {
    const position = this.positions.get(symbol);
    if (position) {
      position.currentPrice = newPrice;
      this.updateCashBalance();
      this.recordSnapshot();

      const snapshot = this.getSnapshot();
      this.emit('exposure:updated', { symbol, snapshot });
    }
  }

  public addPosition(position: Position): void {
    this.positions.set(position.symbol, position);
    this.updateCashBalance();
    this.recordSnapshot();
    this.emit('exposure:updated', { symbol: position.symbol, snapshot: this.getSnapshot() });
  }

  public removePosition(symbol: string): void {
    this.positions.delete(symbol);
    this.updateCashBalance();
    this.recordSnapshot();
    this.emit('exposure:updated', { symbol, snapshot: this.getSnapshot() });
  }

  private recordSnapshot(): void {
    const snapshot = this.getSnapshot();
    this.exposureHistory.push(snapshot);

    if (this.exposureHistory.length > 1440) {
      this.exposureHistory.shift();
    }

    this.checkLimits(snapshot);
  }

  private checkLimits(snapshot: ExposureSnapshot): void {
    const warnings: string[] = [];
    const breaches: string[] = [];

    if (snapshot.leverage > this.limits.maxGrossLeverage * 0.9) {
      warnings.push(`Gross leverage at ${(snapshot.leverage / this.limits.maxGrossLeverage * 100).toFixed(0)}% of limit`);
    }

    if (snapshot.leverage > this.limits.maxGrossLeverage) {
      breaches.push(`Gross leverage breach: ${snapshot.leverage.toFixed(2)}x`);
    }

    const netRatio = Math.abs(snapshot.totalNet) / this.calculateCurrentEquity();
    if (netRatio > this.limits.maxNetExposure * 0.9) {
      warnings.push(`Net exposure at ${(netRatio / this.limits.maxNetExposure * 100).toFixed(0)}% of limit`);
    }

    if (netRatio > this.limits.maxNetExposure) {
      breaches.push(`Net exposure breach: ${(netRatio * 100).toFixed(1)}%`);
    }

    Object.entries(snapshot.bySector).forEach(([sector, exposure]) => {
      if (exposure.utilization > 0.9) {
        warnings.push(`${sector} sector at ${(exposure.utilization * 100).toFixed(0)}% of limit`);
      }
      if (exposure.utilization > 1.0) {
        breaches.push(`${sector} sector breach: ${(exposure.utilization * 100).toFixed(1)}%`);
      }
    });

    if (snapshot.concentrationHHI > this.limits.maxConcentrationHHI * 0.9) {
      warnings.push(`Concentration HHI at ${(snapshot.concentrationHHI / this.limits.maxConcentrationHHI * 100).toFixed(0)}% of limit`);
    }

    if (snapshot.concentrationHHI > this.limits.maxConcentrationHHI) {
      breaches.push(`Concentration HHI breach: ${snapshot.concentrationHHI.toFixed(3)}`);
    }

    if (warnings.length > 0) {
      this.emit('limit:warning', { warnings, snapshot });
    }

    if (breaches.length > 0) {
      this.emit('limit:breach', { breaches, snapshot });
    }
  }

  public getDashboardData(): {
    currentSnapshot: ExposureSnapshot;
    limits: ExposureLimits;
    utilizationByLimit: Record<string, number>;
    heatmap: Record<string, Record<string, number>>;
    positionDetails: Array<{ symbol: string; value: number; sector: string; direction: string; attribution: number }>;
  } {
    const snapshot = this.getSnapshot();
    const currentEquity = this.calculateCurrentEquity();

    const utilizationByLimit: Record<string, number> = {
      grossLeverage: snapshot.leverage / this.limits.maxGrossLeverage,
      netExposure: (Math.abs(snapshot.totalNet) / currentEquity) / this.limits.maxNetExposure,
      concentrationHHI: snapshot.concentrationHHI / this.limits.maxConcentrationHHI,
      longExposure: (snapshot.longExposure / currentEquity) / this.limits.maxLongExposure,
      shortExposure: (snapshot.shortExposure / currentEquity) / this.limits.maxShortExposure
    };

    const positionDetails: Array<{ symbol: string; value: number; sector: string; direction: string; attribution: number }> = [];
    this.positions.forEach(pos => {
      const value = this.calculatePositionValue(pos);
      const attribution = snapshot.totalGross > 0 ? value / snapshot.totalGross : 0;
      positionDetails.push({
        symbol: pos.symbol,
        value,
        sector: pos.sector,
        direction: pos.direction,
        attribution
      });
    });

    positionDetails.sort((a, b) => b.value - a.value);

    return {
      currentSnapshot: snapshot,
      limits: this.limits,
      utilizationByLimit,
      heatmap: this.getExposureHeatmap(),
      positionDetails: positionDetails.slice(0, 20)
    };
  }

  public setLimits(newLimits: Partial<ExposureLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
  }

  public getLimits(): ExposureLimits {
    return { ...this.limits };
  }

  public getPositions(): Map<string, Position> {
    return new Map(this.positions);
  }
}