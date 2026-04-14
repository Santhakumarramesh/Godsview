# Chaos Drills — Failure & Recovery Proofs

These scripts drive the Gate I scenarios from
`PRODUCTION_READINESS_SCORECARD.md`. Each script:

1. Boots the api-server (or assumes one running on `$PORT`)
2. Performs the destructive action
3. Probes the post-condition via the API
4. Exits 0 if the post-condition holds, non-zero otherwise

Run individually:

```bash
PORT=5001 node scripts/chaos/kill-switch-trip.mjs
PORT=5001 node scripts/chaos/breaker-trip-blocks-orders.mjs
PORT=5001 node scripts/chaos/probe-self-heal.mjs
PORT=5001 node scripts/chaos/mesh-degradation.mjs
```

Run all (smoke):

```bash
PORT=5001 node scripts/chaos/run-all.mjs
```

Each script writes a JSON envelope to stdout describing what it did
and what it observed, suitable for capture into the audit log.
