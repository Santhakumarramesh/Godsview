# AWS_RESOURCES.md — GodsView v2+ Blueprint

**Status:** locked for Phase 0 scaffolding (provisioned in Phase 13)
**Scope:** every AWS resource the production deployment uses, with
sizing for `dev`, `staging`, and `prod`; per-account boundaries; IAM
boundaries; cost estimate; and the one-line CDK stack name that
provisions each.

This file is the cross-check for `infra/cdk/` (Phase 13 ships the
real stacks). Every resource here gets a stack file; every stack
file maps to an entry here.

---

## 0. Account & region topology

Three AWS accounts, one organization:

```
Org (godsview)
├─ acct: godsview-shared           (us-east-1)   — ECR, central CloudWatch, IAM Identity Center
├─ acct: godsview-staging          (us-east-1)   — full pre-prod replica at smaller sizing
└─ acct: godsview-prod             (us-east-1, us-east-2 DR)
```

- **Primary region:** `us-east-1` (proximity to broker APIs / market
  data feeds in NYC metro).
- **DR region:** `us-east-2` (warm standby of S3 + DB cross-region
  replicas; not active compute by default).
- All cross-account access via IAM Identity Center + role assumption.

---

## 1. Network — VPC layout

Per environment (dev = single AZ, staging/prod = 3 AZ).

```
VPC: 10.0.0.0/16  (prod)
├─ public  subnets: 10.0.0.0/24, 10.0.1.0/24, 10.0.2.0/24    (ALB, NAT)
├─ private subnets: 10.0.10.0/24, 10.0.11.0/24, 10.0.12.0/24 (ECS tasks)
└─ data    subnets: 10.0.20.0/24, 10.0.21.0/24, 10.0.22.0/24 (RDS, ElastiCache)
```

| Resource             | dev               | staging           | prod                    | CDK stack         |
|----------------------|-------------------|-------------------|-------------------------|-------------------|
| VPC                  | 1                 | 1                 | 1                       | `NetworkStack`    |
| AZs                  | 1                 | 2                 | 3                       | `NetworkStack`    |
| NAT Gateways         | 1                 | 2                 | 3                       | `NetworkStack`    |
| VPC Endpoints (S3, ECR, Logs, Secrets) | 4 | 4              | 4                       | `NetworkStack`    |
| Flow Logs → S3       | yes               | yes               | yes (90d retention)     | `NetworkStack`    |
| TGW peering (DR)     | no                | no                | yes (us-east-2)         | `NetworkStack`    |

Security groups (least privilege):

- `sg-alb` — ingress 443 from world; egress to `sg-app` only
- `sg-app` — ingress 80/8000-8090 from `sg-alb`; egress to `sg-data`,
  `sg-cache`, AWS endpoints
- `sg-data` — ingress 5432 from `sg-app` only
- `sg-cache` — ingress 6379 from `sg-app` only
- `sg-bastion` — disabled; access via SSM Session Manager only

---

## 2. Compute — ECS Fargate

Each Python service + the Next.js app runs as its own ECS service on
Fargate. No shared task definitions — every service has its own image,
its own scaling policy, its own log group.

