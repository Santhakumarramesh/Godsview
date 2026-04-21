#!/usr/bin/env tsx
/**
 * verify-alert-webhook.ts — Webhook Receiver Contract Test CLI
 *
 * Posts a synthetic alert payload in the exact shape the api-server
 * emits to a receiver URL and verifies the receiver accepts it.
 *
 * Primary use: after wiring a Slack or PagerDuty adapter from
 * `docs/ALERT_WEBHOOK_RECEIVERS.md`, run this to confirm the receiver
 * is reachable, is parsing the shape correctly, and is returning a
 * 2xx status. Unlike `POST /api/ops/test-alert`, this does not
 * require a running api-server and can be pointed at a local
 * development receiver.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify-alert-webhook -- \
 *     --url http://localhost:8787/webhook \
 *     --type daily_loss_breach \
 *     --severity fatal
 *
 * Exits 0 if the receiver returns a 2xx, 1 otherwise.
 */

interface Args {
  url: string;
  type: string;
  severity: string;
  message?: string;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[key] = val;
    }
  }

  if (!args.url) {
    console.error("Missing --url. Example:");
    console.error("  verify-alert-webhook --url http://localhost:8787/webhook");
    console.error("                       --type daily_loss_breach");
    console.error("                       --severity fatal");
    process.exit(2);
  }

  return {
    url: args.url,
    type: args.type ?? "test_alert",
    severity: args.severity ?? "warning",
    message: args.message,
    timeoutMs: args.timeout ? Number(args.timeout) : 10_000,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Build a payload that matches the shape documented in
  // docs/ALERT_CHANNEL_MAPPING.md and emitted by lib/alerts/webhook_dispatcher.ts.
  const payload = {
    type: args.type,
    severity: args.severity,
    message:
      args.message ??
      `Synthetic test alert from verify-alert-webhook CLI (type=${args.type}, severity=${args.severity})`,
    details: {
      source: "verify-alert-webhook",
      originatingHost: process.env.HOSTNAME ?? "local",
      runAt: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };

  console.log(`\x1b[36m→ POST\x1b[0m ${args.url}`);
  console.log(`  payload: ${JSON.stringify(payload, null, 2).replace(/\n/g, "\n  ")}`);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), args.timeoutMs);

  let res: Response;
  try {
    res = await fetch(args.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(t);
    console.error(
      `\x1b[31m✗ FAIL\x1b[0m request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
  clearTimeout(t);

  const text = await res.text().catch(() => "");
  const colour = res.ok ? "\x1b[32m" : "\x1b[31m";
  const verdict = res.ok ? "PASS" : "FAIL";

  console.log(
    `${colour}${res.ok ? "✓" : "✗"} ${verdict}\x1b[0m ${res.status} ${res.statusText}`
  );
  if (text) {
    const head = text.length > 400 ? text.slice(0, 400) + "… [truncated]" : text;
    console.log(`  body: ${head}`);
  }

  if (!res.ok) {
    console.error("\nReceiver returned a non-2xx status. Troubleshooting checklist:");
    console.error("  • Is the receiver listening on the configured port?");
    console.error("  • Does it accept application/json?");
    console.error("  • Does it return 2xx for well-formed payloads?");
    console.error("  • Check adapter logs for the payload the receiver saw.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(2);
});

// Make this file a module so its `main` symbol doesn't collide with the
// identically-named top-level functions in sibling scripts during
// project-wide type checking.
export {};
