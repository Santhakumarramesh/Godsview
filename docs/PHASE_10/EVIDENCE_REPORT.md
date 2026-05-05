# Phase 10 — Final Evidence Report

This document is **a template and an extraction recipe**. It is not
the report. The actual evidence report is the file the operator
produces by running the documented commands against the live system
and pasting the outputs into the marked placeholders.

This is intentional. The document author (whoever wrote this template)
does not have access to the running system and therefore cannot
fabricate numbers. Every value in the final report MUST be sourced
from a documented command run against the operator's own deployment.
Anywhere a value would otherwise appear, this template uses
`<<PLACEHOLDER:source_command_id>>` so the link from datum to source
is explicit.

The template enforces the Phase 1 no-fabrication rule: if a number
isn't backed by a command output saved to the evidence directory, it
doesn't go in the report.

## How to use this document

1. Read sections A–C below.
2. Run the extraction commands in section A. Each writes a JSON or
   text file to `/data/evidence/<DATE>/`. Total runtime: ~2 minutes.
3. Copy this file to `/data/evidence/<DATE>/REPORT.md`.
4. For each `<<PLACEHOLDER:source_command_id>>` in sections B-G, open
   the corresponding extracted file and paste the value in.
5. Read the final report top-to-bottom. Confirm every number is
   defensible (you can name the source file).
6. Sign and date the cover sheet.

When the report is complete and signed, archive the entire
`/data/evidence/<DATE>/` directory to S3 or equivalent. That archive
IS the evidence package — the report alone is not.

---

## Section A — Data extraction commands

Run all of these from the EC2 host as the `ubuntu` user. Each block
writes one file to `/data/evidence/<DATE>/`. The `EVDIR` variable is
set once at the top.

```bash
DATE=$(date -u +%F)
EVDIR=/data/evidence/${DATE}
mkdir -p "${EVDIR}"
TOK=$(grep ^GODSVIEW_OPERATOR_TOKEN /opt/godsview/.env | cut -d= -f2)
COMPOSE='docker compose -f /opt/godsview/docker-compose.minimal.yml'

echo "Writing evidence to ${EVDIR}"
```

### A.1 Trade data — full executed + rejected sets

```bash
# A.1.a — every executed trade (open + closed)
curl -fsS "http://localhost/api/proof/trades?limit=10000" \
  > "${EVDIR}/trades_executed.json"

# A.1.b — every rejected attempt (from execution_audit)
curl -fsS "http://localhost/api/proof/trades?status=rejected&limit=10000" \
  > "${EVDIR}/trades_rejected.json"

# A.1.c — CSV export for spreadsheet review
curl -fsS "http://localhost/api/proof/trades.csv?limit=10000" \
  > "${EVDIR}/trades.csv"
```

### A.2 Computed metrics (already computed by the system)

```bash
# A.2.a — Phase 4 metrics object (win rate, avg R, drawdown, profit factor, etc.)
curl -fsS "http://localhost/api/proof/metrics" \
  > "${EVDIR}/metrics.json"

# A.2.b — Phase 6 ops counters (requests, executions, rejections, recon runs)
curl -fsS "http://localhost/api/ops/metrics" \
  > "${EVDIR}/ops_metrics.json"
```

### A.3 Equity curve

```bash
# A.3 — raw time-series; one point per closed trade; no smoothing
curl -fsS "http://localhost/api/proof/equity" \
  > "${EVDIR}/equity.json"
```

### A.4 Integrity check

```bash
# A.4 — current integrity report (no fabricated values)
curl -fsS "http://localhost/api/proof/integrity" \
  > "${EVDIR}/integrity.json"
```

### A.5 Reconciliation status

```bash
# A.5.a — last run summary for both background jobs
curl -fsS "http://localhost/api/proof/reconciliation/status" \
  > "${EVDIR}/reconciliation_status.json"

# A.5.b — total reconciliation runs since process start (sourced from Phase 6 counter)
curl -fsS "http://localhost/api/ops/metrics" | jq '.counters.reconciliation_runs' \
  > "${EVDIR}/reconciliation_runs_count.txt"
```

### A.6 Health, readiness, mode

