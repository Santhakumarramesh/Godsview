/**
 * Phase 3 — TradingView webhook validation & rejection paths
 *
 * Proves the ingestion layer rejects every category of bad payload BEFORE
 * any signal can reach the risk engine, paper trader, or dashboard. This
 * is the first line of defense against:
 *
 *   - Malicious actors guessing the webhook URL
 *   - Replayed/stale alerts from TradingView retries
 *   - Misconfigured Pine scripts emitting garbage
 *   - Duplicate alerts firing within the same bar
 *   - Unknown signal types that bypass strategy filters
 *
 * Each test exercises the REAL `SignalIngestion` class with the production
 * Zod schema and config. No mocks, no shortcuts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SignalIngestion } from "../../lib/tradingview_mcp/signal_ingestion.js";
import {
  MCPPipelineConfigSchema,
  type MCPPipelineConfig,
} from "../../lib/tradingview_mcp/types.js";

const PASSPHRASE = "test-secret-deadbeef";
const NOW_SEC = () => Math.floor(Date.now() / 1000);

function makeIngestion(): SignalIngestion {
  const config: MCPPipelineConfig = MCPPipelineConfigSchema.parse({
    webhookPassphrase: PASSPHRASE,
    maxSignalAgeSec: 60,
  });
  return new SignalIngestion(config);
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: "AAPL",
    signal: "vwap_reclaim",
    timeframe: "5m",
    price: 182.45,
    timestamp: NOW_SEC(),
    direction: "long",
    stop_loss: 181.2,
    take_profit: 184.95,
    strategy_name: "vwap_reclaim_v1",
    passphrase: PASSPHRASE,
    ...overrides,
  };
}

describe("TradingView webhook validation", () => {
  let ingestion: SignalIngestion;

  beforeEach(() => {
    ingestion = makeIngestion();
  });

  it("accepts a well-formed payload", () => {
    const sig = ingestion.ingestTradingView(validPayload());
    expect(sig).not.toBeNull();
    expect(sig?.symbol).toBe("AAPL");
    expect(sig?.signalType).toBe("vwap_reclaim");
    expect(sig?.direction).toBe("long");
    expect(sig?.source).toBe("tradingview");
    expect(sig?.status).toBe("received");
    expect(ingestion.getStats().totalAccepted).toBe(1);
    expect(ingestion.getStats().totalRejected).toBe(0);
  });

  it("rejects payload missing required fields", () => {
    const bad = { ...validPayload() } as any;
    delete bad.symbol;
    const sig = ingestion.ingestTradingView(bad);
    expect(sig).toBeNull();
    expect(ingestion.getStats().totalRejected).toBe(1);
  });

  it("rejects payload with wrong passphrase (auth fail)", () => {
    const sig = ingestion.ingestTradingView(validPayload({ passphrase: "wrong" }));
    expect(sig).toBeNull();
    const errs = ingestion.getStats().recentErrors;
    expect(errs.some((e) => /passphrase/i.test(e.error))).toBe(true);
  });

  it("rejects unknown signal type (not on whitelist)", () => {
    const sig = ingestion.ingestTradingView(validPayload({ signal: "rug_pull" }));
    expect(sig).toBeNull();
    expect(ingestion.getStats().totalRejected).toBe(1);
  });

  it("rejects unsupported timeframe", () => {
    const sig = ingestion.ingestTradingView(validPayload({ timeframe: "30s" }));
    expect(sig).toBeNull();
  });

  it("rejects negative or zero price", () => {
    expect(ingestion.ingestTradingView(validPayload({ price: 0 }))).toBeNull();
    expect(ingestion.ingestTradingView(validPayload({ price: -10 }))).toBeNull();
  });

  it("rejects stale alert older than maxSignalAgeSec", () => {
    const stale = validPayload({ timestamp: NOW_SEC() - 600 }); // 10 min old
    const sig = ingestion.ingestTradingView(stale);
    expect(sig).toBeNull();
    const errs = ingestion.getStats().recentErrors;
    expect(errs.some((e) => /too old/i.test(e.error))).toBe(true);
  });

  it("dedupes identical alerts within 60s window", () => {
    const p = validPayload();
    const first = ingestion.ingestTradingView(p);
    const second = ingestion.ingestTradingView(p);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(ingestion.getStats().recentErrors.some((e) => /Duplicate/i.test(e.error))).toBe(true);
  });

  it("does NOT dedupe different timeframes", () => {
    const a = ingestion.ingestTradingView(validPayload({ timeframe: "5m" }));
    const b = ingestion.ingestTradingView(validPayload({ timeframe: "15m" }));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it("emits 'signal' event for accepted signals", async () => {
    const seen: any[] = [];
    ingestion.on("signal", (s) => seen.push(s));
    ingestion.ingestTradingView(validPayload());
    expect(seen).toHaveLength(1);
    expect(seen[0].symbol).toBe("AAPL");
  });

  it("emits 'rejected' event for bad payloads", async () => {
    const reasons: string[] = [];
    ingestion.on("rejected", (reason: string) => reasons.push(reason));
    ingestion.ingestTradingView(validPayload({ passphrase: "nope" }));
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toMatch(/passphrase/i);
  });

  it("counts stats correctly across mixed traffic", () => {
    ingestion.ingestTradingView(validPayload({ symbol: "AAPL" }));
    ingestion.ingestTradingView(validPayload({ symbol: "TSLA" }));
    ingestion.ingestTradingView(validPayload({ symbol: "TSLA", passphrase: "wrong" }));
    ingestion.ingestTradingView(validPayload({ symbol: "SPY", signal: "fake_signal" }));

    const s = ingestion.getStats();
    expect(s.totalReceived).toBe(4);
    expect(s.totalAccepted).toBe(2);
    expect(s.totalRejected).toBe(2);
    expect(s.bySymbol["AAPL"]).toBe(1);
    expect(s.bySymbol["TSLA"]).toBe(1); // only the accepted one
  });
});

describe("TradingView webhook — production safety guarantees", () => {
  it("does not allow passphrase bypass via empty string", () => {
    const ing = makeIngestion();
    const sig = ing.ingestTradingView(validPayload({ passphrase: "" }));
    expect(sig).toBeNull();
  });

  it("does not allow passphrase bypass via missing field", () => {
    const ing = makeIngestion();
    const p = validPayload();
    delete (p as any).passphrase;
    const sig = ing.ingestTradingView(p);
    expect(sig).toBeNull();
  });

  it("isolates signal IDs (each accepted signal has unique id)", () => {
    const ing = makeIngestion();
    const a = ing.ingestTradingView(validPayload({ symbol: "AAPL" }));
    const b = ing.ingestTradingView(validPayload({ symbol: "TSLA" }));
    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
  });

  it("preserves the raw payload for forensic audit", () => {
    const ing = makeIngestion();
    const raw = validPayload({ meta: { audit_trace: "xyz-123" } });
    const sig = ing.ingestTradingView(raw);
    expect(sig?.rawPayload).toEqual(raw);
  });
});
