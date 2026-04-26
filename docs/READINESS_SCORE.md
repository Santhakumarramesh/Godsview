# GodsView — Honest Production Readiness Score

**Date:** 2026-04-26
**Updated for:** VC presentation tier

> Nothing in this file is rated 100% unless `bash scripts/vc-proof-run.sh`
> exits 0 on the user's machine. Typecheck passing isn't enough — the proof
> script must run end-to-end against a live local stack.

---

## Honest tiered scores

The lower bound is what's true today, in this session, without anyone running
Docker. The upper bound is what is plausible to hit on first try when the proof
script is run, given that all code typechecks and tests are written.

| Tier | Range | What gates the upper bound |
|---|---|---|
| **VC prototype readiness** | 78 – 90% | `vc-proof-run.sh` exits 0 |
| **Local real-system readiness** | 70 – 85% | docker compose up, migrations applied, dashboard `/vc-mode` shows real data |
| **Paper trading readiness** | 70 – 82% | 7-day uninterrupted paper run with daily P&L review |
| **Assisted-live readiness** | 55 – 70% | Real broker quote feed wired into slippage gate; tested against Alpaca paper account |
| **Paid-user SaaS readiness** | 25 – 35% | Multi-tenant data isolation, per-user secrets, billing, RBAC on every route, GDPR posture |
| **Real-money autonomous readiness** | 18 – 25% | 90+ days of paper P&L, broker-side caps, on-call, DR test, legal sign-off |

## What is now real

| Capability | Backing | Verifiable how |
|---|---|---|
| TradingView webhook → signal → risk → paper trade → DB → audit chain | `routes/vc_pipeline.ts` writes 4 DB rows per request | `bash scripts/vc-proof-run.sh` |
| Single proof endpoint returning every artifact | `POST /api/webhooks/tradingview` returns ID for signal/trade/brain/audit | check the envelope JSON |
| System status endpoint with no fallbacks | `GET /api/system/status` returns DB/Redis probes + last webhook/trade/rejection + brain count + strategies + backtest summary | `curl http://localhost:3001/api/system/status` |
| Brain entity detail endpoint | `GET /api/brain/entity/:symbol` joins entity + latest signal + latest trade + latest audit + memory count | click a node on the hologram |
| Mode badge on every dashboard page | `components/ModeBadge.tsx` polls /api/system/status and shows PAPER / ASSISTED / OFFLINE pill | always visible top-right |
| `/vc-mode` page backed by real APIs | 9 tiles, every one polls a real endpoint, no static text | open `http://localhost/vc-mode` |
| Risk engine that actually rejects | 5 distinct rejection paths (stale, missing SL/TP, stop-side, R:R, exposure) | `vc-proof-run.sh` step 8 |
| Brain hologram with explicit MOCK banner | already done in prior phase | open `/brain-hologram` and unplug DB |
| Brain page (`/brain`) MOCK banner | added this session | open `/brain` with empty DB |
| Reproducible backtest across 4 regimes | `scripts/backtest_regimes.mjs`, deterministic | `node scripts/backtest_regimes.mjs` twice → identical metrics |
| Audit log persistence | `audit_events` table, 1 row per pipeline run | `SELECT * FROM audit_events ORDER BY id DESC LIMIT 5;` |
| Approval queue API | `/api/assisted-live/*` (POST /proposals, /approve, /reject, /execute with safety gates) | `curl` flow |

## What was removed or labeled mock/dev-only

| File | Action |
|---|---|
| `pages/brain-hologram.tsx` | First-paint mock removed; explicit MOCK banner if backend offline |
| `pages/brain.tsx` | Added MOCK banner when `brain_entities` or `consciousness` are empty |
| `pages/dom-depth.tsx`, `pages/heatmap-liquidity.tsx`, `pages/correlation-lab.tsx` | Documented in `REAL_SYSTEM_AUDIT.md` § B as silent-fallback pages — banner work pending |
| `components/bookmap-heatmap.tsx`, `components/brain-floating-panel.tsx` | Documented in audit § B/C as decorative `Math.random()` — flagged for replacement before paid users |
| Any "100% production ready" claim | Removed; replaced with explicit ranges and gating conditions |

