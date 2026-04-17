export type MlBootstrapState = "pending" | "running" | "ready" | "failed";

interface MlBootstrapSnapshot {
  state: MlBootstrapState;
  startedAtIso: string | null;
  completedAtIso: string | null;
  error: string | null;
}

const bootStartedAtMs = Date.now();

const mlBootstrap = {
  state: "pending" as MlBootstrapState,
  startedAtMs: null as number | null,
  completedAtMs: null as number | null,
  error: null as string | null,
};

function nowIso(value: number | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function markMlBootstrapRunning(): void {
  mlBootstrap.state = "running";
  mlBootstrap.startedAtMs = Date.now();
  mlBootstrap.completedAtMs = null;
  mlBootstrap.error = null;
}

export function markMlBootstrapReady(): void {
  mlBootstrap.state = "ready";
  mlBootstrap.completedAtMs = Date.now();
  mlBootstrap.error = null;
}

export function markMlBootstrapFailed(err: unknown): void {
  mlBootstrap.state = "failed";
  mlBootstrap.completedAtMs = Date.now();
  mlBootstrap.error = err instanceof Error ? err.message : String(err);
}

export function getMlBootstrapSnapshot(): MlBootstrapSnapshot {
  return {
    state: mlBootstrap.state,
    startedAtIso: nowIso(mlBootstrap.startedAtMs),
    completedAtIso: nowIso(mlBootstrap.completedAtMs),
    error: mlBootstrap.error,
  };
}

export function getStartupSnapshot(): {
  startedAtIso: string;
  uptimeMs: number;
  mlBootstrap: MlBootstrapSnapshot;
} {
  return {
    startedAtIso: new Date(bootStartedAtMs).toISOString(),
    uptimeMs: Date.now() - bootStartedAtMs,
    mlBootstrap: getMlBootstrapSnapshot(),
  };
}
