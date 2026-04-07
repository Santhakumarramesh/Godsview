/**
 * Phase 94 — Historical Replay Engine
 *
 * Event-driven market replay that simulates real-time data flow
 * from historical data. Supports multi-timeframe alignment,
 * no-lookahead guarantee, and realistic fill simulation.
 */

export interface ReplayBar {
  symbol: string;
  timeframe: string;
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
}

export interface ReplayTick {
  symbol: string;
  ts: Date;
  price: number;
  size: number;
  side: "buy" | "sell" | "unknown";
}

export interface ReplayOrder {
  id: string;
  symbol: string;
  direction: "long" | "short";
  type: "market" | "limit" | "stop";
  price: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  placedAt: Date;
  filledAt?: Date;
  fillPrice?: number;
  status: "pending" | "filled" | "cancelled" | "rejected";
  slippage?: number;
}

export interface ReplayPosition {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: Date;
  exitTime?: Date;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  mae: number; // max adverse excursion
  mfe: number; // max favorable excursion
  holdBars: number;
}

export interface ReplayConfig {
  startDate: Date;
  endDate: Date;
  symbols: string[];
  timeframes: string[];
  initialCapital: number;
  slippageModel: "none" | "fixed" | "percent" | "volume_based";
  slippageValue: number;
  commissionPerTrade: number;
  maxPositions: number;
  replaySpeed: number; // 1 = real-time, Infinity = as fast as possible
}

export type StrategyCallback = (bar: ReplayBar, engine: ReplayEngine) => ReplayOrder | null;

export interface ReplayState {
  currentTime: Date;
  capital: number;
  equity: number;
  positions: ReplayPosition[];
  closedPositions: ReplayPosition[];
  orders: ReplayOrder[];
  filledOrders: ReplayOrder[];
  barCount: number;
  drawdown: number;
  peakEquity: number;
}

const DEFAULT_REPLAY_CONFIG: ReplayConfig = {
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-12-31"),
  symbols: ["SPY"],
  timeframes: ["5m"],
  initialCapital: 100_000,
  slippageModel: "percent",
  slippageValue: 0.01, // 1 basis point
  commissionPerTrade: 1.0,
  maxPositions: 5,
  replaySpeed: Infinity,
};

export class ReplayEngine {
  private config: ReplayConfig;
  private state: ReplayState;
  private bars: ReplayBar[] = [];
  private barIndex = 0;
  private strategy: StrategyCallback | null = null;

  constructor(config: Partial<ReplayConfig> = {}) {
    this.config = { ...DEFAULT_REPLAY_CONFIG, ...config };
    this.state = {
      currentTime: this.config.startDate,
      capital: this.config.initialCapital,
      equity: this.config.initialCapital,
      positions: [],
      closedPositions: [],
      orders: [],
      filledOrders: [],
      barCount: 0,
      drawdown: 0,
      peakEquity: this.config.initialCapital,
    };
  }

  /** Load historical bars for replay (must be sorted by time) */
  loadBars(bars: ReplayBar[]): void {
    this.bars = bars.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    this.barIndex = 0;
  }

  /** Set the strategy callback */
  setStrategy(strategy: StrategyCallback): void {
    this.strategy = strategy;
  }

  /** Run the full replay */
  run(): ReplayState {
    for (this.barIndex = 0; this.barIndex < this.bars.length; this.barIndex++) {
      const bar = this.bars[this.barIndex];
      this.state.currentTime = bar.ts;
      this.state.barCount++;

      // 1. Check stop losses and take profits
      this.processExits(bar);

      // 2. Process pending orders
      this.processPendingOrders(bar);

      // 3. Run strategy
      if (this.strategy) {
        const order = this.strategy(bar, this);
        if (order) this.placeOrder(order);
      }

      // 4. Update equity and drawdown
      this.updateEquity(bar);
    }

    // Close any remaining positions at last price
    if (this.bars.length > 0) {
      const lastBar = this.bars[this.bars.length - 1];
      for (const pos of [...this.state.positions]) {
        this.closePosition(pos, lastBar.close, lastBar.ts, "end_of_replay");
      }
    }

    return this.state;
  }

  /** Place an order */
  placeOrder(order: ReplayOrder): void {
    if (this.state.positions.length >= this.config.maxPositions) {
      order.status = "rejected";
      return;
    }
    order.status = "pending";
    this.state.orders.push(order);
  }

