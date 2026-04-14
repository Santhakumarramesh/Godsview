/**
 * reporting/index.ts — Phase 84: Reporting Engine
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. ReportTemplateStore  — parameterized report templates.
 *   2. ReportRenderer       — render markdown / HTML / CSV / JSON.
 *   3. ReportScheduleEngine — schedule recurring reports.
 *   4. ReportDistributor    — track delivery to recipients.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Templates ─────────────────────────────────────────────────────────────

export type ReportFormat = "markdown" | "html" | "csv" | "json";

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  format: ReportFormat;
  template: string;          // template body, supports {{var}} / {{#each}}
  variables: string[];
  createdAt: number;
  version: number;
}

export class ReportTemplateStore {
  private readonly templates = new Map<string, ReportTemplate>();
  private readonly byName = new Map<string, string>();

  upsert(params: {
    name: string;
    description?: string;
    format: ReportFormat;
    template: string;
  }): ReportTemplate {
    const existingId = this.byName.get(params.name);
    const existing = existingId ? this.templates.get(existingId) : undefined;
    const id = existing?.id ?? `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const tpl: ReportTemplate = {
      id,
      name: params.name,
      description: params.description ?? "",
      format: params.format,
      template: params.template,
      variables: this._extractVars(params.template),
      createdAt: existing?.createdAt ?? Date.now(),
      version: (existing?.version ?? 0) + 1,
    };
    this.templates.set(id, tpl);
    this.byName.set(params.name, id);
    return tpl;
  }

  list(): ReportTemplate[] {
    return Array.from(this.templates.values());
  }

  get(id: string): ReportTemplate | null {
    return this.templates.get(id) ?? null;
  }

  byNameLookup(name: string): ReportTemplate | null {
    const id = this.byName.get(name);
    return id ? this.templates.get(id) ?? null : null;
  }

  delete(id: string): boolean {
    const t = this.templates.get(id);
    if (!t) return false;
    this.byName.delete(t.name);
    return this.templates.delete(id);
  }

  private _extractVars(body: string): string[] {
    const found = new Set<string>();
    const re = /\{\{\s*(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) found.add(m[1]!);
    return Array.from(found);
  }
}

// ── Renderer ───────────────────────────────────────────────────────────────

export class ReportRenderer {
  render(template: ReportTemplate, data: Record<string, unknown>): { content: string; format: ReportFormat } {
    const interpolated = this._interpolate(template.template, data);
    if (template.format === "json") {
      // Treat the interpolated string as JSON if possible, else wrap data
      try { return { content: JSON.stringify(JSON.parse(interpolated), null, 2), format: "json" }; }
      catch { return { content: JSON.stringify(data, null, 2), format: "json" }; }
    }
    return { content: interpolated, format: template.format };
  }

  toHTML(markdown: string): string {
    // tiny markdown→HTML: headings, bold, italic, lists, paragraphs
    const escape = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
    const lines = markdown.split(/\r?\n/);
    const out: string[] = [];
    let inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (/^#{1,6}\s/.test(line)) {
        if (inList) { out.push("</ul>"); inList = false; }
        const level = line.match(/^#+/)![0].length;
        out.push(`<h${level}>${escape(line.slice(level + 1))}</h${level}>`);
      } else if (/^[*-]\s/.test(line)) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push(`<li>${this._inline(escape(line.slice(2)))}</li>`);
      } else if (line === "") {
        if (inList) { out.push("</ul>"); inList = false; }
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        out.push(`<p>${this._inline(escape(line))}</p>`);
      }
    }
    if (inList) out.push("</ul>");
    return `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:800px;margin:2em auto;line-height:1.5">${out.join("\n")}</body></html>`;
  }

  toCSV(rows: Array<Record<string, unknown>>): string {
    if (rows.length === 0) return "";
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(","));
    return lines.join("\n");
  }

  private _interpolate(body: string, data: Record<string, unknown>): string {
    // {{#each items}}...{{/each}} support
    let s = body.replace(/\{\{#each\s+(\w+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, inner) => {
      const arr = data[key];
      if (!Array.isArray(arr)) return "";
      return arr.map((item) => this._interpolate(inner, item as Record<string, unknown>)).join("");
    });
    s = s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
      const v = data[k];
      return v === undefined || v === null ? "" : String(v);
    });
    return s;
  }

  private _inline(s: string): string {
    return s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
}

// ── Schedule ──────────────────────────────────────────────────────────────

export interface ReportSchedule {
  id: string;
  templateId: string;
  cron: string;
  recipients: string[];
  enabled: boolean;
  lastFiredAt?: number;
  createdAt: number;
}

export class ReportScheduleEngine {
  private readonly schedules = new Map<string, ReportSchedule>();

  create(params: { templateId: string; cron: string; recipients: string[] }): ReportSchedule {
    const id = `rsh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const sched: ReportSchedule = {
      id,
      templateId: params.templateId,
      cron: params.cron,
      recipients: [...params.recipients],
      enabled: true,
      createdAt: Date.now(),
    };
    this.schedules.set(id, sched);
    return sched;
  }

  list(): ReportSchedule[] {
    return Array.from(this.schedules.values());
  }

  setEnabled(id: string, enabled: boolean): ReportSchedule | null {
    const s = this.schedules.get(id);
    if (!s) return null;
    s.enabled = enabled;
    return s;
  }

  recordFire(id: string): void {
    const s = this.schedules.get(id);
    if (s) s.lastFiredAt = Date.now();
  }

  delete(id: string): boolean {
    return this.schedules.delete(id);
  }
}

// ── Distribution ──────────────────────────────────────────────────────────

export interface DeliveryRecord {
  id: string;
  reportId: string;
  templateId: string;
  recipient: string;
  channel: "email" | "slack" | "webhook" | "download";
  deliveredAt: number;
  status: "delivered" | "failed";
  bytes: number;
  error?: string;
}

export class ReportDistributor {
  private readonly deliveries: DeliveryRecord[] = [];

  recordDelivery(params: {
    reportId: string;
    templateId: string;
    recipient: string;
    channel: DeliveryRecord["channel"];
    bytes: number;
    status: DeliveryRecord["status"];
    error?: string;
  }): DeliveryRecord {
    const record: DeliveryRecord = {
      id: `dlv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      deliveredAt: Date.now(),
      ...params,
    };
    this.deliveries.push(record);
    if (this.deliveries.length > 10_000) this.deliveries.shift();
    return record;
  }

  recent(limit = 100): DeliveryRecord[] {
    return this.deliveries.slice(-limit).reverse();
  }

  byReport(reportId: string): DeliveryRecord[] {
    return this.deliveries.filter((d) => d.reportId === reportId);
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const templateStore = new ReportTemplateStore();
export const reportRenderer = new ReportRenderer();
export const reportScheduleEngine = new ReportScheduleEngine();
export const reportDistributor = new ReportDistributor();

// Seed a couple of default templates
templateStore.upsert({
  name: "daily_pnl_brief",
  description: "Daily PnL summary",
  format: "markdown",
  template: "# Daily PnL — {{date}}\n\n**Realized:** ${{realized}}\n**Unrealized:** ${{unrealized}}\n\n## Top Trades\n\n{{#each trades}}\n- {{symbol}} {{side}} {{quantity}} @ {{price}} → ${{pnl}}\n{{/each}}",
});
templateStore.upsert({
  name: "incident_postmortem",
  description: "Incident postmortem template",
  format: "markdown",
  template: "# Postmortem — {{title}}\n\n**Severity:** {{severity}}\n**Detected:** {{detected}}\n**Resolved:** {{resolved}}\n\n## Root Cause\n\n{{rootCause}}\n\n## Action Items\n\n{{#each actionItems}}\n- [ ] {{title}} ({{owner}})\n{{/each}}",
});
logger.info({ templates: templateStore.list().length }, "[Reporting] Module initialized");
