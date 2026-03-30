import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

type JsonRecord = Record<string, unknown>;

const CACHE_TTL_MS = 10_000;
const PROCESSED_DIR = path.resolve(process.cwd(), "godsview-openbb", "data", "processed");
const ORCHESTRATOR_ARTIFACT = path.join(PROCESSED_DIR, "latest_orchestrator_run.json");
const BOARD_ARTIFACT = path.join(PROCESSED_DIR, "latest_consciousness_board.json");

let snapshotCache: { ts: number; data: JsonRecord | null } = { ts: 0, data: null };
let consciousnessCache: { ts: number; data: JsonRecord | null } = { ts: 0, data: null };

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value === "object" && value !== null) return value as JsonRecord;
  return null;
}

function parseNum(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

async function readJsonArtifact(filePath: string): Promise<JsonRecord | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return null;
  }
}

export async function getLatestBrainSnapshot(force = false): Promise<JsonRecord | null> {
  const now = Date.now();
  if (!force && snapshotCache.data && now - snapshotCache.ts <= CACHE_TTL_MS) {
    return snapshotCache.data;
  }
  const data = await readJsonArtifact(ORCHESTRATOR_ARTIFACT);
  snapshotCache = { ts: now, data };
  return data;
}

export async function getConsciousnessSnapshot(force = false): Promise<JsonRecord | null> {
  const now = Date.now();
  if (!force && consciousnessCache.data && now - consciousnessCache.ts <= CACHE_TTL_MS) {
    return consciousnessCache.data;
  }
  const boardArtifact = await readJsonArtifact(BOARD_ARTIFACT);
  if (boardArtifact && Array.isArray(boardArtifact.cards)) {
    const rows = (boardArtifact.cards as JsonRecord[]).map((card) => ({
      symbol: String(card.symbol ?? "UNKNOWN"),
      setup: String(card.setup ?? "none"),
      action: String(card.bias ?? "neutral"),
      readiness: String(card.risk_state ?? "Blocked").toLowerCase().includes("allow") ? "allow" : "watch",
      attention_score: clamp01(parseNum(card.c4_score, 0) / 100),
      structure_score: clamp01(parseNum(card.readiness_pct, 0) / 100),
      orderflow_score: clamp01(parseNum(card.memory_match_pct, 0) / 100),
      context_score: 0.5,
      memory_score: clamp01(parseNum(card.memory_match_pct, 0) / 100),
      reasoning_score: clamp01(parseNum(card.c4_score, 0) / 100),
      risk_score: String(card.risk_state ?? "").toLowerCase().includes("allow") ? 0.8 : 0.35,
      block_reason: String(card.risk_state ?? ""),
    }));
    const boosted: JsonRecord = {
      symbol: String(rows[0]?.symbol ?? "UNKNOWN"),
      generated_at: String(boardArtifact.generated_at ?? new Date().toISOString()),
      board: rows,
      source: "node_pipeline",
    };
    consciousnessCache = { ts: now, data: boosted };
    return boosted;
  }
  const snapshot = await getLatestBrainSnapshot(force);
  if (!snapshot) return null;

  const data = asRecord(snapshot.data) ?? {};
  const signal = asRecord(data.signal) ?? {};
  const scoring = asRecord(data.scoring) ?? asRecord(signal.scoring) ?? {};
  const components = asRecord(scoring.components) ?? {};
  const hardGates = asRecord(data.hard_gates) ?? {};
  const monitor = asRecord(data.monitor) ?? {};
  const learning = asRecord(monitor.learning) ?? {};

  const symbol = String(snapshot.symbol ?? signal.symbol ?? monitor.symbol ?? "UNKNOWN").toUpperCase();
  const action = String(signal.action ?? "skip").toLowerCase();
  const structure = clamp01(parseNum(components.structure_score, 0));
  const orderflow = clamp01(parseNum(hardGates.liquidity_score, parseNum(components.setup_pattern_quality, 0)));
  const context = clamp01(parseNum(hardGates.pass_ratio, 0));
  const memory = clamp01(parseNum(learning.win_rate, 0));
  const reasoning = clamp01(parseNum(scoring.final_score, 0));
  const risk = clamp01(parseNum(scoring.risk_score, 0.5));
  const attention = clamp01(
    structure * 0.30 + orderflow * 0.22 + context * 0.12 + memory * 0.16 + reasoning * 0.10 + risk * 0.10,
  );
  const blocked = Boolean(snapshot.blocked ?? false);
  const readiness = blocked ? "block" : action === "skip" ? "watch" : "allow";

  const consciousness: JsonRecord = {
    symbol,
    generated_at: String(snapshot.generated_at ?? new Date().toISOString()),
    board: [
      {
        symbol,
        setup: String(signal.setup ?? components.setup ?? "none"),
        action,
        readiness,
        attention_score: attention,
        structure_score: structure,
        orderflow_score: orderflow,
        context_score: context,
        memory_score: memory,
        reasoning_score: reasoning,
        risk_score: risk,
        block_reason: blocked ? String(snapshot.block_reason ?? "pipeline_blocked") : "",
      },
    ],
  };

  consciousnessCache = { ts: now, data: consciousness };
  return consciousness;
}

export async function runBrainCycle(args: {
  symbol: string;
  withReplay?: boolean;
  live?: boolean;
  dryRun?: boolean;
  approve?: boolean;
}): Promise<{
  ok: boolean;
  command: string[];
  stdout: string;
  stderr: string;
  snapshot: JsonRecord | null;
}> {
  const symbol = String(args.symbol || "AAPL").trim().toUpperCase();
  const pythonBin = process.env.PYTHON_BIN || "python3";
  const command = ["-m", "app.agents.orchestrator", "--symbol", symbol];
  if (args.live) command.push("--live");
  if (args.dryRun !== false) command.push("--dry-run");
  if (args.withReplay) command.push("--with-replay");
  if (args.approve) command.push("--approve");

  const cwd = path.resolve(process.cwd(), "godsview-openbb");
  const result = await new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    execFile(pythonBin, command, { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: String(stdout ?? ""), stderr: String(stderr ?? err.message ?? "") });
        return;
      }
      resolve({ ok: true, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

  const snapshot = await getLatestBrainSnapshot(true);
  await getConsciousnessSnapshot(true);
  return { ...result, command: [pythonBin, ...command], snapshot };
}
