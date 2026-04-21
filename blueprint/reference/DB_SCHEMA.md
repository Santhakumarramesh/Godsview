# Database Schema Reference

**Engine:** PostgreSQL 16 (RDS Multi-AZ in prod, local container in
dev). Migrations managed by Alembic under
`services/control_plane/migrations/`.

**Conventions:**
- Table names: `snake_case`, plural (`strategies`, `fills`).
- PKs: UUID v7 (time-ordered) via `gen_random_uuid()` + the
  `uuid7` function (installed via extension).
- Timestamps: `timestamptz`, stored UTC.
- Soft deletes: `deleted_at timestamptz null` on tables that need it.
- JSON payloads: `jsonb` (never `json`).
- Enums: native Postgres enums (`create type ... as enum (...)`) for
  stable vocabulary; `text` + a `check` constraint when the set
  evolves rapidly.
- All monetary values: `numeric(28, 10)` to avoid float drift.
- Foreign keys: `on delete restrict` by default; `on delete cascade`
  only where lifecycle is truly coupled (e.g., strategy_versions
  cascade from strategies).

**Extensions required:**
```sql
create extension if not exists "pgcrypto";        -- gen_random_uuid
create extension if not exists "pg_trgm";         -- text search on symbols
create extension if not exists "btree_gist";      -- range exclusion constraints
create extension if not exists "vector";          -- pgvector, Phase 8
```

---

## 1. Identity + auth

### `users`
```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active','disabled','deleted')),
  mfa_secret text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index users_status_idx on users(status) where deleted_at is null;
```

### `roles`
```sql
create type role_name as enum ('viewer','analyst','operator','admin');

create table roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role role_name not null,
  granted_by uuid references users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, role) where revoked_at is null
);
create index roles_user_idx on roles(user_id) where revoked_at is null;
```

### `sessions`
```sql
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  refresh_token_hash text not null unique,
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user_active_idx on sessions(user_id) where revoked_at is null;
create index sessions_expiry_idx on sessions(expires_at) where revoked_at is null;
```

### `api_keys`
```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,               -- 8 chars, for display
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index api_keys_user_idx on api_keys(user_id) where revoked_at is null;
```

### `audit_events`
```sql
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  api_key_id uuid references api_keys(id),
  event_type text not null,
  resource_type text,
  resource_id text,
  action text not null,                   -- create/update/delete/execute
  outcome text not null check (outcome in ('allowed','denied','error')),
  request_id text,
  ip_address inet,
  user_agent text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_user_idx on audit_events(user_id, created_at desc);
create index audit_resource_idx on audit_events(resource_type, resource_id, created_at desc);
create index audit_request_idx on audit_events(request_id);
-- Partition monthly; retention: 2 years.
```

---

## 2. Market universe

### `symbols`
```sql
create table symbols (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,            -- canonical: AAPL, BTCUSD, NQ1!
  broker_symbol text not null,            -- broker-specific: BTC/USD for Alpaca
  asset_class text not null check (asset_class in ('equity','crypto','futures','forex','option')),
  exchange text,
  tick_size numeric(28,10) not null,
  lot_size numeric(28,10) not null default 1,
  min_notional numeric(28,10),
  metadata jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index symbols_active_idx on symbols(ticker) where is_active;
```

### `watchlists`
```sql
create table watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table watchlist_symbols (
  watchlist_id uuid not null references watchlists(id) on delete cascade,
  symbol_id uuid not null references symbols(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (watchlist_id, symbol_id)
);
```

---

## 3. Strategies + versions

### `strategies`
```sql
create table strategies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  name text not null,
  slug text not null unique,              -- url-safe
  description text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index strategies_owner_idx on strategies(owner_id) where deleted_at is null;
```

### `strategy_versions`
```sql
create type strategy_source as enum ('tradingview_pine','python_native','json_dsl');

create table strategy_versions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  version_number int not null,
  source_type strategy_source not null,
  source_code text not null,              -- pine / python / json
  source_hash text not null,              -- sha256 for dedup
  params jsonb not null default '{}',
  symbols uuid[] not null default '{}',   -- fk-ish to symbols.id
  timeframes text[] not null default '{}',-- '1m','5m','1h',...
  risk_config jsonb not null default '{}',
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (strategy_id, version_number)
);
create index strategy_versions_hash_idx on strategy_versions(source_hash);
create index strategy_versions_strategy_idx on strategy_versions(strategy_id, version_number desc);
```

