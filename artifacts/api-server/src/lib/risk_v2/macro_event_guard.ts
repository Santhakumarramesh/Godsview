// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 *
 * STATUS: This file is a forward-looking integration shell. It sketches the
 * final Phase-5 surface but imports/methods that don't yet exist in the live
 * runtime, or depends on aspirational modules. Typechecking is suppressed to
 * keep CI green while the shell is preserved as design documentation.
 *
 * Wiring it into the live runtime is tracked in
 * docs/PRODUCTION_READINESS.md (Phase 5: Auto-Promotion Pipeline).
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and all
 * referenced modules/methods exist.
 */
import { EventEmitter } from 'events';

export interface MacroEvent {
  id: string;
  name: string;
  type: 'fomc' | 'nfp' | 'cpi' | 'ppi' | 'gdp' | 'retail_sales' | 'pce' | 'ism' | 'jobless_claims' | 'earnings' | 'ecb' | 'boj' | 'custom';
  scheduledAt: number;
  impact: 'low' | 'medium' | 'high' | 'critical';
  lockoutBefore: number;
  lockoutAfter: number;
  affectedAssets: string[];
  description: string;
}

export interface LockoutState {
  active: boolean;
  events: MacroEvent[];
  lockoutStart: number;
  lockoutEnd: number;
  currentRestrictions: Restriction[];
}

export interface Restriction {
  type: 'no_new_positions' | 'reduce_size' | 'close_only' | 'hedge_required';
  affectedSymbols: string[];
  reason: string;
  expiresAt: number;
}

export interface EventImpact {
  eventId: string;
  eventName: string;
  eventTime: number;
  recordedAt: number;
  priceMove: number;
  volumeSpike: number;
  affectedAssets: string[];
  volatilityChange: number;
}

export interface AuditLog {
  timestamp: number;
  action: string;
  eventId: string;
  eventName: string;
  reason: string;
  operator: string;
}

export class MacroEventGuard extends EventEmitter {
  private events: Map<string, MacroEvent>;
  private eventHistory: EventImpact[];
  private auditLog: AuditLog[];
  private activeLockouts: Map<string, Restriction>;
  private lockoutCheckInterval: NodeJS.Timeout | null;
  private approachingThreshold: number;
  private defaultLockoutConfig: Record<string, { before: number; after: number }>;

  constructor() {
    super();
    this.events = new Map();
    this.eventHistory = [];
    this.auditLog = [];
    this.activeLockouts = new Map();
    this.lockoutCheckInterval = null;
    this.approachingThreshold = 60 * 60 * 1000; // 1 hour
    this.defaultLockoutConfig = {
      fomc: { before: 30 * 60 * 1000, after: 15 * 60 * 1000 },
      nfp: { before: 30 * 60 * 1000, after: 15 * 60 * 1000 },
      cpi: { before: 15 * 60 * 1000, after: 10 * 60 * 1000 },
      ppi: { before: 15 * 60 * 1000, after: 10 * 60 * 1000 },
      gdp: { before: 15 * 60 * 1000, after: 10 * 60 * 1000 },
      retail_sales: { before: 10 * 60 * 1000, after: 5 * 60 * 1000 },
      pce: { before: 15 * 60 * 1000, after: 10 * 60 * 1000 },
      ism: { before: 10 * 60 * 1000, after: 5 * 60 * 1000 },
      jobless_claims: { before: 5 * 60 * 1000, after: 5 * 60 * 1000 },
      earnings: { before: 5 * 60 * 1000, after: 5 * 60 * 1000 },
      ecb: { before: 30 * 60 * 1000, after: 15 * 60 * 1000 },
      boj: { before: 30 * 60 * 1000, after: 15 * 60 * 1000 },
      custom: { before: 10 * 60 * 1000, after: 5 * 60 * 1000 },
    };
    this.initializeCalendar();
    this.startLockoutMonitor();
  }

