/**
 * routes/service_mesh.ts — Phase 76 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  serviceRegistry,
  healthAggregator,
  circuitBreakerMesh,
  retryBudgetTracker,
  type HealthSeverity,
} from "../lib/service_mesh";

const router = Router();

// ── Service Registry ──────────────────────────────────────────────────────

router.post("/api/mesh/services", (req: Request, res: Response) => {
  const { serviceName, host, port, version, tags } = req.body ?? {};
  if (!serviceName || !host || !port || !version) {
    return res.status(400).json({ error: "Missing serviceName, host, port, or version" });
  }
  return res.status(201).json(serviceRegistry.register({
    serviceName: String(serviceName),
    host: String(host),
    port: Number(port),
    version: String(version),
    tags,
  }));
});

router.post("/api/mesh/services/:id/heartbeat", (req: Request, res: Response) => {
  const i = serviceRegistry.heartbeat(String(req.params.id));
  if (!i) return res.status(404).json({ error: "Not found" });
  return res.json(i);
});

router.post("/api/mesh/services/:id/drain", (req: Request, res: Response) => {
  const i = serviceRegistry.drain(String(req.params.id));
  if (!i) return res.status(404).json({ error: "Not found" });
  return res.json(i);
});

router.delete("/api/mesh/services/:id", (req: Request, res: Response) => {
  const ok = serviceRegistry.deregister(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.get("/api/mesh/services/discover", (req: Request, res: Response) => {
  const serviceName = String(req.query.serviceName ?? "");
  if (!serviceName) return res.status(400).json({ error: "Missing serviceName" });
  return res.json({
    instances: serviceRegistry.discover(serviceName, {
      tag: req.query.tag ? String(req.query.tag) : undefined,
      healthyOnly: req.query.healthyOnly !== "false",
    }),
  });
});

router.get("/api/mesh/services", (_req: Request, res: Response) => {
  res.json({ instances: serviceRegistry.list() });
});

// ── Health ─────────────────────────────────────────────────────────────────

router.post("/api/mesh/health", (req: Request, res: Response) => {
  const { serviceName, instanceId, severity, message } = req.body ?? {};
  if (!serviceName || !instanceId || !severity) {
    return res.status(400).json({ error: "Missing serviceName, instanceId, or severity" });
  }
  return res.status(201).json(healthAggregator.record({
    serviceName: String(serviceName),
    instanceId: String(instanceId),
    severity: severity as HealthSeverity,
    message: String(message ?? ""),
  }));
});

router.get("/api/mesh/health/:serviceName", (req: Request, res: Response) => {
  res.json(healthAggregator.serviceHealth(String(req.params.serviceName)));
});

router.get("/api/mesh/health", (req: Request, res: Response) => {
  res.json({ checks: healthAggregator.recent(req.query.serviceName ? String(req.query.serviceName) : undefined) });
});

// ── Circuit Breaker ───────────────────────────────────────────────────────

router.post("/api/mesh/breaker/:serviceName/configure", (req: Request, res: Response) => {
  circuitBreakerMesh.configure(String(req.params.serviceName), req.body ?? {});
  res.json({ ok: true });
});

router.post("/api/mesh/breaker/:serviceName/success", (req: Request, res: Response) => {
  res.json(circuitBreakerMesh.recordSuccess(String(req.params.serviceName)));
});

router.post("/api/mesh/breaker/:serviceName/failure", (req: Request, res: Response) => {
  res.json(circuitBreakerMesh.recordFailure(String(req.params.serviceName)));
});

router.get("/api/mesh/breaker/:serviceName/allow", (req: Request, res: Response) => {
  res.json(circuitBreakerMesh.allow(String(req.params.serviceName)));
});

router.get("/api/mesh/breaker", (_req: Request, res: Response) => {
  res.json({ breakers: circuitBreakerMesh.list() });
});

// ── Retry Budget ──────────────────────────────────────────────────────────

router.post("/api/mesh/retry-budget/:serviceName/configure", (req: Request, res: Response) => {
  retryBudgetTracker.configure(String(req.params.serviceName), req.body ?? {});
  res.json({ ok: true });
});

router.post("/api/mesh/retry-budget/:serviceName/record", (req: Request, res: Response) => {
  const { isRetry } = req.body ?? {};
  res.json(retryBudgetTracker.recordRequest(String(req.params.serviceName), Boolean(isRetry)));
});

router.get("/api/mesh/retry-budget", (_req: Request, res: Response) => {
  res.json({ budgets: retryBudgetTracker.list() });
});

export default router;