## Exact command to run the VC proof

```bash
cd ~/Documents/"Playground 2"/Godsview/Godsview
rm -f .git/index.lock
git add -A && git commit -m "feat: VC-ready prototype — real flow, no mock theater" && git push

# Boot + proof in one shot
bash scripts/vc-proof-run.sh
```

Expected final output (terse summary):

```
GodsView VC Proof Run — Summary

API:                  PASS
DB:                   PASS
Redis:                PASS
TradingView Webhook:  PASS
Signal Created:       PASS
Risk Engine:          PASS
Paper Trade Created:  PASS
God Brain Updated:    PASS
Audit Log Created:    PASS
Backtest Proof:       PASS

Dashboard URL:        http://localhost
VC Mode URL:          http://localhost/vc-mode
API Docs:             http://localhost:3001/docs/openapi.json
```

If anything FAILs, check `/tmp/vc_*.log` for details.

## Exact VC presentation flow (script you read on stage)

1. **Open `/vc-mode`** — point at the API/DB/Redis pills. Live, green.
2. **Show the mode badge** in the corner — "PAPER MODE". Set expectations.
3. **POST a TradingView alert** from your terminal:
   ```bash
   bash scripts/test-tradingview-webhook.sh
   ```
4. **Watch the VC mode tiles update**: last webhook, last signal (DB row #), last paper trade (DB row #), audit log row.
5. **Open `/brain-hologram`** — show the AAPL node now lit up.
6. **Click the node** — show the panel with the real signal reason, risk decision, paper trade ID, audit ID.
7. **Show the rejection path** by sending a bad-R:R alert:
   ```bash
   curl -X POST http://localhost:3001/api/webhooks/tradingview \
     -H "Content-Type: application/json" \
     -d '{"symbol":"BADRR","signal":"vwap_reclaim","timeframe":"5m","price":100,"timestamp":'"$(date +%s)"',"direction":"long","stop_loss":95,"take_profit":102}'
   ```
   The "Last Risk Rejection" tile updates with reason `R:R 0.40 < 1.0`.
8. **Show the backtest tile** — 4 regimes, real Sharpe / PF numbers, including the strategy losing money in chop. "We don't fake numbers."
9. **Show the audit log tile** — 4 rows already, every one with a decision_state (allowed/rejected) and a reason.
10. **Close on the readiness ladder**: "We're at PAPER tier. Real-money tier requires 90 days of P&L proof and broker-side caps. We don't shortcut that."

## Remaining blockers before real-money trading

These are the gates from `PRODUCTION_READINESS_CHECKLIST.md` § 14, restated:

1. **90+ days of paper P&L** on the strategy actually being deployed (not the SMA-cross demo).
2. **Backtest of the production strategy** across regimes (not just the demo).
3. **Broker-side position cap** on Alpaca / IBKR (not just app-side).
4. **Daily-loss kill switch** at the broker level.
5. **On-call rotation** with PagerDuty wired to monitoring.
6. **Independent risk-engine review** with human sign-off.
7. **DR test** — DB snapshot restore, full failover.
8. **Insurance / capital-loss policy**.
9. **Broker compliance review**.
10. **Legal review** of the autonomous-execution disclosure.

None of these are coding problems. They're operational and business problems
that take calendar time. That's the honest answer to "when can we go live?"

## What's left to do today (small)

- Run `bash scripts/vc-proof-run.sh` on your machine. Capture the output.
- If anything FAILs, fix it before the VC meeting.
- If everything PASSes, take a screenshot of the summary block and put it in
  `docs/vc/proof_run_<DATE>.txt`. That's the artifact for the VC.