| Service              | Task CPU/MEM (prod) | Min/Max (prod)   | Min/Max (staging) | Min/Max (dev) | CDK stack            |
|----------------------|---------------------|------------------|-------------------|---------------|----------------------|
| control_plane        | 1 vCPU / 2 GiB      | 2 / 6            | 1 / 2             | 1 / 1         | `ControlPlaneStack`  |
| ingestion            | 1 vCPU / 2 GiB      | 2 / 6            | 1 / 2             | 1 / 1         | `IngestionStack`     |
| orderflow            | 2 vCPU / 4 GiB      | 2 / 4            | 1 / 2             | 1 / 1         | `OrderFlowStack`     |
| backtest_runner      | 4 vCPU / 8 GiB      | 1 / 8 (queue-based)| 1 / 2           | 1 / 1         | `BacktestStack`      |
| calibration          | 2 vCPU / 4 GiB      | 1 / 2            | 1 / 1             | 1 / 1         | `CalibrationStack`   |
| promotion            | 0.5 vCPU / 1 GiB    | 1 / 2            | 1 / 1             | 1 / 1         | `PromotionStack`     |
| intelligence         | 2 vCPU / 8 GiB      | 1 / 4            | 1 / 2             | 1 / 1         | `IntelligenceStack`  |
| execution            | 1 vCPU / 2 GiB      | 2 / 4            | 1 / 2             | 1 / 1         | `ExecutionStack`     |
| screenshot_renderer  | 2 vCPU / 4 GiB      | 1 / 4            | 1 / 2             | 1 / 1         | `ScreenshotStack`    |
| replay               | 2 vCPU / 4 GiB      | 0 / 2 (on-demand) | 0 / 1            | 0 / 1         | `ReplayStack`        |
| apps/web (Next.js)   | 1 vCPU / 2 GiB      | 2 / 6            | 1 / 2             | 1 / 1         | `WebAppStack`        |

**Cluster:** one ECS cluster per environment (`godsview-prod`,
`godsview-staging`, `godsview-dev`).

**Scaling triggers:**
- CPU > 70 % for 3 min → scale out
- Queue depth on owned topics (per-service) > threshold → scale out
- Burst protection: scale-in cooldown 5 min, scale-out 1 min

**Health checks:**
- ALB target group: `GET /health` → 200 within 5 s
- ECS task definition: same path, grace 30 s

---

## 3. Load balancing & edge

| Resource                    | dev          | staging      | prod                          | CDK stack       |
|-----------------------------|--------------|--------------|-------------------------------|-----------------|
| ALB (public, HTTPS)         | 1            | 1            | 1                             | `EdgeStack`     |
| Target Groups               | per service  | per service  | per service                   | `EdgeStack`     |
| ACM certificates            | wildcard     | wildcard     | wildcard + apex               | `EdgeStack`     |
| CloudFront distribution     | optional     | yes          | yes (caches static + API edge)| `EdgeStack`     |
| Route 53 hosted zone        | one          | one          | one (primary + failover)      | `EdgeStack`     |
| WAF web ACL                 | basic        | full         | full + bot rules              | `EdgeStack`     |

Routing: `app.godsview.example.com` → CloudFront → ALB → ECS (web app).
`api.godsview.example.com` → CloudFront (no caching for /v1) → ALB →
ECS (control_plane + per-service routes).

---

## 4. Data — RDS Postgres

| Property               | dev                 | staging             | prod                                  | CDK stack       |
|------------------------|---------------------|---------------------|---------------------------------------|-----------------|
| Engine                 | Postgres 16         | Postgres 16         | Postgres 16                           | `DatabaseStack` |
| Instance               | db.t4g.medium       | db.t4g.large        | db.r7g.xlarge (Multi-AZ)              | `DatabaseStack` |
| Storage                | 100 GiB gp3         | 200 GiB gp3         | 500 GiB gp3 (auto-scale 2 TiB)        | `DatabaseStack` |
| IOPS                   | baseline            | baseline            | 12,000 provisioned                    | `DatabaseStack` |
| Backup retention       | 7 d                 | 14 d                | 35 d                                  | `DatabaseStack` |
| PITR                   | yes                 | yes                 | yes (5-min RPO)                       | `DatabaseStack` |
| Read replica           | none                | 1                   | 1 (read-heavy queries)                | `DatabaseStack` |
| Cross-region replica   | no                  | no                  | yes (us-east-2, 5-min lag target)     | `DatabaseStack` |
| Performance Insights   | off                 | on                  | on                                    | `DatabaseStack` |
| Extensions             | pgcrypto, pg_trgm, btree_gist, vector | same | same + pg_partman               | `DatabaseStack` |

Connection routing: writers via `db.godsview.internal` (the writer
endpoint); read-only analytics queries via `db-ro.godsview.internal`.

---

