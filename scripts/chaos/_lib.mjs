/**
 * Shared helpers for chaos drill scripts.
 * Pure Node fetch — no third-party deps.
 */

// Phase 113: chaos drills resolve their target base URL in this priority:
//   1. GODSVIEW_BASE  — full URL, matches scripts/soak/run-48h.sh and the
//                       runtime_config CORS default
//   2. PORT + HOST    — legacy override (used by older drill harnesses)
//   3. http://127.0.0.1:3000 — matches the default `pnpm start` port
const ENV_BASE = String(process.env.GODSVIEW_BASE ?? "").trim();
const PORT = process.env.PORT ?? "3000";
const HOST = process.env.HOST ?? "127.0.0.1";
export const BASE = ENV_BASE || `http://${HOST}:${PORT}`;

export async function gget(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

export async function gpost(path, payload = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

export function record(name, observations, passed) {
  const envelope = {
    drill: name,
    timestamp: new Date().toISOString(),
    base: BASE,
    passed,
    observations,
  };
  console.log(JSON.stringify(envelope, null, 2));
  if (!passed) process.exitCode = 1;
}

export async function waitForServer(maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await gget("/api/health");
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
