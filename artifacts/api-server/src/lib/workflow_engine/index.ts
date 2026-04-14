/**
 * workflow_engine/index.ts — Phase 75: Workflow Engine
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. WorkflowDefinitionStore — DAG definitions with tasks + edges.
 *   2. WorkflowRunner          — execute DAGs with topological order.
 *   3. RetryPolicy             — exponential backoff retries.
 *   4. ScheduleEngine          — cron-like schedule evaluation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Definitions ────────────────────────────────────────────────────────────

export interface TaskDefinition {
  id: string;
  name: string;
  handler: string;       // identifier for the task implementation
  config: Record<string, unknown>;
  dependsOn: string[];   // task ids
  retries: number;
  timeoutMs: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  tasks: TaskDefinition[];
  schedule?: string;     // cron-like
  createdAt: number;
  version: number;
}

export class WorkflowDefinitionStore {
  private readonly defs = new Map<string, WorkflowDefinition>();

  upsert(params: Omit<WorkflowDefinition, "id" | "createdAt" | "version">): WorkflowDefinition {
    // Find by name and bump version, or create new
    const existing = Array.from(this.defs.values()).find((d) => d.name === params.name);
    const id = existing?.id ?? `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const def: WorkflowDefinition = {
      id,
      ...params,
      createdAt: existing?.createdAt ?? Date.now(),
      version: (existing?.version ?? 0) + 1,
    };
    this.validateDAG(def);
    this.defs.set(id, def);
    return def;
  }

  validateDAG(def: WorkflowDefinition): void {
    const ids = new Set(def.tasks.map((t) => t.id));
    for (const t of def.tasks) {
      for (const dep of t.dependsOn) {
        if (!ids.has(dep)) throw new Error(`Task ${t.id} depends on unknown task ${dep}`);
      }
    }
    // Cycle detection via DFS
    const visited = new Set<string>();
    const stack = new Set<string>();
    const map = new Map(def.tasks.map((t) => [t.id, t]));
    const dfs = (id: string): void => {
      if (stack.has(id)) throw new Error(`Cycle detected at task ${id}`);
      if (visited.has(id)) return;
      stack.add(id);
      const t = map.get(id);
      if (t) for (const dep of t.dependsOn) dfs(dep);
      stack.delete(id);
      visited.add(id);
    };
    for (const t of def.tasks) dfs(t.id);
  }

  topoOrder(def: WorkflowDefinition): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const map = new Map(def.tasks.map((t) => [t.id, t]));
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const t = map.get(id);
      if (t) for (const dep of t.dependsOn) visit(dep);
      order.push(id);
    };
    for (const t of def.tasks) visit(t.id);
    return order;
  }

  list(): WorkflowDefinition[] {
    return Array.from(this.defs.values());
  }

  get(id: string): WorkflowDefinition | null {
    return this.defs.get(id) ?? null;
  }

  byName(name: string): WorkflowDefinition | null {
    return Array.from(this.defs.values()).find((d) => d.name === name) ?? null;
  }
}

// ── Runner ─────────────────────────────────────────────────────────────────

export type TaskRunStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "retrying";
export type WorkflowRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface TaskRun {
  taskId: string;
  status: TaskRunStatus;
  startedAt?: number;
  finishedAt?: number;
  attempts: number;
  result?: Record<string, unknown>;
  error?: string;
}

export interface WorkflowRun {
  id: string;
  definitionId: string;
  status: WorkflowRunStatus;
  startedAt: number;
  finishedAt?: number;
  taskRuns: Map<string, TaskRun>;
  trigger: "manual" | "scheduled" | "event";
  context: Record<string, unknown>;
}

export type TaskHandler = (
  task: TaskDefinition,
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export class WorkflowRunner {
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly handlers = new Map<string, TaskHandler>();

  constructor(private readonly store: WorkflowDefinitionStore) {}

  registerHandler(name: string, handler: TaskHandler): void {
    this.handlers.set(name, handler);
  }

  async start(definitionId: string, trigger: WorkflowRun["trigger"] = "manual", context: Record<string, unknown> = {}): Promise<WorkflowRun> {
    const def = this.store.get(definitionId);
    if (!def) throw new Error("Workflow not found");
    const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const taskRuns = new Map<string, TaskRun>();
    for (const t of def.tasks) {
      taskRuns.set(t.id, { taskId: t.id, status: "pending", attempts: 0 });
    }
    const run: WorkflowRun = {
      id,
      definitionId,
      status: "running",
      startedAt: Date.now(),
      taskRuns,
      trigger,
      context: { ...context },
    };
    this.runs.set(id, run);

    const order = this.store.topoOrder(def);
    let failed = false;
    for (const taskId of order) {
      if (failed) {
        const tr = taskRuns.get(taskId)!;
        tr.status = "skipped";
        continue;
      }
      const taskDef = def.tasks.find((t) => t.id === taskId)!;
      const tr = taskRuns.get(taskId)!;
      const handler = this.handlers.get(taskDef.handler);
      if (!handler) {
        tr.status = "failed";
        tr.error = `no handler for ${taskDef.handler}`;
        failed = true;
        continue;
      }
      tr.status = "running";
      tr.startedAt = Date.now();
      let lastError: unknown;
      while (tr.attempts <= taskDef.retries) {
        tr.attempts++;
        try {
          tr.result = await handler(taskDef, run.context);
          tr.status = "succeeded";
          break;
        } catch (err) {
          lastError = err;
          tr.status = tr.attempts <= taskDef.retries ? "retrying" : "failed";
          if (tr.status === "retrying") {
            const backoff = Math.min(60_000, 1000 * 2 ** tr.attempts);
            await new Promise((r) => setTimeout(r, backoff));
          }
        }
      }
      tr.finishedAt = Date.now();
      if (tr.status === "failed") {
        tr.error = String((lastError as Error)?.message ?? lastError);
        failed = true;
      }
    }

    run.status = failed ? "failed" : "succeeded";
    run.finishedAt = Date.now();
    logger.info({ runId: id, status: run.status }, "[Workflow] Run finished");
    return run;
  }

  cancel(id: string): WorkflowRun | null {
    const run = this.runs.get(id);
    if (!run) return null;
    if (run.status === "running" || run.status === "queued") {
      run.status = "cancelled";
      run.finishedAt = Date.now();
    }
    return run;
  }

  list(definitionId?: string): WorkflowRun[] {
    const all = Array.from(this.runs.values());
    return (definitionId ? all.filter((r) => r.definitionId === definitionId) : all)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): WorkflowRun | null {
    return this.runs.get(id) ?? null;
  }
}

// ── Schedule Engine ────────────────────────────────────────────────────────

/**
 * Minimal cron expression matcher: 5 fields (m h dom mon dow).
 * Supports * and integers and comma lists. */
