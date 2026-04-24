/**
 * godsview_lab.ts — GodsView Lab API (Phase 51)
 */
import { Router, type Request, type Response } from "express";
import {
  parsePrompt, compileRules, labCreateStrategy,
  getLabSnapshot, resetLab,
} from "../lib/godsview_lab.js";

const router = Router();

router.get("/api/lab/snapshot", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, snapshot: getLabSnapshot() }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/lab/parse", async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    if (!prompt) { res.status(400).json({ ok: false, error: "prompt required" }); return; }
    const parsed = parsePrompt(prompt);
    res.json({ ok: true, parsed });
  } catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/lab/compile", async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    if (!prompt) { res.status(400).json({ ok: false, error: "prompt required" }); return; }
    const parsed = parsePrompt(prompt);
    const compiled = compileRules(parsed);
    res.json({ ok: true, parsed, compiled });
  } catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/lab/create", async (req: Request, res: Response) => {
  try {
    const { prompt, author } = req.body;
    if (!prompt) { res.status(400).json({ ok: false, error: "prompt required" }); return; }
    const result = labCreateStrategy(prompt, author);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/lab/reset", async (_req: Request, res: Response) => {
  try { resetLab(); res.json({ ok: true, message: "Lab reset" }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

export default router;