```bash
# A.6.a — current Phase 6 health snapshot
curl -fsS "http://localhost/api/health/phase6" \
  > "${EVDIR}/health_phase6.json"

# A.6.b — current Phase 6 readiness snapshot
curl -fsS "http://localhost/api/ready/phase6" \
  > "${EVDIR}/ready_phase6.json"

# A.6.c — system mode at evidence-extraction time
curl -fsS "http://localhost/api/system/diagnostics" | jq '{system_mode}' \
  > "${EVDIR}/system_mode.json"
```

### A.7 Reliability data — uptime, restarts, container state

```bash
# A.7.a — container uptime + restart count
for c in $($COMPOSE ps -q); do
  docker inspect "$c" --format '{{.Name}} restarts={{.RestartCount}} started={{.State.StartedAt}}'
done > "${EVDIR}/containers_state.txt"

# A.7.b — host uptime
uptime > "${EVDIR}/host_uptime.txt"

# A.7.c — full ps view
$COMPOSE ps --format 'table {{.Name}}\t{{.Status}}\t{{.RunningFor}}' \
  > "${EVDIR}/containers_ps.txt"

# A.7.d — Phase 6 fail-fast hits (env validator) — should be zero in steady state
$COMPOSE logs --no-color --since=720h api 2>/dev/null | grep -ci "phase6.*required env missing" || echo 0 \
  > "${EVDIR}/phase6_env_failures_count.txt"
```

### A.8 System behavior — rejection breakdown + fallback usage

```bash
# A.8.a — rejected trades grouped by blocking_gate
jq '.trades | group_by(.blocking_gate) | map({gate: .[0].blocking_gate, count: length}) | sort_by(-.count)' \
  "${EVDIR}/trades_rejected.json" > "${EVDIR}/rejection_gate_distribution.json"

# A.8.b — fallback close events from logs (HIGH PRIORITY audit lines)
$COMPOSE logs --no-color --since=720h api 2>/dev/null | \
  jq -r 'select(.outcome=="fallback_close_position") |
    "\(.time)\t\(.symbol // "-")\t\(.original_blocking_gate // "-")"' \
  > "${EVDIR}/fallback_events.tsv"

# A.8.c — fallback count
wc -l < "${EVDIR}/fallback_events.tsv" > "${EVDIR}/fallback_count.txt"

# A.8.d — error count over the last 30 days
$COMPOSE logs --no-color --since=720h api 2>/dev/null | \
  jq -r 'select(.level == "error" or .level == "fatal" or .level == 50 or .level == 60) | .msg' | \
  sort | uniq -c | sort -rn > "${EVDIR}/error_log_summary.txt"

# A.8.e — high-priority log line count
$COMPOSE logs --no-color --since=720h api 2>/dev/null | \
  jq -r 'select(.priority == "high")' | wc -l \
  > "${EVDIR}/high_priority_count.txt"
```

### A.9 Drift snapshot — config + behavior + data

```bash
# A.9.a — config snapshot (matches Section 6.4 of PHASE_9/SRE_DISCIPLINE.md)
{
  echo "env_md5=$(md5sum /opt/godsview/.env | awk '{print $1}')"
  echo "compose_md5=$(md5sum /opt/godsview/docker-compose.minimal.yml | awk '{print $1}')"
  echo "image=$(docker inspect $($COMPOSE ps -q api) --format '{{ .Image }}')"
  echo "git_HEAD=$(git -C /opt/godsview rev-parse HEAD)"
  echo "snapshot_at=$(date -u +%FT%TZ)"
} > "${EVDIR}/config_snapshot.txt"

# A.9.b — symbols traded
jq '[.trades[] | .symbol] | unique' "${EVDIR}/trades_executed.json" \
  > "${EVDIR}/symbols_traded.json"

# A.9.c — strategy IDs in use
jq '[.trades[] | .strategy_id] | unique' "${EVDIR}/trades_executed.json" \
  > "${EVDIR}/strategy_ids.json"

# A.9.d — modes observed (must be only "paper")
jq '[.trades[] | .mode] | unique' "${EVDIR}/trades_executed.json" \
  > "${EVDIR}/modes_observed.json"
```

### A.10 Database growth + backup state