## 5. Cache & event bus

| Resource             | dev               | staging              | prod                                | CDK stack         |
|----------------------|-------------------|----------------------|-------------------------------------|-------------------|
| ElastiCache Redis    | 1× cache.t4g.small| 1× cache.t4g.medium  | 2× cache.r7g.large (cluster mode)   | `CacheStack`      |
| Redis purpose        | cache + session   | cache + session      | cache + rate limit + sse ringbuffer | `CacheStack`      |
| SQS queues           | per topic         | per topic            | per topic (FIFO where required)     | `EventBusStack`   |
| SQS DLQs             | per queue         | per queue            | per queue (max 3 retries)           | `EventBusStack`   |
| EventBridge bus      | default           | dedicated            | dedicated                           | `EventBusStack`   |
| EventBridge rules    | per-topic dispatch| per-topic dispatch   | per-topic dispatch                  | `EventBusStack`   |
| Kinesis (orderflow)  | none (use SQS)    | optional             | optional (high-fanout L2)           | `EventBusStack`   |

Event bus model: producers `PutEvents` to EventBridge; rules fan out
to SQS queues per consumer service. FIFO topics use SQS FIFO (with
content-based dedup); non-FIFO use standard.

---

## 6. Object storage — S3

| Bucket                            | Purpose                                | Versioning | Lifecycle              | Encryption | CDK stack       |
|-----------------------------------|----------------------------------------|------------|------------------------|------------|-----------------|
| `godsview-{env}-screenshots`      | Chart PNGs                             | yes        | IA after 30 d, glacier 365 d | KMS  | `StorageStack`  |
| `godsview-{env}-event-archive`    | Cold copy of every bus event           | yes        | glacier 30 d           | KMS        | `StorageStack`  |
| `godsview-{env}-backtest-artifacts` | Backtest equity csv, logs, trades    | yes        | IA 60 d, glacier 365 d | KMS        | `StorageStack`  |
| `godsview-{env}-replay-snapshots` | Replay-friendly day snapshots          | yes        | IA 90 d                | KMS        | `StorageStack`  |
| `godsview-{env}-models`           | Model artifacts (pkl, onnx)            | yes        | none (kept indefinitely) | KMS      | `StorageStack`  |
| `godsview-{env}-cdn-static`       | Web app static assets                  | no         | none                   | SSE-S3     | `StorageStack`  |
| `godsview-{env}-logs-archive`     | Structured logs, > 30 d                | no         | glacier 30 d           | KMS        | `StorageStack`  |
| `godsview-prod-dr-mirror`         | Cross-region copy of prod buckets      | yes        | glacier 7 d            | KMS        | `StorageStack`  |

All buckets:
- Block Public Access: ON
- Default encryption: KMS (per-account customer-managed key)
- Bucket policies enforce TLS-only access
- Access logs to `godsview-{env}-logs-archive`

---

## 7. Container registry

| Resource             | Detail                                                                |
|----------------------|-----------------------------------------------------------------------|
| ECR repos            | One per service, in `godsview-shared`. e.g. `gv/control-plane`        |
| Image scan on push   | enabled (basic + enhanced via Inspector)                              |
| Lifecycle            | retain last 30 images per service; delete untagged after 7 days       |
| Replication          | shared → staging, prod accounts (read-only)                           |

CDK stack: `EcrStack` (lives in `godsview-shared`).

---

## 8. Secrets & config

| Resource                    | Detail                                                                |
|-----------------------------|-----------------------------------------------------------------------|
| Secrets Manager             | All credentials (db, redis, broker, jwt private keys, hmac webhook secrets) |
| Rotation                    | DB: 30 d auto; broker keys: manual + alarm before expiry              |
| SSM Parameter Store         | Non-secret config (feature flag defaults, broker endpoints)           |
| KMS keys                    | One per env: `gv-{env}-data` (RDS, S3, secrets)                       |
| IAM Identity Center         | Human SSO; per-account role assumption                                |

CDK stack: `SecretsStack`.