### `promotion_states`
```sql
create type promotion_state as enum (
  'draft','parsed','backtested','stress_tested',
  'paper_approved','assisted_live','autonomous_candidate',
  'autonomous_active','demoted','retired'
);

create table promotion_states (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references strategy_versions(id) on delete cascade,
  state promotion_state not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  entered_by uuid references users(id),       -- null = system (cron)
  reason text,
  evidence_ids uuid[] not null default '{}',  -- refs to backtest_runs, calibration_snapshots, etc.
  constraint promotion_current_once exclude using gist (
    strategy_version_id with =,
    tstzrange(entered_at, exited_at, '[)') with &&
  )
);
create index promotion_current_idx on promotion_states(strategy_version_id) where exited_at is null;
create index promotion_state_entered_idx on promotion_states(state, entered_at desc);
```

### `trust_scores`
```sql
create table trust_scores (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references strategy_versions(id) on delete cascade,
  computed_at timestamptz not null default now(),
  score numeric(6,4) not null check (score between 0 and 1),
  components jsonb not null,              -- { edge_delta, slippage_delta, drift, ... }
  window_start timestamptz not null,
  window_end timestamptz not null,
  unique (strategy_version_id, computed_at)
);
create index trust_scores_version_idx on trust_scores(strategy_version_id, computed_at desc);
```

---

## 4. Signals + decisions

### `webhook_receipts`
```sql
create table webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  source text not null,                   -- 'tradingview','internal','manual'
  path text not null,
  dedup_key text,
  signature_valid boolean not null,
  signature_reason text,
  headers jsonb not null default '{}',
  raw_body text not null,
  received_at timestamptz not null default now(),
  request_id text,
  unique (source, dedup_key)              -- dedup when key present
);
create index webhook_received_idx on webhook_receipts(received_at desc);
-- Partition daily; retention: 90 days raw, indefinite metadata.
```

### `signals`
```sql
create type signal_side as enum ('buy','sell','close','none');

create table signals (
  id uuid primary key default gen_random_uuid(),
  webhook_receipt_id uuid references webhook_receipts(id),
  strategy_version_id uuid references strategy_versions(id),
  symbol_id uuid not null references symbols(id),
  side signal_side not null,
  price numeric(28,10),
  stop_loss numeric(28,10),
  take_profit numeric(28,10),
  size_hint numeric(28,10),
  confidence numeric(6,4) check (confidence between 0 and 1),
  timeframe text,
  tags text[] not null default '{}',
  payload jsonb not null default '{}',
  received_at timestamptz not null default now(),
  correlation_id text not null
);
create index signals_version_idx on signals(strategy_version_id, received_at desc);
create index signals_symbol_idx on signals(symbol_id, received_at desc);
create index signals_correlation_idx on signals(correlation_id);
-- Partition monthly.
```

### `signal_decisions`
```sql
create type decision_outcome as enum (
  'allow','allow_reduced_size','defer','reject','veto'
);

create table signal_decisions (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references signals(id) on delete cascade,
  outcome decision_outcome not null,
  reason_codes text[] not null default '{}',
  explanation text,
  agent_contributions jsonb not null default '{}',   -- per-agent score/veto
  deterministic_gates jsonb not null default '{}',   -- which gates passed/failed
  final_size numeric(28,10),
  final_confidence numeric(6,4),
  decided_at timestamptz not null default now(),
  latency_ms int,                         -- end-to-end decision latency
  unique (signal_id)
);
create index signal_decisions_outcome_idx on signal_decisions(outcome, decided_at desc);
```

---

## 5. Orders + fills + positions

### `orders`
```sql
create type order_type as enum ('market','limit','stop','stop_limit','trailing_stop');
create type order_status as enum (
  'pending_submit','submitted','accepted','partial','filled',
  'canceled','rejected','expired','replaced'
);
create type order_tif as enum ('day','gtc','ioc','fok','opg','cls');

create table orders (
  id uuid primary key default gen_random_uuid(),
  signal_decision_id uuid references signal_decisions(id),
  strategy_version_id uuid references strategy_versions(id),
  broker text not null,
  broker_order_id text,
  symbol_id uuid not null references symbols(id),
  side signal_side not null,
  type order_type not null,
  tif order_tif not null default 'day',
  qty numeric(28,10) not null,
  limit_price numeric(28,10),
  stop_price numeric(28,10),
  parent_order_id uuid references orders(id),  -- bracket parent
  status order_status not null default 'pending_submit',
  submitted_at timestamptz,
  accepted_at timestamptz,
  terminal_at timestamptz,
  correlation_id text not null,
  metadata jsonb not null default '{}'
);
create unique index orders_broker_id_idx on orders(broker, broker_order_id) where broker_order_id is not null;
create index orders_status_idx on orders(status, submitted_at desc);
create index orders_strategy_idx on orders(strategy_version_id, submitted_at desc);
create index orders_correlation_idx on orders(correlation_id);
```

