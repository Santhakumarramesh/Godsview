import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the SignalStreamHub logic by importing the module
// and exercising publish, addClient, replay, closeAll.

// Mock a minimal Express Response for SSE testing
function mockResponse() {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let ended = false;
  const closeHandlers: Array<() => void> = [];

  return {
    setHeader(k: string, v: string) { headers[k] = v; },
    flushHeaders() {},
    write(chunk: string) { written.push(chunk); return true; },
    end() { ended = true; },
    on(event: string, handler: () => void) {
      if (event === "close") closeHandlers.push(handler);
    },
    flush() {},
    // Test helpers
    _written: written,
    _headers: headers,
    _ended: () => ended,
    _triggerClose() { closeHandlers.forEach((h) => h()); },
  };
}

describe("SignalStreamHub", () => {
  // We create a fresh hub for each test to avoid singleton state leakage
  // Import the class constructor indirectly via the module's singleton
  let hub: any;

  beforeEach(async () => {
    // Dynamic import to get a fresh module each test
    const mod = await import("../lib/signal_stream");
    hub = mod.signalHub;
    // Clear any existing clients from prior tests
    hub.closeAll();
    // Restart heartbeat (closeAll stops it)
    // We'll just test without heartbeat for unit tests
  });

  it("addClient registers SSE client and sends connection event", () => {
    const res = mockResponse();
    const id = hub.addClient(res as any);

    expect(id).toMatch(/^sse-/);
    expect(res._headers["Content-Type"]).toBe("text/event-stream");
    // Should have written a connection system event
    const joined = res._written.join("");
    expect(joined).toContain("connected");
    expect(hub.status().connectedClients).toBeGreaterThanOrEqual(1);
  });

  it("publish broadcasts to all connected clients", () => {
    const res1 = mockResponse();
    const res2 = mockResponse();
    hub.addClient(res1 as any);
    hub.addClient(res2 as any);

    hub.publish({
      type: "signal",
      timestamp: new Date().toISOString(),
      payload: { symbol: "BTCUSD", decision: "APPLY" },
    });

    // Both clients should have received the event
    expect(res1._written.join("")).toContain("BTCUSD");
    expect(res2._written.join("")).toContain("BTCUSD");
  });

  it("filter restricts which events a client receives", () => {
    const res = mockResponse();
    hub.addClient(res as any, ["alert"]);

    // Publish a signal event — should NOT reach this client
    hub.publish({
      type: "signal",
      timestamp: new Date().toISOString(),
      payload: { symbol: "ETHUSD" },
    });

    // Publish an alert event — SHOULD reach this client
    hub.publish({
      type: "alert",
      timestamp: new Date().toISOString(),
      payload: { message: "test alert" },
    });

    const joined = res._written.join("");
    expect(joined).not.toContain("ETHUSD");
    expect(joined).toContain("test alert");
  });

  it("removeClient closes connection and stops delivery", () => {
    const res = mockResponse();
    const id = hub.addClient(res as any);

    hub.removeClient(id);
    expect(res._ended()).toBe(true);
    expect(hub.status().connectedClients).toBe(0);
  });

  it("replay sends missed events after reconnect", () => {
    // Publish events before client connects
    hub.publish({ type: "signal", timestamp: new Date().toISOString(), payload: { n: 1 } });
    hub.publish({ type: "signal", timestamp: new Date().toISOString(), payload: { n: 2 } });
    hub.publish({ type: "alert", timestamp: new Date().toISOString(), payload: { n: 3 } });

    const afterId = hub.status().totalEventsPublished - 2; // miss last 2

    const res = mockResponse();
    const id = hub.addClient(res as any);
    hub.replay(id, afterId);

    const joined = res._written.join("");
    // Should have replayed the 2 missed events
    expect(joined).toContain('"n":2');
    expect(joined).toContain('"n":3');
  });

  it("closeAll terminates all clients and clears state", () => {
    const res1 = mockResponse();
    const res2 = mockResponse();
    hub.addClient(res1 as any);
    hub.addClient(res2 as any);

    hub.closeAll();

    expect(hub.status().connectedClients).toBe(0);
    expect(res1._ended()).toBe(true);
    expect(res2._ended()).toBe(true);
  });

  it("broadcast() legacy function maps to publish", async () => {
    const res = mockResponse();
    hub.addClient(res as any); // receives all types

    // Import the legacy broadcast function (ESM dynamic import)
    const { broadcast } = await import("../lib/signal_stream");
    broadcast({
      type: "si_decision",
      data: { symbol: "SYSTEM", setup_type: "alert", rejection_reason: "test" },
    });

    const joined = res._written.join("");
    expect(joined).toContain("SYSTEM");
    expect(joined).toContain("rejection_reason");
  });

  it("client disconnect via close event auto-removes", () => {
    const res = mockResponse();
    const id = hub.addClient(res as any);
    expect(hub.status().connectedClients).toBeGreaterThanOrEqual(1);

    // Simulate client disconnect
    res._triggerClose();
    expect(hub.status().clients.find((c: any) => c.id === id)).toBeUndefined();
  });

  it("status returns correct hub state", () => {
    const res = mockResponse();
    hub.addClient(res as any, ["signal"]);

    hub.publish({ type: "signal", timestamp: new Date().toISOString(), payload: { test: true } });

    const st = hub.status();
    expect(st.connectedClients).toBeGreaterThanOrEqual(1);
    expect(st.totalEventsPublished).toBeGreaterThanOrEqual(1);
    expect(st.recentBufferSize).toBeGreaterThanOrEqual(1);
    expect(st.clients[0]?.filter).toEqual(["signal"]);
  });
});