export class ScheduleEngine {
  shouldRun(cron: string, at: Date = new Date()): boolean {
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) return false;
    const minute = at.getMinutes();
    const hour = at.getHours();
    const dom = at.getDate();
    const mon = at.getMonth() + 1;
    const dow = at.getDay();
    return (
      this._match(fields[0]!, minute) &&
      this._match(fields[1]!, hour) &&
      this._match(fields[2]!, dom) &&
      this._match(fields[3]!, mon) &&
      this._match(fields[4]!, dow)
    );
  }

  private _match(field: string, value: number): boolean {
    if (field === "*") return true;
    const parts = field.split(",");
    for (const p of parts) {
      if (p.includes("/")) {
        const [base, stepStr] = p.split("/");
        const step = parseInt(stepStr ?? "1", 10);
        if (base === "*") {
          if (value % step === 0) return true;
        } else if (Number.isFinite(Number(base))) {
          if (Number(base) === value) return true;
        }
      } else if (p.includes("-")) {
        const [a, b] = p.split("-").map(Number);
        if (a !== undefined && b !== undefined && value >= a && value <= b) return true;
      } else if (Number(p) === value) return true;
    }
    return false;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const workflowStore = new WorkflowDefinitionStore();
export const workflowRunner = new WorkflowRunner(workflowStore);
export const scheduleEngine = new ScheduleEngine();

// Register a noop handler so demo workflows can run.
workflowRunner.registerHandler("noop", async (task) => ({ task: task.id, ok: true }));
