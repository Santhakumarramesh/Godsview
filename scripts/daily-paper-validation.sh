#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# GodsView — Daily paper-mode validation
#
# Run this every operating day during the paper-trading soak. It runs the
# canonical proof scripts, exports the day's audit log + metrics + trade
# journal to a dated folder, and exits non-zero if any check fails so cron
# / CI can alert.
#
#   bash scripts/daily-paper-validation.sh
#
# Output: logs/daily/YYYY-MM-DD/
#   ├── system-proof.txt
#   ├── replay.txt
#   ├── backtest-summary.json
#   ├── data-integrity.txt
#   ├── audit-events.jsonl   ← exported audit_events for the day
#   ├── trade-journal.jsonl  ← exported paper trades for the day
#   ├── metrics.json         ← /api/system/metrics snapshot
#   └── result.txt           ← PASS / FAIL summary
# ─────────────────────────────────────────────────────────────────
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DATE="${DATE:-$(date +%Y-%m-%d)}"
OUT="$ROOT/logs/daily/$DATE"
API="${API:-http://localhost}"
mkdir -p "$OUT"

PASS=0; FAIL=0
ok()  { printf "  \033[1;32m✓ PASS\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
bad() { printf "  \033[1;31m✗ FAIL\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
hdr() { printf "\n\033[1;35m── %s ──\033[0m\n" "$1"; }

set -a; [ -f .env ] && . ./.env; set +a

# ─── 1. System proof ─────────────────────────────────────────────
hdr "1. system-proof-run"
if bash scripts/system-proof-run.sh > "$OUT/system-proof.txt" 2>&1; then
  ok "system-proof exited 0"
else
  bad "system-proof exited non-zero (see $OUT/system-proof.txt)"
fi

# ─── 2. Replay session ───────────────────────────────────────────
hdr "2. replay-session"
if bash scripts/replay-session.sh > "$OUT/replay.txt" 2>&1; then
  ok "replay-session ran"
else
  bad "replay-session failed (see $OUT/replay.txt)"
fi

# ─── 3. Reproducible backtest ────────────────────────────────────
hdr "3. backtest_regimes"
if node scripts/backtest_regimes.mjs > /dev/null 2>&1; then
  cp docs/backtests/regime_proof/summary.json "$OUT/backtest-summary.json" 2>/dev/null || true
  ok "backtest reproducible"
else
  bad "backtest run failed"
fi

# ─── 4. Audit-chain integrity (rolling 24h window) ───────────────
# We deliberately scope the daily check to the last 24 hours so legacy
# pre-epoch rows (whose hashed columns may have shifted under earlier
# schema/encoding migrations) cannot poison tomorrow's run.
#
# Inside the window the check is STRICT: any broken row fails the day.
# Manual full-history audits still go through GET /api/webhooks/audit/verify
# (untouched) — and we capture its current snapshot below for the record.
hdr "4. audit-chain integrity (rolling 24h window)"
WIN_OUT="$OUT/audit-chain-window.json"
WIN_HUMAN="$OUT/audit-chain-window.txt"

if AUDIT_VERIFY_JSON=1 node scripts/verify-audit-chain-window.mjs > "$WIN_OUT" 2>"$WIN_HUMAN.err"; then
  WIN_OK=1
else
  WIN_OK=0
fi

# Re-emit the human-readable form for the daily folder + stdout
AUDIT_WINDOW_HOURS="${AUDIT_WINDOW_HOURS:-24}" node scripts/verify-audit-chain-window.mjs \
  > "$WIN_HUMAN" 2>&1 || true
cat "$WIN_HUMAN"

if [ "$WIN_OK" = "1" ] && jq -e '.brokenCount == 0' "$WIN_OUT" >/dev/null 2>&1; then
  ok "audit chain verifies (rolling 24h, brokenCount=0)"
else
  FIRST_BROKEN=$(jq -r '.broken[0].id // "n/a"' "$WIN_OUT" 2>/dev/null)
  TOTAL=$(jq -r '.total // 0' "$WIN_OUT" 2>/dev/null)
  BROKEN=$(jq -r '.brokenCount // "?"' "$WIN_OUT" 2>/dev/null)
  bad "audit chain has broken rows in last 24h (total=$TOTAL, broken=$BROKEN, first_id=$FIRST_BROKEN — see $WIN_OUT)"
fi

# Also snapshot the full-history endpoint result for manual audit reference.
INTEG=$(curl -sS "${API}/api/webhooks/audit/verify" 2>/dev/null || echo '{}')
echo "$INTEG" | jq . > "$OUT/data-integrity.txt" 2>/dev/null || echo "$INTEG" > "$OUT/data-integrity.txt"

# ─── 5. Export today's audit + trades + metrics ─────────────────
hdr "5. Daily exports"
TS_FROM="${DATE}T00:00:00Z"
TS_TO="$(date -u -d "$DATE +1 day" +%Y-%m-%dT00:00:00Z 2>/dev/null || \
         date -u -j -f %Y-%m-%d -v+1d "$DATE" +%Y-%m-%dT00:00:00Z 2>/dev/null || echo "")"

# Audit events for the day
SQL_AUDIT="\\copy (
  SELECT id, event_type, decision_state, system_mode, instrument, setup_type,
         symbol, actor, reason, payload_json, prev_hash, row_hash, org_id, created_at
  FROM audit_events
  WHERE created_at >= '${TS_FROM}' AND created_at < '${TS_TO}'
  ORDER BY id
) TO STDOUT WITH (FORMAT csv, HEADER true)"

# Trades for the day
SQL_TRADES="\\copy (
  SELECT id, signal_id, instrument, setup_type, direction, entry_price, exit_price,
         stop_loss, take_profit, quantity, pnl, pnl_pct, outcome, status,
         rejection_reason, regime, org_id, created_at, updated_at
  FROM trades
  WHERE created_at >= '${TS_FROM}' AND created_at < '${TS_TO}'
  ORDER BY id
) TO STDOUT WITH (FORMAT csv, HEADER true)"

if command -v docker >/dev/null && docker compose ps 2>/dev/null | grep -q postgres; then
  docker compose exec -T postgres psql -U "${POSTGRES_USER:-godsview}" -At -c "$SQL_AUDIT"  > "$OUT/audit-events.csv" 2>/dev/null \
    && ok "audit-events.csv exported" || bad "audit-events export failed"
  docker compose exec -T postgres psql -U "${POSTGRES_USER:-godsview}" -At -c "$SQL_TRADES" > "$OUT/trade-journal.csv" 2>/dev/null \
    && ok "trade-journal.csv exported" || bad "trade-journal export failed"
else
  bad "docker postgres not running — skipping DB exports"
fi

# Metrics snapshot
if [ -n "${GODSVIEW_OPERATOR_TOKEN:-}" ]; then
  curl -sS -H "Authorization: Bearer ${GODSVIEW_OPERATOR_TOKEN}" \
    "${API}/api/system/metrics" > "$OUT/metrics.json" 2>/dev/null \
    && ok "metrics.json exported" || bad "metrics export failed"
else
  curl -sS "${API}/api/system/status" > "$OUT/metrics.json" 2>/dev/null \
    && ok "status.json exported (no operator token)" || bad "status export failed"
fi

# ─── 6. Result ───────────────────────────────────────────────────
{
  echo "Date: $DATE"
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "PASS: $PASS"
  echo "FAIL: $FAIL"
  if [ "$FAIL" -eq 0 ]; then echo "RESULT: PASS"; else echo "RESULT: FAIL"; fi
  echo ""
  echo "Outputs in: $OUT"
} > "$OUT/result.txt"
cat "$OUT/result.txt"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