### `fills`
```sql
create table fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  broker_fill_id text,
  qty numeric(28,10) not null,
  price numeric(28,10) not null,
  fee numeric(28,10) not null default 0,
  fee_currency text not null default 'USD',
  filled_at timestamptz not null,
  liquidity text check (liquidity in ('maker','taker','unknown')),
  metadata jsonb not null default '{}',
  unique (order_id, broker_fill_id) where broker_fill_id is not null
);
create index fills_order_idx on fills(order_id, filled_at);
create index fills_filled_at_idx on fills(filled_at desc);
-- Partition monthly.
```

### `positions`
```sql
create table positions (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid references strategy_versions(id),
  symbol_id uuid not null references symbols(id),
  opened_at timestamptz not null,
  closed_at timestamptz,
  qty numeric(28,10) not null,
  avg_entry_price numeric(28,10) not null,
  avg_exit_price numeric(28,10),
  realized_pnl numeric(28,10),
  unrealized_pnl numeric(28,10),
  fee_total numeric(28,10) not null default 0,
  updated_at timestamptz not null default now()
);
create index positions_open_idx on positions(symbol_id) where closed_at is null;
create index positions_strategy_idx on positions(strategy_version_id, opened_at desc);
```

---

## 6. Backtests + calibration

### `backtest_runs`
```sql
create type backtest_status as enum (
  'queued','running','succeeded','failed','canceled'
);

create table backtest_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references strategy_versions(id) on delete cascade,
  requested_by uuid references users(id),
  scenario jsonb not null,                -- symbols, tf, date range, regime tags, fees, slippage model
  params_hash text not null,              -- for cache hit detection
  status backtest_status not null default 'queued',
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  artifacts_prefix text,                  -- S3 prefix
  correlation_id text
);
create index backtest_version_idx on backtest_runs(strategy_version_id, queued_at desc);
create index backtest_status_idx on backtest_runs(status, queued_at);
create index backtest_params_hash_idx on backtest_runs(params_hash);
```

### `backtest_metrics`
```sql
create table backtest_metrics (
  run_id uuid primary key references backtest_runs(id) on delete cascade,
  total_return numeric(28,10),
  sharpe numeric(10,4),
  sortino numeric(10,4),
  max_drawdown numeric(10,6),
  win_rate numeric(6,4),
  profit_factor numeric(10,4),
  expectancy numeric(28,10),
  num_trades int,
  avg_hold_min numeric(10,2),
  mae numeric(28,10),
  mfe numeric(28,10),
  regime_breakdown jsonb,                 -- per-regime sub-metrics
  session_breakdown jsonb,
  symbol_breakdown jsonb,
  sensitivity jsonb,                      -- param sensitivity analysis
  computed_at timestamptz not null default now()
);
```

### `calibration_snapshots`
```sql
create table calibration_snapshots (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references strategy_versions(id) on delete cascade,
  computed_at timestamptz not null default now(),
  window_start timestamptz not null,
  window_end timestamptz not null,
  sample_size int not null,
  slippage_p50 numeric(10,6),
  slippage_p95 numeric(10,6),
  latency_p50_ms int,
  latency_p95_ms int,
  edge_delta numeric(28,10),              -- expected - actual PnL per trade
  win_rate_delta numeric(6,4),
  distribution jsonb,                     -- histogram buckets
  notes text
);
create index calibration_version_idx on calibration_snapshots(strategy_version_id, computed_at desc);
```

### `drift_events`
```sql
create type drift_severity as enum ('info','warning','critical');

create table drift_events (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid references strategy_versions(id),
  symbol_id uuid references symbols(id),
  metric text not null,                   -- 'slippage_p95','win_rate','feature_ks_stat','regime_mix'
  severity drift_severity not null,
  baseline jsonb not null,
  observed jsonb not null,
  ks_stat numeric(10,6),
  psi numeric(10,6),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(id)
);
create index drift_severity_idx on drift_events(severity, detected_at desc);
create index drift_version_idx on drift_events(strategy_version_id, detected_at desc);
```

