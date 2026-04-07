import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// Type Definitions
export interface DispatcherConfig {
  channels: ChannelConfig[];
  rateLimits?: {
    maxPerMinute?: number;
    maxPerHour?: number;
  };
  retryAttempts?: number;
  batchIntervalMs?: number;
}

export interface ChannelConfig {
  id: string;
  type: 'dashboard' | 'email' | 'sms' | 'webhook' | 'slack' | 'telegram' | 'push';
  enabled: boolean;
  endpoint?: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4' | 'all';
  template?: string;
}

export interface Notification {
  id: string;
  alertId: string;
  channel: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'rate_limited';
  message: string;
  subject?: string;
  priority: string;
  attempts: number;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  error?: string;
}

export interface NotificationStats {
  totalSent: number;
  totalFailed: number;
  totalRateLimited: number;
  byChannel: Record<string, { sent: number; failed: number; avgLatencyMs: number }>;
  rateLimitStatus: {
    currentMinute: number;
    currentHour: number;
    isLimited: boolean;
  };
  lastNotification: string | null;
}

export interface EscalationChain {
  levels: {
    level: number;
    channels: string[];
    delayMs: number;
    description: string;
  }[];
}

interface RateLimitTracker {
  minute: number[];
  hour: number[];
}

interface ChannelStats {
  sent: number;
  failed: number;
  latencies: number[];
}

// NotificationDispatcher Class
export class NotificationDispatcher extends EventEmitter {
  private config: DispatcherConfig;
  private channels: Map<string, ChannelConfig>;
  private notifications: Map<string, Notification>;
  private rateLimitTracker: RateLimitTracker;
  private channelStats: Map<string, ChannelStats>;
  private escalationChain: EscalationChain;
  private batchQueue: Notification[];
  private batchTimer: NodeJS.Timeout | null;

  constructor(config: DispatcherConfig) {
    super();

    this.config = {
      rateLimits: {
        maxPerMinute: 30,
        maxPerHour: 200,
        ...config.rateLimits,
      },
      retryAttempts: config.retryAttempts ?? 3,
      batchIntervalMs: config.batchIntervalMs ?? 5000,
      channels: config.channels,
    };

    this.channels = new Map();
    this.notifications = new Map();
    this.rateLimitTracker = { minute: [], hour: [] };
    this.channelStats = new Map();
    this.batchQueue = [];
    this.batchTimer = null;

    // Initialize default escalation chain
    this.escalationChain = {
      levels: [
        {
          level: 1,
          channels: ['dashboard', 'slack_webhook'],
          delayMs: 0,
          description: 'Immediate notification to dashboard and Slack',
        },
        {
          level: 2,
          channels: ['email', 'telegram'],
          delayMs: 5 * 60 * 1000,
          description: 'Email and Telegram after 5 minutes',
        },
        {
          level: 3,
          channels: ['sms'],
          delayMs: 15 * 60 * 1000,
          description: 'SMS escalation after 15 minutes',
        },
      ],
    };

    // Initialize channels with defaults
    this.initializeDefaultChannels();

    // Add custom channels from config
    for (const channelConfig of config.channels) {
      this.channels.set(channelConfig.id, channelConfig);
      this.channelStats.set(channelConfig.id, { sent: 0, failed: 0, latencies: [] });
    }
  }

  private initializeDefaultChannels(): void {
    const defaults: ChannelConfig[] = [
      {
        id: 'dashboard',
        type: 'dashboard',
        enabled: true,
        priority: 'all',
      },
      {
        id: 'email',
        type: 'email',
        enabled: true,
        priority: 'P1',
        endpoint: 'https://api.internal/email',
      },
      {
        id: 'slack_webhook',
        type: 'slack',
        enabled: true,
        priority: 'P1',
        endpoint: 'https://hooks.slack.com/services/webhook',
      },
      {
        id: 'sms',
        type: 'sms',
        enabled: true,
        priority: 'P1',
        endpoint: 'https://api.internal/sms',
      },
      {
        id: 'telegram',
        type: 'telegram',
        enabled: true,
        priority: 'P1',
        endpoint: 'https://api.telegram.org/bot',
      },
    ];

    for (const defaultChannel of defaults) {
      if (!this.channels.has(defaultChannel.id)) {
        this.channels.set(defaultChannel.id, defaultChannel);
        this.channelStats.set(defaultChannel.id, { sent: 0, failed: 0, latencies: [] });
      }
    }
  }

