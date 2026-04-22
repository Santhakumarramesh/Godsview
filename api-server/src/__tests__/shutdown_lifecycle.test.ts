import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    })),
  },
}));

vi.mock("../lib/runtime_config", () => ({
  runtimeConfig: {
    shutdownTimeoutMs: 1000,
  },
}));

describe("shutdown lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers process handlers only once even when setup is called multiple times", async () => {
    const onSpy = vi.spyOn(process, "on").mockImplementation(((..._args: unknown[]) => process) as typeof process.on);
    const shutdown = await import("../lib/shutdown");
    const server = { close: vi.fn((cb?: () => void) => cb?.()) } as unknown as import("node:http").Server;

    shutdown.setupGracefulShutdown(server);
    shutdown.setupGracefulShutdown(server);

    const registeredSignals = onSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((name) => ["SIGTERM", "SIGINT", "uncaughtException", "unhandledRejection"].includes(name));
    expect(registeredSignals).toHaveLength(4);

    onSpy.mockRestore();
  });
});
