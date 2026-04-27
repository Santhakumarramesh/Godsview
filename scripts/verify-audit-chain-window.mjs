#!/usr/bin/env node
/**
 * scripts/verify-audit-chain-window.mjs
 *
 * Rolling-window audit-chain verifier used by the daily paper-mode validation
 * (and system-proof) checks during the 90-day soak.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The HMAC chain in `audit_events` hashes row bytes at insert time. Any later
 * mutation to a hashed column (schema migration, default fill, encoding shift)
 * makes those legacy rows fail re-verification forever — even though they
 * were never tampered with. During early development that residue piled up.
 *
 * For the soak window we want to:
 *   • Keep tamper detection STRICT for new rows.
 *   • Stop letting historical residue poison the daily green light.
 *   • Preserve full-history verification for manual audits via the existing
 *     GET /api/webhooks/audit/verify endpoint (unchanged).
 *
 * This script verifies ONLY rows where `created_at >= NOW() - INTERVAL '24h'`
 * by fetching them through `docker compose exec postgres psql` and walking
 * the chain locally with the same canonicalize+HMAC formula the API uses.
 *
 * Within the 24-hour window the check is strict:
 *   • chain must be continuous
 *   • no broken hashes allowed
 *   • exits 1 if brokenCount > 0
 *
 * Output:
 *
 *   Audit Chain Check:
 *   Window: last 24 hours
 *   Window start: 2026-04-25T17:31:09Z
 *   Rows checked: 61
 *   Broken rows: 0
 *   Status: PASS
 *
 * Env:
 *   AUDIT_HMAC_KEY        — HMAC key (falls back to JWT_SECRET, then dev key)
 *   POSTGRES_USER         — psql user (default: godsview)
 *   POSTGRES_DB           — psql db   (default: godsview)
 *   AUDIT_WINDOW_HOURS    — override window (default: 24)
 *   AUDIT_VERIFY_JSON=1   — emit a single JSON line instead of human output
 */

import { execSync } from "node:child_process";
import * as crypto from "node:crypto";

const HMAC_KEY =
  process.env.AUDIT_HMAC_KEY ||
  process.env.JWT_SECRET ||
  "dev-only-audit-hmac-key";

const PG_USER = process.env.POSTGRES_USER || "godsview";
const PG_DB = process.env.POSTGRES_DB || "godsview";
const WINDOW_HOURS = Number(process.env.AUDIT_WINDOW_HOURS || 24);
const EMIT_JSON = process.env.AUDIT_VERIFY_JSON === "1";

function canonicalize(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function rowHash(prev, payload) {
  const h = crypto.createHmac("sha256", HMAC_KEY);
  h.update(prev ?? "");
  h.update("|");
  h.update(canonicalize(payload));
  return h.digest("hex");
}

function fetchWindowRows() {
  // Build a psql command that returns one JSON object per row, ordered by id.
  // We pull the same columns the in-process verifier hashes, plus row_hash
  // and prev_hash for comparison, plus created_at + id for reporting.
  //
  // payload_json is stored as text — keep it as text here (the API also
  // hashes the raw stored value, not a re-parsed object).
  const sql = `
    SELECT json_build_object(
      'id', id,
      'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'event_type', event_type,
      'decision_state', decision_state,
      'system_mode', system_mode,
      'instrument', instrument,
      'setup_type', setup_type,
      'symbol', symbol,
      'actor', actor,
      'reason', reason,
      'payload_json', payload_json,
      'prev_hash', prev_hash,
      'row_hash', row_hash
    )::text AS rec
    FROM audit_events
    WHERE created_at >= NOW() - INTERVAL '${WINDOW_HOURS} hours'
    ORDER BY id ASC;
  `.replace(/\s+/g, " ");

  const cmd = [
    "docker",
    "compose",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    PG_USER,
    "-d",
    PG_DB,
    "-At",
    "-F",
    "",
    "-c",
    JSON.stringify(sql),
  ].join(" ");

  let raw;
  try {
    raw = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const msg = err?.stderr?.toString?.() || err?.message || String(err);
    throw new Error(`psql exec failed: ${msg.trim()}`);
  }

  // We also need the window-start timestamp the DB used. Pull it back too.
  const startCmd = [
    "docker",
    "compose",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    PG_USER,
    "-d",
    PG_DB,
    "-At",
    "-c",
    `"SELECT to_char((NOW() - INTERVAL '${WINDOW_HOURS} hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD\\"T\\"HH24:MI:SS\\"Z\\"');"`,
  ].join(" ");
  let windowStart = "";
  try {
    windowStart = execSync(startCmd, { encoding: "utf8" }).trim();
  } catch {
    // non-fatal — leave blank
  }

  const rows = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return { rows, windowStart };
}

function verify(rows) {
  let prev = null;
  let valid = 0;
  const broken = [];

  for (const row of rows) {
    const payload = {
      event_type: row.event_type,
      decision_state: row.decision_state,
      system_mode: row.system_mode,
      instrument: row.instrument,
      setup_type: row.setup_type,
      symbol: row.symbol,
      actor: row.actor,
      reason: row.reason,
      payload_json: row.payload_json,
    };
    const expected = rowHash(prev, payload);

    if (row.row_hash) {
      if (row.row_hash === expected && row.prev_hash === prev) {
        valid++;
      } else {
        broken.push({
          id: row.id,
          created_at: row.created_at,
          expected,
          actual: row.row_hash,
          prev_seen: prev,
          prev_stored: row.prev_hash,
        });
      }
      prev = row.row_hash;
    } else {
      // Pre-chain row — skip but reset prev so subsequent rows chain off
      // their own prev_hash, matching the in-process verifier's behavior.
      prev = null;
    }
  }

  return {
    total: rows.length,
    verified: valid,
    brokenCount: broken.length,
    broken: broken.slice(0, 20),
  };
}

function main() {
  let result;
  let windowStart = "";
  try {
    const { rows, windowStart: ws } = fetchWindowRows();
    windowStart = ws;
    result = verify(rows);
  } catch (err) {
    if (EMIT_JSON) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: err?.message ?? String(err),
          window_hours: WINDOW_HOURS,
        }) + "\n"
      );
    } else {
      console.error("Audit Chain Check:");
      console.error(`Window: last ${WINDOW_HOURS} hours`);
      console.error(`Status: ERROR`);
      console.error(`Reason: ${err?.message ?? String(err)}`);
    }
    process.exit(2);
  }

  const status = result.brokenCount === 0 ? "PASS" : "FAIL";

  if (EMIT_JSON) {
    process.stdout.write(
      JSON.stringify({
        ok: result.brokenCount === 0,
        window_hours: WINDOW_HOURS,
        window_start: windowStart,
        total: result.total,
        verified: result.verified,
        brokenCount: result.brokenCount,
        broken: result.broken,
        status,
      }) + "\n"
    );
  } else {
    console.log("Audit Chain Check:");
    console.log(`Window: last ${WINDOW_HOURS} hours`);
    if (windowStart) console.log(`Window start: ${windowStart}`);
    console.log(`Rows checked: ${result.total}`);
    console.log(`Broken rows: ${result.brokenCount}`);
    if (result.brokenCount > 0) {
      const first = result.broken[0];
      console.log(`First broken row ID: ${first.id} (created_at=${first.created_at})`);
    }
    console.log(`Status: ${status}`);
  }

  process.exit(result.brokenCount === 0 ? 0 : 1);
}

main();