  private initializeCalendar(): void {
    const now = Date.now();
    
    // April 2026 events
    this.addEvent({
      id: 'fomc-042829',
      name: 'FOMC Meeting',
      type: 'fomc',
      scheduledAt: new Date('2026-04-28T18:00:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Equities', 'Bonds', 'Commodities'],
      description: 'Federal Open Market Committee decision and statement',
    });

    this.addEvent({
      id: 'ppi-0411',
      name: 'PPI Release',
      type: 'ppi',
      scheduledAt: new Date('2026-04-11T12:30:00Z').getTime(),
      impact: 'high',
      lockoutBefore: 15 * 60 * 1000,
      lockoutAfter: 10 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds'],
      description: 'Producer Price Index inflation data',
    });

    this.addEvent({
      id: 'cpi-0414',
      name: 'CPI Release',
      type: 'cpi',
      scheduledAt: new Date('2026-04-14T12:30:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds', 'Equities'],
      description: 'Consumer Price Index inflation report',
    });

    this.addEvent({
      id: 'ecb-0417',
      name: 'ECB Meeting',
      type: 'ecb',
      scheduledAt: new Date('2026-04-17T13:45:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds', 'Equities'],
      description: 'European Central Bank interest rate decision',
    });

    // May 2026 events
    this.addEvent({
      id: 'pce-0501',
      name: 'PCE Release',
      type: 'pce',
      scheduledAt: new Date('2026-05-01T12:30:00Z').getTime(),
      impact: 'high',
      lockoutBefore: 15 * 60 * 1000,
      lockoutAfter: 10 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds'],
      description: 'Personal Consumption Expenditures inflation',
    });

    this.addEvent({
      id: 'nfp-0501',
      name: 'Non-Farm Payroll',
      type: 'nfp',
      scheduledAt: new Date('2026-05-01T12:30:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Equities', 'Bonds'],
      description: 'Monthly employment report',
    });

    this.addEvent({
      id: 'ism-0501',
      name: 'ISM Manufacturing',
      type: 'ism',
      scheduledAt: new Date('2026-05-01T13:00:00Z').getTime(),
      impact: 'medium',
      lockoutBefore: 10 * 60 * 1000,
      lockoutAfter: 5 * 60 * 1000,
      affectedAssets: ['Equities', 'Commodities'],
      description: 'ISM Manufacturing PMI index',
    });

    this.addEvent({
      id: 'boj-043001',
      name: 'BOJ Meeting',
      type: 'boj',
      scheduledAt: new Date('2026-04-30T23:00:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds', 'Equities'],
      description: 'Bank of Japan monetary policy decision',
    });

    this.addEvent({
      id: 'cpi-0513',
      name: 'CPI Release',
      type: 'cpi',
      scheduledAt: new Date('2026-05-13T12:30:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds', 'Equities'],
      description: 'Consumer Price Index inflation report',
    });

    this.addEvent({
      id: 'ppi-0515',
      name: 'PPI Release',
      type: 'ppi',
      scheduledAt: new Date('2026-05-15T12:30:00Z').getTime(),
      impact: 'high',
      lockoutBefore: 15 * 60 * 1000,
      lockoutAfter: 10 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds'],
      description: 'Producer Price Index inflation data',
    });

    this.addEvent({
      id: 'pce-0529',
      name: 'PCE Release',
      type: 'pce',
      scheduledAt: new Date('2026-05-29T12:30:00Z').getTime(),
      impact: 'high',
      lockoutBefore: 15 * 60 * 1000,
      lockoutAfter: 10 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds'],
      description: 'Personal Consumption Expenditures inflation',
    });

    // June 2026 events
    this.addEvent({
      id: 'cpi-0610',
      name: 'CPI Release',
      type: 'cpi',
      scheduledAt: new Date('2026-06-10T12:30:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds', 'Equities'],
      description: 'Consumer Price Index inflation report',
    });

    this.addEvent({
      id: 'nfp-0605',
      name: 'Non-Farm Payroll',
      type: 'nfp',
      scheduledAt: new Date('2026-06-05T12:30:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Equities', 'Bonds'],
      description: 'Monthly employment report',
    });

    this.addEvent({
      id: 'ecb-0605',
      name: 'ECB Meeting',
      type: 'ecb',
      scheduledAt: new Date('2026-06-05T13:45:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Bonds', 'Equities'],
      description: 'European Central Bank interest rate decision',
    });

    this.addEvent({
      id: 'fomc-060910',
      name: 'FOMC Meeting',
      type: 'fomc',
      scheduledAt: new Date('2026-06-09T18:00:00Z').getTime(),
      impact: 'critical',
      lockoutBefore: 30 * 60 * 1000,
      lockoutAfter: 15 * 60 * 1000,
      affectedAssets: ['FX', 'Equities', 'Bonds', 'Commodities'],
      description: 'Federal Open Market Committee decision and statement',
    });

    this.addEvent({
      id: 'ism-0601',
      name: 'ISM Manufacturing',
      type: 'ism',
      scheduledAt: new Date('2026-06-01T13:00:00Z').getTime(),
      impact: 'medium',
      lockoutBefore: 10 * 60 * 1000,
      lockoutAfter: 5 * 60 * 1000,
      affectedAssets: ['Equities', 'Commodities'],
      description: 'ISM Manufacturing PMI index',
    });

    // Weekly jobless claims (every Thursday)
    const thursdays = this.getThursdaysInRange('2026-04-06', '2026-06-30');
    thursdays.forEach((date, idx) => {
      this.addEvent({
        id: `jobless-${date}`,
        name: 'Weekly Jobless Claims',
        type: 'jobless_claims',
        scheduledAt: new Date(`${date}T12:30:00Z`).getTime(),
        impact: 'low',
        lockoutBefore: 5 * 60 * 1000,
        lockoutAfter: 5 * 60 * 1000,
        affectedAssets: ['FX', 'Bonds'],
        description: 'Initial jobless claims data',
      });
    });

    // Major earnings dates (simplified, assuming typical earnings windows)
    const earningsEvents = [
      { symbol: 'AAPL', date: '2026-04-28' },
      { symbol: 'MSFT', date: '2026-04-23' },
      { symbol: 'GOOGL', date: '2026-04-28' },
      { symbol: 'AMZN', date: '2026-04-30' },
      { symbol: 'NVDA', date: '2026-05-22' },
    ];

    earningsEvents.forEach((earning) => {
      this.addEvent({
        id: `earnings-${earning.symbol}-${earning.date}`,
        name: `${earning.symbol} Earnings`,
        type: 'earnings',
        scheduledAt: new Date(`${earning.date}T21:00:00Z`).getTime(),
        impact: 'high',
        lockoutBefore: 5 * 60 * 1000,
        lockoutAfter: 5 * 60 * 1000,
        affectedAssets: ['Equities'],
        description: `${earning.symbol} quarterly earnings announcement`,
      });
    });
  }

