/**
 * routes/incident_management.ts — Phase 68 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  incidentEngine,
  incidentTimeline,
  postmortemBuilder,
  oncallDirectory,
  type IncidentSeverity,
  type IncidentStatus,
  type TimelineEventKind,
  type OncallShift,
} from "../lib/incident_management";

const router = Router();

// ── Incidents ──────────────────────────────────────────────────────────────

router.post("/api/incidents", (req: Request, res: Response) => {
  const { title, description, severity, services, customerImpact, commander } = req.body ?? {};
  if (!title || !severity) return res.status(400).json({ error: "Missing title or severity" });
  return res.status(201).json(incidentEngine.declare({
    title: String(title),
    description: String(description ?? ""),
    severity: severity as IncidentSeverity,
    services,
    customerImpact,
    commander,
  }));
});

router.get("/api/incidents", (req: Request, res: Response) => {
  res.json({
    incidents: incidentEngine.list({
      status: req.query.status ? (String(req.query.status) as IncidentStatus) : undefined,
      severity: req.query.severity ? (String(req.query.severity) as IncidentSeverity) : undefined,
    }),
    open: incidentEngine.open().length,
    mttr: incidentEngine.mttr(),
  });
});

router.get("/api/incidents/:id", (req: Request, res: Response) => {
  const inc = incidentEngine.get(String(req.params.id));
  if (!inc) return res.status(404).json({ error: "Not found" });
  return res.json({
    incident: inc,
    timeline: incidentTimeline.forIncident(inc.id),
    postmortem: postmortemBuilder.forIncident(inc.id),
  });
});

router.patch("/api/incidents/:id/status", (req: Request, res: Response) => {
  const { status, actor } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "Missing status" });
  const inc = incidentEngine.transition(String(req.params.id), status as IncidentStatus, actor);
  if (!inc) return res.status(404).json({ error: "Not found" });
  return res.json(inc);
});

router.patch("/api/incidents/:id/commander", (req: Request, res: Response) => {
  const { commander } = req.body ?? {};
  if (!commander) return res.status(400).json({ error: "Missing commander" });
  const inc = incidentEngine.assignCommander(String(req.params.id), String(commander));
  if (!inc) return res.status(404).json({ error: "Not found" });
  return res.json(inc);
});

// ── Timeline ───────────────────────────────────────────────────────────────

router.post("/api/incidents/:id/timeline", (req: Request, res: Response) => {
  const { kind, actor, message, data } = req.body ?? {};
  if (!kind || !actor || !message) return res.status(400).json({ error: "Missing kind, actor, or message" });
  return res.status(201).json(incidentTimeline.append({
    incidentId: String(req.params.id),
    kind: kind as TimelineEventKind,
    actor: String(actor),
    message: String(message),
    data,
  }));
});

// ── Postmortems ────────────────────────────────────────────────────────────

router.post("/api/incidents/:id/postmortem", (req: Request, res: Response) => {
  const { author } = req.body ?? {};
  if (!author) return res.status(400).json({ error: "Missing author" });
  return res.status(201).json(postmortemBuilder.draft({
    incidentId: String(req.params.id),
    author: String(author),
  }));
});

router.patch("/api/postmortems/:id", (req: Request, res: Response) => {
  const pm = postmortemBuilder.update(String(req.params.id), req.body ?? {});
  if (!pm) return res.status(404).json({ error: "Not found" });
  return res.json(pm);
});

router.post("/api/postmortems/:id/action-items", (req: Request, res: Response) => {
  const { title, owner, status, dueAt } = req.body ?? {};
  if (!title || !owner) return res.status(400).json({ error: "Missing title or owner" });
  const pm = postmortemBuilder.addActionItem(String(req.params.id), {
    title: String(title),
    owner: String(owner),
    status: (status as "open" | "in_progress" | "done") ?? "open",
    dueAt,
  });
  if (!pm) return res.status(404).json({ error: "Not found" });
  return res.status(201).json(pm);
});

router.post("/api/postmortems/:id/finalize", (req: Request, res: Response) => {
  const pm = postmortemBuilder.finalize(String(req.params.id));
  if (!pm) return res.status(404).json({ error: "Not found" });
  return res.json(pm);
});

router.get("/api/postmortems", (_req: Request, res: Response) => {
  res.json({ postmortems: postmortemBuilder.list() });
});

// ── Oncall ────────────────────────────────────────────────────────────────

router.post("/api/oncall/shifts", (req: Request, res: Response) => {
  const { userId, userName, role, service, startsAt, endsAt } = req.body ?? {};
  if (!userId || !userName || !role || !service || !startsAt || !endsAt) {
    return res.status(400).json({ error: "Missing shift fields" });
  }
  return res.status(201).json(oncallDirectory.schedule({
    userId: String(userId),
    userName: String(userName),
    role: role as OncallShift["role"],
    service: String(service),
    startsAt: Number(startsAt),
    endsAt: Number(endsAt),
  }));
});

router.get("/api/oncall", (req: Request, res: Response) => {
  const service = String(req.query.service ?? "");
  if (!service) return res.status(400).json({ error: "Missing service" });
  return res.json({
    current: oncallDirectory.currentOncall(service),
    upcoming: oncallDirectory.upcoming(service),
  });
});

router.get("/api/oncall/all", (_req: Request, res: Response) => {
  res.json({ shifts: oncallDirectory.list() });
});

export default router;