```bash
# A.10.a — Postgres database size
$COMPOSE exec -T postgres psql -U godsview -d godsview -t -c \
  "SELECT pg_size_pretty(pg_database_size('godsview'));" \
  > "${EVDIR}/db_size.txt"

# A.10.b — top tables by size
$COMPOSE exec -T postgres psql -U godsview -d godsview -c "
  SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size, c.reltuples::bigint AS rows
  FROM pg_class c LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10;" \
  > "${EVDIR}/db_top_tables.txt"

# A.10.c — backup inventory
ls -lh /data/backups/ > "${EVDIR}/backup_inventory.txt"
```

### A.11 Bundle the evidence directory

```bash
cd /data/evidence
tar czf "${DATE}_evidence.tar.gz" "${DATE}/"
sha256sum "${DATE}_evidence.tar.gz" > "${DATE}_evidence.tar.gz.sha256"
ls -lh "${DATE}_evidence.tar.gz" "${DATE}_evidence.tar.gz.sha256"
```

The `.tar.gz` + its `.sha256` ARE the evidence archive. Upload both
to S3 or equivalent. The report file (sections B-G below) references
their hashes in section H so any reader can verify integrity.

---

## Section B — Cover sheet

```
GodsView — Paper-trading evidence report
================================================================
Window start (first trade ts):      <<PLACEHOLDER:metrics.json .metrics.first_trade_at>>
Window end   (extraction ts):       <<PLACEHOLDER:metrics.json .metrics.computed_at>>
Window length (calendar days):      <<PLACEHOLDER:operator_compute>>
Mode at extraction:                 <<PLACEHOLDER:system_mode.json .system_mode>>
Modes observed in trade rows:       <<PLACEHOLDER:modes_observed.json>>
Strategy IDs in use:                <<PLACEHOLDER:strategy_ids.json>>
Symbols traded:                     <<PLACEHOLDER:symbols_traded.json>>
Starting equity (configured):       <<PLACEHOLDER:metrics.json .starting_equity>>
Operator:                           ____________________________
Sign-off date:                      ____________________________
Evidence archive:                   /data/evidence/<<DATE>>_evidence.tar.gz
Evidence sha256:                    <<PLACEHOLDER:<<DATE>>_evidence.tar.gz.sha256>>
================================================================
```

The report MUST be reproducible from the archive. Anyone with the
archive should be able to derive every datum below by re-running
section A's commands against the JSON files.

---

## Section C — Performance metrics (real, computed by the system)

All numbers below come from `metrics.json` — the response of
`GET /api/proof/metrics`. They are computed by the same Phase 4
metric module that the system itself uses (`lib/paper_trades/metrics.ts`).
No re-derivation, no smoothing, no fabricated baselines.

```
Total trades — executed:            <<PLACEHOLDER:metrics.json .metrics.total_executed>>
Total trades — open:                <<PLACEHOLDER:metrics.json .metrics.total_open>>
Total trades — closed:              <<PLACEHOLDER:metrics.json .metrics.total_closed>>
Total trades — rejected:            <<PLACEHOLDER:metrics.json .metrics.total_rejected>>

Wins:                               <<PLACEHOLDER:metrics.json .metrics.total_wins>>
Losses:                             <<PLACEHOLDER:metrics.json .metrics.total_losses>>
Breakevens:                         <<PLACEHOLDER:metrics.json .metrics.total_breakevens>>

Win rate (wins / closed):           <<PLACEHOLDER:metrics.json .metrics.win_rate>>
Loss rate (losses / closed):        <<PLACEHOLDER:metrics.json .metrics.loss_rate>>

Avg R-multiple (closed):            <<PLACEHOLDER:metrics.json .metrics.avg_r>>
Median R-multiple:                  <<PLACEHOLDER:metrics.json .metrics.median_r>>
Best R-multiple:                    <<PLACEHOLDER:metrics.json .metrics.best_r>>
Worst R-multiple:                   <<PLACEHOLDER:metrics.json .metrics.worst_r>>

Total PnL (quote currency):         <<PLACEHOLDER:metrics.json .metrics.total_pnl>>
Avg PnL per trade:                  <<PLACEHOLDER:metrics.json .metrics.avg_pnl_per_trade>>
Profit factor:                      <<PLACEHOLDER:metrics.json .metrics.profit_factor>>

Max drawdown — absolute (quote):    <<PLACEHOLDER:metrics.json .metrics.max_drawdown_abs>>
Max drawdown — percent:             <<PLACEHOLDER:metrics.json .metrics.max_drawdown_pct>>
```

