import { describe, it, expect, beforeEach } from "vitest";
import {
  registerEngine,
  setEngineState,
  heartbeat,
  executeCommand,
  getEngine,
  listEngines,
  getSystemHealth,
  getOrchestratorSnapshot,
  resetOrchestrator,
} from "../lib/system_orchestrator.js";

beforeEach(() => resetOrchestrator());

describe("System Orchestrator", () => {
  it("registers an engine", () => {
    const eng = registerEngine({ id: "brain", name: "Brain Engine" });
    expect(eng.id).toBe("brain");
    expect(eng.state).toBe("stopped");
    expect(listEngines()).toHaveLength(1);
  });

  it("re-registration acts as heartbeat", () => {
    registerEngine({ id: "brain", name: "Brain Engine" });
    const eng2 = registerEngine({ id: "brain", name: "Brain Engine" });
    expect(eng2.lastHeartbeat).toBeDefined();
    expect(listEngines()).toHaveLength(1);
  });

  it("transitions engine state", () => {
    registerEngine({ id: "brain", name: "Brain Engine" });
    setEngineState("brain", "running");
    expect(getEngine("brain")!.state).toBe("running");
    expect(getEngine("brain")!.startedAt).toBeDefined();
  });

  it("tracks errors", () => {
    registerEngine({ id: "brain", name: "Brain Engine" });
    setEngineState("brain", "error", "OOM");
    const eng = getEngine("brain")!;
    expect(eng.errorCount).toBe(1);
    expect(eng.lastError).toBe("OOM");
  });

  it("throws on unknown engine", () => {
    expect(() => setEngineState("nope", "running")).toThrow("not registered");
  });

  it("processes heartbeat", () => {
    registerEngine({ id: "exec", name: "Execution Engine" });
    const eng = heartbeat("exec");
    expect(eng.lastHeartbeat).toBeDefined();
  });

  it("executes command", () => {
    registerEngine({ id: "exec", name: "Execution Engine" });
    const result = executeCommand("exec", "pause");
    expect(result.ok).toBe(true);
  });

  it("computes system health", () => {
    registerEngine({ id: "a", name: "A" });
    registerEngine({ id: "b", name: "B" });
    setEngineState("a", "running");
    setEngineState("b", "degraded");
    const h = getSystemHealth();
    expect(h.overall).toBe("degraded");
    expect(h.enginesRunning).toBe(1);
    expect(h.enginesDegraded).toBe(1);
  });

  it("returns snapshot", () => {
    registerEngine({ id: "a", name: "A" });
    const snap = getOrchestratorSnapshot();
    expect(snap.engines).toHaveLength(1);
    expect(snap.recentEvents.length).toBeGreaterThan(0);
    expect(snap.health.enginesTotal).toBe(1);
  });
});
