/**
 * privacy_protection/index.ts — Phase 72: Privacy & PII Protection
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. PIIDetector            — regex-based PII classifiers.
 *   2. PIIRedactor            — reversible/irreversible redaction.
 *   3. DataSubjectRequestEng  — GDPR/CCPA right-to-access/erasure.
 *   4. ConsentLedger          — consent grants with audit trail.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash, randomBytes } from "crypto";
import { logger } from "../logger.js";

// ── PII Detection ──────────────────────────────────────────────────────────

export type PIIKind = "email" | "phone_us" | "phone_intl" | "ssn" | "credit_card" | "ip_address" | "aws_key" | "jwt" | "us_zip" | "name_like";

export interface PIIMatch {
  kind: PIIKind;
  value: string;
  start: number;
  end: number;
  confidence: number; // 0-1
}

const PATTERNS: Array<{ kind: PIIKind; regex: RegExp; confidence: number }> = [
  { kind: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, confidence: 0.95 },
  { kind: "phone_us", regex: /(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g, confidence: 0.8 },
  { kind: "phone_intl", regex: /\+\d{1,3}[-.\s]?\d{4,}/g, confidence: 0.7 },
  { kind: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.9 },
  { kind: "credit_card", regex: /\b(?:\d[ -]*?){13,19}\b/g, confidence: 0.7 },
  { kind: "ip_address", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, confidence: 0.85 },
  { kind: "aws_key", regex: /AKIA[0-9A-Z]{16}/g, confidence: 0.99 },
  { kind: "jwt", regex: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, confidence: 0.95 },
  { kind: "us_zip", regex: /\b\d{5}(?:-\d{4})?\b/g, confidence: 0.5 },
];

export class PIIDetector {
  detect(text: string): PIIMatch[] {
    const out: PIIMatch[] = [];
    for (const { kind, regex, confidence } of PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        out.push({ kind, value: m[0], start: m.index, end: m.index + m[0].length, confidence });
      }
    }
    // Sort by start, dedupe overlapping
    out.sort((a, b) => a.start - b.start);
    const deduped: PIIMatch[] = [];
    for (const m of out) {
      const last = deduped[deduped.length - 1];
      if (last && m.start < last.end) {
        if (m.confidence > last.confidence) deduped[deduped.length - 1] = m;
      } else {
        deduped.push(m);
      }
    }
    return deduped;
  }

  scanRecord(rec: Record<string, unknown>): Record<string, PIIMatch[]> {
    const out: Record<string, PIIMatch[]> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === "string") {
        const matches = this.detect(v);
        if (matches.length > 0) out[k] = matches;
      }
    }
    return out;
  }
}

// ── Redaction ──────────────────────────────────────────────────────────────

export interface RedactionToken {
  token: string;
  kind: PIIKind;
  originalHash: string;
  createdAt: number;
}

export class PIIRedactor {
  private readonly tokens = new Map<string, string>(); // token → original
  private readonly ledger: RedactionToken[] = [];
  private readonly pepper = randomBytes(16).toString("hex");

  constructor(private readonly detector: PIIDetector) {}

  redact(text: string, reversible = false): { redacted: string; matches: PIIMatch[]; tokens: string[] } {
    const matches = this.detector.detect(text);
    if (matches.length === 0) return { redacted: text, matches: [], tokens: [] };
    let out = "";
    let cursor = 0;
    const tokens: string[] = [];
    for (const m of matches) {
      out += text.slice(cursor, m.start);
      if (reversible) {
        const token = `[REDACTED:${m.kind}:${randomBytes(4).toString("hex")}]`;
        this.tokens.set(token, m.value);
        this.ledger.push({
          token, kind: m.kind,
          originalHash: this._hash(m.value),
          createdAt: Date.now(),
        });
        tokens.push(token);
        out += token;
      } else {
        out += `[REDACTED:${m.kind}]`;
      }
      cursor = m.end;
    }
    out += text.slice(cursor);
    return { redacted: out, matches, tokens };
  }

  unredact(text: string): string {
    let out = text;
    for (const [token, original] of this.tokens) {
      out = out.split(token).join(original);
    }
    return out;
  }

  ledgerEntries(): RedactionToken[] {
    return [...this.ledger];
  }

  private _hash(v: string): string {
    return createHash("sha256").update(this.pepper + v).digest("hex");
  }
}

// ── Data Subject Requests (GDPR / CCPA) ───────────────────────────────────

export type DSRKind = "access" | "erasure" | "rectification" | "portability" | "objection";
export type DSRStatus = "received" | "verifying" | "processing" | "completed" | "rejected";

export interface DataSubjectRequest {
  id: string;
  subjectId: string;
  kind: DSRKind;
  receivedAt: number;
  dueBy: number; // GDPR is 30 days
  status: DSRStatus;
  verificationMethod?: string;
  processedAt?: number;
  fulfilledAt?: number;
  notes: string;
  artifactPath?: string;
}

export class DataSubjectRequestEngine {
  private readonly requests = new Map<string, DataSubjectRequest>();

  file(params: { subjectId: string; kind: DSRKind; notes?: string }): DataSubjectRequest {
    const id = `dsr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const req: DataSubjectRequest = {
      id,
      subjectId: params.subjectId,
      kind: params.kind,
      receivedAt: now,
      dueBy: now + 30 * 24 * 60 * 60 * 1000,
      status: "received",
      notes: params.notes ?? "",
    };
    this.requests.set(id, req);
    logger.info({ requestId: id, kind: params.kind }, "[DSR] Request filed");
    return req;
  }

  verify(id: string, method: string): DataSubjectRequest | null {
    const r = this.requests.get(id);
    if (!r) return null;
    r.status = "verifying";
    r.verificationMethod = method;
    return r;
  }

  advance(id: string, status: DSRStatus, notes?: string): DataSubjectRequest | null {
    const r = this.requests.get(id);
    if (!r) return null;
    r.status = status;
    if (notes) r.notes += "\n" + notes;
    if (status === "processing") r.processedAt = Date.now();
    if (status === "completed") r.fulfilledAt = Date.now();
    return r;
  }

  attachArtifact(id: string, path: string): DataSubjectRequest | null {
    const r = this.requests.get(id);
    if (!r) return null;
    r.artifactPath = path;
    return r;
  }

  list(filter?: { status?: DSRStatus; kind?: DSRKind }): DataSubjectRequest[] {
    let out = Array.from(this.requests.values());
    if (filter?.status) out = out.filter((r) => r.status === filter.status);
    if (filter?.kind) out = out.filter((r) => r.kind === filter.kind);
    return out.sort((a, b) => b.receivedAt - a.receivedAt);
  }

  overdue(): DataSubjectRequest[] {
    const now = Date.now();
    return this.list().filter((r) => r.status !== "completed" && r.status !== "rejected" && r.dueBy < now);
  }

  get(id: string): DataSubjectRequest | null {
    return this.requests.get(id) ?? null;
  }
}

// ── Consent Ledger ─────────────────────────────────────────────────────────

export interface ConsentRecord {
  id: string;
  subjectId: string;
  purpose: string;
  version: string;
  granted: boolean;
  at: number;
  revokedAt?: number;
  source: string; // e.g. "web_form_v3"
}

export class ConsentLedger {
  private readonly records: ConsentRecord[] = [];

  grant(params: { subjectId: string; purpose: string; version: string; source: string }): ConsentRecord {
    const record: ConsentRecord = {
      id: `con_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      granted: true,
      at: Date.now(),
      ...params,
    };
    this.records.push(record);
    return record;
  }

  revoke(params: { subjectId: string; purpose: string }): ConsentRecord | null {
    const current = this.current(params.subjectId, params.purpose);
    if (!current || !current.granted) return null;
    current.revokedAt = Date.now();
    return current;
  }

  current(subjectId: string, purpose: string): ConsentRecord | null {
    const matching = this.records.filter((r) => r.subjectId === subjectId && r.purpose === purpose);
    if (matching.length === 0) return null;
    return matching.sort((a, b) => b.at - a.at)[0] ?? null;
  }

  history(subjectId: string): ConsentRecord[] {
    return this.records.filter((r) => r.subjectId === subjectId).sort((a, b) => b.at - a.at);
  }

  isCurrentlyGranted(subjectId: string, purpose: string): boolean {
    const c = this.current(subjectId, purpose);
    return Boolean(c && c.granted && !c.revokedAt);
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const piiDetector = new PIIDetector();
export const piiRedactor = new PIIRedactor(piiDetector);
export const dsrEngine = new DataSubjectRequestEngine();
export const consentLedger = new ConsentLedger();