Any field that comes back as `null` means the system honestly could
not compute it (e.g. `win_rate: null` when there were zero closed
trades, `profit_factor: null` when there were zero losses). Do NOT
substitute a default. Write `null` in the report.

### C.1 Numerical integrity check (operator)

After filling in the values above, the operator MUST verify these
identities by inspection:

| Identity | Verification |
|---|---|
| `wins + losses + breakevens == total_closed` | algebra |
| `total_executed == total_open + total_closed` | algebra |
| equity_curve length == `total_closed` | from `equity.json` `.points \| length` |
| every closed-trade `pnl` value is a real number, no `null`s among closed | jq filter on `trades_executed.json` |
| `last_trade_at` is within the window | algebra |

If any identity fails, halt the report. The system is in an
integrity-violation state and the data is not trustworthy.

---

## Section D — System behavior analysis

### D.1 Most common rejection gates

Source: `rejection_gate_distribution.json` (extracted in A.8.a).

```
Rank Gate                          Count    % of rejections
---- ----------------------------- -------- ----------------
1    <<PLACEHOLDER:[0].gate>>      <<count>> <<%>>
2    <<PLACEHOLDER:[1].gate>>      <<count>> <<%>>
3    <<PLACEHOLDER:[2].gate>>      <<count>> <<%>>
...
```

The gate names will be drawn from this fixed set:
`system_mode`, `kill_switch`, `operator_token`, `data_staleness`,
`session`, `news_lockout`, `daily_loss_limit`, `max_exposure`,
`order_sanity`. Any other label means the audit log was corrupted.

**Operator note (do NOT skip):** rejection IS healthy behavior. A
gate firing means it did its job. A heavy concentration on ONE gate
(> 70% of rejections in the window) means investigate that gate's
upstream condition; it does not mean the gate is wrong.

### D.2 Fallback usage frequency

Source: `fallback_count.txt` and `fallback_events.tsv` (A.8.b–c).

```
Total fallback close events in window:  <<PLACEHOLDER:fallback_count.txt>>

If > 0, list each one:
Time                          Symbol     Original blocking gate
----------------------------- ---------- ----------------------
<<PLACEHOLDER:fallback_events.tsv (each row)>>
```

A fallback fires when `closeFullPosition` was blocked by a gate,
the request was a true stop-out, AND the legacy `closePosition`
DELETE path was used to exit the position. Each event is a
HIGH-PRIORITY audit line. Section F (Failure Report) captures any
that surface.

### D.3 Reconciliation corrections

Source: `reconciliation_status.json` (A.5.a).

```
Reconciler enabled:                 <<PLACEHOLDER:.reconciler.enabled>>
Reconciler running:                 <<PLACEHOLDER:.reconciler.running>>
Last run timestamp:                 <<PLACEHOLDER:.reconciler.last_result.ran_at>>
Last run open_rows_total:           <<PLACEHOLDER:.reconciler.last_result.open_rows_total>>
Last run positions_total:           <<PLACEHOLDER:.reconciler.last_result.positions_total>>
Last run orphans_found:             <<PLACEHOLDER:.reconciler.last_result.orphans_found>>
Last run orphans_closed:            <<PLACEHOLDER:.reconciler.last_result.orphans_closed>>
Last run untracked_positions:       <<PLACEHOLDER:.reconciler.last_result.untracked_positions>>
Last run error:                     <<PLACEHOLDER:.reconciler.last_result.error>>

Total reconciliation runs since
process start:                      <<PLACEHOLDER:reconciliation_runs_count.txt>>

Data-health job enabled:            <<PLACEHOLDER:.data_health.enabled>>
Data-health job last run:           <<PLACEHOLDER:.data_health.last_result.ran_at>>
Data-health last violations seen:   <<PLACEHOLDER:.data_health.last_result.total_violations>>
Data-health last error:             <<PLACEHOLDER:.data_health.last_result.error>>
```

If `Last run error` is non-null OR `orphans_closed != orphans_found`
OR `untracked_positions > 0`, append a sub-section explaining each.

### D.4 Error frequency

Source: `error_log_summary.txt` (A.8.d).

Top 10 error messages over the last 30 days, with counts:

