import { EventEmitter } from 'events';

interface ReconciliationResult {
  id: string;
  timestamp: number;
  duration: number;
  internalOrders: number;
  brokerOrders: number;
  matched: number;
  mismatched: number;
  missingFromBroker: number;
  missingFromInternal: number;
  discrepancies: Discrepancy[];
  positionMismatches: PositionMismatch[];
  status: 'clean' | 'warnings' | 'critical';
  score: number; // 0-100
}

interface Discrepancy {
  orderId: string;
  field: string;
  internalValue: string;
  brokerValue: string;
  severity: 'info' | 'warning' | 'critical';
  resolution: 'auto_corrected' | 'manual_required' | 'pending';
  detectedAt: number;
  resolvedAt?: number;
}

interface PositionMismatch {
  symbol: string;
  internalQty: number;
  brokerQty: number;
  delta: number;
  marketValue: number;
  riskExposure: number;
  action: 'investigate' | 'force_sync' | 'ignore';
  detectedAt: number;
}

interface InternalOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  filledQty: number;
  avgFillPrice: number;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED';
  createdAt: number;
  updatedAt: number;
}

interface BrokerOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  filledQty: number;
  avgFillPrice: number;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED';
  brokerTimestamp: number;
}

interface UnsettledTrade {
  orderId: string;
  symbol: string;
  qty: number;
  filledPrice: number;
  executedAt: number;
  expectedSettlement: number;
  settlementType: 'T+0' | 'T+1' | 'T+2';
  status: 'pending' | 'settled' | 'failed';
}

interface Position {
  symbol: string;
  qty: number;
  avgCost: number;
  marketValue: number;
}

export class BrokerReconciler extends EventEmitter {
  private history: ReconciliationResult[] = [];
  private lastResult: ReconciliationResult | null = null;
  private unsettledTrades: UnsettledTrade[] = [];
  private resolvedDiscrepancies: Map<string, Discrepancy> = new Map();
  private internalOrders: Map<string, InternalOrder> = new Map();
  private brokerOrders: Map<string, BrokerOrder> = new Map();
  private internalPositions: Map<string, Position> = new Map();
  private brokerPositions: Map<string, Position> = new Map();
  private maxHistorySize: number = 100;
  private priceTolerancePercent: number = 0.1; // 0.1% tolerance

  constructor() {
    super();
    this.initializeMockData();
  }

  private initializeMockData(): void {
    // Initialize with empty collections - data should come from DB-backed sources
  }

