# Proof Endpoint Exposure Policy

The Phase 4–5 endpoints under `/api/proof/*` exist to make the
paper-trading record auditable. They contain trade-level data, not
secrets, but care still needs to be taken about who can reach them.

## Endpoint inventory

| Method | Path | Read/Write | Sensitivity | Exposure recommendation |
|---|---|---|---|---|
| GET | `/api/proof/trades` | read | Medium — exposes strategy ids, symbols, entry/exit prices, PnL | Internal only OR auth-gated |
| GET | `/api/proof/trades?status=rejected` | read | Medium — exposes rejection reasons, audit ids | Internal only OR auth-gated |
| GET | `/api/proof/metrics` | read | Low — aggregate numbers only | Safe to expose publicly (read-only) |
| GET | `/api/proof/equity` | read | Low — aggregate equity curve | Safe to expose publicly (read-only) |
| GET | `/api/proof/trades.csv` | read | Medium — full CSV dump | Internal only OR auth-gated |
| GET | `/api/proof/integrity` | read | Low/Medium — surfaces internal data quality state | Internal only |
| GET | `/api/proof/reconciliation/status` | read | Low — job heartbeats | Internal only |
| POST | `/api/proof/reconciliation/run` | **WRITE** — triggers DB writes (closes orphan rows) | High | **Must be auth-gated** |

## "Public-safe" subset

If you want a publicly readable proof page (recruiter / investor /
portfolio audience) without exposing the full trade history, expose
ONLY these two:

```
/api/proof/metrics
/api/proof/equity
```

Aggregate stats (win rate, profit factor, max drawdown, equity curve)
are honest signals without revealing per-trade strategy details.

## Recommended nginx config (`nginx/default.conf`)

The `nginx` container in `docker-compose.minimal.yml` mounts
`./nginx` as `/etc/nginx/conf.d`. Suggested rules:

```nginx
upstream godsview_api {
  server api:3001;
}

server {
  listen 80;
  server_name _;

  # ── PUBLIC: metrics + equity only ─────────────────────────────
  location ~ ^/api/proof/(metrics|equity)$ {
    proxy_pass http://godsview_api;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # ── INTERNAL: everything else under /api/proof/ requires the
  #             operator token ─────────────────────────────────
  location /api/proof/ {
    if ($http_x_godsview_operator != "REPLACE_WITH_OPERATOR_TOKEN") {
      return 403;
    }
    proxy_pass http://godsview_api;
    proxy_set_header Host $host;
  }

  # ── INTERNAL: order submission requires the operator token ──
  location /api/alpaca/orders {
    if ($http_x_godsview_operator != "REPLACE_WITH_OPERATOR_TOKEN") {
      return 403;
    }
    proxy_pass http://godsview_api;
    proxy_set_header Host $host;
  }

  # ── INTERNAL: kill switch ─────────────────────────────────────
  location /api/system/kill-switch {
    if ($http_x_godsview_operator != "REPLACE_WITH_OPERATOR_TOKEN") {
      return 403;
    }
    proxy_pass http://godsview_api;
    proxy_set_header Host $host;
  }

  # ── DEFAULT: pass through (the api server has its own auth gate
  #            via the GODSVIEW_API_KEY env var if you set it) ──
  location / {
    proxy_pass http://godsview_api;
    proxy_set_header Host $host;
  }
}
```

A safer pattern than the inline `if` check is nginx's `auth_request`
module pointed at a tiny in-house verify endpoint, but the inline `if`
is sufficient for paper mode.

## What MUST NOT be exposed publicly

- `/api/alpaca/orders` (POST) — order submission. Only operator.
- `/api/alpaca/orders` (DELETE) — cancel orders. Only operator.
- `/api/alpaca/positions/:symbol` (DELETE) — close a position. Only operator.
- `/api/system/kill-switch` (POST) — toggles trading. Only operator.
- `/api/proof/reconciliation/run` (POST) — writes to DB. Only operator.
- Any route under `/api/execution/*` — direct execution control.
- Any route under `/api/ops/*` — operational state mutation.

## Optional: global API key gate

The repo already supports a global API-key gate via `GODSVIEW_API_KEY`.
Set it and every `/api/*` route becomes unreachable without the key.
Useful when you want to block ALL public access during early paper
validation:

```bash
# .env
GODSVIEW_API_KEY=$(openssl rand -hex 32)
```

Then every request needs `Authorization: Bearer $GODSVIEW_API_KEY`.

## What proof endpoints do NOT contain

- No API keys.
- No operator token.
- No customer PII (the paper system has no customers).
- No DB credentials.

The trade data itself is your strategy IP. Decide accordingly.
