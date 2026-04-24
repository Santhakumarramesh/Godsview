import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getGuardStateDataDirStatus,
  loadGuardState,
  persistGuardState,
  resolveGuardStateDataDir,
} from "../lib/guard_state_persistence";

function missingPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("guard_state_persistence", () => {
  const originalDataDir = process.env.GODSVIEW_DATA_DIR;
  const tempDirs = new Set<string>();

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.GODSVIEW_DATA_DIR;
    else process.env.GODSVIEW_DATA_DIR = originalDataDir;

    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.clear();
  });

  it("resolves data dir from explicit env override", () => {
    const resolved = resolveGuardStateDataDir({
      cwd: "/tmp/workspace",
      envDataDir: "runtime-data",
      moduleDir: "/tmp/workspace/artifacts/api-server/src/lib",
    });
    expect(resolved).toBe(path.resolve("/tmp/workspace", "runtime-data"));
  });

  it("resolves data dir under artifacts/api-server when cwd is repo root", () => {
    const resolved = resolveGuardStateDataDir({
      cwd: "/tmp/workspace",
      envDataDir: "",
      moduleDir: "/tmp/workspace/artifacts/api-server/src/lib",
    });
    expect(resolved).toBe("/tmp/workspace/artifacts/api-server/.runtime");
  });

  it("falls back to module location when cwd is outside repo", () => {
    const cwd = missingPath("godsview-cwd-missing");
    const resolved = resolveGuardStateDataDir({
      cwd,
      envDataDir: "",
      moduleDir: "/tmp/workspace/artifacts/api-server/dist",
    });
    expect(resolved).toBe("/tmp/workspace/artifacts/api-server/.runtime");
  });

  it("uses generic .godsview-runtime fallback when api-server root cannot be inferred", () => {
    const cwd = missingPath("godsview-cwd-generic");
    const resolved = resolveGuardStateDataDir({
      cwd,
      envDataDir: "",
      moduleDir: "/tmp/other/location",
    });
    expect(resolved).toBe(path.join(cwd, ".godsview-runtime"));
  });

  it("persists and loads guard state in configured data dir", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "godsview-guard-state-"));
    tempDirs.add(tempDir);
    process.env.GODSVIEW_DATA_DIR = tempDir;

    const file = "execution_market_guard_state.json";
    const payload = {
      level: "WATCH",
      timestamp: new Date().toISOString(),
      score: 0.74,
    };

    persistGuardState(file, payload);
    const loaded = loadGuardState<typeof payload>(file);
    expect(loaded).toEqual(payload);

    const status = getGuardStateDataDirStatus();
    expect(status.directory).toBe(tempDir);
    expect(status.writable).toBe(true);
    expect(status.error).toBeNull();
  });
});
