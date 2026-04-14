/**
 * notifications/index.ts — Phase 71: Notification & Communication Hub
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. ChannelRegistry     — email / slack / webhook / sms / push channels.
 *   2. TemplateEngine      — template storage with {{var}} interpolation.
 *   3. NotificationQueue   — priority queue with delivery attempts.
 *   4. PreferenceManager   — per-user channel preferences + DND windows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Channels ───────────────────────────────────────────────────────────────

export type ChannelKind = "email" | "slack" | "webhook" | "sms" | "push" | "inapp";
export type ChannelStatus = "active" | "paused" | "failed";

export interface Channel {
  id: string;
  kind: ChannelKind;
  name: string;
  config: Record<string, string>;
  status: ChannelStatus;
  createdAt: number;
  lastDeliveredAt?: number;
  failureCount: number;
}

export class ChannelRegistry {
  private readonly channels = new Map<string, Channel>();

  register(params: { kind: ChannelKind; name: string; config: Record<string, string> }): Channel {
    const id = `chn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const channel: Channel = {
      id,
      ...params,
      status: "active",
      createdAt: Date.now(),
      failureCount: 0,
    };
    this.channels.set(id, channel);
    return channel;
  }

  setStatus(id: string, status: ChannelStatus): Channel | null {
    const c = this.channels.get(id);
    if (!c) return null;
    c.status = status;
    return c;
  }

  list(kind?: ChannelKind): Channel[] {
    const all = Array.from(this.channels.values());
    return kind ? all.filter((c) => c.kind === kind) : all;
  }

  get(id: string): Channel | null {
    return this.channels.get(id) ?? null;
  }
}

// ── Templates ──────────────────────────────────────────────────────────────

export interface Template {
  id: string;
  key: string;              // e.g. "incident.declared"
  subject: string;          // used for email/push
  body: string;             // supports {{var}} interpolation
  variables: string[];      // declared variables
  createdAt: number;
  version: number;
}

export class TemplateEngine {
  private readonly templates = new Map<string, Template>();
  private readonly byKey = new Map<string, string>();

  upsert(params: { key: string; subject: string; body: string; variables?: string[] }): Template {
    const existingId = this.byKey.get(params.key);
    const existing = existingId ? this.templates.get(existingId) : undefined;
    const id = existing?.id ?? `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const tpl: Template = {
      id,
      key: params.key,
      subject: params.subject,
      body: params.body,
      variables: params.variables ?? this._extractVars(params.body + " " + params.subject),
      createdAt: existing?.createdAt ?? Date.now(),
      version: (existing?.version ?? 0) + 1,
    };
    this.templates.set(id, tpl);
    this.byKey.set(params.key, id);
    return tpl;
  }

  render(key: string, vars: Record<string, string | number>): { subject: string; body: string } | null {
    const id = this.byKey.get(key);
    if (!id) return null;
    const tpl = this.templates.get(id);
    if (!tpl) return null;
    const interpolate = (s: string): string => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));
    return { subject: interpolate(tpl.subject), body: interpolate(tpl.body) };
  }

  list(): Template[] {
    return Array.from(this.templates.values());
  }

  get(key: string): Template | null {
    const id = this.byKey.get(key);
    if (!id) return null;
    return this.templates.get(id) ?? null;
  }

  private _extractVars(body: string): string[] {
    const found = new Set<string>();
    const re = /\{\{\s*(\w+)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) found.add(m[1]!);
    return Array.from(found);
  }
}

// ── Notification Queue ─────────────────────────────────────────────────────

export type Priority = "low" | "normal" | "high" | "urgent";
export type DeliveryStatus = "queued" | "sending" | "delivered" | "failed" | "suppressed";

export interface Notification {
  id: string;
  channelId: string;
  recipient: string;
  templateKey?: string;
  subject: string;
  body: string;
  priority: Priority;
  queuedAt: number;
  sentAt?: number;
  status: DeliveryStatus;
  attempts: number;
  error?: string;
  dedupeKey?: string;
}

export class NotificationQueue {
  private readonly queue: Notification[] = [];
  private readonly seenDedupe = new Map<string, number>(); // dedupeKey → queuedAt

  enqueue(params: {
    channelId: string;
    recipient: string;
    subject: string;
    body: string;
    priority?: Priority;
    templateKey?: string;
    dedupeKey?: string;
  }): Notification {
    if (params.dedupeKey) {
      const recent = this.seenDedupe.get(params.dedupeKey);
      if (recent && Date.now() - recent < 60_000) {
        const suppressed: Notification = {
          id: `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          channelId: params.channelId,
          recipient: params.recipient,
          templateKey: params.templateKey,
          subject: params.subject,
          body: params.body,
          priority: params.priority ?? "normal",
          queuedAt: Date.now(),
          status: "suppressed",
          attempts: 0,
          dedupeKey: params.dedupeKey,
        };
        this.queue.push(suppressed);
        return suppressed;
      }
      this.seenDedupe.set(params.dedupeKey, Date.now());
    }
    const notification: Notification = {
      id: `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      channelId: params.channelId,
      recipient: params.recipient,
      templateKey: params.templateKey,
      subject: params.subject,
      body: params.body,
      priority: params.priority ?? "normal",
      queuedAt: Date.now(),
      status: "queued",
      attempts: 0,
      dedupeKey: params.dedupeKey,
    };
    this.queue.push(notification);
    if (this.queue.length > 50_000) this.queue.shift();
    return notification;
  }

  dequeue(): Notification | null {
    // priority order
    const order: Priority[] = ["urgent", "high", "normal", "low"];
    for (const p of order) {
      const idx = this.queue.findIndex((n) => n.status === "queued" && n.priority === p);
      if (idx >= 0) {
        const n = this.queue[idx]!;
        n.status = "sending";
        n.attempts++;
        return n;
      }
    }
    return null;
  }

  markDelivered(id: string): Notification | null {
    const n = this.queue.find((x) => x.id === id);
    if (!n) return null;
    n.status = "delivered";
    n.sentAt = Date.now();
    return n;
  }

  markFailed(id: string, error: string): Notification | null {
    const n = this.queue.find((x) => x.id === id);
    if (!n) return null;
    if (n.attempts < 3) {
      n.status = "queued"; // retry
    } else {
      n.status = "failed";
      n.error = error;
    }
    return n;
  }

  pending(): Notification[] {
    return this.queue.filter((n) => n.status === "queued");
  }

  recent(limit = 100): Notification[] {
    return this.queue.slice(-limit).reverse();
  }

  stats(): {
    queued: number; sending: number; delivered: number; failed: number; suppressed: number;
  } {
    const counters = { queued: 0, sending: 0, delivered: 0, failed: 0, suppressed: 0 };
    for (const n of this.queue) counters[n.status]++;
    return counters;
  }
}

// ── Preferences ────────────────────────────────────────────────────────────

export interface Preference {
  userId: string;
  channelId: string;
  eventTypes: string[];
  dndWindows: Array<{ startHour: number; endHour: number }>; // local time
  createdAt: number;
}

export class PreferenceManager {
  private readonly prefs = new Map<string, Preference[]>();

  set(userId: string, pref: Omit<Preference, "userId" | "createdAt">): Preference {
    const arr = this.prefs.get(userId) ?? [];
    const complete: Preference = { ...pref, userId, createdAt: Date.now() };
    // Replace any existing channel-id match
    const idx = arr.findIndex((p) => p.channelId === pref.channelId);
    if (idx >= 0) arr[idx] = complete;
    else arr.push(complete);
    this.prefs.set(userId, arr);
    return complete;
  }

  get(userId: string): Preference[] {
    return this.prefs.get(userId) ?? [];
  }

  allow(userId: string, channelId: string, eventType: string, atHour?: number): boolean {
    const list = this.get(userId);
    if (list.length === 0) return true; // no prefs → allow by default
    const pref = list.find((p) => p.channelId === channelId);
    if (!pref) return true;
    if (!pref.eventTypes.includes(eventType) && !pref.eventTypes.includes("*")) return false;
    if (atHour !== undefined) {
      for (const w of pref.dndWindows) {
        if (w.startHour <= w.endHour) {
          if (atHour >= w.startHour && atHour < w.endHour) return false;
        } else {
          // wraps midnight, e.g. 22..6
          if (atHour >= w.startHour || atHour < w.endHour) return false;
        }
      }
    }
    return true;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const channelRegistry = new ChannelRegistry();
export const templateEngine = new TemplateEngine();
export const notificationQueue = new NotificationQueue();
export const preferenceManager = new PreferenceManager();

// Seed a couple of default templates so the module isn't completely empty.
templateEngine.upsert({
  key: "incident.declared",
  subject: "[{{severity}}] {{title}}",
  body: "Incident {{id}} declared by {{commander}}.\n\n{{description}}\n\nStatus: {{status}}",
});
templateEngine.upsert({
  key: "strategy.promoted",
  subject: "Strategy promoted: {{name}}",
  body: "Strategy {{name}} promoted to {{tier}} at {{at}}.",
});
logger.info({ templates: templateEngine.list().length }, "[Notifications] Module initialized");