  private matchesPriority(channelPriority: string, alertPriority: string): boolean {
    if (channelPriority === 'all') return true;
    return channelPriority === alertPriority;
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    this.rateLimitTracker.minute = this.rateLimitTracker.minute.filter((t) => t > oneMinuteAgo);
    this.rateLimitTracker.hour = this.rateLimitTracker.hour.filter((t) => t > oneHourAgo);

    const maxPerMinute = this.config.rateLimits?.maxPerMinute ?? 30;
    const maxPerHour = this.config.rateLimits?.maxPerHour ?? 200;

    if (
      this.rateLimitTracker.minute.length >= maxPerMinute ||
      this.rateLimitTracker.hour.length >= maxPerHour
    ) {
      return true;
    }

    return false;
  }

  private updateRateLimit(): void {
    const now = Date.now();
    this.rateLimitTracker.minute.push(now);
    this.rateLimitTracker.hour.push(now);
  }

  private simulateLatency(): number {
    // Simulate realistic latency between 50-500ms
    return Math.floor(Math.random() * 450) + 50;
  }

  public dispatch(alert: {
    id: string;
    priority: string;
    category: string;
    message: string;
    details: Record<string, unknown>;
  }): Notification[] {
    const dispatchedNotifications: Notification[] = [];

    if (this.checkRateLimit()) {
      // Handle rate limiting
      const notification: Notification = {
        id: randomUUID(),
        alertId: alert.id,
        channel: 'all',
        status: 'rate_limited',
        message: alert.message,
        priority: alert.priority,
        attempts: 0,
        createdAt: new Date().toISOString(),
        error: 'Rate limit exceeded',
      };

      this.notifications.set(notification.id, notification);
      this.emit('notification:rate-limited', notification);
      dispatchedNotifications.push(notification);
      return dispatchedNotifications;
    }

    // Find applicable channels based on priority
    const applicableChannels = Array.from(this.channels.values()).filter(
      (channel) =>
        channel.enabled &&
        this.matchesPriority(channel.priority, alert.priority)
    );

    if (applicableChannels.length === 0) {
      return dispatchedNotifications;
    }

    // Create notification for each applicable channel
    for (const channel of applicableChannels) {
      const notification: Notification = {
        id: randomUUID(),
        alertId: alert.id,
        channel: channel.id,
        status: 'pending',
        message: alert.message,
        subject: `[${alert.priority}] ${alert.category}`,
        priority: alert.priority,
        attempts: 0,
        createdAt: new Date().toISOString(),
      };

      this.notifications.set(notification.id, notification);
      this.batchQueue.push(notification);
      dispatchedNotifications.push(notification);
    }

    this.updateRateLimit();
    this.processBatch();

    return dispatchedNotifications;
  }

