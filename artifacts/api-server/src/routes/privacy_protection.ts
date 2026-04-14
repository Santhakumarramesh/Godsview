/**
 * routes/privacy_protection.ts — Phase 72 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  piiDetector,
  piiRedactor,
  dsrEngine,
  consentLedger,
  type DSRKind,
  type DSRStatus,
} from "../lib/privacy_protection";

const router = Router();

// ── PII Detection ──────────────────────────────────────────────────────────

router.post("/api/privacy/detect", (req: Request, res: Response) => {
  const { text, record } = req.body ?? {};
  if (text !== undefined) return res.json({ matches: piiDetector.detect(String(text)) });
  if (record && typeof record === "object") {
    return res.json({ byField: piiDetector.scanRecord(record) });
  }
  return res.status(400).json({ error: "Provide either text or record" });
});

router.post("/api/privacy/redact", (req: Request, res: Response) => {
  const { text, reversible } = req.body ?? {};
  if (text === undefined) return res.status(400).json({ error: "Missing text" });
  return res.json(piiRedactor.redact(String(text), Boolean(reversible)));
});

router.post("/api/privacy/unredact", (req: Request, res: Response) => {
  const { text } = req.body ?? {};
  if (text === undefined) return res.status(400).json({ error: "Missing text" });
  return res.json({ restored: piiRedactor.unredact(String(text)) });
});

router.get("/api/privacy/redaction-ledger", (_req: Request, res: Response) => {
  res.json({ entries: piiRedactor.ledgerEntries() });
});

// ── DSR ────────────────────────────────────────────────────────────────────

router.post("/api/privacy/dsr", (req: Request, res: Response) => {
  const { subjectId, kind, notes } = req.body ?? {};
  if (!subjectId || !kind) return res.status(400).json({ error: "Missing subjectId or kind" });
  return res.status(201).json(dsrEngine.file({
    subjectId: String(subjectId),
    kind: kind as DSRKind,
    notes,
  }));
});

router.post("/api/privacy/dsr/:id/verify", (req: Request, res: Response) => {
  const { method } = req.body ?? {};
  if (!method) return res.status(400).json({ error: "Missing method" });
  const r = dsrEngine.verify(String(req.params.id), String(method));
  if (!r) return res.status(404).json({ error: "Not found" });
  return res.json(r);
});

router.patch("/api/privacy/dsr/:id", (req: Request, res: Response) => {
  const { status, notes } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "Missing status" });
  const r = dsrEngine.advance(String(req.params.id), status as DSRStatus, notes);
  if (!r) return res.status(404).json({ error: "Not found" });
  return res.json(r);
});

router.post("/api/privacy/dsr/:id/artifact", (req: Request, res: Response) => {
  const { path } = req.body ?? {};
  if (!path) return res.status(400).json({ error: "Missing path" });
  const r = dsrEngine.attachArtifact(String(req.params.id), String(path));
  if (!r) return res.status(404).json({ error: "Not found" });
  return res.json(r);
});

router.get("/api/privacy/dsr", (req: Request, res: Response) => {
  res.json({
    requests: dsrEngine.list({
      status: req.query.status ? (String(req.query.status) as DSRStatus) : undefined,
      kind: req.query.kind ? (String(req.query.kind) as DSRKind) : undefined,
    }),
    overdue: dsrEngine.overdue().length,
  });
});

// ── Consent ────────────────────────────────────────────────────────────────

router.post("/api/privacy/consent/grant", (req: Request, res: Response) => {
  const { subjectId, purpose, version, source } = req.body ?? {};
  if (!subjectId || !purpose || !version || !source) {
    return res.status(400).json({ error: "Missing subjectId, purpose, version, or source" });
  }
  return res.status(201).json(consentLedger.grant({
    subjectId: String(subjectId),
    purpose: String(purpose),
    version: String(version),
    source: String(source),
  }));
});

router.post("/api/privacy/consent/revoke", (req: Request, res: Response) => {
  const { subjectId, purpose } = req.body ?? {};
  if (!subjectId || !purpose) return res.status(400).json({ error: "Missing subjectId or purpose" });
  const r = consentLedger.revoke({ subjectId: String(subjectId), purpose: String(purpose) });
  if (!r) return res.status(404).json({ error: "No active consent" });
  return res.json(r);
});

router.get("/api/privacy/consent/:subjectId", (req: Request, res: Response) => {
  res.json({ history: consentLedger.history(String(req.params.subjectId)) });
});

router.get("/api/privacy/consent/:subjectId/check", (req: Request, res: Response) => {
  const purpose = String(req.query.purpose ?? "");
  if (!purpose) return res.status(400).json({ error: "Missing purpose" });
  return res.json({
    granted: consentLedger.isCurrentlyGranted(String(req.params.subjectId), purpose),
    current: consentLedger.current(String(req.params.subjectId), purpose),
  });
});

export default router;
