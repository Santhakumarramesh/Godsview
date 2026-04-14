/**
 * routes/risk_analytics.ts — Phase 73 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  varEngine,
  cvarEngine,
  stressTestEngine,
  correlationMatrix,
  riskLimitRegistry,
  type VaRMethod,
  type RiskLimitKind,
} from "../lib/risk_analytics";

const router = Router();

// ── VaR / CVaR ─────────────────────────────────────────────────────────────

router.post("/api/risk/var", (req: Request, res: Response) => {
  const { returns, confidence, horizonDays, method } = req.body ?? {};
  if (!Array.isArray(returns)) return res.status(400).json({ error: "Missing returns[]" });
  return res.json(varEngine.compute(
    returns.map(Number),
    confidence ?? 0.95,
    horizonDays ?? 1,
    (method as VaRMethod) ?? "historical",
  ));
});

router.post("/api/risk/cvar", (req: Request, res: Response) => {
  const { returns, confidence, horizonDays } = req.body ?? {};
  if (!Array.isArray(returns)) return res.status(400).json({ error: "Missing returns[]" });
  return res.json(cvarEngine.compute(returns.map(Number), confidence ?? 0.95, horizonDays ?? 1));
});

// ── Stress Tests ───────────────────────────────────────────────────────────

router.post("/api/risk/scenarios", (req: Request, res: Response) => {
  const { name, description, shocks } = req.body ?? {};
  if (!name || !shocks) return res.status(400).json({ error: "Missing name or shocks" });
  return res.status(201).json(stressTestEngine.register({
    name: String(name),
    description: String(description ?? ""),
    shocks,
  }));
});

router.get("/api/risk/scenarios", (_req: Request, res: Response) => {
  res.json({ scenarios: stressTestEngine.list() });
});

router.post("/api/risk/stress-test", (req: Request, res: Response) => {
  const { scenarioId, portfolio } = req.body ?? {};
  if (!scenarioId || !portfolio) return res.status(400).json({ error: "Missing scenarioId or portfolio" });
  const result = stressTestEngine.run({ scenarioId: String(scenarioId), portfolio });
  if (!result) return res.status(404).json({ error: "Scenario not found" });
  return res.json(result);
});

// ── Correlation + Concentration ───────────────────────────────────────────

router.post("/api/risk/correlation", (req: Request, res: Response) => {
  const { returnSeries } = req.body ?? {};
  if (!returnSeries || typeof returnSeries !== "object") {
    return res.status(400).json({ error: "Missing returnSeries" });
  }
  return res.json({ pairs: correlationMatrix.compute(returnSeries) });
});

router.post("/api/risk/concentration", (req: Request, res: Response) => {
  const { exposures } = req.body ?? {};
  if (!exposures || typeof exposures !== "object") {
    return res.status(400).json({ error: "Missing exposures" });
  }
  return res.json(correlationMatrix.concentration(exposures));
});

// ── Limits ─────────────────────────────────────────────────────────────────

router.post("/api/risk/limits", (req: Request, res: Response) => {
  const { name, kind, threshold, severity } = req.body ?? {};
  if (!name || !kind || threshold === undefined || !severity) {
    return res.status(400).json({ error: "Missing name, kind, threshold, or severity" });
  }
  return res.status(201).json(riskLimitRegistry.register({
    name: String(name),
    kind: kind as RiskLimitKind,
    threshold: Number(threshold),
    severity: severity as "warn" | "halt",
  }));
});

router.get("/api/risk/limits", (_req: Request, res: Response) => {
  res.json({
    limits: riskLimitRegistry.listLimits(),
    openBreaches: riskLimitRegistry.openBreaches(),
  });
});

router.post("/api/risk/limits/check", (req: Request, res: Response) => {
  const { kind, observed } = req.body ?? {};
  if (!kind || observed === undefined) return res.status(400).json({ error: "Missing kind or observed" });
  return res.json({ fired: riskLimitRegistry.check(kind as RiskLimitKind, Number(observed)) });
});

router.post("/api/risk/limits/breach/:id/resolve", (req: Request, res: Response) => {
  const b = riskLimitRegistry.resolve(String(req.params.id));
  if (!b) return res.status(404).json({ error: "Not found" });
  return res.json(b);
});

router.get("/api/risk/limits/breaches", (_req: Request, res: Response) => {
  res.json({ breaches: riskLimitRegistry.recentBreaches() });
});

export default router;
