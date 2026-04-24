import { Router } from "express";
import { tradingSafety } from "../lib/trading_safety";

const router = Router();

/** GET /status — Full safety engine status */
router.get("/status", (_req, res) => {
  res.json(tradingSafety.getStatus());
});

/** POST /kill-switch — Toggle kill switch */
router.post("/kill-switch", (req, res) => {
  const { action, reason } = req.body || {};
  if (action === "activate") {
    tradingSafety.activateKillSwitch(reason || "Manual activation");
    res.json({ status: "activated", reason });
  } else if (action === "deactivate") {
    tradingSafety.deactivateKillSwitch();
    res.json({ status: "deactivated" });
  } else {
    res.status(400).json({ error: "action must be 'activate' or 'deactivate'" });
  }
});

/** GET /pre-check — Pre-trade safety check */
router.get("/pre-check", (req, res) => {
  const symbol = (req.query.symbol as string) || "BTCUSD";
  const side = (req.query.side as string) || "long";
  const quantity = parseFloat((req.query.quantity as string) || "1");
  const price = parseFloat((req.query.price as string) || "50000");
  const strategy = (req.query.strategy as string) || "default";

  const result = tradingSafety.preTradeCheck({
    symbol,
    side: side as "long" | "short",
    quantity,
    price,
    strategy,
  });
  res.json(result);
});

/** POST /record-loss — Record a loss event */
router.post("/record-loss", (req, res): void => {
  const { amount } = req.body || {};
  if (typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  tradingSafety.recordLoss(amount);
  res.json({ recorded: true, status: tradingSafety.getStatus() });
});

/** POST /record-trade — Record a trade outcome */
router.post("/record-trade", (req, res): void => {
  const { pnl } = req.body || {};
  if (typeof pnl !== "number") {
    res.status(400).json({ error: "pnl must be a number" });
    return;
  }
  tradingSafety.recordTrade(pnl);
  res.json({ recorded: true, status: tradingSafety.getStatus() });
});

/** GET /live-allowed — Quick check if live trading is permitted */
router.get("/live-allowed", (_req, res) => {
  res.json({
    allowed: tradingSafety.isLiveAllowed(),
    killSwitch: tradingSafety.getStatus().killSwitch,
    paperOnly: tradingSafety.getStatus().paperOnly,
  });
});

/** POST /reset-daily — Reset daily stats (for new trading day) */
router.post("/reset-daily", (_req, res) => {
  tradingSafety.resetDaily();
  res.json({ reset: true, status: tradingSafety.getStatus() });
});

export default router;
