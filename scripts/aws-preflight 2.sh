#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# GodsView — AWS deploy preflight
#
# Verifies the local machine is ready to run `bash scripts/aws-deploy.sh`
# against the target AWS account. This script is READ-ONLY: it does not
# create any AWS resources. Run it any time you want a fast green/red
# answer on whether the next deploy will explode during bootstrap.
#
# Usage:
#   bash scripts/aws-preflight.sh                 # default: env=dev region=us-east-1
#   AWS_PROFILE=godsview bash scripts/aws-preflight.sh
#   GV_ENV=prod GV_REGION=us-east-1 bash scripts/aws-preflight.sh
#
# Exit codes:
#   0   all checks passed — safe to run aws-deploy.sh
#   1   at least one check failed — fix before deploying
#
# Environment:
#   GV_ENV        dev | prod        (default: dev)
#   GV_REGION     AWS region        (default: us-east-1)
#   AWS_PROFILE   AWS CLI profile   (default: whatever is in your env)
# -----------------------------------------------------------------------------
set -euo pipefail

GV_ENV="${GV_ENV:-dev}"
GV_REGION="${GV_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"

# --- output helpers --------------------------------------------------------
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; NC=$'\033[0m'
pass() { printf "  %sok%s    %s\n" "$GREEN" "$NC" "$1"; }
warn() { printf "  %swarn%s  %s\n" "$YELLOW" "$NC" "$1"; WARNINGS=$((WARNINGS+1)); }
fail() { printf "  %sfail%s  %s\n" "$RED" "$NC" "$1"; FAILURES=$((FAILURES+1)); }
hdr()  { printf "\n%s▸ %s%s\n" "$BOLD" "$1" "$NC"; }

FAILURES=0
WARNINGS=0

printf "%sGodsView preflight — env=%s region=%s%s\n" "$BOLD" "$GV_ENV" "$GV_REGION" "$NC"

# --- 1. local toolchain ----------------------------------------------------
hdr "1. Local toolchain"

if command -v node >/dev/null 2>&1; then
  NODE_V=$(node --version | sed 's/^v//')
  NODE_MAJOR=${NODE_V%%.*}
  if [ "$NODE_MAJOR" -ge 20 ]; then
    pass "node v$NODE_V (≥ v20)"
  else
    fail "node v$NODE_V — need ≥ v20"
  fi
else
  fail "node not found"
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_V=$(pnpm --version)
  PNPM_MAJOR=${PNPM_V%%.*}
  if [ "$PNPM_MAJOR" -ge 9 ]; then
    pass "pnpm v$PNPM_V (≥ v9)"
  else
    fail "pnpm v$PNPM_V — need ≥ v9"
  fi
else
  fail "pnpm not found"
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    pass "docker daemon reachable"
  else
    fail "docker CLI found but daemon is not running"
  fi
else
  fail "docker not found (needed for api-server image build + push)"
fi

if command -v aws >/dev/null 2>&1; then
  AWS_V=$(aws --version 2>&1 | head -1)
  pass "aws CLI ($AWS_V)"
else
  fail "aws CLI not found — install from https://aws.amazon.com/cli/"
fi

if command -v npx >/dev/null 2>&1; then
  if npx --no-install cdk --version >/dev/null 2>&1; then
    CDK_V=$(npx --no-install cdk --version)
    pass "aws-cdk ($CDK_V)"
  elif command -v cdk >/dev/null 2>&1; then
    CDK_V=$(cdk --version)
    pass "aws-cdk ($CDK_V, globally installed)"
  else
    warn "aws-cdk not found globally — will use npx after pnpm install"
  fi
fi

# --- 2. AWS identity + region ---------------------------------------------
hdr "2. AWS identity + region"

if command -v aws >/dev/null 2>&1; then
  if IDENTITY=$(aws sts get-caller-identity --output json 2>/dev/null); then
    AWS_ACCOUNT=$(printf '%s' "$IDENTITY" | grep -o '"Account": "[0-9]*"' | grep -o '[0-9]*')
    AWS_ARN=$(printf '%s' "$IDENTITY" | grep -o '"Arn": "[^"]*"' | cut -d'"' -f4)
    pass "sts: account=$AWS_ACCOUNT"
    pass "sts: arn=$AWS_ARN"
    export CDK_DEFAULT_ACCOUNT="$AWS_ACCOUNT"
    export CDK_DEFAULT_REGION="$GV_REGION"
  else
    fail "aws sts get-caller-identity failed — run 'aws configure' or set AWS_PROFILE"
    AWS_ACCOUNT=""
  fi
