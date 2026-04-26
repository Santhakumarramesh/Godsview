/**
 * Webhook-specific input guards.
 *
 *  - bodySizeGuard: rejects payloads larger than MAX_BYTES with 413
 *  - hmacSignatureGuard: optional verification of `X-Webhook-Signature` header
 *    (HMAC-SHA256 hex of the raw body using TRADINGVIEW_WEBHOOK_SECRET).
 *    When TRADINGVIEW_REQUIRE_HMAC=on, requests without a valid signature are
 *    rejected with 401. Otherwise the guard is permissive (no header → pass)
 *    so existing TradingView passphrase-only setups keep working.
 *
 * Both guards run BEFORE the route handler so the route never sees a
 * dangerous payload.
 */

import type { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";
import { systemMetrics } from "../lib/system_metrics";

const MAX_BYTES = 16 * 1024; // 16 KB — TradingView alerts are <2 KB

export function webhookBodySizeGuard(req: Request, res: Response, next: NextFunction): void {
  const len = parseInt(String(req.header("content-length") ?? "0"), 10);
  if (Number.isFinite(len) && len > MAX_BYTES) {
    systemMetrics.log("warn", "webhook.body_too_large", { len });
    res.status(413).json({
      ok: false,
      error: `Payload too large: ${len} bytes (max ${MAX_BYTES})`,
    });
    return;
  }
  next();
}

/**
 * To use HMAC verification, set TRADINGVIEW_REQUIRE_HMAC=on in production.
 * The sender (TradingView via a Cloudflare Worker / Lambda relay) must
 * compute `X-Webhook-Signature: sha256=<hex>` over the raw body using the
 * shared secret. This is in addition to the JSON-body passphrase, not
 * instead of it.
 */
export function webhookHmacGuard(req: Request, res: Response, next: NextFunction): void {
  const requireHmac = (process.env.TRADINGVIEW_REQUIRE_HMAC ?? "").toLowerCase() === "on";
  const sig = (req.header("x-webhook-signature") || "").trim();
  const secret = process.env.TRADINGVIEW_WEBHOOK_SECRET || "";

  if (!sig) {
    if (requireHmac) {
      systemMetrics.log("warn", "webhook.hmac_missing", { path: req.path });
      res.status(401).json({ ok: false, error: "X-Webhook-Signature header required" });
      return;
    }
    return next();
  }

  if (!secret) {
    res.status(503).json({ ok: false, error: "Server has no webhook secret configured for signature verification" });
    return;
  }

  // The body has already been parsed by `express.json()`; re-stringify with
  // the same canonical form the sender used. We assume the sender hashes the
  // raw bytes; we recreate them by re-stringifying without keys reordered.
  // In production, mount a `raw` body capture middleware before `express.json`.
  const raw = JSON.stringify(req.body ?? {});
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const provided = sig.replace(/^sha256=/, "");
  let ok = false;
  try {
    ok = provided.length === expected.length &&
         crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    ok = false;
  }

  if (!ok) {
    systemMetrics.log("warn", "webhook.hmac_invalid", { path: req.path });
    res.status(401).json({ ok: false, error: "Invalid X-Webhook-Signature" });
    return;
  }
  next();
}