  async runReconciliation(): Promise<ReconciliationResult> {
    const startTime = Date.now();
    const result: ReconciliationResult = {
      id: `RECON-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: startTime,
      duration: 0,
      internalOrders: this.internalOrders.size,
      brokerOrders: this.brokerOrders.size,
      matched: 0,
      mismatched: 0,
      missingFromBroker: 0,
      missingFromInternal: 0,
      discrepancies: [],
      positionMismatches: [],
      status: 'clean',
      score: 100,
    };

    // Check order existence and state
    for (const [orderId, internalOrder] of this.internalOrders) {
      const brokerOrder = this.brokerOrders.get(orderId);

      if (!brokerOrder) {
        result.missingFromBroker++;
        result.discrepancies.push({
          orderId,
          field: 'existence',
          internalValue: 'exists',
          brokerValue: 'missing',
          severity: 'warning',
          resolution: 'manual_required',
          detectedAt: startTime,
        });
      } else {
        // Check order state
        const discrepanciesFound = this.checkOrderDiscrepancies(
          internalOrder,
          brokerOrder,
          startTime
        );
        result.discrepancies.push(...discrepanciesFound);

        if (discrepanciesFound.length === 0) {
          result.matched++;
        } else {
          result.mismatched++;
        }
      }
    }

    // Check for orders in broker but not internal
    for (const [orderId, brokerOrder] of this.brokerOrders) {
      if (!this.internalOrders.has(orderId)) {
        result.missingFromInternal++;
        result.discrepancies.push({
          orderId,
          field: 'existence',
          internalValue: 'missing',
          brokerValue: 'exists',
          severity: 'info',
          resolution: 'pending',
          detectedAt: startTime,
        });
      }
    }

    // Check position mismatches
    const positionMismatches = this.checkPositionMismatches();
    result.positionMismatches = positionMismatches;

    // Auto-resolve minor discrepancies
    result.discrepancies = result.discrepancies.map((disc) => {
      if (
        disc.field === 'avgFillPrice' &&
        disc.severity === 'info' &&
        this.isPriceWithinTolerance(disc.internalValue, disc.brokerValue)
      ) {
        return {
          ...disc,
          resolution: 'auto_corrected',
        };
      }
      return disc;
    });

    // Determine status and score
    const criticalCount = result.discrepancies.filter(
      (d) => d.severity === 'critical'
    ).length;
    const warningCount = result.discrepancies.filter(
      (d) => d.severity === 'warning'
    ).length;

    if (criticalCount > 0) {
      result.status = 'critical';
      result.score = Math.max(0, 100 - criticalCount * 20 - warningCount * 5);
    } else if (warningCount > 0) {
      result.status = 'warnings';
      result.score = Math.max(50, 100 - warningCount * 5);
    } else {
      result.status = 'clean';
      result.score = 100;
    }

    // Add position delta penalties to score
    const largeDeltas = positionMismatches.filter((pm) => Math.abs(pm.delta) > 0);
    if (largeDeltas.length > 0) {
      result.score = Math.max(0, result.score - largeDeltas.length * 10);
      if (result.status === 'clean') {
        result.status = 'warnings';
      }
    }

    result.duration = Date.now() - startTime;

    // Store result
    this.lastResult = result;
    this.history.unshift(result);
    if (this.history.length > this.maxHistorySize) {
      this.history.pop();
    }

    // Emit events
    this.emit('reconciliation:complete', result);

    for (const disc of result.discrepancies) {
      if (disc.severity === 'critical' || disc.severity === 'warning') {
        this.emit('discrepancy:found', disc);
      }
    }

    for (const pm of positionMismatches) {
      if (Math.abs(pm.delta) > 0) {
        this.emit('position:mismatch', pm);
      }
    }

    return result;
  }

  private checkOrderDiscrepancies(
    internalOrder: InternalOrder,
    brokerOrder: BrokerOrder,
    timestamp: number
  ): Discrepancy[] {
    const discrepancies: Discrepancy[] = [];

    // Check status
    if (internalOrder.status !== brokerOrder.status) {
      // State lag is common, auto-correct
      discrepancies.push({
        orderId: internalOrder.id,
        field: 'status',
        internalValue: internalOrder.status,
        brokerValue: brokerOrder.status,
        severity: 'warning',
        resolution:
          brokerOrder.status === 'FILLED' && internalOrder.status === 'ACKNOWLEDGED'
            ? 'auto_corrected'
            : 'manual_required',
        detectedAt: timestamp,
      });
    }

    // Check filled quantity
    if (internalOrder.filledQty !== brokerOrder.filledQty) {
      discrepancies.push({
        orderId: internalOrder.id,
        field: 'filledQty',
        internalValue: internalOrder.filledQty.toString(),
        brokerValue: brokerOrder.filledQty.toString(),
        severity: 'critical',
        resolution: 'manual_required',
        detectedAt: timestamp,
      });
    }

    // Check fill price
    if (
      internalOrder.filledQty > 0 &&
      !this.isPriceWithinTolerance(
        internalOrder.avgFillPrice.toString(),
        brokerOrder.avgFillPrice.toString()
      )
    ) {
      discrepancies.push({
        orderId: internalOrder.id,
        field: 'avgFillPrice',
        internalValue: internalOrder.avgFillPrice.toFixed(2),
        brokerValue: brokerOrder.avgFillPrice.toFixed(2),
        severity: 'info',
        resolution: 'pending',
        detectedAt: timestamp,
      });
    }

    return discrepancies;
  }

  private checkPositionMismatches(): PositionMismatch[] {
    const mismatches: PositionMismatch[] = [];
    const allSymbols = new Set([
      ...this.internalPositions.keys(),
      ...this.brokerPositions.keys(),
    ]);

    for (const symbol of allSymbols) {
      const internalPos = this.internalPositions.get(symbol);
      const brokerPos = this.brokerPositions.get(symbol);

      const internalQty = internalPos?.qty ?? 0;
      const brokerQty = brokerPos?.qty ?? 0;
      const delta = brokerQty - internalQty;

      if (delta !== 0) {
        const mismatch: PositionMismatch = {
          symbol,
          internalQty,
          brokerQty,
          delta,
          marketValue: brokerPos?.marketValue ?? 0,
          riskExposure: Math.abs(delta) * (brokerPos?.avgCost ?? 0),
          action:
            Math.abs(delta) > 100
              ? 'investigate'
              : Math.abs(delta) > 10
                ? 'force_sync'
                : 'ignore',
          detectedAt: Date.now(),
        };
        mismatches.push(mismatch);
      }
    }

    return mismatches;
  }

  private isPriceWithinTolerance(internal: string, broker: string): boolean {
    const internalPrice = parseFloat(internal);
    const brokerPrice = parseFloat(broker);

    if (internalPrice === 0 || brokerPrice === 0) {
      return true;
    }

    const percentDiff =
      Math.abs(internalPrice - brokerPrice) / brokerPrice * 100;
    return percentDiff <= this.priceTolerancePercent;
  }

  getLastResult(): ReconciliationResult | null {
    return this.lastResult;
  }

  getHistory(limit: number = 10): ReconciliationResult[] {
    return this.history.slice(0, Math.min(limit, this.history.length));
  }

  getDiscrepancies(severity?: 'info' | 'warning' | 'critical'): Discrepancy[] {
    if (!this.lastResult) {
      return [];
    }

    if (severity) {
      return this.lastResult.discrepancies.filter((d) => d.severity === severity);
    }

    return this.lastResult.discrepancies;
  }

  resolveDiscrepancy(
    orderId: string,
    resolution: 'auto_corrected' | 'manual_required' | 'pending'
  ): boolean {
    if (!this.lastResult) {
      return false;
    }

    const discrepancy = this.lastResult.discrepancies.find(
      (d) => d.orderId === orderId
    );
    if (discrepancy) {
      discrepancy.resolution = resolution;
      discrepancy.resolvedAt = Date.now();
      this.resolvedDiscrepancies.set(orderId, discrepancy);
      return true;
    }

    return false;
  }

  getPositionMismatches(): PositionMismatch[] {
    return this.lastResult?.positionMismatches ?? [];
  }

  async recoverState(): Promise<void> {
    const startTime = Date.now();

    // Simulate state recovery from broker truth
    for (const [orderId, brokerOrder] of this.brokerOrders) {
      const internalOrder = this.internalOrders.get(orderId);

      if (!internalOrder) {
        // Recover from broker
        this.internalOrders.set(orderId, {
          id: brokerOrder.id,
          symbol: brokerOrder.symbol,
          side: brokerOrder.side,
          qty: brokerOrder.qty,
          filledQty: brokerOrder.filledQty,
          avgFillPrice: brokerOrder.avgFillPrice,
          status: brokerOrder.status,
          createdAt: brokerOrder.brokerTimestamp,
          updatedAt: brokerOrder.brokerTimestamp,
        });
      } else {
        // Sync state to broker truth
        internalOrder.filledQty = brokerOrder.filledQty;
        internalOrder.avgFillPrice = brokerOrder.avgFillPrice;
        internalOrder.status = brokerOrder.status;
        internalOrder.updatedAt = brokerOrder.brokerTimestamp;
      }
    }

    // Recover positions from broker
    for (const [symbol, brokerPos] of this.brokerPositions) {
      this.internalPositions.set(symbol, {
        ...brokerPos,
      });
    }

    this.emit('recovery:complete', {
      timestamp: startTime,
      duration: Date.now() - startTime,
      ordersRecovered: this.internalOrders.size,
      positionsRecovered: this.internalPositions.size,
    });
  }

  getUnsettledTrades(): UnsettledTrade[] {
    const now = Date.now();
    return this.unsettledTrades.filter((trade) => {
      if (trade.status === 'settled' || trade.status === 'failed') {
        return false;
      }

      // Check if settlement time has passed
      if (now > trade.expectedSettlement && trade.status === 'pending') {
        this.emit('settlement:pending', {
          orderId: trade.orderId,
          overdueSince: now - trade.expectedSettlement,
        });
      }

      return true;
    });
  }

  getReconciliationScore(): number {
    return this.lastResult?.score ?? 100;
  }

  addInternalOrder(order: InternalOrder): void {
    this.internalOrders.set(order.id, order);
  }

  addBrokerOrder(order: BrokerOrder): void {
    this.brokerOrders.set(order.id, order);
  }

  updatePosition(symbol: string, position: Position, isBroker: boolean = false): void {
    if (isBroker) {
      this.brokerPositions.set(symbol, position);
    } else {
      this.internalPositions.set(symbol, position);
    }
  }

  addUnsettledTrade(trade: UnsettledTrade): void {
    this.unsettledTrades.push(trade);
  }

  settleUnsettledTrade(orderId: string, status: 'settled' | 'failed'): boolean {
    const trade = this.unsettledTrades.find((t) => t.orderId === orderId);
    if (trade) {
      trade.status = status;
      return true;
    }
    return false;
  }

  getInternalOrders(): Map<string, InternalOrder> {
    return this.internalOrders;
  }

  getBrokerOrders(): Map<string, BrokerOrder> {
    return this.brokerOrders;
  }

  getInternalPositions(): Map<string, Position> {
    return this.internalPositions;
  }

  getBrokerPositions(): Map<string, Position> {
    return this.brokerPositions;
  }

  clearHistory(): void {
    this.history = [];
    this.lastResult = null;
  }

  setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
  }

  setPriceTolerance(percentTolerance: number): void {
    this.priceTolerancePercent = percentTolerance;
  }
}