---

## 9. Observability

| Resource                    | dev          | staging       | prod                                  | CDK stack       |
|-----------------------------|--------------|---------------|---------------------------------------|-----------------|
| CloudWatch log groups       | per service  | per service   | per service (90 d retention)          | `ObsStack`      |
| Metric filters              | basic        | full          | full                                  | `ObsStack`      |
| CloudWatch dashboards       | none         | per-service   | per-service + roll-up                 | `ObsStack`      |
| CloudWatch alarms           | none         | warn-level    | warn + page-level                     | `ObsStack`      |
| X-Ray tracing               | off          | on            | on (10 % sample, 100 % errors)        | `ObsStack`      |
| Prometheus / Grafana        | local-only   | self-hosted   | AMP + AMG (managed)                   | `ObsStack`      |
| OpenTelemetry collectors    | sidecar      | sidecar       | sidecar                               | `ObsStack`      |
| SNS topics                  | n/a          | `gv-staging-alerts` | `gv-prod-pageable`, `gv-prod-warn` | `ObsStack`      |
| PagerDuty integration       | n/a          | warn only     | full (P1/P2 paging)                   | `ObsStack`      |

Log retention by tier:
- `app/*` — 90 d hot, then archive S3 365 d
- `audit/*` — 365 d hot, then S3 7 y (compliance)
- `vpc-flow/*` — 90 d hot

---

## 10. CI/CD

| Resource                    | Detail                                                                |
|-----------------------------|-----------------------------------------------------------------------|
| GitHub Actions (primary CI) | Runs lint, type, unit, integration tests, contract validation         |
| GitHub OIDC → AWS           | Per-environment role assumption; no long-lived AWS keys in GH         |
| ECR push                    | From `main` branch on tag                                             |
| CodeDeploy (ECS Blue/Green) | Prod only; staging uses rolling                                       |
| CodePipeline                | Optional orchestrator if GH Actions hits limits                       |
| Image signing (cosign)      | Yes, verified at deploy time                                          |

CDK stack: `CicdStack` (per env account).

---

## 11. Backups, DR, and runbooks

- **RPO target:** 5 min (RDS PITR + S3 cross-region replication).
- **RTO target:** 30 min (DR region warm standby promotion).
- **Quarterly DR drill:** restore prod RDS snapshot into us-east-2,
  bring up subset of services, verify `/v1/ops/health` reports OK on
  the DR set.
- **Backup vault:** AWS Backup for RDS + EFS (if added) + S3, retention
  matching per-bucket lifecycle.
- **Runbooks:** every alarm has a `Runbook URL` annotation pointing
  to a `cp: /v1/runbooks/:id` page.

---

## 12. Cost estimate (monthly, prod, USD)

Order-of-magnitude only. Phase 13 ships the actual Cost Explorer
dashboards.

| Category               | Estimate     | Notes                                          |
|------------------------|--------------|------------------------------------------------|
| ECS Fargate            | ~$1,400      | ~30 baseline tasks, average 1.5 vCPU / 3 GiB   |
| RDS (Multi-AZ + replica)| ~$700       | r7g.xlarge writer + r7g.large replica + storage|
| ElastiCache Redis      | ~$280        | 2× r7g.large                                   |
| ALB + CloudFront + R53 | ~$120        | Modest traffic; CDN cache hit ~70 %            |
| NAT Gateways (3)       | ~$130        | Plus data transfer ~$60                        |
| S3 + lifecycle         | ~$80         | Mostly screenshots + event archive             |
| SQS + EventBridge      | ~$40         | Scales with event volume                       |
| CloudWatch + X-Ray     | ~$160        | Logs are the largest contributor               |
| AMP + AMG              | ~$120        | Managed Prometheus + Grafana                   |
| Secrets Manager        | ~$15         | ~30 secrets                                    |
| KMS                    | ~$5          | A few CMKs                                     |
| ECR                    | ~$10         | Cross-account replication                      |
| Backups (AWS Backup)   | ~$50         | RDS + S3                                       |
| **Sub-total**          | **~$3,110**  | Excludes broker fees and market data          |
| Buffer (15 %)          | ~$470        |                                                |
| **Estimated total**    | **~$3,580**  | Per month, single prod environment             |

