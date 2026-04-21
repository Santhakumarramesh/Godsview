#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# GodsView — Railway teardown
#
# Cleanly removes the Railway deployment AFTER verifying the AWS
# deployment is serving traffic. Hard-aborts if AWS ALB is not healthy —
# we never leave GodsView with no live endpoint.
#
# Usage:
#   RAILWAY_SERVICE=godsview bash scripts/railway-teardown.sh
#   RAILWAY_SERVICE=godsview GV_YES=1 bash scripts/railway-teardown.sh  # no prompts
#
# Required environment:
#   RAILWAY_SERVICE    Name of the Railway service to tear down
#   GV_ENV             dev | prod   (default: prod — we gate on the
#                                    env that should be serving live users)
#   GV_REGION          AWS region   (default: us-east-1)
#
# Optional:
#   RAILWAY_PROJECT    Railway project ID (if `railway link` already done,
#                      not needed)
#   GV_YES             skip confirmation prompts
#   GV_SKIP_AWS_CHECK  skip the "AWS must be serving" gate (DANGEROUS)
# -----------------------------------------------------------------------------
set -euo pipefail

RAILWAY_SERVICE="${RAILWAY_SERVICE:-}"
GV_ENV="${GV_ENV:-prod}"
GV_REGION="${GV_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
GV_YES="${GV_YES:-0}"
GV_SKIP_AWS_CHECK="${GV_SKIP_AWS_CHECK:-0}"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
step() { printf "\n%s%s▸ %s%s\n" "$BOLD" "$BLUE" "$1" "$NC"; }
ok()   { printf "  %sok%s   %s\n" "$GREEN" "$NC" "$1"; }
die()  { printf "%s✗ %s%s\n" "$RED" "$1" "$NC"; exit 1; }
warn() { printf "  %swarn%s %s\n" "$YELLOW" "$NC" "$1"; }

[ -n "$RAILWAY_SERVICE" ] || die "RAILWAY_SERVICE is required. Example: RAILWAY_SERVICE=godsview bash scripts/railway-teardown.sh"

printf "%sGodsView Railway teardown — service=%s (AWS gate env=%s)%s\n" \
  "$BOLD" "$RAILWAY_SERVICE" "$GV_ENV" "$NC"

# --- 1. Tooling ------------------------------------------------------------
step "1/5  Tooling"
command -v railway >/dev/null 2>&1 || \
  die "railway CLI not found — install from https://docs.railway.com/guides/cli"
ok "railway CLI present ($(railway --version 2>&1 | head -1))"

if ! railway whoami >/dev/null 2>&1; then
  die "not logged in to Railway — run: railway login"
fi
ok "railway authenticated"

# --- 2. AWS gate — AWS MUST be serving live traffic -----------------------
step "2/5  AWS gate (must be serving before Railway teardown)"

if [ "$GV_SKIP_AWS_CHECK" = "1" ]; then
  warn "AWS gate skipped (GV_SKIP_AWS_CHECK=1) — make sure you know what you're doing"
else
  command -v aws >/dev/null 2>&1 || die "aws CLI required for the AWS gate"

  ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name "godsview-${GV_ENV}-compute" \
    --region "$GV_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='AlbDns'].OutputValue" \
    --output text 2>/dev/null || echo "")

  [ -n "$ALB_DNS" ] && [ "$ALB_DNS" != "None" ] || \
    die "godsview-${GV_ENV}-compute has no AlbDns output — is AWS deployed?"

  API_URL="http://${ALB_DNS}"
  HEALTH=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/healthz" || echo "000")
  READY=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/readyz" || echo "000")

  [ "$HEALTH" = "200" ] || die "AWS /api/healthz returned $HEALTH — refusing to tear down Railway"
  [ "$READY"  = "200" ] || die "AWS /api/readyz returned $READY — refusing to tear down Railway"
  ok "AWS /api/healthz 200"
  ok "AWS /api/readyz  200"

  # Probe scheduler status too — if the promotion cron isn't ticking,
  # we're not really "serving" in the GodsView sense.
  SCHED=$(curl -sf "$API_URL/api/governance/scheduler/status" 2>/dev/null || echo "")
  if printf '%s' "$SCHED" | grep -q '"status":"running"'; then
    ok "AWS promotion scheduler running"
  else
    warn "promotion scheduler status not 'running' — verify before tearing down"
    [ "$GV_YES" = "1" ] || {
      printf "%sContinue anyway? Type %syes%s to proceed: %s" "$YELLOW" "$BOLD" "$YELLOW" "$NC"
      read -r CONFIRM
      [ "$CONFIRM" = "yes" ] || die "aborted"
    }
  fi
fi

# --- 3. Confirm -----------------------------------------------------------
step "3/5  Confirm teardown"

railway status 2>/dev/null || die "railway status failed — run 'railway link' in the service dir first"

if [ "$GV_YES" != "1" ]; then
  printf "%sAbout to tear down Railway service '%s'.%s\n" "$YELLOW" "$RAILWAY_SERVICE" "$NC"
  printf "%sType %sdelete %s%s to continue: %s" "$YELLOW" "$BOLD" "$RAILWAY_SERVICE" "$YELLOW" "$NC"
  read -r CONFIRM
  [ "$CONFIRM" = "delete $RAILWAY_SERVICE" ] || die "aborted"
fi

# --- 4. railway down + service delete -------------------------------------
step "4/5  Teardown"

# Stop all active deployments for the service (non-destructive first step).
if railway down --yes 2>&1 | tee /tmp/railway-down.log; then
  ok "railway down complete"
else
  warn "railway down returned non-zero — check /tmp/railway-down.log"
fi

# Delete the service itself. Fall back to the interactive form if --yes
# isn't supported by the installed railway version.
if railway service delete --service "$RAILWAY_SERVICE" --yes 2>/dev/null; then
  ok "railway service '$RAILWAY_SERVICE' deleted"
elif echo "y" | railway service delete --service "$RAILWAY_SERVICE" 2>/dev/null; then
  ok "railway service '$RAILWAY_SERVICE' deleted (interactive)"
else
  warn "could not delete the service via CLI — finish manually in the Railway dashboard: https://railway.com/"
fi

# --- 5. Verify it's gone --------------------------------------------------
step "5/5  Verify"

if railway service list 2>/dev/null | grep -q "^$RAILWAY_SERVICE\$"; then
  warn "service still listed — may take a few seconds to drop"
else
  ok "service no longer listed"
fi

cat <<EOF

${GREEN}${BOLD}Railway teardown complete${NC}

What's left on Railway:
  - Railway *project* is preserved. If you want the project deleted too,
    do that in the dashboard.
  - Any managed databases on Railway are preserved. If you migrated them
    to RDS (see docs/RAILWAY_TO_AWS_CUTOVER.md §4), delete them manually
    once you've snapshotted.

What's next on AWS:
  - Watch the api-server CloudWatch Logs for 24h.
  - Watch SLO burn rates: $API_URL/api/slo/budgets
  - If anything degrades, roll back via:
      aws ecs update-service --cluster godsview-${GV_ENV}-cluster \\
        --service godsview-${GV_ENV}-api --force-new-deployment

EOF
