import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "guard_state_persistence" });
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

interface ResolveGuardStateDataDirOptions {
  cwd?: string;
  envDataDir?: string;
  moduleDir?: string;
}

function findApiServerRoot(from: string): string | null {
  let current = path.resolve(from);
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(current);
    if (path.basename(current) === "api-server" && path.basename(parent) === "artifacts") {
      return current;
    }
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveDefaultGuardStateDataDir(cwd: string, moduleDir: string): string {
  const rootFromCwd = findApiServerRoot(cwd);
  if (rootFromCwd) return path.join(rootFromCwd, ".runtime");

  const rootFromModule = findApiServerRoot(moduleDir);
  if (rootFromModule) return path.join(rootFromModule, ".runtime");

  return path.join(cwd, ".godsview-runtime");
}

export function resolveGuardStateDataDir(options?: ResolveGuardStateDataDirOptions): string {
  const cwd = options?.cwd ? path.resolve(options.cwd) : process.cwd();
  const envDataDir = (options?.envDataDir ?? process.env.GODSVIEW_DATA_DIR ?? "").trim();
  if (envDataDir) return path.resolve(cwd, envDataDir);

  const moduleDir = options?.moduleDir ? path.resolve(options.moduleDir) : MODULE_DIR;
  return resolveDefaultGuardStateDataDir(cwd, moduleDir);
}

export function getGuardStateDataDirStatus(): { directory: string; writable: boolean; error: string | null } {
  const directory = resolveGuardStateDataDir();
  try {
    mkdirSync(directory, { recursive: true });
    accessSync(directory, constants.W_OK);
    return { directory, writable: true, error: null };
  } catch (err) {
    return {
      directory,
      writable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function statePath(fileName: string): string {
  return path.join(resolveGuardStateDataDir(), fileName);
}

export function loadGuardState<T>(fileName: string): T | null {
  const fullPath = statePath(fileName);
  try {
    if (!existsSync(fullPath)) return null;
    const raw = readFileSync(fullPath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn({ err, fileName, fullPath }, "Failed to load guard state");
    return null;
  }
}

export function persistGuardState<T>(fileName: string, payload: T): void {
  const fullPath = statePath(fileName);
  const dir = path.dirname(fullPath);
  const tmpPath = `${fullPath}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmpPath, fullPath);
  } catch (err) {
    logger.warn({ err, fileName, fullPath }, "Failed to persist guard state");
  }
}
