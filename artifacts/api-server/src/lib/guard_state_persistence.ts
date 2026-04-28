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

// Production runtime directory baked into the container image and chown'd to
// the godsview user (see Dockerfile). This is the canonical writable location
// for guard state in deployed containers.
const PRODUCTION_DATA_DIR = "/app/.runtime/persistent";

function resolveDefaultGuardStateDataDir(cwd: string): string {
  // In production containers /app/.runtime/persistent is mkdir'd + chown'd
  // by the Dockerfile and is the canonical home for runtime state. We
  // previously walked up to artifacts/api-server and used ".runtime" there,
  // but that path is owned by root from the COPY layer and EACCES'd on
  // every supervisor cycle. Removed.
  if (existsSync(PRODUCTION_DATA_DIR)) return PRODUCTION_DATA_DIR;
  // Dev fallback — when running pnpm dev outside Docker, drop a hidden
  // dir in the current working directory.
  return path.join(cwd, ".godsview-runtime");
}

export function resolveGuardStateDataDir(options?: ResolveGuardStateDataDirOptions): string {
  const cwd = options?.cwd ? path.resolve(options.cwd) : process.cwd();
  // Always prefer GODSVIEW_DATA_DIR if set — this is how docker-compose pins
  // the path explicitly. resolveGuardStateDataDir is the single entry point
  // every persistence call goes through.
  const envDataDir = (options?.envDataDir ?? process.env.GODSVIEW_DATA_DIR ?? "").trim();
  if (envDataDir) return path.resolve(cwd, envDataDir);

  return resolveDefaultGuardStateDataDir(cwd);
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
