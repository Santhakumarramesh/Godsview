/**
 * data_lineage/index.ts — Phase 64: Data Lineage + Quality Metrics
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. LineageGraph         — nodes (datasets) + edges (transformations).
 *   2. DataQualityEngine    — null/dup/freshness/schema checks.
 *   3. ImpactAnalysisEngine — downstream + upstream traversal.
 *   4. SchemaRegistry       — versioned dataset schemas with drift detection.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Lineage Graph ──────────────────────────────────────────────────────────

export interface DatasetNode {
  id: string;
  name: string;
  source: "alpaca" | "tradingview" | "computed" | "internal" | "external_feed";
  layer: "raw" | "bronze" | "silver" | "gold";
  owner: string;
  createdAt: number;
}

export interface LineageEdge {
  id: string;
  from: string;
  to: string;
  transformation: string;
  createdAt: number;
}

export class LineageGraph {
  private readonly nodes = new Map<string, DatasetNode>();
  private readonly edges = new Map<string, LineageEdge>();

  addNode(params: Omit<DatasetNode, "id" | "createdAt">): DatasetNode {
    const id = `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const node: DatasetNode = { id, createdAt: Date.now(), ...params };
    this.nodes.set(id, node);
    return node;
  }

  addEdge(from: string, to: string, transformation: string): LineageEdge | null {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    const id = `edg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const edge: LineageEdge = { id, from, to, transformation, createdAt: Date.now() };
    this.edges.set(id, edge);
    return edge;
  }

  getNode(id: string): DatasetNode | null {
    return this.nodes.get(id) ?? null;
  }

  listNodes(): DatasetNode[] {
    return Array.from(this.nodes.values());
  }

  listEdges(): LineageEdge[] {
    return Array.from(this.edges.values());
  }

  downstream(startId: string): DatasetNode[] {
    const visited = new Set<string>();
    const stack = [startId];
    const out: DatasetNode[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const e of this.edges.values()) {
        if (e.from === cur && !visited.has(e.to)) {
          visited.add(e.to);
          const n = this.nodes.get(e.to);
          if (n) out.push(n);
          stack.push(e.to);
        }
      }
    }
    return out;
  }

  upstream(startId: string): DatasetNode[] {
    const visited = new Set<string>();
    const stack = [startId];
    const out: DatasetNode[] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const e of this.edges.values()) {
        if (e.to === cur && !visited.has(e.from)) {
          visited.add(e.from);
          const n = this.nodes.get(e.from);
          if (n) out.push(n);
          stack.push(e.from);
        }
      }
    }
    return out;
  }
}

// ── Data Quality ──────────────────────────────────────────────────────────

export type QualityCheckKind = "null_rate" | "duplicate_rate" | "freshness" | "row_count" | "schema_drift";
export type Severity = "info" | "warning" | "critical";

export interface QualityCheck {
  id: string;
  datasetId: string;
  kind: QualityCheckKind;
  threshold: number;
  severity: Severity;
  description: string;
}

export interface QualityResult {
  id: string;
  checkId: string;
  datasetId: string;
  at: number;
  observed: number;
  passed: boolean;
  severity: Severity;
  message: string;
}

export class DataQualityEngine {
  private readonly checks = new Map<string, QualityCheck>();
  private readonly results: QualityResult[] = [];
  private readonly maxResults = 10_000;

  addCheck(params: Omit<QualityCheck, "id">): QualityCheck {
    const id = `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const check: QualityCheck = { id, ...params };
    this.checks.set(id, check);
    return check;
  }

  listChecks(datasetId?: string): QualityCheck[] {
    const all = Array.from(this.checks.values());
    return datasetId ? all.filter((c) => c.datasetId === datasetId) : all;
  }

  runCheck(checkId: string, observed: number): QualityResult | null {
    const check = this.checks.get(checkId);
    if (!check) return null;
    let passed = true;
    let message = "ok";
    switch (check.kind) {
      case "null_rate":
      case "duplicate_rate":
      case "schema_drift":
        passed = observed <= check.threshold;
        break;
      case "freshness":
        passed = observed <= check.threshold; // ms since last update
        break;
      case "row_count":
        passed = observed >= check.threshold;
        break;
    }
    if (!passed) message = `${check.kind} violation: observed ${observed} vs threshold ${check.threshold}`;
    const result: QualityResult = {
      id: `qr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      checkId,
      datasetId: check.datasetId,
      at: Date.now(),
      observed,
      passed,
      severity: check.severity,
      message,
    };
    this.results.push(result);
    if (this.results.length > this.maxResults) this.results.shift();
    if (!passed) logger.warn({ check: check.id, observed }, "[DataQuality] Check failed");
    return result;
  }

  recentResults(datasetId?: string, limit = 100): QualityResult[] {
    let out = this.results;
    if (datasetId) out = out.filter((r) => r.datasetId === datasetId);
    return out.slice(-limit).reverse();
  }

  summary(datasetId: string): {
    checks: number; passed: number; failed: number; critical: number;
    healthScore: number; // 0-100
  } {
    const checks = this.listChecks(datasetId);
    const latest = new Map<string, QualityResult>();
    for (const r of this.results) {
      if (r.datasetId !== datasetId) continue;
      const existing = latest.get(r.checkId);
      if (!existing || r.at > existing.at) latest.set(r.checkId, r);
    }
    const arr = Array.from(latest.values());
    const passed = arr.filter((r) => r.passed).length;
    const failed = arr.filter((r) => !r.passed).length;
    const critical = arr.filter((r) => !r.passed && r.severity === "critical").length;
    const healthScore = checks.length > 0 ? Math.max(0, 100 - failed * 10 - critical * 20) : 0;
    return { checks: checks.length, passed, failed, critical, healthScore: Math.min(100, healthScore) };
  }
}

// ── Schema Registry ────────────────────────────────────────────────────────

export interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "timestamp" | "array" | "object";
  nullable: boolean;
}

export interface DatasetSchema {
  id: string;
  datasetId: string;
  version: number;
  fields: SchemaField[];
  createdAt: number;
  active: boolean;
}

export class SchemaRegistry {
  private readonly schemas = new Map<string, DatasetSchema>();

  register(datasetId: string, fields: SchemaField[]): DatasetSchema {
    const existing = Array.from(this.schemas.values())
      .filter((s) => s.datasetId === datasetId)
      .sort((a, b) => b.version - a.version);
    const version = existing.length > 0 ? existing[0]!.version + 1 : 1;
    // Deactivate old versions
    existing.forEach((s) => { s.active = false; });
    const id = `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const schema: DatasetSchema = {
      id,
      datasetId,
      version,
      fields: [...fields],
      createdAt: Date.now(),
      active: true,
    };
    this.schemas.set(id, schema);
    return schema;
  }

  current(datasetId: string): DatasetSchema | null {
    return Array.from(this.schemas.values()).find((s) => s.datasetId === datasetId && s.active) ?? null;
  }

  history(datasetId: string): DatasetSchema[] {
    return Array.from(this.schemas.values())
      .filter((s) => s.datasetId === datasetId)
      .sort((a, b) => b.version - a.version);
  }

  drift(datasetId: string, observedFields: SchemaField[]): {
    added: string[];
    removed: string[];
    typeChanged: Array<{ name: string; from: string; to: string }>;
    driftScore: number;
  } {
    const current = this.current(datasetId);
    if (!current) return { added: [], removed: [], typeChanged: [], driftScore: 0 };
    const existingMap = new Map(current.fields.map((f) => [f.name, f]));
    const observedMap = new Map(observedFields.map((f) => [f.name, f]));
    const added: string[] = [];
    const removed: string[] = [];
    const typeChanged: Array<{ name: string; from: string; to: string }> = [];
    for (const o of observedFields) if (!existingMap.has(o.name)) added.push(o.name);
    for (const e of current.fields) {
      if (!observedMap.has(e.name)) removed.push(e.name);
      else {
        const o = observedMap.get(e.name)!;
        if (o.type !== e.type) typeChanged.push({ name: e.name, from: e.type, to: o.type });
      }
    }
    const driftScore = added.length + removed.length * 2 + typeChanged.length * 3;
    return { added, removed, typeChanged, driftScore };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const lineageGraph = new LineageGraph();
export const dataQualityEngine = new DataQualityEngine();
export const schemaRegistry = new SchemaRegistry();
