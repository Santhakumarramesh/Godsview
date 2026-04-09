import express from "express";
import {
  chaosOrchestrator,
  resilienceScorer,
  rollbackEngine,
  dependencyFaultSimulator,
} from "../lib/chaos_engineering/index.js";

const router = express.Router();

// Chaos Experiments
router.post("/chaos/experiments", (req, res) => {
  try {
    const config = req.body;
    const result = chaosOrchestrator.createExperiment(config);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.post("/chaos/experiments/:id/run", (req, res) => {
  try {
    const experimentId = req.params.id;
    const result = chaosOrchestrator.runExperiment(experimentId);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.post("/chaos/experiments/:id/stop", (req, res) => {
  try {
    const experimentId = req.params.id;
    const result = chaosOrchestrator.stopExperiment(experimentId);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/experiments", (req, res) => {
  try {
    const filters = {
      type: req.query.type as string | undefined,
      status: req.query.status as string | undefined,
      since: req.query.since ? parseInt(req.query.since as string) : undefined,
    };
    const experiments = chaosOrchestrator.listExperiments(filters);
    res.status(200).json(experiments);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/experiments/:id", (req, res) => {
  try {
    const experimentId = req.params.id;
    const experiment = chaosOrchestrator.getExperiment(experimentId);
    res.status(200).json(experiment);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/experiments/:id/report", (req, res) => {
  try {
    const experimentId = req.params.id;
    const report = chaosOrchestrator.getExperimentReport(experimentId);
    res.status(200).json(report);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Resilience Assessment
router.post("/chaos/resilience/assess", (req, res) => {
  try {
    const result = resilienceScorer.runResilienceAssessment();
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/resilience/:id", (req, res) => {
  try {
    const assessmentId = req.params.id;
    const assessment = resilienceScorer.getAssessment(assessmentId);
    res.status(200).json(assessment);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/resilience", (req, res) => {
  try {
    const history = resilienceScorer.getAssessmentHistory();
    res.status(200).json(history);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.post("/chaos/resilience/compare", (req, res) => {
  try {
    const { id1, id2 } = req.body;
    const comparison = resilienceScorer.compareAssessments(id1, id2);
    res.status(200).json(comparison);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Rollback Plans
router.post("/chaos/rollback-plans", (req, res) => {
  try {
    const config = req.body;
    const result = rollbackEngine.createRollbackPlan(config);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/rollback-plans", (req, res) => {
  try {
    const plans = rollbackEngine.listRollbackPlans();
    res.status(200).json(plans);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/rollback-plans/:id", (req, res) => {
  try {
    const planId = req.params.id;
    const plan = rollbackEngine.getRollbackPlan(planId);
    res.status(200).json(plan);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.post("/chaos/rollback-plans/:id/execute", (req, res) => {
  try {
    const planId = req.params.id;
    const result = rollbackEngine.executeRollback(planId);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.post("/chaos/rollback-plans/:id/validate", (req, res) => {
  try {
    const planId = req.params.id;
    const validation = rollbackEngine.validateRollbackPlan(planId);
    res.status(200).json(validation);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/rollback-history", (req, res) => {
  try {
    const history = rollbackEngine.getRollbackHistory();
    res.status(200).json(history);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Dependencies
router.post("/chaos/dependencies", (req, res) => {
  try {
    const config = req.body;
    const result = dependencyFaultSimulator.registerDependency(config);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/dependencies", (req, res) => {
  try {
    const depMap = dependencyFaultSimulator.getDependencyMap();
    res.status(200).json(depMap);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.post("/chaos/dependencies/:depId/fault", (req, res) => {
  try {
    const depId = req.params.depId;
    const faultType = req.body.faultType;
    const result = dependencyFaultSimulator.simulateFault(depId, faultType);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/dependencies/:depId/impact", (req, res) => {
  try {
    const depId = req.params.depId;
    const analysis = dependencyFaultSimulator.getImpactAnalysis(depId);
    res.status(200).json(analysis);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get("/chaos/fault-history", (req, res) => {
  try {
    const history = dependencyFaultSimulator.getFaultHistory();
    res.status(200).json(history);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

export default router;
