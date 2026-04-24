import { Router, type IRouter } from "express";
import {
  computePortfolioAllocatorSnapshot,
  getPortfolioAllocatorSnapshot,
} from "../lib/portfolio_allocator";

const router: IRouter = Router();

router.get("/portfolio/allocator/status", async (_req, res) => {
  try {
    const snapshot = await getPortfolioAllocatorSnapshot();
    res.json(snapshot);
  } catch (err) {
    _req.log.error({ err }, "Failed to load portfolio allocator status");
    res.status(503).json({ error: "portfolio_allocator_status_failed", message: "Failed to load allocator status" });
  }
});

router.get("/portfolio/opportunities", async (_req, res) => {
  try {
    const snapshot = await getPortfolioAllocatorSnapshot();
    res.json({
      count: snapshot.opportunities.length,
      opportunities: snapshot.opportunities,
      generated_at: snapshot.generated_at,
    });
  } catch (err) {
    _req.log.error({ err }, "Failed to load portfolio opportunities");
    res.status(503).json({ error: "portfolio_opportunities_failed", message: "Failed to load opportunities" });
  }
});

router.get("/portfolio/exposures", async (_req, res) => {
  try {
    const snapshot = await getPortfolioAllocatorSnapshot();
    res.json({
      exposure: snapshot.exposure,
      available_risk_pct: snapshot.available_risk_pct,
      available_risk_usd: snapshot.available_risk_usd,
      generated_at: snapshot.generated_at,
    });
  } catch (err) {
    _req.log.error({ err }, "Failed to load portfolio exposures");
    res.status(503).json({ error: "portfolio_exposures_failed", message: "Failed to load exposures" });
  }
});

router.get("/portfolio/allocations", async (_req, res) => {
  try {
    const snapshot = await getPortfolioAllocatorSnapshot();
    res.json({
      count: snapshot.allocations.length,
      allocations: snapshot.allocations,
      blocked: snapshot.blocked,
      generated_at: snapshot.generated_at,
    });
  } catch (err) {
    _req.log.error({ err }, "Failed to load portfolio allocations");
    res.status(503).json({ error: "portfolio_allocations_failed", message: "Failed to load allocations" });
  }
});

router.post("/portfolio/allocate", async (_req, res) => {
  try {
    const reason = typeof _req.body?.reason === "string" && _req.body.reason.trim()
      ? `manual:${_req.body.reason.trim()}`
      : "manual";
    const snapshot = await computePortfolioAllocatorSnapshot(reason);
    res.json({
      ok: true,
      snapshot,
    });
  } catch (err) {
    _req.log.error({ err }, "Portfolio allocate run failed");
    res.status(503).json({ error: "portfolio_allocate_failed", message: "Failed to compute allocations" });
  }
});

router.post("/portfolio/rebalance", async (_req, res) => {
  try {
    const reason = typeof _req.body?.reason === "string" && _req.body.reason.trim()
      ? `rebalance:${_req.body.reason.trim()}`
      : "rebalance";
    const snapshot = await computePortfolioAllocatorSnapshot(reason);
    res.json({
      ok: true,
      snapshot,
    });
  } catch (err) {
    _req.log.error({ err }, "Portfolio rebalance run failed");
    res.status(503).json({ error: "portfolio_rebalance_failed", message: "Failed to run rebalance" });
  }
});

export default router;
