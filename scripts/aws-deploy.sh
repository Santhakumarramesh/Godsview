#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# GodsView — AWS deploy (turnkey)
#
# Idempotent end-to-end deploy:
#   1. Runs preflight (aws-preflight.sh). Aborts on failure.
#   2. CDK bootstrap if CDKToolkit stack is missing.
#   3. Installs dependencies (pnpm install --frozen-lockfile).
#   4. Builds api-server image locally, pushes to the ECR repo created by
#      the StorageStack.
#   5. Builds the dashboard (vite) and syncs the bundle to the S3 bucket
#      created by the StorageStack.
#   6. `cdk deploy --all -c env=<GV_ENV>`.
#   7. Polls the ALB /api/healthz and /api/readyz until healthy (or fails
#      after 10 minutes).
#   8. Prints cutover instructions (DNS + RAILWAY teardown).
#
# Usage:
#   bash scripts/aws-deploy.sh                           # dev deploy
#   GV_ENV=prod bash scripts/aws-deploy.sh               # prod deploy
#   GV_ENV=dev GV_SKIP_BUILD=1 bash scripts/aws-deploy.sh  # infra-only
#   GV_ENV=dev GV_YES=1 bash scripts/aws-deploy.sh       # non-interactive
#
# Required before running:
#   - You already ran `bash scripts/aws-preflight.sh` and it passed.
#   - $AWS_PROFILE (or default profile) points at the correct account.
#
# Environment:
#   GV_ENV          dev | prod            (default: dev)
#   GV_REGION       AWS region            (default: us-east-1)
#   GV_SKIP_BUILD   skip image/bundle builds   (default: 0)
#   GV_YES          skip confirmation prompts  (default: 0, except dev)
#   GV_IMAGE_TAG    api image tag              (default: git short SHA)
# -----------------------------------------------------------------------------
set -euo pipefail

GV_ENV="${GV_ENV:-dev}"
GV_REGION="${GV_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
GV_SKIP_BUILD="${GV_SKIP_BUILD:-0}"
GV_YES="${GV_YES:-0}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

GIT_SHA="$(git rev-parse --short HEAD)"
GV_IMAGE_TAG="${GV_IMAGE_TAG:-$GIT_SHA}"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
step() { printf "\n%s%s▸ %s%s\n" "$BOLD" "$BLUE" "$1" "$NC"; }
ok()   { printf "  %sok%s   %s\n" "$GREEN" "$NC" "$1"; }
die()  { printf "%s✗ %s%s\n" "$RED" "$1" "$NC"; exit 1; }

printf "%sGodsView AWS deploy — env=%s region=%s tag=%s%s\n" \
  "$BOLD" "$GV_ENV" "$GV_REGION" "$GV_IMAGE_TAG" "$NC"

# --- confirm if prod -------------------------------------------------------
if [ "$GV_ENV" = "prod" ] && [ "$GV_YES" != "1" ]; then
  printf "%s⚠ prod deploy. Type %syes%s to continue: %s" "$YELLOW" "$BOLD" "$YELLOW" "$NC"
  read -r CONFIRM
  [ "$CONFIRM" = "yes" ] || die "aborted"
fi

# --- 1. preflight ----------------------------------------------------------
step "1/7  Preflight"
GV_ENV="$GV_ENV" GV_REGION="$GV_REGION" bash scripts/aws-preflight.sh \
  || die "preflight failed"

AWS_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_ACCOUNT="$AWS_ACCOUNT"
export CDK_DEFAULT_REGION="$GV_REGION"
ok "identity account=$AWS_ACCOUNT region=$GV_REGION"

# --- 2. CDK bootstrap ------------------------------------------------------
step "2/7  CDK bootstrap"
if aws cloudformation describe-stacks --stack-name CDKToolkit \
      --region "$GV_REGION" >/dev/null 2>&1; then
  ok "CDKToolkit already present"
else
  (cd infra && pnpm install --frozen-lockfile && \
     npx cdk bootstrap "aws://$AWS_ACCOUNT/$GV_REGION") \
    || die "cdk bootstrap failed"
  ok "bootstrapped aws://$AWS_ACCOUNT/$GV_REGION"
fi

# --- 3. Install + typecheck + test ----------------------------------------
step "3/7  Install + typecheck + test"
pnpm install --frozen-lockfile
./node_modules/.bin/tsc --build
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/godsview-dashboard test
ok "install + typecheck + tests green"

# --- 4. Build dashboard + sync to S3 --------------------------------------
step "4/7  Dashboard build + S3 sync"
if [ "$GV_SKIP_BUILD" = "1" ]; then
  ok "skipped (GV_SKIP_BUILD=1)"
else
  pnpm --filter @workspace/godsview-dashboard build
  DASHBOARD_DIST="artifacts/godsview-dashboard/dist"
  DASHBOARD_BUCKET="godsview-${GV_ENV}-dashboard-${AWS_ACCOUNT}"
  if aws s3api head-bucket --bucket "$DASHBOARD_BUCKET" --region "$GV_REGION" 2>/dev/null; then
    aws s3 sync "$DASHBOARD_DIST" "s3://$DASHBOARD_BUCKET/" \
      --delete --region "$GV_REGION"
    ok "synced to s3://$DASHBOARD_BUCKET/"
  else
    ok "bucket $DASHBOARD_BUCKET not yet created — deferred until after CDK deploy"
  fi
fi

# --- 5. Build + push api image --------------------------------------------
step "5/7  API image build + ECR push"
ECR_REPO="godsview-${GV_ENV}-api"
ECR_URI="${AWS_ACCOUNT}.dkr.ecr.${GV_REGION}.amazonaws.com/${ECR_REPO}"