```
Count  Message
------ -----------------------------------------
<<PLACEHOLDER:error_log_summary.txt (top 10 rows)>>
```

If the file is empty, the report records: `No error-level log lines
in the window.`

---

## Section E — Reliability metrics

Source: `containers_state.txt`, `host_uptime.txt`, `containers_ps.txt`,
`phase6_env_failures_count.txt`, `high_priority_count.txt`.

```
Host uptime:                        <<PLACEHOLDER:host_uptime.txt>>

Per-container state:
<<PLACEHOLDER:containers_state.txt (verbatim)>>

Container running times:
<<PLACEHOLDER:containers_ps.txt (verbatim)>>

Phase 6 fail-fast env hits in window:  <<PLACEHOLDER:phase6_env_failures_count.txt>>
High-priority log lines in window:     <<PLACEHOLDER:high_priority_count.txt>>
```

### E.1 Computed reliability quantities (operator math)

Compute these from the verbatim values above:

```
Window length (seconds):            <<derive: cover sheet end ts − start ts>>
Sum of api downtime in window (sec):
                                    <<derive: sum of intervals between api restarts;
                                              0 if RestartCount has not changed since deploy>>
api uptime % in window:             <<1 − (api downtime / window length) × 100>>
Number of intentional restarts:     <<from operator's ops log>>
Number of unintentional restarts:   <<RestartCount delta − intentional>>
```

The system does NOT track downtime intervals natively. The only honest
way to compute uptime % is from container `RestartCount` plus the
operator's own ops-log record of intentional restarts. If the operator
did not record their restarts, write: `Insufficient evidence to
compute uptime; RestartCount is <N>; intentional restarts unknown.`

---

## Section F — Integrity validation

Source: `integrity.json` (A.4) and the integrity check identities in
section C.1.

```
Trades checked:                     <<PLACEHOLDER:integrity.json .total_trades>>
Total violations:                   <<PLACEHOLDER:integrity.json .total_violations>>
Violations by rule:                 <<PLACEHOLDER:integrity.json .by_rule>>
```

For each non-zero rule below, paste the matching `.violations[]` entries:

```
missing_audit_id:                   <<PLACEHOLDER:integrity.json .violations[] | select(.rule=="missing_audit_id")>>
missing_broker_order_id:            <<PLACEHOLDER:integrity.json .violations[] | select(.rule=="missing_broker_order_id")>>
missing_entry_time:                 <<PLACEHOLDER>>
closed_without_exit_time:           <<PLACEHOLDER>>
closed_without_pnl:                 <<PLACEHOLDER>>
open_too_long:                      <<PLACEHOLDER>>
negative_quantity:                  <<PLACEHOLDER>>
non_positive_entry_price:           <<PLACEHOLDER>>
```

### F.1 Required outcome

For the report to be considered VALID, the operator must answer ONE
of the following:

- (a) `total_violations == 0` → record: "Clean. No integrity
  violations at extraction time."
- (b) `total_violations > 0` → for EACH violation, record: violation
  rule + trade_id + decision (FIX, ACCEPT, OR ESCALATE). Do not
  leave any violation unaddressed in the report.

There is no third option.

---

## Section G — Equity curve (raw)

Source: `equity.json` (A.3).

```
Starting equity:                    <<PLACEHOLDER:.starting_equity>>
Starting at:                        <<PLACEHOLDER:.starting_at>>
Ending equity:                      <<PLACEHOLDER:.ending_equity>>
Number of points:                   <<PLACEHOLDER:.points | length>>
```

### G.1 Full series (raw — no smoothing, no interpolation)

Paste the full point list as a fenced block. Format: TSV, one row per
point, ordered by timestamp ascending. The system already orders by
`exit_time` ascending; do not re-sort.

```
timestamp                       trade_id   pnl       equity
------------------------------ ---------- --------- --------
<<PLACEHOLDER:equity.json .points[] | [.timestamp, .trade_id, .pnl, .equity] | @tsv>>
```

### G.2 Identity check

The final row's `equity` MUST equal `ending_equity`. The first row's
prior-step equity (NOT shown) is `starting_equity`. The number of rows
MUST equal `total_closed` from section C. Verify by inspection.

---

## Section H — Failure report

Drawn from THREE sources:

