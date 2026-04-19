# 09 · Phase roadmap (0 → 15)

Each phase is atomic — it lands fully reviewed and tagged before the
next phase begins. A phase is only "done" when its exit criteria are
green on CI, documented in the changelog, and the blueprint doc for the
affected surface has been updated.

| Phase | Name                            | Exit criteria                                                                                  |
|-------|---------------------------------|------------------------------------------------------------------------------------------------|
| 0     | Foundation                      | Monorepo builds, control plane boots, web renders, auth works, CI green, v2.0.0 tagged.        |
| 1     | Operator surface                | Users/roles/api-keys/webhooks/mcp admin, audit events, SLOs + alerts + incidents functional.   |
| 2     | Market Structure Engine + MCP   | TradingView webhook ingestion, BOS/CHOCH/OB/FVG detection, Market Symbols with live quote.     |
| 3     | Order Flow Engine               | Depth feed adapter, delta/imbalance/absorption output, Liquidity page live.                    |
| 4     | Fusion Engine                   | Weighted scoring, conflict resolution, confidence output feeding Regimes + Fusion pages.       |
| 5     | Setup Detection + Strategies    | Typed setup DSL, catalog/builder/active pages, paper-trading harness.                          |
| 6     | Quant Lab                       | Backtests, replay engine, experiments, metrics, ranking — all wired to the Strategy Builder.   |
| 7     | Recall Engine                   | Chart screenshot store, similarity search, Missed Trades ledger.                               |
| 8     | Multi-agent brain + Learning    | Per-agent vote capture, feedback loop, calibration drift detector.                             |
| 9     | Execution + Risk                | Alpaca adapter, bracket orders, risk engine, kill-switch UI functional.                        |
| 10    | Portfolio Intelligence          | PnL / exposure / correlation / allocation / drawdown pages live against broker state.          |
| 11    | Governance + Autonomy           | Trust tiers enforced, approvals + demotions + policies functional, dual-control gating.        |
| 12    | Observability hardening         | Tracing across webhook → decision → broker, SLOs wired to real PagerDuty/Slack routing.        |
| 13    | Perf + cost pass                | p95 budget per route, DB hot spots profiled, cold-path costs documented.                       |
| 14    | Security hardening              | Secrets via KMS, MFA enforced in staging+, pentest remediation closed, SBOM published.         |
| 15    | GA launch                       | Customer-facing release notes, public runbook, postmortem template, incident SLA signed-off.   |

## Dependencies

- Phase 2 blocks Phase 3, 4, 5.
- Phase 4 blocks Phase 5, 8.
- Phase 5 blocks Phase 6, 9.
- Phase 6 blocks Phase 7, 8.
- Phase 9 blocks Phase 10.
- Phase 11 depends on 1, 8, 9, 10.

## Phase 0 exit criteria (this PR set)

- [x] PR1: monorepo root builds green.
- [x] PR2: four packages compile, version-pinned.
- [x] PR3: control plane boots against compose postgres; `/ready` green.
- [x] PR4: auth + users + flags + audit routes covered by tests (folded into PR3).
- [x] PR5: web app renders all 66 sidebar routes (6 functional, 60 stubs).
- [ ] PR6: `make dev-up` stands up postgres + redis + minio + localstack + mailhog; docs/blueprint committed.
- [ ] PR7: CI workflows (lint + typecheck + test + contract validation).
- [ ] PR8: HANDOFF.md + patch file + `git tag v2.0.0`.
