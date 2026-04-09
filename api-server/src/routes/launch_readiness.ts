import express, { Router, Request, Response } from "express";
import {
  stagingEnvironmentManager,
  launchChecklistEngine,
  goNoGoEngine,
  launchRehearsalEngine,
} from "../lib/launch_readiness/index.js";

const router = Router();

// Staging Environment Routes

router.post("/api/launch/staging", (req: Request, res: Response) => {
  try {
    const { name, sourceEnv, dataSnapshot, mockBroker, isolatedNetwork } = req.body;
    const envId = stagingEnvironmentManager.createStagingEnv({
      name,
      sourceEnv,
      dataSnapshot,
      mockBroker,
      isolatedNetwork,
    });
    res.status(201).json({ envId, status: "provisioning" });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/staging", (req: Request, res: Response) => {
  try {
    const envs = stagingEnvironmentManager.listStagingEnvs();
    res.json(envs);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/staging/:envId", (req: Request, res: Response) => {
  try {
    const { envId } = req.params;
    const env = stagingEnvironmentManager.getStagingEnv(envId);
    if (!env) {
      return res.status(404).json({ error: "Environment not found" });
    }
    res.json(env);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/staging/:envId/health", (req: Request, res: Response) => {
  try {
    const { envId } = req.params;
    const health = stagingEnvironmentManager.getStagingHealth(envId);
    if (!health) {
      return res.status(404).json({ error: "Environment not found" });
    }
    res.json(health);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/api/launch/staging/:envId/promote", (req: Request, res: Response) => {
  try {
    const { envId } = req.params;
    const env = stagingEnvironmentManager.promoteToProd(envId);
    if (!env) {
      return res.status(404).json({ error: "Environment not found" });
    }
    res.json(env);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.delete("/api/launch/staging/:envId", (req: Request, res: Response) => {
  try {
    const { envId } = req.params;
    const env = stagingEnvironmentManager.teardownEnv(envId);
    if (!env) {
      return res.status(404).json({ error: "Environment not found" });
    }
    res.json({ message: "Environment terminated", envId });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Checklist Routes

router.post("/api/launch/checklists", (req: Request, res: Response) => {
  try {
    const { name, launchType, requiredGates } = req.body;
    const checklistId = launchChecklistEngine.createChecklist({
      name,
      launchType,
      requiredGates,
    });
    res.status(201).json({ checklistId });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/checklists", (req: Request, res: Response) => {
  try {
    const checklists = launchChecklistEngine.listChecklists();
    res.json(checklists);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/checklists/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const checklist = launchChecklistEngine.getChecklist(id);
    if (!checklist) {
      return res.status(404).json({ error: "Checklist not found" });
    }
    res.json(checklist);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/checklists/:id/progress", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const progress = launchChecklistEngine.getChecklistProgress(id);
    if (!progress) {
      return res.status(404).json({ error: "Checklist not found" });
    }
    res.json(progress);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/api/launch/checklists/:id/gates", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, category, verifier, criticalPath } = req.body;
    const gateId = launchChecklistEngine.addGate(id, {
      name,
      category,
      verifier,
      criticalPath,
    });
    if (!gateId) {
      return res.status(404).json({ error: "Checklist not found" });
    }
    res.status(201).json({ gateId });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.patch("/api/launch/checklists/:checklistId/gates/:gateId/pass", (req: Request, res: Response) => {
  try {
    const { checklistId, gateId } = req.params;
    const { verifiedBy, notes, artifacts } = req.body;
    const gate = launchChecklistEngine.passGate(checklistId, gateId, {
      verifiedBy,
      notes,
      artifacts,
    });
    if (!gate) {
      return res.status(404).json({ error: "Gate or checklist not found" });
    }
    res.json(gate);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.patch("/api/launch/checklists/:checklistId/gates/:gateId/fail", (req: Request, res: Response) => {
  try {
    const { checklistId, gateId } = req.params;
    const { reason } = req.body;
    const gate = launchChecklistEngine.failGate(checklistId, gateId, reason);
    if (!gate) {
      return res.status(404).json({ error: "Gate or checklist not found" });
    }
    res.json(gate);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Go/No-Go Routes

router.post("/api/launch/go-no-go", (req: Request, res: Response) => {
  try {
    const { checklistId, scheduledLaunchTime, decisionMakers, requiredApprovals } = req.body;
    const decisionId = goNoGoEngine.createDecision({
      checklistId,
      scheduledLaunchTime,
      decisionMakers,
      requiredApprovals,
    });
    res.status(201).json({ decisionId });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/go-no-go", (req: Request, res: Response) => {
  try {
    const decisions = goNoGoEngine.listDecisions();
    res.json(decisions);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/go-no-go/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const decision = goNoGoEngine.getDecision(id);
    if (!decision) {
      return res.status(404).json({ error: "Decision not found" });
    }
    res.json(decision);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/api/launch/go-no-go/:id/vote", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { voter, vote, conditions } = req.body;
    const voteId = goNoGoEngine.castVote(id, voter, vote, conditions);
    if (!voteId) {
      return res.status(404).json({ error: "Decision not found" });
    }
    res.status(201).json({ voteId });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/api/launch/go-no-go/:id/finalize", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const decision = goNoGoEngine.finalizeDecision(id);
    if (!decision) {
      return res.status(404).json({ error: "Decision not found" });
    }
    res.json(decision);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/go-no-go/:id/report", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const report = goNoGoEngine.getDecisionReport(id);
    if (!report) {
      return res.status(404).json({ error: "Decision not found" });
    }
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Rehearsal Routes

router.post("/api/launch/rehearsals", (req: Request, res: Response) => {
  try {
    const { name, scenario, checklistId } = req.body;
    const rehearsalId = launchRehearsalEngine.createRehearsal({
      name,
      scenario,
      checklistId,
    });
    res.status(201).json({ rehearsalId });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/rehearsals", (req: Request, res: Response) => {
  try {
    const rehearsals = launchRehearsalEngine.listRehearsals();
    res.json(rehearsals);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/rehearsals/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rehearsal = launchRehearsalEngine.getRehearsal(id);
    if (!rehearsal) {
      return res.status(404).json({ error: "Rehearsal not found" });
    }
    res.json(rehearsal);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/api/launch/rehearsals/:id/execute", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rehearsal = launchRehearsalEngine.executeRehearsal(id);
    if (!rehearsal) {
      return res.status(404).json({ error: "Rehearsal not found" });
    }
    res.json(rehearsal);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/api/launch/rehearsals/:id/complete", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { overallResult, lessons } = req.body;
    const rehearsal = launchRehearsalEngine.completeRehearsal(id, overallResult, lessons);
    if (!rehearsal) {
      return res.status(404).json({ error: "Rehearsal not found" });
    }
    res.json(rehearsal);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/launch/rehearsals/:id/report", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const report = launchRehearsalEngine.getRehearsalReport(id);
    if (!report) {
      return res.status(404).json({ error: "Rehearsal not found" });
    }
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
