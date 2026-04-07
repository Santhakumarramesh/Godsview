import { EventEmitter } from 'events';

export type Position = {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  notionalValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  realizedPnl: number;
  fees: number;
  entryTime: string;
  lastUpdate: string;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  tags: string[];
};

export type PortfolioSnapshot = {
  totalPositions: number;
  longPositions: number;
  shortPositions: number;
  totalNotional: number;
  netExposure: number;
  grossExposure: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalFees: number;
  marginUsed: number;
  marginAvailable: number;
  buyingPower: number;
  dailyPnl: number;
  weeklyPnl: number;
  winningPositions: number;
  losingPositions: number;
};

export type PositionUpdate = {
  positionId: string;
  field: string;
  oldValue: number;
  newValue: number;
  timestamp: string;
};

export type ClosedPosition = Position & {
  exitPrice: number;
  exitTime: string;
  holdingPeriodMs: number;
  returnPct: number;
};

interface PositionManagerConfig {
  maxPositions?: number;
  marginRequirement?: number;
}

interface InternalPosition extends Position {
  dayOpenPrice?: number;
  dayOpenTime?: string;
}

export class PositionManager extends EventEmitter {
  private positions: Map<string, InternalPosition> = new Map();
  private closedPositions: ClosedPosition[] = [];
  private maxPositions: number;
  private marginRequirement: number;
  private positionCounter: number = 0;

  constructor(config?: PositionManagerConfig) {
    super();
    this.maxPositions = config?.maxPositions ?? 20;
    this.marginRequirement = config?.marginRequirement ?? 0.25;
  }

  openPosition(
    symbol: string,
    side: 'long' | 'short',
    quantity: number,
    entryPrice: number,
    opts?: {
      stopLoss?: number;
      takeProfit?: number;
      trailingStop?: number;
      tags?: string[];
    }
  ): Position {
    if (this.positions.size >= this.maxPositions) {
      throw new Error(
        `Maximum positions (${this.maxPositions}) reached`
      );
    }

    if (quantity <= 0 || entryPrice <= 0) {
      throw new Error('Quantity and entryPrice must be positive');
    }

    const id = `pos_${++this.positionCounter}`;
    const now = new Date().toISOString();
    const notionalValue = quantity * entryPrice;

    const position: InternalPosition = {
      id,
      symbol,
      side,
      entryPrice,
      currentPrice: entryPrice,
      quantity,
      notionalValue,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      realizedPnl: 0,
      fees: 0,
      entryTime: now,
      lastUpdate: now,
      stopLoss: opts?.stopLoss,
      takeProfit: opts?.takeProfit,
      trailingStop: opts?.trailingStop,
      tags: opts?.tags ?? [],
      dayOpenPrice: entryPrice,
      dayOpenTime: now,
    };

    this.positions.set(id, position);
    this.emit('position:opened', position);

    return this.toPublicPosition(position);
  }

  closePosition(positionId: string, exitPrice: number): ClosedPosition {
    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    if (exitPrice <= 0) {
      throw new Error('Exit price must be positive');
    }

    const now = new Date().toISOString();
    const entryTimeMs = new Date(position.entryTime).getTime();
    const exitTimeMs = new Date(now).getTime();
    const holdingPeriodMs = exitTimeMs - entryTimeMs;

    // Calculate P&L
    let pnl: number;
    if (position.side === 'long') {
      pnl = (exitPrice - position.entryPrice) * position.quantity;
    } else {
      pnl = (position.entryPrice - exitPrice) * position.quantity;
    }

    const returnPct =
      position.entryPrice !== 0
        ? ((pnl / (position.entryPrice * position.quantity)) * 100)
        : 0;

    const closedPosition: ClosedPosition = {
      ...position,
      exitPrice,
      exitTime: now,
      holdingPeriodMs,
      returnPct,
    };

    // Update realized P&L to account for the closed position
    closedPosition.realizedPnl = position.realizedPnl + pnl;

    this.positions.delete(positionId);
    this.closedPositions.push(closedPosition);

    this.emit('position:closed', closedPosition);

    return closedPosition;
  }

  updatePrice(symbol: string, price: number): void {
    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    const now = new Date().toISOString();
    let updated = false;

    for (const position of this.positions.values()) {
      if (position.symbol === symbol) {
        const oldPrice = position.currentPrice;
        position.currentPrice = price;
        position.lastUpdate = now;

        // Recalculate P&L
        this.recalculatePnL(position);

        updated = true;
        this.emit('position:updated', {
          positionId: position.id,
          field: 'currentPrice',
          oldValue: oldPrice,
          newValue: price,
          timestamp: now,
        } as PositionUpdate);
      }
    }

    if (updated) {
      // Check stop loss and take profit
      this.checkStopLoss();
      this.checkTakeProfit();
    }
  }

  getPosition(id: string): Position | undefined {
    const pos = this.positions.get(id);
    return pos ? this.toPublicPosition(pos) : undefined;
  }