Staging adds ~$700/month (smaller everything, no Multi-AZ, no replica).
Dev adds ~$200/month (single AZ, smallest sizes, no Multi-AZ).

---

## 13. IAM principals (operator-facing)

Created via IAM Identity Center groups, mapped to per-account roles.

| Group               | Accounts          | Permissions summary                                   |
|---------------------|-------------------|-------------------------------------------------------|
| `gv-admins`         | shared, staging, prod | Full admin                                       |
| `gv-engineers`      | shared, staging   | Read + deploy via CodeDeploy; prod read-only          |
| `gv-on-call`        | prod              | Read + restart ECS services + ack alarms              |
| `gv-analysts`       | prod (read-only)  | Read RDS via SSM tunnel; no write                     |

Service tasks assume execution roles scoped to the minimum AWS APIs
they need. No `*` IAM in any task role.

---

## 14. CDK stack roll-up (Phase 13 deliverable)

`infra/cdk/bin/godsview.ts` instantiates per-environment app, then
each stack:

```
NetworkStack          -> VPC, subnets, NAT, endpoints
EdgeStack             -> ALB, ACM, CloudFront, Route 53, WAF
DatabaseStack         -> RDS + replica + DR replica
CacheStack            -> ElastiCache
EventBusStack         -> EventBridge + SQS topics
StorageStack          -> S3 buckets
EcrStack              -> ECR repos (in shared account)
SecretsStack          -> KMS keys, Secrets Manager, SSM
ObsStack              -> Logs, alarms, dashboards, AMP/AMG
ControlPlaneStack     -> ECS service
IngestionStack        -> ECS service
OrderFlowStack        -> ECS service
BacktestStack         -> ECS service + worker autoscaling
CalibrationStack      -> ECS service
PromotionStack        -> ECS service
IntelligenceStack     -> ECS service
ExecutionStack        -> ECS service (Multi-AZ pinned)
ScreenshotStack       -> ECS service
ReplayStack           -> ECS service (scale-to-zero)
WebAppStack           -> ECS service for Next.js
CicdStack             -> CodePipeline / CodeDeploy
```

`cdk synth` per environment is checked into `infra/cdk/cdk.out/` so
diffs are reviewable in PRs.

---

## 15. What's not in v1 (deliberate)

- **Multi-region active/active.** us-east-1 active + us-east-2 warm
  only. Active/active needs cross-region writes (Aurora Global) and
  doubles the bill; not justified by current latency budget.
- **EKS / Kubernetes.** ECS Fargate is sufficient and substantially
  simpler. Revisit if we need workloads that don't fit Fargate (GPU,
  privileged).
- **Lambda.** Used only for narrow glue (e.g., S3 → SNS notifications,
  scheduled snapshot triggers). All product code is on ECS.
- **AWS-native LLM (Bedrock) for agents.** Phase 10 starts with model
  routing through the existing inference path; Bedrock is an option
  but not the v1 default.
- **DocumentDB / DynamoDB.** Postgres + pgvector covers our workload.

---

## 16. Phase 13 acceptance criteria

The infra phase is "done" when:

1. `cdk deploy --all` to a clean staging account succeeds end-to-end.
2. All ECS services report healthy on ALB target groups within 10 min.
3. RDS Multi-AZ failover test (manual reboot with failover) preserves
   < 60 s of write unavailability.
4. S3 cross-region replication observed within 60 s in DR bucket.
5. SQS DLQ alarms fire on a synthetic poison message.
6. PagerDuty receives a synthetic SNS test page.
7. Cost Explorer tag-by-`Environment` reports per-env spend.
8. Quarterly DR drill runbook executed dry-run end-to-end.

---

**End of AWS_RESOURCES.md**
