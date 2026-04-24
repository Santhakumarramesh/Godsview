import { Router } from "express";
import crypto from "crypto";

const router = Router();

// ── Plan definitions ────────────────────────────────────────────────────
const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    interval: "month",
    features: [
      "Market scanner (delayed 15min)",
      "5 watchlist symbols",
      "Daily briefing",
      "Community access",
    ],
    limits: { apiCallsPerDay: 100, symbols: 5, signals: 0 },
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    interval: "month",
    features: [
      "Real-time market data",
      "50 watchlist symbols",
      "Full signal pipeline",
      "Paper trading",
      "Backtesting (10 runs/day)",
      "Trade journal",
      "Email alerts",
    ],
    limits: { apiCallsPerDay: 5000, symbols: 50, signals: 50 },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 299,
    interval: "month",
    features: [
      "Everything in Pro",
      "Unlimited symbols",
      "Live trading modes",
      "Autonomous candidate mode",
      "Unlimited backtesting",
      "API access",
      "Priority support",
      "Custom strategies",
      "Webhook integrations",
    ],
    limits: { apiCallsPerDay: 100000, symbols: -1, signals: -1 },
  },
];

// ── In-memory usage tracking ────────────────────────────────────────────
const usageStore = new Map<
  string,
  { apiCalls: number; signalsConsumed: number; backtestRuns: number; date: string }
>();
const apiKeyStore = new Map<
  string,
  { key: string; userId: string; plan: string; createdAt: string; active: boolean }
>();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getUsage(userId: string) {
  const today = todayStr();
  let usage = usageStore.get(userId);
  if (!usage || usage.date !== today) {
    usage = { apiCalls: 0, signalsConsumed: 0, backtestRuns: 0, date: today };
    usageStore.set(userId, usage);
  }
  return usage;
}

// ── Routes ──────────────────────────────────────────────────────────────

/** GET /plans — List available plans */
router.get("/plans", (_req, res) => {
  res.json({ plans: PLANS });
});

/** GET /usage — Get usage for a user */
router.get("/usage", (req, res) => {
  const userId = (req.query.userId as string) || "default";
  const usage = getUsage(userId);
  res.json({ userId, ...usage });
});

/** GET /api-keys — List API keys */
router.get("/api-keys", (req, res) => {
  const userId = (req.query.userId as string) || "default";
  const keys = Array.from(apiKeyStore.values()).filter((k) => k.userId === userId);
  res.json({
    keys: keys.map((k) => ({
      ...k,
      key: k.key.slice(0, 8) + "..." + k.key.slice(-4),
    })),
  });
});

/** POST /api-keys — Generate new API key */
router.post("/api-keys", (req, res) => {
  const { userId, plan } = req.body || {};
  const uid = userId || "default";
  const apiKey = `gv_${crypto.randomBytes(24).toString("hex")}`;
  const record = {
    key: apiKey,
    userId: uid,
    plan: plan || "free",
    createdAt: new Date().toISOString(),
    active: true,
  };
  apiKeyStore.set(apiKey, record);
  res.json({ apiKey, message: "Store this key securely — it won't be shown again" });
});

/** GET /signals/public — Public signal feed (limited for free tier) */
router.get("/signals/public", (_req, res) => {
  res.json({
    signals: [
      {
        symbol: "BTCUSD",
        direction: "long",
        confidence: 0.72,
        timeframe: "1h",
        timestamp: new Date().toISOString(),
        delayed: true,
      },
    ],
    note: "Free tier signals are delayed 15 minutes. Upgrade to Pro for real-time.",
  });
});

/** GET /billing — Billing summary */
router.get("/billing", (req, res) => {
  const userId = (req.query.userId as string) || "default";
  res.json({
    userId,
    currentPlan: "free",
    billingCycle: "monthly",
    nextBillingDate: null,
    paymentMethod: null,
    invoices: [],
    note: "Stripe integration pending — contact support for enterprise billing",
  });
});

export default router;