  private processBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      while (this.batchQueue.length > 0) {
        const notification = this.batchQueue.shift();
        if (notification) {
          this.sendNotification(notification);
        }
      }
      this.batchTimer = null;
    }, this.config.batchIntervalMs);
  }

  private sendNotification(notification: Notification): void {
    const channel = this.channels.get(notification.channel);
    if (!channel) return;

    notification.attempts++;
    const latency = this.simulateLatency();
    const stats = this.channelStats.get(channel.id);

    // Simulate 10% failure rate
    const failed = Math.random() < 0.1;

    if (failed && notification.attempts < (this.config.retryAttempts ?? 3)) {
      // Retry logic
      setTimeout(
        () => {
          this.sendNotification(notification);
        },
        Math.random() * 5000 + 1000
      );
      return;
    }

    if (failed) {
      notification.status = 'failed';
      notification.error = `Failed after ${notification.attempts} attempts`;
      this.emit('notification:failed', notification);

      if (stats) {
        stats.failed++;
      }
    } else {
      notification.status = 'delivered';
      notification.sentAt = new Date().toISOString();
      notification.deliveredAt = new Date().toISOString();
      this.emit('notification:sent', notification);

      if (stats) {
        stats.sent++;
        stats.latencies.push(latency);
      }
    }

    this.notifications.set(notification.id, notification);
  }

  public getNotifications(filters?: {
    alertId?: string;
    channel?: string;
    status?: string;
    limit?: number;
  }): Notification[] {
    let results = Array.from(this.notifications.values());

    if (filters?.alertId) {
      results = results.filter((n) => n.alertId === filters.alertId);
    }

    if (filters?.channel) {
      results = results.filter((n) => n.channel === filters.channel);
    }

    if (filters?.status) {
      results = results.filter((n) => n.status === filters.status);
    }

    if (filters?.limit) {
      results = results.slice(0, filters.limit);
    }

    return results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public getStats(): NotificationStats {
    let totalSent = 0;
    let totalFailed = 0;
    let totalRateLimited = 0;
    const byChannel: Record<string, { sent: number; failed: number; avgLatencyMs: number }> = {};

    for (const [channelId, stats] of this.channelStats) {
      totalSent += stats.sent;
      totalFailed += stats.failed;

      const avgLatency =
        stats.latencies.length > 0
          ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length
          : 0;

      byChannel[channelId] = {
        sent: stats.sent,
        failed: stats.failed,
        avgLatencyMs: Math.round(avgLatency),
      };
    }

    const rateLimitedNotifications = Array.from(this.notifications.values()).filter(
      (n) => n.status === 'rate_limited'
    );
    totalRateLimited = rateLimitedNotifications.length;

    const lastNotification = this.getNotifications({ limit: 1 })[0];

    return {
      totalSent,
      totalFailed,
      totalRateLimited,
      byChannel,
      rateLimitStatus: {
        currentMinute: this.rateLimitTracker.minute.length,
        currentHour: this.rateLimitTracker.hour.length,
        isLimited: this.checkRateLimit(),
      },
      lastNotification: lastNotification?.id ?? null,
    };
  }

  public addChannel(config: ChannelConfig): void {
    this.channels.set(config.id, config);
    this.channelStats.set(config.id, { sent: 0, failed: 0, latencies: [] });
  }

  public removeChannel(id: string): void {
    this.channels.delete(id);
    this.channelStats.delete(id);
  }

  public getChannels(): ChannelConfig[] {
    return Array.from(this.channels.values());
  }

  public setEscalationChain(chain: EscalationChain): void {
    this.escalationChain = chain;
  }

  public getEscalationChain(): EscalationChain {
    return this.escalationChain;
  }

  public async testChannel(channelId: string): Promise<boolean> {
    const channel = this.channels.get(channelId);
    if (!channel || !channel.enabled) {
      return false;
    }

    // Simulate test latency
    await new Promise((resolve) => setTimeout(resolve, this.simulateLatency()));

    // Simulate 95% success rate for channel tests
    return Math.random() < 0.95;
  }

  public clearHistory(olderThanMs?: number): number {
    const cutoffTime = olderThanMs ? Date.now() - olderThanMs : Date.now();
    let cleared = 0;

    for (const [id, notification] of this.notifications) {
      if (new Date(notification.createdAt).getTime() < cutoffTime) {
        this.notifications.delete(id);
        cleared++;
      }
    }

    return cleared;
  }
}