### `fill_divergence`
```sql
-- Per-fill comparison between backtest expectation and live reality.
-- Feeds calibration_snapshots.
create table fill_divergence (
  id uuid primary key default gen_random_uuid(),
  fill_id uuid not null references fills(id) on delete cascade,
  expected_price numeric(28,10) not null,
  actual_price numeric(28,10) not null,
  slippage_bps numeric(10,6) not null,
  expected_latency_ms int,
  actual_latency_ms int not null,
  computed_at timestamptz not null default now(),
  unique (fill_id)
);
create index fill_divergence_computed_idx on fill_divergence(computed_at desc);
```

---

## 7. Order flow + screenshots

### `orderflow_snapshots`
```sql
create table orderflow_snapshots (
  id uuid primary key default gen_random_uuid(),
  symbol_id uuid not null references symbols(id),
  ts timestamptz not null,                -- snapshot time
  timeframe text not null,                -- '1s','5s','1m'
  features jsonb not null,                -- delta, cum_delta, imbalance, absorption, ...
  depth_summary jsonb,                    -- {bids:[{px,qty}], asks:[{px,qty}], imbalance}
  raw_ref text                            -- S3 path for full depth
);
create index orderflow_symbol_ts_idx on orderflow_snapshots(symbol_id, ts desc);
create index orderflow_ts_idx on orderflow_snapshots(ts desc);
-- Partition daily by ts; retention: 30 days hot, lifecycle to S3 after.
```

### `screenshots`
```sql
create type screenshot_kind as enum (
  'signal','order','fill','incident','replay_bookmark','backtest_case','manual'
);

create table screenshots (
  id uuid primary key default gen_random_uuid(),
  kind screenshot_kind not null,
  symbol_id uuid references symbols(id),
  ts_anchor timestamptz,                  -- the chart's "now" time
  s3_key text not null unique,
  width int not null,
  height int not null,
  annotations jsonb not null default '[]',
  refs jsonb not null default '{}',       -- { signal_id, order_id, fill_id, ... }
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index screenshots_kind_idx on screenshots(kind, created_at desc);
create index screenshots_symbol_idx on screenshots(symbol_id, created_at desc);
create index screenshots_refs_signal_idx on screenshots((refs->>'signal_id')) where refs ? 'signal_id';
create index screenshots_refs_order_idx on screenshots((refs->>'order_id')) where refs ? 'order_id';
```

---

## 8. Alerts + incidents

### `alerts`
```sql
create type alert_severity as enum ('info','warning','critical','fatal');

create table alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null,                     -- 'slo_burn','drift','kill_switch','webhook_dedup', ...
  severity alert_severity not null,
  source text not null,                   -- service name
  summary text not null,
  details jsonb not null default '{}',
  refs jsonb not null default '{}',       -- resource refs for click-through
  correlation_id text,
  fired_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(id),
  resolved_at timestamptz,
  resolved_by uuid references users(id),
  channels_delivered text[] not null default '{}'
);
create index alerts_open_idx on alerts(fired_at desc) where resolved_at is null;
create index alerts_severity_idx on alerts(severity, fired_at desc);
```

### `incidents`
```sql
create type incident_status as enum ('open','mitigated','resolved','postmortem');

create table incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status incident_status not null default 'open',
  severity alert_severity not null,
  commander_id uuid references users(id),
  opened_at timestamptz not null default now(),
  mitigated_at timestamptz,
  resolved_at timestamptz,
  summary text,
  postmortem_url text,
  alert_ids uuid[] not null default '{}'
);
create index incidents_open_idx on incidents(opened_at desc) where status != 'resolved';

create table incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  author_id uuid references users(id),
  kind text not null,                     -- 'note','status_change','action','screenshot'
  body text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index incident_events_incident_idx on incident_events(incident_id, created_at);
```

### `runbooks`
```sql
create table runbooks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  tags text[] not null default '{}',
  markdown text not null,
  version int not null default 1,
  last_exercised_at timestamptz,
  updated_at timestamptz not null default now()
);
```

### `deployments`
```sql
create type deployment_status as enum (
  'queued','in_progress','succeeded','failed','rolled_back'
);

create table deployments (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('dev','prod')),
  git_sha text not null,
  release_tag text,
  services text[] not null,
  status deployment_status not null default 'queued',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  deployed_by uuid references users(id),
  ci_run_url text,
  notes text
);
create index deployments_env_idx on deployments(environment, started_at desc);
```