1. The operator's ops log (the file the operator maintained per
   `PHASE_9/SRE_DISCIPLINE.md` section 4.7). Paste relevant entries
   into H.1 below.
2. `fallback_events.tsv` (A.8.b). Paste the full file into H.2.
3. The error log summary (A.8.d). Reference H.3 for the count.

### H.1 Incidents recorded by the operator (paste from ops log)

For each incident, record:

```
Incident ID:                        <<unique label>>
Date / Time (UTC):                  <<from ops log>>
Tier:                               CRITICAL | WARNING | INFO
Alert ID (from PHASE_9 §10.2):      <<C1..C6, W1..W10, I1..I5>>
Detection source:                   <<which command surfaced it>>
Root cause:                         <<one paragraph>>
Resolution:                         <<what was done>>
Impact (data-affecting? Y/N):       <<Y/N + brief>>
Window reset (Y/N):                 <<Y/N + reason>>
```

If there were no incidents in the window, write: `No incidents
recorded in the window.`

### H.2 Fallback close events (verbatim from fallback_events.tsv)

```
<<PLACEHOLDER:fallback_events.tsv (verbatim)>>
```

If the file is empty, write: `Zero fallback close events in the window.`

### H.3 Errors aggregate

`Total error-level log lines in window: <<derive: sum of counts in error_log_summary.txt>>`
`Distinct error message strings: <<derive: number of rows in error_log_summary.txt>>`

If > 0, the per-message counts are already in section D.4. Reference
that section here.

---

## Section I — System behavior summary

This section is **descriptive, not evaluative**. It states what the
system did. It does NOT interpret whether what it did was good.

For each of the four properties below, the operator writes ONE
sentence drawn from the data above. The sentences must be factual,
quantitative where possible, and contain no comparison to expected
or desired performance.

```
What worked (factual):
  <<one sentence per item, drawn from §C/D/E/F/G data>>

What failed (factual):
  <<one sentence per item, drawn from §H data; "nothing failed" is acceptable
    if §H.1 is empty AND §H.2 is empty AND §H.3 count == 0>>

What remained stable (factual):
  <<one sentence per item, drawn from drift snapshot (config_snapshot.txt) +
    rejection-gate distribution stability + container RestartCount stability>>

Did the system behave as designed?  YES | NO | PARTIALLY

  Justification:  <<2-4 sentences. "Behaved as designed" means: every
                   trade went through the executeOrder choke point;
                   every audit row has an audit_id; the reconciler ran
                   on schedule with error == null; integrity violations
                   stayed at zero (or were resolved); kill switch and
                   operator-token gates fired exactly when expected.
                   Anything else is NO or PARTIALLY, with the deviation
                   named.>>
```

This is the only section in the report that contains operator
judgment. It must be defensible from sections C–H. Do not write
anything in this section that is not directly supported by data
extracted in section A.

---

## Section J — What this report IS NOT

Per the Phase 10 strict rules, this report explicitly DOES NOT:

1. Recommend strategy improvements.
2. Recommend optimizations of any kind.
3. Suggest changes to the system.
4. Suggest new features.
5. Interpret profitability as success.

Profitability data is recorded factually in section C (Total PnL,
Profit factor). Whether that PnL is "good" or "bad" is not a question
this report answers — that is a downstream business decision separate
from the system-behavior evidence captured here.

The only success criterion this report tests against is:
**the system behaved as designed** (Section I).

---

## Section K — Verification commands the reader can run

A third party with the evidence archive must be able to verify
each datum independently. Provide them this checklist:

```bash
# 1. Verify archive integrity
sha256sum -c <DATE>_evidence.tar.gz.sha256

# 2. Unpack
tar xzf <DATE>_evidence.tar.gz
cd <DATE>/

# 3. Re-derive each report value:
# Total executed
jq '.metrics.total_executed' metrics.json
# Win rate
jq '.metrics.win_rate' metrics.json
# Equity curve length matches total_closed
jq '.points | length' equity.json
jq '.metrics.total_closed' metrics.json
# Total fallback events
wc -l < fallback_events.tsv
# Integrity violations
jq '.total_violations' integrity.json
# Container restart counts
cat containers_state.txt

# 4. Confirm no "live" mode in trade history
jq '[.trades[] | .mode] | unique' trades_executed.json
# Expect: ["paper"]

# 5. Confirm only one strategy
jq '[.trades[] | .strategy_id] | unique' trades_executed.json
# Expect: ["ob_retest_long_1h"]
```

