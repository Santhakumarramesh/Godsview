import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function unauthorizedResponse() {
  return {
    ok: false,
    status: 401,
    text: async () => "<html><h1>401 Authorization Required</h1></html>",
    headers: new Headers(),
  };
}

function okResponse(json: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    headers: new Headers(),
  };
}

describe("alpaca auth cooldown", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubEnv("ALPACA_API_KEY", "PK_TEST_AUTH_COOLDOWN");
    vi.stubEnv("ALPACA_SECRET_KEY", "SECRET_TEST_AUTH_COOLDOWN");
    vi.stubEnv("ALPACA_AUTH_FAILURE_COOLDOWN_MS", "60000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("opens auth cooldown after 401 and fails fast for subsequent auth requests", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(unauthorizedResponse() as any);
    global.fetch = fetchMock as any;

    const alpaca = await import("../lib/alpaca");

    await expect(alpaca.getAccount()).rejects.toThrow(/Alpaca API 401/i);
    expect(alpaca.getAlpacaAuthFailureState().active).toBe(true);

    await expect(alpaca.getPositions()).rejects.toThrow(/cooldown/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows recovery after auth cooldown state reset", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorizedResponse() as any)
      .mockResolvedValueOnce(okResponse({ account_number: "paper-123" }) as any);

    global.fetch = fetchMock as any;

    const alpaca = await import("../lib/alpaca");

    await expect(alpaca.getAccount()).rejects.toThrow(/401/);
    expect(alpaca.getAlpacaAuthFailureState().active).toBe(true);

    alpaca._resetAlpacaAuthFailureStateForTests();
    const account = await alpaca.getAccount();

    expect(account).toEqual({ account_number: "paper-123" });
    expect(alpaca.getAlpacaAuthFailureState().active).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports key kind and trading-key validity from prefix", async () => {
    const alpaca = await import("../lib/alpaca");
    const creds = alpaca.getAlpacaCredentialStatus();

    expect(creds.keyConfigured).toBe(true);
    expect(creds.secretConfigured).toBe(true);
    expect(creds.keyKind).toBe("paper");
    expect(creds.hasValidTradingKey).toBe(true);
  });
});