### `system_health_events`
```sql
create table system_health_events (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  event text not null,                    -- 'startup','shutdown','degraded','recovered'
  details jsonb not null default '{}',
  observed_at timestamptz not null default now()
);
create index system_health_idx on system_health_events(service, observed_at desc);
-- Partition monthly; retention: 1 year.
```

---

## 9. Intelligence + memory

### `memory_entries` (pgvector)
```sql
create table memory_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                     -- 'setup','incident','decision','regime'
  embedding vector(1536) not null,        -- text-embedding-3-small dimension
  summary text not null,
  refs jsonb not null default '{}',       -- what this memory ties to
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index memory_embedding_idx on memory_entries using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index memory_kind_idx on memory_entries(kind, created_at desc);
```

### `agent_runs`
```sql
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null,
  signal_id uuid references signals(id),
  agents jsonb not null,                  -- per-agent: { name, version, latency_ms, output }
  consensus jsonb not null,
  total_latency_ms int not null,
  started_at timestamptz not null,
  finished_at timestamptz not null
);
create index agent_runs_signal_idx on agent_runs(signal_id);
create index agent_runs_correlation_idx on agent_runs(correlation_id);
```

---

## 10. Feature flags + config

### `feature_flags`
```sql
create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  owner_id uuid references users(id),
  last_toggled_by uuid references users(id),
  last_toggled_at timestamptz,
  created_at timestamptz not null default now(),
  notes text
);
```

### `system_config`
```sql
-- Singleton row; settings that are global + runtime-mutable.
create table system_config (
  id boolean primary key default true check (id is true),
  live_trading_enabled boolean not null default false,
  mode text not null default 'paper' check (mode in ('kill','paper','assisted_live','autonomous')),
  max_daily_loss_usd numeric(28,10) not null default 1000,
  max_open_positions int not null default 10,
  kill_reason text,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
insert into system_config default values on conflict do nothing;
```

---

## 11. Partitioning strategy

Tables marked "Partition monthly/daily" above use native Postgres
declarative partitioning. Creation is automated by pg_partman or a
nightly cron that pre-creates next-month partitions. Schema:

```sql
-- Example for signals
create table signals (...) partition by range (received_at);
create table signals_202604 partition of signals
  for values from ('2026-04-01') to ('2026-05-01');
-- index created on parent propagates.
```

Retention is enforced by a nightly job that runs:
```sql
alter table signals detach partition signals_202410;
drop table signals_202410;
```
... with an S3 archive step before drop (parquet export).

---

## 12. Index strategy summary

Every FK has an explicit index (Postgres doesn't auto-index FKs).
Every "WHERE x is null" common query has a partial index. Every
time-series table has a `(scope_column, ts desc)` compound.

---

## 13. Migration workflow

- All schema changes land as Alembic migrations under
  `services/control_plane/migrations/versions/`.
- Migrations are reviewed in PRs — never auto-applied to prod.
- Prod application: a separate `migrate` ECS task runs
  `alembic upgrade head` before the service rollout lands.
- Destructive migrations (drop column, drop table) go through a
  two-step process: PR 1 stops reading/writing the column; PR 2
  drops it a release later.

---

## 14. Backups + DR

- **RDS automated backups:** 7-day retention in dev, 30-day in prod.
- **Manual snapshots:** before every schema migration in prod.
- **Cross-region replication:** S3 artifacts + RDS snapshot copy
  to us-west-2 (prod only).
- **Restore drill:** quarterly (Phase 13 runbook).

---

## 15. Table count summary

| Domain | Tables |
|--------|--------|
| Identity + auth | users, roles, sessions, api_keys, audit_events |
| Market universe | symbols, watchlists, watchlist_symbols |
| Strategies | strategies, strategy_versions, promotion_states, trust_scores |
| Signals + decisions | webhook_receipts, signals, signal_decisions |
| Orders + fills | orders, fills, positions |
| Backtests + calibration | backtest_runs, backtest_metrics, calibration_snapshots, drift_events, fill_divergence |
| Order flow + screenshots | orderflow_snapshots, screenshots |
| Ops | alerts, incidents, incident_events, runbooks, deployments, system_health_events |
| Intelligence | memory_entries, agent_runs |
| Config | feature_flags, system_config |

**Total: 30 tables** (enum types and partitions not counted).
