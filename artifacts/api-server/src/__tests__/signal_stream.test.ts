/**
 * signal_stream.test.ts — SSE Broadcast Hub Unit Tests
 *
 * Tests the SignalStreamHub: client registration, event publishing,
 * filtering, replay, and graceful shutdown.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Response object for SSE clients
function mockResponse() {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let ended = false;
  const listeners: Record<string, Function[]> = {};

  return {
    writeHead: vi.fn((status: number, hdrs: Record<string, string>) => {
      Object.assign(headers, hdrs);
    }),
    write: vi.fn((data: string) => {
      if (ended) throw new Error("Write after end");
      written.push(data);
      return true;
    }),
    end: vi.fn(() => { ended = true; }),
    on: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    setHeader: vi.fn(),
    // Helpers for test assertions
    _written: written,
    _headers: headers,
    _ended: () => ended,
    _trigger: (event: string) => listeners[event]?.forEach((cb) => cb()),
  };
}

// We re-import fresh for each test to avoid singleton state leaking
let hub: typeof import("../lib/signal_stream");

beforeEach(async () => {
  vi.resetModules();
  hub = await import("../lib/signal_stream");
});

describe("SignalStreamHub", () => {
  it("addClient registers an SSE client and sends connected event", () => {
    const res = mockResponse();
    const id = hub.signalStreamHub.addClient(res as any);
    expect(id).toMatch(/^sse-/);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));
    expect(res._written.length).toBeGreaterThanOrEqual(1);
    expect(res._written[0]).toContain("event: connected");
  });

  it("publish broadcasts to all connected clients", () => {
    const res1 = mockResponse();
    const res2 = mockResponse();
    hub.signalStreamHub.addClient(res1 as any);
    hub.signalStreamHub.addClient(res2 as any);

    hub.publishSignal({ symbol: "BTCUSD", score: 0.85 });

    // Both clients should have received the signal event (connected + signal)
    expect(res1._written.length).toBeGreaterThanOrEqual(2);
    expect(res2._written.length).toBeGreaterThanOrEqual(2);
    const last1 = res1._written[res1._written.length - 1];
    expect(last1).toContain("event: signal");
    expect(last1).toContain("BTCUSD");
  });

  it("filter restricts which events a client receives", () => {
    const signalOnly = mockResponse();
    const alertOnly = mockResponse();
    hub.signalStreamHub.addClient(signalOnly as any, ["signal"]);
    hub.signalStreamHub.addClient(alertOnly as any, ["alert"]);

    hub.publishSignal({ test: true });
    hub.publishAlert({ severity: "warning" });

    // signalOnly should get connected + signal but NOT alert
    const signalEvents = signalOnly._written.filter((w: string) => w.includes("event: signal"));
    const alertOnSignal = signalOnly._written.filter((w: string) => w.includes("event: alert"));
    expect(signalEvents.length).toBe(1);
    expect(alertOnSignal.length).toBe(0);

    // alertOnly should get connected + alert but NOT signal
    const alertEvents = alertOnly._written.filter((w: string) => w.includes("event: alert"));
    const signalOnAlert = alertOnly._written.filter((w: string) => w.includes("event: signal"));
    expect(alertEvents.length).toBe(1);
    expect(signalOnAlert.length).toBe(0);
  });

  it("removeClient closes and removes a specific client", () => {
    const res = mockResponse();
    const id = hub.signalStreamHub.addClient(res as any);
    hub.signalStreamHub.removeClient(id);
    expect(res.end).toHaveBeenCalled();

    // Publishing after removal should not write to the removed client
    const countBefore = res._written.length;
    hub.publishSignal({ after: true });
    expect(res._written.length).toBe(countBefore);
  });

  it("replay sends missed events after a given event ID", () => {
    const res = mockResponse();
    const id = hub.signalStreamHub.addClient(res as any);

    // Publish 3 events
    hub.publishEvent("signal", { n: 1 });
    hub.publishEvent("signal", { n: 2 });
    hub.publishEvent("alert", { n: 3 });

    // Get the ID of the first signal event
    const firstSignal = res._written.find((w: string) => w.includes('"n":1'));
    const idMatch = firstSignal?.match(/id: (evt-\d+-\d+)/);
    expect(idMatch).toBeTruthy();

    // Add a new client and replay from after first event
    const res2 = mockResponse();
    const id2 = hub.signalStreamHub.addClient(res2 as any);
    const countBefore = res2._written.length;
    hub.signalStreamHub.replay(id2, idMatch![1]);
    // Should have received the 2 events after the first one
    expect(res2._written.length).toBeGreaterThan(countBefore);
  });

  it("closeAll terminates all clients with goodbye event", () => {
    const res1 = mockResponse();
    const res2 = mockResponse();
    hub.signalStreamHub.addClient(res1 as any);
    hub.signalStreamHub.addClient(res2 as any);

    hub.signalStreamHub.closeAll();

    expect(res1.end).toHaveBeenCalled();
    expect(res2.end).toHaveBeenCalled();
    const hasGoodbye1 = res1._written.some((w: string) => w.includes("server_shutdown"));
    const hasGoodbye2 = res2._written.some((w: string) => w.includes("server_shutdown"));
    expect(hasGoodbye1).toBe(true);
    expect(hasGoodbye2).toBe(true);
  });

  it("broadcast() legacy maps to publish with correct event type", () => {
    const res = mockResponse();
    hub.signalStreamHub.addClient(res as any);

    hub.broadcast({ type: "si_decision", data: { symbol: "BTCUSD" } });
    const hasSignal = res._written.some((w: string) => w.includes("event: signal"));
    expect(hasSignal).toBe(true);

    hub.broadcast({ type: "alert", data: { msg: "test" } });
    const hasAlert = res._written.some((w: string) => w.includes("event: alert"));
    expect(hasAlert).toBe(true);
  });

  it("client disconnect auto-removes via close event", () => {
    const res = mockResponse();
    const id = hub.signalStreamHub.addClient(res as any);

    const statusBefore = hub.signalStreamHub.status();
    expect(statusBefore.clientCount).toBe(1);

    // Simulate client disconnect
    res._trigger("close");

    const statusAfter = hub.signalStreamHub.status();
    expect(statusAfter.clientCount).toBe(0);
  });

  it("status returns correct hub state", () => {
    const res1 = mockResponse();
    const res2 = mockResponse();
    hub.signalStreamHub.addClient(res1 as any, ["signal"]);
    hub.signalStreamHub.addClient(res2 as any);

    hub.publishEvent("signal", { test: true });

    const status = hub.signalStreamHub.status();
    expect(status.clientCount).toBe(2);
    expect(status.recentEventCount).toBeGreaterThanOrEqual(1);
    expect(status.clients).toHaveLength(2);
    expect(status.clients[0].filter).toEqual(["signal"]);
    expect(status.clients[1].filter).toBe("all");
  });
});
