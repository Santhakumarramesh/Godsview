# 06 · Governance & the safety floor

## Decision #4 — the safety floor

Every environment — dev, staging, production — boots with these defaults.
They are enforced both in code (the control plane startup check) and in
data (the seed script inserts these values on first run):

| Key                             | Default    | Effect                                   |
|---------------------------------|------------|------------------------------------------|
| `execution.kill_switch`         | `true`     | Blocks every order submission.           |
| `execution.allow_live`          | `false`    | Disallows live venue; paper only.        |
| `intelligence.allow_autonomous` | `false`    | Agents may recommend, never act.         |
| `auth.mfa.required`             | `false`    | Opt-in in dev; enforced in staging+.     |
| `ui.show_v2_command_center`     | `true`     | New UI chrome visible.                   |

## Trust tiers (Phase 11)

A strategy progresses through four tiers. The currently active tier
drives both execution gating and capital allocation.

| Tier           | Who can trade | Sizing cap | Promotion requires                                   |
|----------------|---------------|------------|------------------------------------------------------|
| Experimental   | nobody (lab)  | n/a        | Backtest passes metric thresholds.                   |
| Paper          | paper venue   | n/a        | 30 live paper days, drawdown under cap.              |
| Assisted live  | operator      | 0.25×      | Promotion ticket + dual-control approval.            |
| Autonomous     | control plane | 1.0×       | 90 assisted days, stable calibration, no demotions.  |

## Auto-demotion triggers

The Governance engine (Phase 11) demotes a strategy one tier on any of:

- Drawdown breach of `risk.max_daily_loss_pct` or strategy-level cap.
- Three consecutive red calibration windows (ECE above threshold).
- An anomaly-detector alert fired against the strategy's DNA.
- Operator-triggered demotion via `/governance/approvals`.

Demotions are audit-logged with actor, rationale, and the triggering
metric snapshot.

## Approval workflows

Dual-control is required for:

- Promoting a strategy from assisted live → autonomous.
- Disabling `execution.kill_switch`.
- Raising `risk.max_daily_loss_pct` above 2.0.
- Removing a feature flag that another flag depends on.

Approvals are a pending-item queue on `/governance/approvals`. Once two
distinct admins approve, the Governance engine applies the mutation in
a single audit-logged transaction.