if [ "$GV_SKIP_BUILD" = "1" ]; then
  ok "skipped (GV_SKIP_BUILD=1)"
else
  if ! aws ecr describe-repositories --repository-names "$ECR_REPO" \
        --region "$GV_REGION" >/dev/null 2>&1; then
    ok "ECR repo $ECR_REPO will be created by StorageStack — deferring image push"
    GV_DEFERRED_IMAGE_PUSH=1
  else
    aws ecr get-login-password --region "$GV_REGION" \
      | docker login --username AWS --password-stdin "$ECR_URI" >/dev/null
    docker build \
      --platform linux/arm64 \
      -t "$ECR_URI:$GV_IMAGE_TAG" \
      -t "$ECR_URI:latest" \
      -f Dockerfile .
    docker push "$ECR_URI:$GV_IMAGE_TAG"
    docker push "$ECR_URI:latest"
    ok "pushed $ECR_URI:$GV_IMAGE_TAG"
  fi
fi

# --- 6. CDK deploy ---------------------------------------------------------
step "6/7  cdk deploy --all -c env=$GV_ENV"
DEPLOY_CMD="deploy:dev"
[ "$GV_ENV" = "prod" ] && DEPLOY_CMD="deploy:prod"
(cd infra && pnpm run "$DEPLOY_CMD") || die "cdk deploy failed"
ok "cdk deploy complete"

# If the ECR repo didn't exist earlier, push the image now.
if [ "${GV_DEFERRED_IMAGE_PUSH:-0}" = "1" ] && [ "$GV_SKIP_BUILD" != "1" ]; then
  step "6b  API image push (post-CDK)"
  aws ecr get-login-password --region "$GV_REGION" \
    | docker login --username AWS --password-stdin "$ECR_URI" >/dev/null
  docker build --platform linux/arm64 \
    -t "$ECR_URI:$GV_IMAGE_TAG" -t "$ECR_URI:latest" \
    -f Dockerfile .
  docker push "$ECR_URI:$GV_IMAGE_TAG"
  docker push "$ECR_URI:latest"
  ok "pushed $ECR_URI:$GV_IMAGE_TAG"

  # Force ECS to pick up the freshly pushed image.
  CLUSTER="godsview-${GV_ENV}-cluster"
  SERVICE="godsview-${GV_ENV}-api"
  if aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
        --region "$GV_REGION" >/dev/null 2>&1; then
    aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
      --force-new-deployment --region "$GV_REGION" >/dev/null
    ok "forced new ECS deployment on $CLUSTER/$SERVICE"
  fi
fi

# Sync dashboard bundle now if it was deferred above.
if [ "$GV_SKIP_BUILD" != "1" ]; then
  DASHBOARD_BUCKET="godsview-${GV_ENV}-dashboard-${AWS_ACCOUNT}"
  if aws s3api head-bucket --bucket "$DASHBOARD_BUCKET" --region "$GV_REGION" 2>/dev/null; then
    aws s3 sync "artifacts/godsview-dashboard/dist" "s3://$DASHBOARD_BUCKET/" \
      --delete --region "$GV_REGION" >/dev/null
    ok "dashboard bundle synced (post-CDK)"
  fi
fi

# --- 7. Health probe -------------------------------------------------------
step "7/7  Health probe"
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name "godsview-${GV_ENV}-compute" \
  --region "$GV_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDns'].OutputValue" \
  --output text 2>/dev/null || echo "")

DASHBOARD_URL=$(aws cloudformation describe-stacks \
  --stack-name "godsview-${GV_ENV}-compute" \
  --region "$GV_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DashboardUrl'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [ -z "$ALB_DNS" ] || [ "$ALB_DNS" = "None" ]; then
  die "could not find AlbDns output on godsview-${GV_ENV}-compute — deploy may have failed"
fi

API_URL="http://${ALB_DNS}"

# Wait up to 10 minutes for healthz to go green.
for i in $(seq 1 60); do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/healthz" || echo "000")
  if [ "$STATUS" = "200" ]; then
    ok "api/healthz  200 after ${i}0s"
    break
  fi
  sleep 10
  [ "$i" = "60" ] && die "api/healthz never returned 200 (timed out at 10 min)"
done

READY=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/readyz" || echo "000")
[ "$READY" = "200" ] && ok "api/readyz   200" \
  || printf "  %swarn%s api/readyz returned %s (may still be warming)\n" "$YELLOW" "$NC" "$READY"

# --- done ------------------------------------------------------------------
printf "\n%sDeploy complete%s\n" "$GREEN$BOLD" "$NC"
printf "  API ALB:        %s\n" "$API_URL"
[ -n "$DASHBOARD_URL" ] && [ "$DASHBOARD_URL" != "None" ] \
  && printf "  Dashboard URL:  %s\n" "$DASHBOARD_URL"
printf "  Image tag:      %s\n" "$GV_IMAGE_TAG"

cat <<EOF

Next steps:

  1. Run an operator smoke test:
       curl -sf $API_URL/api/healthz   | jq .
       curl -sf $API_URL/api/readyz    | jq .
       curl -sf $API_URL/api/governance/scheduler/status | jq '.status, .lastRunAt'

  2. Switch DNS to point at the AWS ALB / CloudFront. See:
       docs/RAILWAY_TO_AWS_CUTOVER.md

  3. After 24h of green metrics on AWS, tear down Railway:
       RAILWAY_SERVICE=<service-name> bash scripts/railway-teardown.sh

EOF
