import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));
vi.mock("../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

import {
  registerSubsystem,
  updateSubsystemHealth,
  getSubsystem,
  getAllSubsystems,
  generateManifest,
  setConfig,
  getConfig,
  getAllConfig,
  deleteConfig,
  getDependencyGraph,
  checkDependencyHealth,
  _clearManifest,
  SubsystemEntry,
  HealthStatus,
} from "../lib/system_manifest";

describe("SystemManifest Module", () => {
  beforeEach(() => {
    _clearManifest();
  });

  describe("Subsystem Registration", () => {
    it("should register a subsystem", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Risk Engine",
        version: "1.0.0",
        category: "trading",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: ["/api/risk"],
        description: "Main risk calculation system",
        config: { max_exposure: 0.15 },
      };

      const result = registerSubsystem(entry);

      expect(result.id).toMatch(/^sys_/);
      expect(result.name).toBe("Risk Engine");
      expect(result.status).toBe("running");
    });

    it("should generate unique subsystem IDs", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Test",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Test subsystem",
        config: {},
      };

      const s1 = registerSubsystem(entry);
      const s2 = registerSubsystem(entry);

      expect(s1.id).not.toBe(s2.id);
    });

    it("should retrieve all registered subsystems", () => {
      const e1: Omit<SubsystemEntry, "id"> = {
        name: "System 1",
        version: "1.0.0",
        category: "core",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "System 1",
        config: {},
      };

      const e2: Omit<SubsystemEntry, "id"> = {
        name: "System 2",
        version: "2.0.0",
        category: "core",
        status: "stopped",
        health: "unknown",
        dependencies: [],
        endpoints: [],
        description: "System 2",
        config: {},
      };

      registerSubsystem(e1);
      registerSubsystem(e2);

      const all = getAllSubsystems();
      expect(all).toHaveLength(2);
      expect(all.map(s => s.name)).toContain("System 1");
      expect(all.map(s => s.name)).toContain("System 2");
    });

    it("should retrieve subsystem by ID", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Retrievable",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Should be retrievable",
        config: {},
      };

      const registered = registerSubsystem(entry);
      const retrieved = getSubsystem(registered.id);

      expect(retrieved).toEqual(registered);
    });

    it("should return undefined for missing subsystem", () => {
      const result = getSubsystem("sys_missing");
      expect(result).toBeUndefined();
    });
  });

  describe("Subsystem Health Updates", () => {
    it("should update subsystem health", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Healthy System",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Test",
        config: {},
      };

      const sub = registerSubsystem(entry);
      const result = updateSubsystemHealth(sub.id, "degraded");

      expect(result.success).toBe(true);

      const updated = getSubsystem(sub.id);
      expect(updated?.health).toBe("degraded");
    });

    it("should update status along with health", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Status Test",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Test",
        config: {},
      };

      const sub = registerSubsystem(entry);
      const result = updateSubsystemHealth(sub.id, "critical", "error");

      expect(result.success).toBe(true);

      const updated = getSubsystem(sub.id);
      expect(updated?.health).toBe("critical");
      expect(updated?.status).toBe("error");
    });

    it("should fail to update non-existent subsystem", () => {
      const result = updateSubsystemHealth("sys_missing", "degraded");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Subsystem not found");
    });

    it("should accept all health statuses", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Health Test",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Test",
        config: {},
      };

      const sub = registerSubsystem(entry);
      const statuses: HealthStatus[] = ["healthy", "degraded", "critical", "unknown"];

      for (const status of statuses) {
        const result = updateSubsystemHealth(sub.id, status);
        expect(result.success).toBe(true);
        expect(getSubsystem(sub.id)?.health).toBe(status);
      }
    });
  });

  describe("Manifest Generation", () => {
    it("should generate manifest with subsystems", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Test System",
        version: "1.0.0",
        category: "core",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: ["/api/test"],
        description: "Test",
        config: {},
      };

      registerSubsystem(entry);

      const manifest = generateManifest();

      expect(manifest.generated_at).toBeDefined();
      expect(manifest.subsystems).toHaveLength(1);
      expect(manifest.counts.total).toBe(1);
      expect(manifest.counts.running).toBe(1);
      expect(manifest.counts.healthy).toBe(1);
    });

    it("should calculate correct counts", () => {
      const healthy: Omit<SubsystemEntry, "id"> = {
        name: "Healthy",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Healthy",
        config: {},
      };

      const degraded: Omit<SubsystemEntry, "id"> = {
        name: "Degraded",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "degraded",
        dependencies: [],
        endpoints: [],
        description: "Degraded",
        config: {},
      };

      const critical: Omit<SubsystemEntry, "id"> = {
        name: "Critical",
        version: "1.0.0",
        category: "test",
        status: "error",
        health: "critical",
        dependencies: [],
        endpoints: [],
        description: "Critical",
        config: {},
      };

      registerSubsystem(healthy);
      registerSubsystem(degraded);
      registerSubsystem(critical);

      const manifest = generateManifest();

      expect(manifest.counts.total).toBe(3);
      expect(manifest.counts.healthy).toBe(1);
      expect(manifest.counts.degraded).toBe(1);
      expect(manifest.counts.critical).toBe(1);
      expect(manifest.counts.error).toBe(1);
      expect(manifest.counts.running).toBe(2);
    });

    it("should include timestamp", () => {
      const before = new Date();
      const manifest = generateManifest();
      const after = new Date();

      const manifestTime = new Date(manifest.generated_at);
      expect(manifestTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(manifestTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("Dependency Graph", () => {
    it("should build dependency graph", () => {
      const a: Omit<SubsystemEntry, "id"> = {
        name: "A",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "A",
        config: {},
      };

      const b: Omit<SubsystemEntry, "id"> = {
        name: "B",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "B",
        config: {},
      };

      const subA = registerSubsystem(a);
      const subB = registerSubsystem({ ...b, dependencies: [subA.id] });

      const graph = getDependencyGraph();

      expect(graph[subA.id]).toEqual([]);
      expect(graph[subB.id]).toEqual([subA.id]);
    });

    it("should include manifest in dependency graph", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Test",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: ["some-dep"],
        endpoints: [],
        description: "Test",
        config: {},
      };

      registerSubsystem(entry);

      const manifest = generateManifest();
      expect(Object.keys(manifest.dependency_graph).length).toBeGreaterThan(0);
    });
  });

  describe("Configuration Management", () => {
    it("should set configuration", () => {
      const entry = setConfig("api_key", "secret123", {
        category: "auth",
        description: "API authentication key",
        sensitive: true,
      });

      expect(entry.key).toBe("api_key");
      expect(entry.value).toBe("secret123");
      expect(entry.sensitive).toBe(true);
      expect(entry.updated_at).toBeDefined();
    });

    it("should retrieve config by key", () => {
      setConfig("db_host", "localhost", {
        category: "database",
        description: "Database host",
      });

      const entry = getConfig("db_host");
      expect(entry?.value).toBe("localhost");
    });

    it("should redact sensitive configs by default", () => {
      setConfig("password", "secret_pwd", {
        category: "auth",
        description: "Password",
        sensitive: true,
      });

      const entry = getConfig("password");
      expect(entry?.value).toBe("[REDACTED]");
    });

    it("should reveal sensitive configs when requested", () => {
      setConfig("api_token", "token123", {
        category: "auth",
        description: "API token",
        sensitive: true,
      });

      const entry = getConfig("api_token", true);
      expect(entry?.value).toBe("token123");
    });

    it("should retrieve all configs", () => {
      setConfig("key1", "val1", { category: "test", description: "Test 1" });
      setConfig("key2", "val2", { category: "test", description: "Test 2" });

      const all = getAllConfig();
      expect(all).toHaveLength(2);
    });

    it("should redact all sensitive configs by default", () => {
      setConfig("public_key", "pub123", { category: "auth", description: "Public", sensitive: false });
      setConfig("private_key", "priv123", {
        category: "auth",
        description: "Private",
        sensitive: true,
      });

      const all = getAllConfig();
      const privateEntry = all.find(e => e.key === "private_key");
      expect(privateEntry?.value).toBe("[REDACTED]");
    });

    it("should delete config", () => {
      setConfig("to_delete", "value", { category: "test", description: "To delete" });
      const result = deleteConfig("to_delete");

      expect(result.success).toBe(true);
      expect(getConfig("to_delete")).toBeUndefined();
    });

    it("should fail to delete non-existent config", () => {
      const result = deleteConfig("missing_key");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Config not found");
    });

    it("should update config by setting with same key", () => {
      setConfig("counter", 1, { category: "test", description: "Counter" });
      const first = getConfig("counter");

      setConfig("counter", 2, { category: "test", description: "Counter" });
      const second = getConfig("counter");

      expect(first?.value).toBe(1);
      expect(second?.value).toBe(2);
    });
  });

  describe("Dependency Health Checking", () => {
    it("should check dependency health", () => {
      const dep: Omit<SubsystemEntry, "id"> = {
        name: "Dependency",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Dependency",
        config: {},
      };

      const main: Omit<SubsystemEntry, "id"> = {
        name: "Main",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Main",
        config: {},
      };

      const depSub = registerSubsystem(dep);
      const mainSub = registerSubsystem({ ...main, dependencies: [depSub.id] });

      const result = checkDependencyHealth(mainSub.id);
      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should report issues with missing dependencies", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Broken",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: ["sys_missing"],
        endpoints: [],
        description: "Has missing dependency",
        config: {},
      };

      const sub = registerSubsystem(entry);
      const result = checkDependencyHealth(sub.id);

      expect(result.healthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should report issues with stopped dependencies", () => {
      const dep: Omit<SubsystemEntry, "id"> = {
        name: "Stopped Dep",
        version: "1.0.0",
        category: "test",
        status: "stopped",
        health: "unknown",
        dependencies: [],
        endpoints: [],
        description: "Stopped",
        config: {},
      };

      const main: Omit<SubsystemEntry, "id"> = {
        name: "Main",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Main",
        config: {},
      };

      const depSub = registerSubsystem(dep);
      const mainSub = registerSubsystem({ ...main, dependencies: [depSub.id] });

      const result = checkDependencyHealth(mainSub.id);
      expect(result.healthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should report issues with critical dependencies", () => {
      const dep: Omit<SubsystemEntry, "id"> = {
        name: "Critical Dep",
        version: "1.0.0",
        category: "test",
        status: "error",
        health: "critical",
        dependencies: [],
        endpoints: [],
        description: "Critical",
        config: {},
      };

      const main: Omit<SubsystemEntry, "id"> = {
        name: "Main",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Main",
        config: {},
      };

      const depSub = registerSubsystem(dep);
      const mainSub = registerSubsystem({ ...main, dependencies: [depSub.id] });

      const result = checkDependencyHealth(mainSub.id);
      expect(result.healthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should report if subsystem itself is critical", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Critical System",
        version: "1.0.0",
        category: "test",
        status: "error",
        health: "critical",
        dependencies: [],
        endpoints: [],
        description: "Critical",
        config: {},
      };

      const sub = registerSubsystem(entry);
      const result = checkDependencyHealth(sub.id);

      expect(result.healthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should fail for non-existent subsystem", () => {
      const result = checkDependencyHealth("sys_missing");
      expect(result.healthy).toBe(false);
      expect(result.issues).toContain("Subsystem not found");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty manifest", () => {
      const manifest = generateManifest();
      expect(manifest.subsystems).toHaveLength(0);
      expect(manifest.counts.total).toBe(0);
    });

    it("should handle subsystem with empty config", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Empty Config",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Empty config",
        config: {},
      };

      const sub = registerSubsystem(entry);
      expect(sub.config).toEqual({});
    });

    it("should handle subsystem with complex config", () => {
      const entry: Omit<SubsystemEntry, "id"> = {
        name: "Complex Config",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "Complex",
        config: {
          nested: { deep: { value: 123 } },
          array: [1, 2, 3],
          string: "test",
        },
      };

      const sub = registerSubsystem(entry);
      expect(sub.config.nested.deep.value).toBe(123);
    });

    it("should preserve all subsystem data types in config", () => {
      setConfig("number", 42, { category: "test", description: "Number" });
      setConfig("boolean", true, { category: "test", description: "Boolean" });
      setConfig("object", { key: "value" }, { category: "test", description: "Object" });
      setConfig("array", [1, 2, 3], { category: "test", description: "Array" });

      expect(getConfig("number")?.value).toBe(42);
      expect(getConfig("boolean")?.value).toBe(true);
      expect(getConfig("object")?.value).toEqual({ key: "value" });
      expect(getConfig("array")?.value).toEqual([1, 2, 3]);
    });

    it("should handle special characters in keys and descriptions", () => {
      setConfig("api_key_v2.0", "value", {
        category: "auth-keys",
        description: "API Key v2.0 [PRODUCTION]",
      });

      const entry = getConfig("api_key_v2.0");
      expect(entry?.key).toBe("api_key_v2.0");
      expect(entry?.description).toContain("[PRODUCTION]");
    });

    it("should timestamp all configs", () => {
      const before = new Date();
      const entry = setConfig("timestamped", "value", {
        category: "test",
        description: "Test",
      });
      const after = new Date();

      const entryTime = new Date(entry.updated_at);
      expect(entryTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entryTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("_clearManifest", () => {
    it("should clear all subsystems and configs", () => {
      registerSubsystem({
        name: "To Clear",
        version: "1.0.0",
        category: "test",
        status: "running",
        health: "healthy",
        dependencies: [],
        endpoints: [],
        description: "To clear",
        config: {},
      });

      setConfig("to_clear", "value", { category: "test", description: "To clear" });

      _clearManifest();

      expect(getAllSubsystems()).toHaveLength(0);
      expect(getAllConfig()).toHaveLength(0);
    });
  });
});