else
  AWS_ACCOUNT=""
fi

# --- 3. CDK bootstrap state ------------------------------------------------
hdr "3. CDK bootstrap"

if [ -n "${AWS_ACCOUNT:-}" ] && command -v aws >/dev/null 2>&1; then
  if aws cloudformation describe-stacks --stack-name CDKToolkit \
        --region "$GV_REGION" >/dev/null 2>&1; then
    pass "CDKToolkit stack present in $GV_REGION"
  else
    warn "CDKToolkit not found in $GV_REGION — aws-deploy.sh will bootstrap on first run"
  fi
fi

# --- 4. Secrets Manager entries --------------------------------------------
hdr "4. Secrets Manager"

REQUIRED_SECRETS=(
  "godsview/${GV_ENV}/alpaca"
  "godsview/${GV_ENV}/anthropic"
  "godsview/${GV_ENV}/operator-token"
  "godsview/${GV_ENV}/alert-webhook-url"
)

if [ -n "${AWS_ACCOUNT:-}" ] && command -v aws >/dev/null 2>&1; then
  for SECRET in "${REQUIRED_SECRETS[@]}"; do
    if aws secretsmanager describe-secret --secret-id "$SECRET" \
          --region "$GV_REGION" >/dev/null 2>&1; then
      pass "secret present: $SECRET"
    else
      warn "secret missing: $SECRET (DataStack will create a placeholder; rotate after deploy)"
    fi
  done
else
  warn "skipped — aws CLI or credentials not available"
fi

# --- 5. ACM cert + Route 53 (prod only) -----------------------------------
hdr "5. ACM + Route 53 (prod)"

if [ "$GV_ENV" = "prod" ] && [ -n "${AWS_ACCOUNT:-}" ] && command -v aws >/dev/null 2>&1; then
  # Look for any ISSUED cert tagged Project=GodsView.
  CERT_COUNT=$(aws acm list-certificates --region "$GV_REGION" \
                 --certificate-statuses ISSUED --query 'length(CertificateSummaryList)' \
                 --output text 2>/dev/null || echo "0")
  if [ "$CERT_COUNT" -gt 0 ]; then
    pass "acm: $CERT_COUNT ISSUED certificate(s) in $GV_REGION"
  else
    warn "acm: no ISSUED certificates in $GV_REGION — ALB will use the default ACM cert or require manual wiring"
  fi

  ZONE_COUNT=$(aws route53 list-hosted-zones --query 'length(HostedZones)' --output text 2>/dev/null || echo "0")
  if [ "$ZONE_COUNT" -gt 0 ]; then
    pass "route53: $ZONE_COUNT hosted zone(s) visible"
  else
    warn "route53: no hosted zones — DNS cutover will require manual configuration"
  fi
else
  printf "  (skipped for env=%s)\n" "$GV_ENV"
fi

# --- 6. Repo layout sanity -------------------------------------------------
hdr "6. Repo layout"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
for PATH_CHECK in \
    "$REPO_ROOT/infra/package.json" \
    "$REPO_ROOT/infra/bin/app.ts" \
    "$REPO_ROOT/artifacts/api-server/build.mjs" \
    "$REPO_ROOT/artifacts/godsview-dashboard/vite.config.ts" \
    "$REPO_ROOT/Dockerfile"; do
  if [ -f "$PATH_CHECK" ]; then
    pass "present: $(realpath --relative-to="$REPO_ROOT" "$PATH_CHECK")"
  else
    fail "missing: $PATH_CHECK"
  fi
done

# --- summary ---------------------------------------------------------------
printf "\n%sSummary%s  failures=%d  warnings=%d\n" "$BOLD" "$NC" "$FAILURES" "$WARNINGS"

if [ "$FAILURES" -gt 0 ]; then
  printf "%sPreflight failed — fix the checks above before running aws-deploy.sh%s\n" "$RED" "$NC"
  exit 1
fi

printf "%sPreflight passed — safe to run: bash scripts/aws-deploy.sh%s\n" "$GREEN" "$NC"
exit 0