  getPositionBySymbol(symbol: string): Position | undefined {
    for (const position of this.positions.values()) {
      if (position.symbol === symbol) {
        return this.toPublicPosition(position);
      }
    }
    return undefined;
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values()).map(p =>
      this.toPublicPosition(p)
    );
  }

  getPortfolioSnapshot(equity: number): PortfolioSnapshot {
    let totalNotional = 0;
    let netExposure = 0;
    let grossExposure = 0;
    let totalUnrealizedPnl = 0;
    let totalRealizedPnl = 0;
    let totalFees = 0;
    let longPositions = 0;
    let shortPositions = 0;
    let winningPositions = 0;
    let losingPositions = 0;

    for (const position of this.positions.values()) {
      const notional = position.notionalValue;
      totalNotional += notional;

      if (position.side === 'long') {
        netExposure += notional;
        longPositions++;
      } else {
        netExposure -= notional;
        shortPositions++;
      }

      grossExposure += notional;
      totalUnrealizedPnl += position.unrealizedPnl;
      totalRealizedPnl += position.realizedPnl;
      totalFees += position.fees;

      if (position.unrealizedPnl > 0) {
        winningPositions++;
      } else if (position.unrealizedPnl < 0) {
        losingPositions++;
      }
    }

    // Calculate realized P&L from closed positions
    for (const closed of this.closedPositions) {
      totalRealizedPnl += closed.realizedPnl;
    }

    const marginUsed = totalNotional * this.marginRequirement;
    const marginAvailable = Math.max(0, equity - marginUsed);
    const buyingPower = marginAvailable / this.marginRequirement;

    // Daily and weekly P&L (simplified: based on current unrealized)
    const dailyPnl = totalUnrealizedPnl;
    const weeklyPnl = totalUnrealizedPnl;

    return {
      totalPositions: this.positions.size,
      longPositions,
      shortPositions,
      totalNotional,
      netExposure,
      grossExposure,
      totalUnrealizedPnl,
      totalRealizedPnl,
      totalFees,
      marginUsed,
      marginAvailable,
      buyingPower,
      dailyPnl,
      weeklyPnl,
      winningPositions,
      losingPositions,
    };
  }

  getClosedPositions(): ClosedPosition[] {
    return [...this.closedPositions];
  }

  checkStopLoss(): ClosedPosition[] {
    const closed: ClosedPosition[] = [];

    for (const position of this.positions.values()) {
      if (position.stopLoss === undefined) {
        continue;
      }

      let hitStopLoss = false;

      if (position.side === 'long' && position.currentPrice <= position.stopLoss) {
        hitStopLoss = true;
      } else if (
        position.side === 'short' &&
        position.currentPrice >= position.stopLoss
      ) {
        hitStopLoss = true;
      }

      if (hitStopLoss) {
        const closedPos = this.closePosition(
          position.id,
          position.stopLoss
        );
        closed.push(closedPos);
        this.emit('position:stop-hit', closedPos);
      }
    }

    return closed;
  }

  checkTakeProfit(): ClosedPosition[] {
    const closed: ClosedPosition[] = [];

    for (const position of this.positions.values()) {
      if (position.takeProfit === undefined) {
        continue;
      }

      let hitTakeProfit = false;

      if (position.side === 'long' && position.currentPrice >= position.takeProfit) {
        hitTakeProfit = true;
      } else if (
        position.side === 'short' &&
        position.currentPrice <= position.takeProfit
      ) {
        hitTakeProfit = true;
      }

      if (hitTakeProfit) {
        const closedPos = this.closePosition(
          position.id,
          position.takeProfit
        );
        closed.push(closedPos);
        this.emit('position:tp-hit', closedPos);
      }
    }

    return closed;
  }

  adjustTrailingStops(): void {
    const now = new Date().toISOString();

    for (const position of this.positions.values()) {
      if (position.trailingStop === undefined) {
        continue;
      }

      if (position.side === 'long') {
        const minStopPrice = position.currentPrice - position.trailingStop;
        if (
          position.stopLoss === undefined ||
          minStopPrice > position.stopLoss
        ) {
          const oldStopLoss = position.stopLoss;
          position.stopLoss = minStopPrice;

          this.emit('position:updated', {
            positionId: position.id,
            field: 'stopLoss',
            oldValue: oldStopLoss ?? 0,
            newValue: minStopPrice,
            timestamp: now,
          } as PositionUpdate);

          this.emit('trailing-stop:adjusted', {
            positionId: position.id,
            newStopPrice: minStopPrice,
          });
        }
      } else {
        const maxStopPrice = position.currentPrice + position.trailingStop;
        if (
          position.stopLoss === undefined ||
          maxStopPrice < position.stopLoss
        ) {
          const oldStopLoss = position.stopLoss;
          position.stopLoss = maxStopPrice;

          this.emit('position:updated', {
            positionId: position.id,
            field: 'stopLoss',
            oldValue: oldStopLoss ?? 0,
            newValue: maxStopPrice,
            timestamp: now,
          } as PositionUpdate);

          this.emit('trailing-stop:adjusted', {
            positionId: position.id,
            newStopPrice: maxStopPrice,
          });
        }
      }
    }
  }

  private recalculatePnL(position: InternalPosition): void {
    if (position.side === 'long') {
      position.unrealizedPnl =
        (position.currentPrice - position.entryPrice) * position.quantity;
    } else {
      position.unrealizedPnl =
        (position.entryPrice - position.currentPrice) * position.quantity;
    }

    position.notionalValue = position.currentPrice * position.quantity;
    position.unrealizedPnlPct =
      position.entryPrice !== 0
        ? ((position.unrealizedPnl /
            (position.entryPrice * position.quantity)) *
            100)
        : 0;
  }

  private toPublicPosition(position: InternalPosition): Position {
    const { dayOpenPrice, dayOpenTime, ...publicPos } = position;
    return publicPos as Position;
  }
}
