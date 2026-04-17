import { Router, type IRouter } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";

const router: IRouter = Router();

function resolveOpenbbBaseDir(): string {
  const configured = String(process.env.GODSVIEW_OPENBB_DIR ?? "").trim();
  if (configured.length > 0) {
    return configured;
  }
  return path.resolve(process.cwd(), "godsview-openbb");
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

router.get("/research/openbb/latest", async (_req, res) => {
  const baseDir = resolveOpenbbBaseDir();
  const dataDir = path.join(baseDir, "data", "processed");

  const [latestSignal, latestDecision, backtestSummary] = await Promise.all([
    readJsonFile(path.join(dataDir, "latest_signal.json")),
    readJsonFile(path.join(dataDir, "latest_decision.json")),
    readJsonFile(path.join(dataDir, "backtest_summary.json")),
  ]);

  const hasAny = Boolean(latestSignal || latestDecision || backtestSummary);
  res.status(hasAny ? 200 : 404).json({
    status: hasAny ? "ok" : "not_found",
    base_dir: baseDir,
    latest_signal: latestSignal,
    latest_decision: latestDecision,
    backtest_summary: backtestSummary,
    message: hasAny
      ? "OpenBB research artifacts loaded."
      : "No research artifacts found. Run godsview-openbb pipeline first.",
  });
});

export default router;

