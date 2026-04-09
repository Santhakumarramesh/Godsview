import crypto from "crypto";
import pino from "pino";

const logger = pino({ name: "manifest-registry" });

export type HealthStatus = "healthy" | "degraded" | "critical" | "unknown";

export interface SubsystemEntry {
  id: string;
  name: string;
  version: string;
  category: string;
  status: "running" | "stopped" | "error" | "unknown";
  health: HealthStatus;
  dependencies: string[];
  endpoints: string[];
  description: string;
  config: Record<string, any>;
}

export interface SystemManifest {
  generated_at: string;
  subsystems: SubsystemEntry[];
  counts: {
    total: number;
    running: number;
    stopped: number;
    error: number;
    healthy: number;
    degraded: number;
    critical: number;
  };
  dependency_graph: Record<string, string[]>;
}

export interface ConfigEntry {
  key: string;
  value: any;
  category: string;
  description: string;
  sensitive: boolean;
  updated_at: string;
}

// Storage
const subsystems = new Map<string, SubsystemEntry>();
const configs = new Map<string, ConfigEntry>();

function calculateCounts(subs: SubsystemEntry[]): SystemManifest["counts"] {
  return {
    total: subs.length,
    running: subs.filter(s => s.status === "running").length,
    stopped: subs.filter(s => s.status === "stopped").length,
    error: subs.filter(s => s.status === "error").length,
    healthy: subs.filter(s => s.health === "healthy").length,
    degraded: subs.filter(s => s.health === "degraded").length,
    critical: subs.filter(s => s.health === "critical").length,
  };
}

function buildDependencyGraph(subs: SubsystemEntry[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const sub of subs) {
    graph[sub.id] = sub.dependencies;
  }
  return graph;
}

export function registerSubsystem(entry: Omit<SubsystemEntry, "id">): SubsystemEntry {
  const id = `sys_${crypto.randomUUID()}`;
  const subsystem: SubsystemEntry = { ...entry, id };
  subsystems.set(id, subsystem);
  logger.info({ id, name: entry.name }, "Subsystem registered");
  return subsystem;
}

export function updateSubsystemHealth(subsystem_id: string, health: HealthStatus, status?: string): { success: boolean; error?: string } {
  const sub = subsystems.get(subsystem_id);
  if (!sub) return { success: false, error: "Subsystem not found" };

  sub.health = health;
  if (status) sub.status = status as any;

  return { success: true };
}

export function getSubsystem(id: string): SubsystemEntry | undefined {
  return subsystems.get(id);
}

export function getAllSubsystems(): SubsystemEntry[] {
  return Array.from(subsystems.values());
}

export function generateManifest(): SystemManifest {
  const subs = Array.from(subsystems.values());
  return {
    generated_at: new Date().toISOString(),
    subsystems: subs,
    counts: calculateCounts(subs),
    dependency_graph: buildDependencyGraph(subs),
  };
}

export function setConfig(key: string, value: any, config: { category: string; description: string; sensitive?: boolean }): ConfigEntry {
  const entry: ConfigEntry = {
    key,
    value,
    category: config.category,
    description: config.description,
    sensitive: config.sensitive ?? false,
    updated_at: new Date().toISOString(),
  };

  configs.set(key, entry);
  logger.info({ key, category: config.category }, "Config set");
  return entry;
}

export function getConfig(key: string, include_sensitive?: boolean): ConfigEntry | undefined {
  const entry = configs.get(key);
  if (!entry) return undefined;

  if (entry.sensitive && !include_sensitive) {
    return { ...entry, value: "[REDACTED]" };
  }

  return entry;
}

export function getAllConfig(include_sensitive?: boolean): ConfigEntry[] {
  return Array.from(configs.values()).map(entry => {
    if (entry.sensitive && !include_sensitive) {
      return { ...entry, value: "[REDACTED]" };
    }
    return entry;
  });
}

export function deleteConfig(key: string): { success: boolean; error?: string } {
  if (!configs.has(key)) return { success: false, error: "Config not found" };
  configs.delete(key);
  logger.info({ key }, "Config deleted");
  return { success: true };
}

export function getDependencyGraph(): Record<string, string[]> {
  const subs = Array.from(subsystems.values());
  return buildDependencyGraph(subs);
}

export function checkDependencyHealth(subsystem_id: string): { healthy: boolean; issues: string[] } {
  const sub = subsystems.get(subsystem_id);
  if (!sub) return { healthy: false, issues: ["Subsystem not found"] };

  const issues: string[] = [];

  if (sub.health === "critical") {
    issues.push(`Subsystem ${sub.name} is in critical state`);
  }

  if (sub.health === "degraded") {
    issues.push(`Subsystem ${sub.name} is degraded`);
  }

  for (const depId of sub.dependencies) {
    const dep = subsystems.get(depId);
    if (!dep) {
      issues.push(`Dependency ${depId} not registered`);
    } else if (dep.status === "stopped") {
      issues.push(`Dependency ${dep.name} is stopped`);
    } else if (dep.health === "critical") {
      issues.push(`Dependency ${dep.name} is in critical state`);
    }
  }

  return { healthy: issues.length === 0, issues };
}

export function _clearManifest(): void {
  subsystems.clear();
  configs.clear();
}
