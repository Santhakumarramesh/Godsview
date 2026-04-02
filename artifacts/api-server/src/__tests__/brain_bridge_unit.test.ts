/**
 * brain_bridge_unit.test.ts — Phase 66
 *
 * Tests brain_bridge.ts — file-read caching layer + consciousness snapshot shaping.
 * Mocks the filesystem to avoid needing real godsview-openbb artifacts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import {
  getLatestBrainSnapshot,
  getConsciousnessSnapshot,
  runBrainCycle,
} from "../lib/brain_bridge";

// ── getLatestBrainSnapshot ────────────────────────────────────────────────────

describe("getLatestBrainSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
  });

  it("returns null when artifact file is missing", async () => {
    const result = await getLatestBrainSnapshot(true);
    expect(result).toBeNull();
  });

  it("caches non-null result for 10s TTL on successive calls", async () => {
    // First call — returns valid data and caches it
    const mockData = { symbol: "BTCUSD", generated_at: "2026-01-01T00:00:00Z", data: {} };
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(mockData) as any);
    await getLatestBrainSnapshot(true);
    // Second call without force — should hit cache, not re-read
    const callsBefore = vi.mocked(readFile).mock.calls.length;
    await getLatestBrainSnapshot(false);
    expect(vi.mocked(readFile).mock.calls.length).toBe(callsBefore); // no new read
  });

  it("force=true bypasses cache", async () => {
    await getLatestBrainSnapshot(true);
    const callsBefore = vi.mocked(readFile).mock.calls.length;
    await getLatestBrainSnapshot(true);
    expect(vi.mocked(readFile).mock.calls.length).toBe(callsBefore + 1);
  });

  it("parses valid JSON artifact", async () => {
    const mockData = { symbol: "BTCUSD", generated_at: "2026-01-01T00:00:00Z", data: {} };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockData) as any);
    const result = await getLatestBrainSnapshot(true);
    expect(result).toEqual(mockData);
  });

  it("returns null on invalid JSON", async () => {
    vi.mocked(readFile).mockResolvedValue("not-json" as any);
    const result = await getLatestBrainSnapshot(true);
    expect(result).toBeNull();
  });
});

// ── getConsciousnessSnapshot ──────────────────────────────────────────────────

describe("getConsciousnessSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
  });

  it("returns null when both artifact files are missing", async () => {
    const result = await getConsciousnessSnapshot(true);
    expect(result).toBeNull();
  });

  it("parses board-format artifact (cards array)", async () => {
    const boardData = {
      generated_at: "2026-01-01T00:00:00Z",
      cards: [
        {
          symbol: "BTCUSD", setup: "sweep_reclaim", bias: "long",
          risk_state: "allow", c4_score: 72, readiness_pct: 68, memory_match_pct: 55,
        },
      ],
    };
    // getConsciousnessSnapshot reads BOARD_ARTIFACT first, then ORCHESTRATOR as fallback
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(boardData) as any); // board (read first)
    const result = await getConsciousnessSnapshot(true);
    expect(result).not.toBeNull();
    if (result) {
      expect(result).toHaveProperty("board");
      const board = result.board as Array<Record<string, unknown>>;
      expect(Array.isArray(board)).toBe(true);
      expect(board[0]).toHaveProperty("symbol", "BTCUSD");
      expect(board[0]).toHaveProperty("setup", "sweep_reclaim");
      expect(board[0]).toHaveProperty("attention_score");
    }
  });

  it("shapes attention_score in 0-1 range from board card", async () => {
    const boardData = {
      generated_at: "2026-01-01T00:00:00Z",
      cards: [
        { symbol: "ETHUSD", setup: "cvd_divergence", bias: "short",
          risk_state: "allow", c4_score: 85, readiness_pct: 80, memory_match_pct: 70 },
      ],
    };
    // BOARD_ARTIFACT is read first
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(boardData) as any);
    const result = await getConsciousnessSnapshot(true);
    if (result) {
      const board = result.board as Array<Record<string, number>>;
      expect(board[0].attention_score).toBeGreaterThanOrEqual(0);
      expect(board[0].attention_score).toBeLessThanOrEqual(1);
    }
  });

  it("falls back to orchestrator snapshot when board artifact has no cards", async () => {
    const orchestratorData = {
      symbol: "SOLUSD",
      generated_at: "2026-01-01T00:00:00Z",
      blocked: false,
      data: {
        signal: { action: "enter", setup: "sweep_reclaim", symbol: "SOLUSD" },
        scoring: { final_score: 0.72, components: { structure_score: 0.7 }, risk_score: 0.8 },
        hard_gates: { liquidity_score: 0.65, pass_ratio: 0.55 },
        monitor: { symbol: "SOLUSD", learning: { win_rate: 0.60 } },
      },
    };
    // BOARD_ARTIFACT is read first (no cards → fallback), then ORCHESTRATOR_ARTIFACT
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ generated_at: "x" }) as any); // board without cards
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(orchestratorData) as any); // orchestrator fallback
    const result = await getConsciousnessSnapshot(true);
    expect(result).not.toBeNull();
    if (result) {
      const board = result.board as Array<Record<string, unknown>>;
      expect(board[0].symbol).toBe("SOLUSD");
      expect(board[0].action).toBe("enter");
    }
  });
});

// ── runBrainCycle ─────────────────────────────────────────────────────────────

describe("runBrainCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb: any) => {
      cb(null, "Brain cycle complete", "");
    });
  });

  it("returns ok:true when execFile succeeds", async () => {
    const result = await runBrainCycle({ symbol: "BTCUSD", dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("Brain cycle complete");
  });

  it("returns ok:false when execFile errors", async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb: any) => {
      cb(new Error("python not found"), "", "No module named 'app'");
    });
    const result = await runBrainCycle({ symbol: "BTCUSD", dryRun: true });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("No module named");
  });

  it("command includes symbol and --dry-run by default", async () => {
    await runBrainCycle({ symbol: "ETHUSD", dryRun: true });
    expect(vi.mocked(execFile)).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["--symbol", "ETHUSD", "--dry-run"]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("command includes --live when live=true", async () => {
    await runBrainCycle({ symbol: "BTCUSD", live: true });
    const args = vi.mocked(execFile).mock.calls[0][1] as string[];
    expect(args).toContain("--live");
  });

  it("command includes --with-replay when withReplay=true", async () => {
    await runBrainCycle({ symbol: "BTCUSD", withReplay: true });
    const args = vi.mocked(execFile).mock.calls[0][1] as string[];
    expect(args).toContain("--with-replay");
  });

  it("result includes snapshot (null when file missing)", async () => {
    const result = await runBrainCycle({ symbol: "BTCUSD" });
    expect(result).toHaveProperty("snapshot");
    expect(result.snapshot).toBeNull();
  });

  it("uppercases the symbol", async () => {
    await runBrainCycle({ symbol: "btcusd" });
    const args = vi.mocked(execFile).mock.calls[0][1] as string[];
    expect(args).toContain("BTCUSD");
  });
});
