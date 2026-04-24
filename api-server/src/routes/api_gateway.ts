import { Router, Request, Response } from "express";
import {
  createApiKey,
  revokeApiKey,
  validateApiKey,
  listApiKeys,
  checkRateLimit,
  logRequest,
  getAuditLog,
  getGatewaySnapshot,
  resetGateway,
} from "../lib/api_gateway.js";

const router = Router();

router.get("/gateway/snapshot", (_req: Request, res: Response) => {
  res.json(getGatewaySnapshot());
});

router.get("/gateway/keys", (_req: Request, res: Response) => {
  res.json(listApiKeys());
});

router.post("/gateway/keys", (req: Request, res: Response) => {
  try {
    const key = createApiKey(req.body);
    res.json(key);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/gateway/keys/revoke", (req: Request, res: Response) => {
  const ok = revokeApiKey(req.body.key);
  res.json({ ok });
});

router.post("/gateway/validate", (req: Request, res: Response) => {
  const result = validateApiKey(req.body.key);
  res.json(result);
});

router.post("/gateway/rate-check", (req: Request, res: Response) => {
  const state = checkRateLimit(req.body.key);
  res.json(state);
});

router.post("/gateway/log", (req: Request, res: Response) => {
  try {
    const entry = logRequest(req.body);
    res.json(entry);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/gateway/audit", (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
  res.json(getAuditLog(limit));
});

router.post("/gateway/reset", (_req: Request, res: Response) => {
  resetGateway();
  res.json({ status: "gateway_reset" });
});

export default router;