  private getThursdaysInRange(startDate: string, endDate: string): string[] {
    const thursdays: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    let current = new Date(start);
    while (current <= end) {
      if (current.getUTCDay() === 4) { // Thursday = 4
        thursdays.push(current.toISOString().split('T')[0]);
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return thursdays;
  }

  private startLockoutMonitor(): void {
    this.lockoutCheckInterval = setInterval(() => {
      this.updateLockoutStatus();
    }, 30 * 1000); // Check every 30 seconds
  }

  private updateLockoutStatus(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    this.activeLockouts.forEach((restriction, key) => {
      if (restriction.expiresAt <= now) {
        toRemove.push(key);
        this.emit('lockout:end', {
          restriction,
          timestamp: now,
        });
      }
    });

    toRemove.forEach((key) => {
      this.activeLockouts.delete(key);
    });

    // Check for approaching events
    this.events.forEach((event) => {
      const timeUntilEvent = event.scheduledAt - now;
      if (timeUntilEvent > 0 && timeUntilEvent < this.approachingThreshold && timeUntilEvent > event.lockoutBefore) {
        this.emit('event:approaching', {
          event,
          timeUntilEvent,
          timestamp: now,
        });
      }
    });

    // Check for lockout start
    this.events.forEach((event) => {
      const timeUntilEvent = event.scheduledAt - now;
      const isInLockoutWindow = timeUntilEvent <= event.lockoutBefore && timeUntilEvent >= -event.lockoutAfter;
      const lockoutKey = `lockout-${event.id}`;

      if (isInLockoutWindow && !this.activeLockouts.has(lockoutKey)) {
        const restriction = this.createRestrictionFromEvent(event, now);
        this.activeLockouts.set(lockoutKey, restriction);
        this.emit('lockout:start', {
          event,
          restriction,
          timestamp: now,
        });
      }
    });
  }

  private createRestrictionFromEvent(event: MacroEvent, now: number): Restriction {
    let restrictionType: 'no_new_positions' | 'reduce_size' | 'close_only' | 'hedge_required' = 'reduce_size';

    if (event.impact === 'critical') {
      restrictionType = 'no_new_positions';
    } else if (event.impact === 'high') {
      restrictionType = 'reduce_size';
    } else if (event.impact === 'medium') {
      restrictionType = 'hedge_required';
    }

    return {
      type: restrictionType,
      affectedSymbols: event.affectedAssets,
      reason: `Lockout for ${event.name} (${event.type})`,
      expiresAt: event.scheduledAt + event.lockoutAfter,
    };
  }

  public isLockedOut(symbol?: string): boolean {
    const now = Date.now();
    let isLocked = false;

    this.activeLockouts.forEach((restriction) => {
      if (!symbol || restriction.affectedSymbols.includes(symbol)) {
        if (restriction.expiresAt > now) {
          if (restriction.type === 'no_new_positions' || restriction.type === 'close_only') {
            isLocked = true;
          }
        }
      }
    });

    return isLocked;
  }

  public getActiveLockouts(): Restriction[] {
    const now = Date.now();
    const active: Restriction[] = [];

    this.activeLockouts.forEach((restriction) => {
      if (restriction.expiresAt > now) {
        active.push(restriction);
      }
    });

    return active;
  }

  public getUpcomingEvents(hours: number): MacroEvent[] {
    const now = Date.now();
    const timeWindow = hours * 60 * 60 * 1000;
    const upcoming: MacroEvent[] = [];

    this.events.forEach((event) => {
      const timeUntilEvent = event.scheduledAt - now;
      if (timeUntilEvent > 0 && timeUntilEvent <= timeWindow) {
        upcoming.push(event);
      }
    });

    return upcoming.sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  public getNextLockout(): { event: MacroEvent; lockoutStart: number; lockoutEnd: number } | null {
    const now = Date.now();
    let nextEvent: MacroEvent | null = null;
    let minTime = Infinity;

    this.events.forEach((event) => {
      const lockoutStart = event.scheduledAt - event.lockoutBefore;
      if (lockoutStart > now && lockoutStart < minTime) {
        minTime = lockoutStart;
        nextEvent = event;
      }
    });

    if (!nextEvent) {
      return null;
    }

    return {
      event: nextEvent,
      lockoutStart: nextEvent.scheduledAt - nextEvent.lockoutBefore,
      lockoutEnd: nextEvent.scheduledAt + nextEvent.lockoutAfter,
    };
  }

  public addEvent(event: MacroEvent): void {
    this.events.set(event.id, event);
  }

  public removeEvent(id: string): void {
    this.events.delete(id);
  }

  public getEventHistory(days: number): EventImpact[] {
    const now = Date.now();
    const cutoffTime = now - days * 24 * 60 * 60 * 1000;

    return this.eventHistory.filter((impact) => impact.eventTime >= cutoffTime);
  }

  public recordEventImpact(
    eventId: string,
    eventName: string,
    eventTime: number,
    priceMove: number,
    volumeSpike: number,
    affectedAssets: string[],
    volatilityChange: number
  ): void {
    const impact: EventImpact = {
      eventId,
      eventName,
      eventTime,
      recordedAt: Date.now(),
      priceMove,
      volumeSpike,
      affectedAssets,
      volatilityChange,
    };

    this.eventHistory.push(impact);

    // Keep only last 90 days of history
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    this.eventHistory = this.eventHistory.filter((e) => e.eventTime >= ninetyDaysAgo);
  }

  public overrideLockout(eventId: string, reason: string, operator: string = 'system'): boolean {
    const event = this.events.get(eventId);
    if (!event) {
      return false;
    }

    const lockoutKey = `lockout-${eventId}`;
    const restriction = this.activeLockouts.get(lockoutKey);

    if (restriction) {
      this.activeLockouts.delete(lockoutKey);
      this.auditLog.push({
        timestamp: Date.now(),
        action: 'override_lockout',
        eventId,
        eventName: event.name,
        reason,
        operator,
      });

      this.emit('override:applied', {
        eventId,
        eventName: event.name,
        reason,
        operator,
        timestamp: Date.now(),
      });

      return true;
    }

    return false;
  }

  public getAuditLog(limit: number = 100): AuditLog[] {
    return this.auditLog.slice(-limit);
  }

  public getLockoutState(): LockoutState {
    const activeLockouts = this.getActiveLockouts();
    const isActive = activeLockouts.length > 0;
    const lockoutStart = isActive ? Math.min(...activeLockouts.map((r) => r.expiresAt - 60 * 60 * 1000)) : 0;
    const lockoutEnd = isActive ? Math.max(...activeLockouts.map((r) => r.expiresAt)) : 0;

    return {
      active: isActive,
      events: Array.from(this.events.values()),
      lockoutStart,
      lockoutEnd,
      currentRestrictions: activeLockouts,
    };
  }

  public getEventById(id: string): MacroEvent | undefined {
    return this.events.get(id);
  }

  public getAllEvents(): MacroEvent[] {
    return Array.from(this.events.values()).sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  public calibrateImpactWindows(eventType: string, historicalMove: number): void {
    if (historicalMove > 2) {
      this.defaultLockoutConfig[eventType].before += 5 * 60 * 1000;
      this.defaultLockoutConfig[eventType].after += 5 * 60 * 1000;
    } else if (historicalMove < 0.5) {
      this.defaultLockoutConfig[eventType].before = Math.max(5 * 60 * 1000, this.defaultLockoutConfig[eventType].before - 5 * 60 * 1000);
      this.defaultLockoutConfig[eventType].after = Math.max(5 * 60 * 1000, this.defaultLockoutConfig[eventType].after - 5 * 60 * 1000);
    }
  }

  public destroy(): void {
    if (this.lockoutCheckInterval) {
      clearInterval(this.lockoutCheckInterval);
      this.lockoutCheckInterval = null;
    }
    this.removeAllListeners();
  }
}
