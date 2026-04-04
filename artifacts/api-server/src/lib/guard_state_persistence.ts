import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "guard_state_persistence" });

function statePath(fileName: string): string {
  const base = (process.env.GODSVIEW_DATA_DIR ?? process.cwd()).trim() || process.cwd();
  return path.join(base, fileName);
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
