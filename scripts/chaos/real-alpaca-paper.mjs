#!/usr/bin/env node
// P1-6: real-alpaca-paper chaos drill.
//
// Gates on a real paper-trading PK... key and actually submits a 1-share AAPL
// market order to Alpaca's paper endpoint. Polls /v2/orders/:id until terminal,
// asserts status==filled, captures slippage vs. the reference quote. Designed
// to be wired into `pnpm run verify:market:paper` in place of the current
// placeholder-key path.
//
// SAFETY
//   * Refuses to run unless ALPACA_API_KEY starts with "PK" (paper keys only).
//   * Hard-coded symbol=AAPL, qty=1, side=buy, type=market.
//   * Writes the full run envelope to artifacts/chaos/real-alpaca-paper/<ts>.json
//     so reviewers have an audit trail.
//
// USAGE
//   ALPACA_API_KEY=PK... ALPACA_SECRET_KEY=... node scripts/chaos/real-alpaca-paper.mjs

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..", "..");

const SYMBOL = "AAPL";
const QTY = 1;
const POLL_INTERVAL_MS = 1_000;
const POLL_DEADLINE_MS = 120_000;
const PAPER_BASE = "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

function fail(msg) {
  console.error(`real-alpaca-paper FAIL — ${msg}`);
  process.exit(1);
}

const apiKey = String(process.env.ALPACA_API_KEY ?? "").trim();
const secretKey = String(process.env.ALPACA_SECRET_KEY ?? "").trim();

if (!apiKey || !secretKey) fail("ALPACA_API_KEY and ALPACA_SECRET_KEY are required.");
if (!/^PK[A-Z0-9]{10,}$/.test(apiKey)) {
  fail(`ALPACA_API_KEY must be a paper key (starts with "PK"). Got "${apiKey.slice(0, 4)}…".`);
}

const tradingHeaders = {
  "APCA-API-KEY-ID": apiKey,
  "APCA-API-SECRET-KEY": secretKey,
  "Content-Type": "application/json",
};

async function alpacaGet(url) {
  const r = await fetch(url, { headers: tradingHeaders });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function alpacaPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: tradingHeaders,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TERMINAL = new Set([
  "filled",
  "cancelled",
  "canceled",
  "rejected",
  "expired",
  "done_for_day",
]);

const startedAt = Date.now();
const startedIso = new Date(startedAt).toISOString();
console.log(`real-alpaca-paper: submitting ${QTY}x ${SYMBOL} market buy (${startedIso})`);

let referenceQuote;
try {
  const quote = await alpacaGet(`${DATA_BASE}/v2/stocks/${SYMBOL}/quotes/latest`);
  referenceQuote = Number(quote?.quote?.ap ?? quote?.quote?.bp ?? 0) || null;
  console.log(`reference ask quote: ${referenceQuote}`);
} catch (err) {
  console.warn(`quote fetch failed (continuing without slippage ref): ${err.message}`);
  referenceQuote = null;
}

let submitted;
try {
  submitted = await alpacaPost(`${PAPER_BASE}/v2/orders`, {
    symbol: SYMBOL,
    qty: String(QTY),
    side: "buy",
    type: "market",
    time_in_force: "day",
  });
} catch (err) {
  fail(`order submit failed: ${err.message}`);
}
console.log(`submitted order id=${submitted.id}`);

let terminal;
const pollDeadline = Date.now() + POLL_DEADLINE_MS;
while (Date.now() < pollDeadline) {
  const order = await alpacaGet(`${PAPER_BASE}/v2/orders/${submitted.id}`);
  if (TERMINAL.has(String(order.status).toLowerCase())) {
    terminal = order;
    break;
  }
  await sleep(POLL_INTERVAL_MS);
}
if (!terminal) fail(`order did not reach terminal state within ${POLL_DEADLINE_MS}ms.`);

const fillPrice = Number(terminal.filled_avg_price ?? 0) || null;
const slippageBps =
  referenceQuote && fillPrice
    ? Number((((fillPrice - referenceQuote) / referenceQuote) * 10_000).toFixed(2))
    : null;

const envelope = {
  drill: "real-alpaca-paper",
  started_at: startedIso,
  duration_ms: Date.now() - startedAt,
  symbol: SYMBOL,
  qty: QTY,
  submitted_order_id: submitted.id,
  terminal_status: terminal.status,
  filled_qty: terminal.filled_qty,
  filled_avg_price: terminal.filled_avg_price,
  reference_quote: referenceQuote,
  slippage_bps: slippageBps,
  passed: String(terminal.status).toLowerCase() === "filled",
};

const outDir = path.join(repoRoot, "artifacts", "chaos", "real-alpaca-paper");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `${startedIso.replace(/[:.]/g, "-")}.json`);
await writeFile(outPath, JSON.stringify(envelope, null, 2));
console.log(`\nenvelope written to ${path.relative(repoRoot, outPath)}`);
console.log(JSON.stringify(envelope, null, 2));

if (!envelope.passed) fail(`terminal status was "${terminal.status}", expected "filled".`);
console.log("real-alpaca-paper PASS");