Anyone running these commands against the archive must reach the same
numbers as those in sections C–H of the report. If a re-deriver finds
a discrepancy, the report is invalid.

---

## Section L — Sign-off

```
The report above was assembled from /data/evidence/<DATE>/, every
datum is sourced from a documented command in section A, and every
identity check in sections C.1, F.1, and G.2 passed.

The system behaved as documented [YES / NO / PARTIALLY].
The operator accepts this report as the evidence of paper-mode
operation for the window <window_start> through <extraction_ts>.

Operator name:    ____________________________
Signature:        ____________________________
Date (UTC):       ____________________________

Evidence archive sha256:  __________________________________________
                          (must match contents of <DATE>_evidence.tar.gz.sha256)
```

---

## Appendix M — Sample JSON STRUCTURES

These are the SHAPES of the responses, not real values from any
deployment. They are included so the operator knows what to expect
when running the section A commands. Operator must NOT use these
numbers in the report.

### M.1 Shape of `/api/proof/metrics`

```json
{
  "starting_equity": <number>,
  "metrics": {
    "total_executed":  <int>,
    "total_open":      <int>,
    "total_closed":    <int>,
    "total_wins":      <int>,
    "total_losses":    <int>,
    "total_breakevens":<int>,
    "total_rejected":  <int>,
    "win_rate":        <number | null>,
    "loss_rate":       <number | null>,
    "avg_r":           <number | null>,
    "median_r":        <number | null>,
    "best_r":          <number | null>,
    "worst_r":         <number | null>,
    "total_pnl":       <number>,
    "avg_pnl_per_trade":<number | null>,
    "profit_factor":   <number | null>,
    "max_drawdown_abs":<number | null>,
    "max_drawdown_pct":<number | null>,
    "first_trade_at":  <ISO8601 | null>,
    "last_trade_at":   <ISO8601 | null>,
    "computed_at":     <ISO8601>
  }
}
```

### M.2 Shape of `/api/proof/equity`

```json
{
  "starting_equity": <number>,
  "starting_at":     <ISO8601 | null>,
  "points": [
    {
      "timestamp": <ISO8601>,
      "trade_id":  <int>,
      "pnl":       <number>,
      "equity":    <number>
    }
  ],
  "ending_equity":   <number>
}
```

### M.3 Shape of `/api/proof/integrity`

```json
{
  "checked_at":         <ISO8601>,
  "total_trades":       <int>,
  "total_violations":   <int>,
  "by_rule": {
    "missing_audit_id":          <int>,
    "missing_broker_order_id":   <int>,
    "missing_entry_time":        <int>,
    "closed_without_exit_time":  <int>,
    "closed_without_pnl":        <int>,
    "open_too_long":             <int>,
    "negative_quantity":         <int>,
    "non_positive_entry_price":  <int>
  },
  "violations": [
    { "trade_id": <int>, "rule": <string>, "detail": <string> }
  ]
}
```

### M.4 Shape of `/api/proof/reconciliation/status`

```json
{
  "reconciler": {
    "enabled":     <bool>,
    "interval_ms": <int>,
    "running":     <bool>,
    "last_result": {
      "ran_at":               <ISO8601>,
      "duration_ms":          <int>,
      "open_rows_total":      <int>,
      "positions_total":      <int>,
      "orphans_found":        <int>,
      "orphans_closed":       <int>,
      "untracked_positions":  <int>,
      "error":                <string | null>
    }
  },
  "data_health": {
    "enabled":     <bool>,
    "interval_ms": <int>,
    "running":     <bool>,
    "last_result": {
      "ran_at":           <ISO8601>,
      "total_trades":     <int>,
      "total_violations": <int>,
      "error":            <string | null>
    }
  }
}
```

---

## End of template

When this template is filled in completely, signed, and archived
together with the `<DATE>_evidence.tar.gz` it references, the
Phase 10 deliverable is complete.

The presence of this report does not authorize live mode. Live mode
remains out of scope and requires its own escalation checklist
(Phase 1 acceptance criteria + a separate cutover runbook).