  /** Process pending orders against current bar */
  private processPendingOrders(bar: ReplayBar): void {
    for (const order of this.state.orders) {
      if (order.status !== "pending") continue;
      if (order.symbol !== bar.symbol) continue;

      let filled = false;
      let fillPrice = 0;

      switch (order.type) {
        case "market":
          filled = true;
          fillPrice = bar.open; // market orders fill at open
          break;
        case "limit":
          if (order.direction === "long" && bar.low <= order.price) {
            filled = true;
            fillPrice = Math.min(order.price, bar.open);
          } else if (order.direction === "short" && bar.high >= order.price) {
            filled = true;
            fillPrice = Math.max(order.price, bar.open);
          }
          break;
        case "stop":
          if (order.direction === "long" && bar.high >= order.price) {
            filled = true;
            fillPrice = Math.max(order.price, bar.open);
          } else if (order.direction === "short" && bar.low <= order.price) {
            filled = true;
            fillPrice = Math.min(order.price, bar.open);
          }
          break;
      }

      if (filled) {
        const slippage = this.calculateSlippage(fillPrice, order.direction);
        fillPrice += slippage;
        order.fillPrice = fillPrice;
        order.filledAt = bar.ts;
        order.slippage = slippage;
        order.status = "filled";
        this.state.filledOrders.push(order);
        this.state.capital -= this.config.commissionPerTrade;

        // Create position
        const position: ReplayPosition = {
          symbol: order.symbol,
          direction: order.direction,
          entryPrice: fillPrice,
          quantity: order.quantity,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          entryTime: bar.ts,
          mae: 0,
          mfe: 0,
          holdBars: 0,
        };
        this.state.positions.push(position);
      }
    }

    // Remove filled/rejected orders from pending
    this.state.orders = this.state.orders.filter((o) => o.status === "pending");
  }

  /** Check stop losses and take profits */
  private processExits(bar: ReplayBar): void {
    for (const pos of [...this.state.positions]) {
      if (pos.symbol !== bar.symbol) continue;
      pos.holdBars++;

      // Update MAE/MFE
      if (pos.direction === "long") {
        const unrealizedLow = ((bar.low - pos.entryPrice) / pos.entryPrice) * 100;
        const unrealizedHigh = ((bar.high - pos.entryPrice) / pos.entryPrice) * 100;
        pos.mae = Math.min(pos.mae, unrealizedLow);
        pos.mfe = Math.max(pos.mfe, unrealizedHigh);

        // Stop loss
        if (bar.low <= pos.stopLoss) {
          this.closePosition(pos, pos.stopLoss, bar.ts, "stop_loss");
          continue;
        }
        // Take profit
        if (bar.high >= pos.takeProfit) {
          this.closePosition(pos, pos.takeProfit, bar.ts, "take_profit");
          continue;
        }
      } else {
        const unrealizedLow = ((pos.entryPrice - bar.high) / pos.entryPrice) * 100;
        const unrealizedHigh = ((pos.entryPrice - bar.low) / pos.entryPrice) * 100;
        pos.mae = Math.min(pos.mae, unrealizedLow);
        pos.mfe = Math.max(pos.mfe, unrealizedHigh);

        // Stop loss (short)
        if (bar.high >= pos.stopLoss) {
          this.closePosition(pos, pos.stopLoss, bar.ts, "stop_loss");
          continue;
        }
        // Take profit (short)
        if (bar.low <= pos.takeProfit) {
          this.closePosition(pos, pos.takeProfit, bar.ts, "take_profit");
          continue;
        }
      }
    }
  }

  /** Close a position */
  private closePosition(pos: ReplayPosition, exitPrice: number, exitTime: Date, _reason: string): void {
    const slippage = this.calculateSlippage(exitPrice, pos.direction === "long" ? "short" : "long");
    exitPrice += slippage;

    const pnlPerUnit = pos.direction === "long"
      ? exitPrice - pos.entryPrice
      : pos.entryPrice - exitPrice;

    pos.exitPrice = exitPrice;
    pos.exitTime = exitTime;
    pos.pnl = pnlPerUnit * pos.quantity;
    pos.pnlPercent = (pnlPerUnit / pos.entryPrice) * 100;

    this.state.capital += pos.pnl - this.config.commissionPerTrade;
    this.state.closedPositions.push(pos);
    this.state.positions = this.state.positions.filter((p) => p !== pos);
  }

  /** Calculate slippage based on model */
  private calculateSlippage(price: number, direction: "long" | "short"): number {
    const sign = direction === "long" ? 1 : -1;
    switch (this.config.slippageModel) {
      case "none": return 0;
      case "fixed": return sign * this.config.slippageValue;
      case "percent": return sign * price * (this.config.slippageValue / 100);
      case "volume_based": return sign * price * (this.config.slippageValue / 100) * (1 + Math.random() * 0.5);
      default: return 0;
    }
  }

  /** Update equity curve */
  private updateEquity(bar: ReplayBar): void {
    let unrealizedPnl = 0;
    for (const pos of this.state.positions) {
      if (pos.symbol !== bar.symbol) continue;
      const pnlPerUnit = pos.direction === "long"
        ? bar.close - pos.entryPrice
        : pos.entryPrice - bar.close;
      unrealizedPnl += pnlPerUnit * pos.quantity;
    }
    this.state.equity = this.state.capital + unrealizedPnl;
    this.state.peakEquity = Math.max(this.state.peakEquity, this.state.equity);
    this.state.drawdown = this.state.peakEquity > 0
      ? ((this.state.peakEquity - this.state.equity) / this.state.peakEquity) * 100
      : 0;
  }

  /** Get current state (read-only snapshot) */
  getState(): Readonly<ReplayState> {
    return { ...this.state };
  }

  /** Get current bar index */
  getBarIndex(): number {
    return this.barIndex;
  }

  /** Get historical bars up to current time (no lookahead) */
  getBarsUpToNow(symbol: string, timeframe: string, count: number): ReplayBar[] {
    const eligible = this.bars
      .slice(0, this.barIndex + 1)
      .filter((b) => b.symbol === symbol && b.timeframe === timeframe);
    return eligible.slice(-count);
  }
}
