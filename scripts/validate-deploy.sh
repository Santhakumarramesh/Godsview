#!/usr/bin/env bash
#
# GodsView Deployment Validation Script
#
# Performs comprehensive validation of GodsView deployment infrastructure.
# Checks prerequisites, environment, Docker builds, database connectivity,
# Redis connectivity, and deployed service health.
#
# Usage:
#   bash scripts/validate-deploy.sh              # validate dev environment
#   GV_ENV=prod bash scripts/validate-deploy.sh  # validate prod environment
#   GV_ENV=dev bash scripts/validate-deploy.sh --verbose
#
# Exit codes:
#   0 = All checks passed
#   1 = One or more checks failed
#   2 = Prerequisites missing, cannot proceed
#

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────

GV_ENV="${GV_ENV:-dev}"
GV_REGION="${GV_REGION:-us-east-1}"
VERBOSE="${VERBOSE:-0}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Tracking
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_SKIPPED=0
FAILED_CHECKS=()

# ──────────────────────────────────────────────────────────────────────────
# Utility Functions
# ──────────────────────────────────────────────────────────────────────────

log_section() {
    printf "\n%s%s══════════════════════════════════════════════════════════════%s\n" "$BOLD" "$BLUE" "$NC"
    printf "%s%s  %s%s\n" "$BOLD" "$BLUE" "$1" "$NC"
    printf "%s%s══════════════════════════════════════════════════════════════%s\n" "$BOLD" "$BLUE" "$NC"
}

log_check() {
    printf "%s▸ %s%s" "$BOLD" "$1" "$NC"
}

check_pass() {
    printf " %s[PASS]%s\n" "$GREEN" "$NC"
    ((CHECKS_PASSED++))
}

check_fail() {
    printf " %s[FAIL]%s\n" "$RED" "$NC"
    FAILED_CHECKS+=("$1")
    ((CHECKS_FAILED++))
}

check_skip() {
    printf " %s[SKIP]%s\n" "$YELLOW" "$NC"
    ((CHECKS_SKIPPED++))
}

check_warn() {
    printf " %s[WARN]%s\n" "$YELLOW" "$NC"
}

debug_log() {
    if [[ "$VERBOSE" == "1" ]]; then
        printf "  %s→ %s%s\n" "$YELLOW" "$1" "$NC"
    fi
}

error_detail() {
    printf "    %s✗ %s%s\n" "$RED" "$1" "$NC"
}

success_detail() {
    printf "    %s✓ %s%s\n" "$GREEN" "$1" "$NC"
}

# ──────────────────────────────────────────────────────────────────────────
# Environment Setup
# ──────────────────────────────────────────────────────────────────────────

validate_environment() {
    log_section "ENVIRONMENT SETUP"

    # Check environment variable
    log_check "Environment is '$GV_ENV'"
    if [[ "$GV_ENV" != "dev" && "$GV_ENV" != "prod" ]]; then
        check_fail "Invalid GV_ENV (expected 'dev' or 'prod')"
        return 1
    fi
    check_pass

    # Check region
    log_check "AWS region is '$GV_REGION'"
    check_pass

    # Get repo root
    REPO_ROOT="$(git rev-parse --show-toplevel)" || {
        check_fail "Not a git repository"
        return 1
    }
    debug_log "Repository root: $REPO_ROOT"
    cd "$REPO_ROOT"
}

# ──────────────────────────────────────────────────────────────────────────
# Prerequisite Checks
# ──────────────────────────────────────────────────────────────────────────

check_prerequisites() {
    log_section "PREREQUISITES"

    # AWS CLI
    log_check "AWS CLI installed and configured"
    if ! command -v aws &> /dev/null; then
        check_fail "AWS CLI not found"
        return 2
    fi
    AWS_VERSION=$(aws --version | cut -d' ' -f1)
    debug_log "AWS CLI version: $AWS_VERSION"
    check_pass

    # AWS credentials
    log_check "AWS credentials configured"
    if ! aws sts get-caller-identity &> /dev/null; then
        check_fail "AWS credentials invalid or not configured"
        return 2
    fi
    ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
    debug_log "AWS Account: $ACCOUNT_ID"
    check_pass

    # Docker
    log_check "Docker daemon running"
    if ! command -v docker &> /dev/null; then
        check_fail "Docker not installed"
        return 2
    fi
    if ! docker ps &> /dev/null; then
        check_fail "Docker daemon not running or no permission"
        return 2
    fi
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
    debug_log "Docker version: $DOCKER_VERSION"
    check_pass

    # Node.js
    log_check "Node.js installed"
    if ! command -v node &> /dev/null; then
        check_fail "Node.js not installed"
        return 2
    fi
    NODE_VERSION=$(node --version | tr -d 'v')
    debug_log "Node.js version: $NODE_VERSION"
    check_pass

    # pnpm
    log_check "pnpm package manager installed"
    if ! command -v pnpm &> /dev/null; then
        check_fail "pnpm not installed"
        return 2
    fi
    PNPM_VERSION=$(pnpm --version)
    debug_log "pnpm version: $PNPM_VERSION"
    check_pass

    # jq (optional but recommended)
    log_check "jq JSON processor installed"
    if ! command -v jq &> /dev/null; then
        check_warn
        debug_log "jq not found (optional, some checks may be limited)"
    else
        check_pass
    fi

    # CDK
    log_check "AWS CDK installed"
    if ! command -v cdk &> /dev/null; then
        check_fail "AWS CDK not installed"
        return 2
    fi
    CDK_VERSION=$(cdk --version)
    debug_log "CDK version: $CDK_VERSION"
    check_pass
}

# ──────────────────────────────────────────────────────────────────────────
# Environment Variables
# ──────────────────────────────────────────────────────────────────────────

check_environment_variables() {
    log_section "ENVIRONMENT VARIABLES"

    # Load .env if exists
    if [[ -f "$REPO_ROOT/.env" ]]; then
        debug_log "Loading .env file"
        # shellcheck disable=SC1090
        set +a
        source "$REPO_ROOT/.env"
        set -a
    fi

    # Required variables
    local REQUIRED_VARS=(
        "AWS_PROFILE:AWS profile or credentials configured"
        "ALPACA_API_KEY:Alpaca API key set"
        "ALPACA_SECRET_KEY:Alpaca secret key set"
        "ANTHROPIC_API_KEY:Anthropic API key set"
        "POSTGRES_PASSWORD:PostgreSQL password set"
    )

    for VAR_DEF in "${REQUIRED_VARS[@]}"; do
        VAR_NAME="${VAR_DEF%%:*}"
        VAR_DESC="${VAR_DEF##*:}"

        log_check "$VAR_DESC"
        if [[ -z "${!VAR_NAME:-}" ]]; then
            check_fail "$VAR_NAME not set"
        else
            check_pass
        fi
    done

    # Optional variables with defaults
    local OPTIONAL_VARS=(
        "GODSVIEW_SYSTEM_MODE:System mode (paper/live)"
        "GODSVIEW_ENABLE_LIVE_TRADING:Live trading enabled flag"
        "DB_POOL_MAX:Database connection pool size"
    )

    for VAR_DEF in "${OPTIONAL_VARS[@]}"; do
        VAR_NAME="${VAR_DEF%%:*}"
        VAR_DESC="${VAR_DEF##*:}"

        log_check "$VAR_DESC"
        if [[ -z "${!VAR_NAME:-}" ]]; then
            check_warn
            debug_log "$VAR_NAME not set, will use default"
        else
            check_pass
            debug_log "$VAR_NAME=${!VAR_NAME}"
        fi
    done
}

# ──────────────────────────────────────────────────────────────────────────
# Docker Image Builds
# ──────────────────────────────────────────────────────────────────────────

check_docker_builds() {
    log_section "DOCKER IMAGE BUILDS"

    # Check if Dockerfile exists
    log_check "API Dockerfile exists"
    if [[ ! -f "$REPO_ROOT/Dockerfile" ]]; then
        check_fail "Dockerfile not found at $REPO_ROOT/Dockerfile"
    else
        check_pass
    fi

    # Try to build API image (without pushing)
    log_check "API Docker image builds successfully"
    if docker build -t godsview:validate --quiet "$REPO_ROOT" &> /dev/null; then
        check_pass
        debug_log "Image built: godsview:validate"
    else
        check_fail "Docker build failed"
        if [[ "$VERBOSE" == "1" ]]; then
            docker build -t godsview:validate "$REPO_ROOT" 2>&1 | head -20
        fi
    fi

    # Check services Dockerfile if v2 enabled
    if [[ -f "$REPO_ROOT/services/Dockerfile" ]]; then
        log_check "Python services Dockerfile exists"
        check_pass

        log_check "Python services Docker image builds successfully"
        if docker build -t godsview-services:validate -f "$REPO_ROOT/services/Dockerfile" --quiet "$REPO_ROOT" &> /dev/null; then
            check_pass
        else
            check_warn
            debug_log "Python services build failed (optional if v2 not enabled)"
        fi
    else
        log_check "Python services Dockerfile"
        check_skip
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# AWS Infrastructure
# ──────────────────────────────────────────────────────────────────────────

check_aws_infrastructure() {
    log_section "AWS INFRASTRUCTURE"

    local STACK_PREFIX="godsview-${GV_ENV}"

    # Check CloudFormation stacks
    log_check "Network stack exists"
    if aws cloudformation describe-stacks \
        --stack-name "${STACK_PREFIX}-network" \
        --region "$GV_REGION" &> /dev/null; then
        check_pass
    else
        check_fail "Stack not found: ${STACK_PREFIX}-network"
    fi

    log_check "Storage stack exists"
    if aws cloudformation describe-stacks \
        --stack-name "${STACK_PREFIX}-storage" \
        --region "$GV_REGION" &> /dev/null; then
        check_pass
    else
        check_fail "Stack not found: ${STACK_PREFIX}-storage"
    fi

    log_check "Data stack exists"
    if aws cloudformation describe-stacks \
        --stack-name "${STACK_PREFIX}-data" \
        --region "$GV_REGION" &> /dev/null; then
        check_pass
    else
        check_fail "Stack not found: ${STACK_PREFIX}-data"
    fi

    log_check "Compute stack exists"
    if aws cloudformation describe-stacks \
        --stack-name "${STACK_PREFIX}-compute" \
        --region "$GV_REGION" &> /dev/null; then
        check_pass
    else
        check_fail "Stack not found: ${STACK_PREFIX}-compute"
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# Database Connectivity
# ──────────────────────────────────────────────────────────────────────────

check_database_connectivity() {
    log_section "DATABASE CONNECTIVITY"

    local STACK_PREFIX="godsview-${GV_ENV}"

    # Get RDS endpoint
    log_check "Retrieving RDS endpoint"
    RDS_ENDPOINT=$(aws rds describe-db-instances \
        --region "$GV_REGION" \
        --filters "Name=db-instance-id,Values=${STACK_PREFIX}-db" \
        --query 'DBInstances[0].Endpoint.Address' \
        --output text 2>/dev/null || echo "")

    if [[ -z "$RDS_ENDPOINT" || "$RDS_ENDPOINT" == "None" ]]; then
        check_skip
        debug_log "RDS instance not found (may not be deployed yet)"
        return 0
    fi
    check_pass
    debug_log "RDS endpoint: $RDS_ENDPOINT"

    # Try psql if available
    log_check "PostgreSQL connectivity (pg_isready)"
    if command -v pg_isready &> /dev/null; then
        if pg_isready -h "$RDS_ENDPOINT" -p 5432 -U godsview &> /dev/null; then
            check_pass
            success_detail "Connected to PostgreSQL"
        else
            check_warn
            debug_log "pg_isready failed (may still work, check credentials)"
        fi
    else
        log_check "PostgreSQL connectivity (nc)"
        if timeout 2 bash -c "cat < /dev/null > /dev/tcp/$RDS_ENDPOINT/5432" 2>/dev/null; then
            check_pass
            success_detail "Port 5432 is reachable"
        else
            check_fail "Cannot reach PostgreSQL on port 5432"
        fi
    fi

    # Check DB secret in Secrets Manager
    log_check "Database secret in Secrets Manager"
    if aws secretsmanager describe-secret \
        --secret-id "${STACK_PREFIX}-db" \
        --region "$GV_REGION" &> /dev/null; then
        check_pass
        debug_log "Secret exists: ${STACK_PREFIX}-db"
    else
        check_warn
        debug_log "Secret not found (may be created by RDS)"
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# Redis Connectivity
# ──────────────────────────────────────────────────────────────────────────

check_redis_connectivity() {
    log_section "REDIS CONNECTIVITY"

    local STACK_PREFIX="godsview-${GV_ENV}"

    # Get Redis endpoint
    log_check "Retrieving ElastiCache endpoint"
    REDIS_ENDPOINT=$(aws elasticache describe-cache-clusters \
        --region "$GV_REGION" \
        --cache-cluster-id "${STACK_PREFIX}-redis" \
        --show-cache-node-info \
        --query 'CacheClusters[0].CacheNodes[0].Endpoint.Address' \
        --output text 2>/dev/null || echo "")

    if [[ -z "$REDIS_ENDPOINT" || "$REDIS_ENDPOINT" == "None" ]]; then
        check_skip
        debug_log "ElastiCache cluster not found (may not be deployed)"
        return 0
    fi
    check_pass
    debug_log "Redis endpoint: $REDIS_ENDPOINT"

    # Try redis-cli if available
    log_check "Redis connectivity (redis-cli PING)"
    if command -v redis-cli &> /dev/null; then
        if redis-cli -h "$REDIS_ENDPOINT" -p 6379 ping &> /dev/null; then
            check_pass
            success_detail "Connected to Redis"
        else
            check_warn
            debug_log "redis-cli PING failed (may still work)"
        fi
    else
        log_check "Redis connectivity (nc)"
        if timeout 2 bash -c "cat < /dev/null > /dev/tcp/$REDIS_ENDPOINT/6379" 2>/dev/null; then
            check_pass
            success_detail "Port 6379 is reachable"
        else
            check_fail "Cannot reach Redis on port 6379"
        fi
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# ECS Service Health
# ──────────────────────────────────────────────────────────────────────────

check_ecs_service_health() {
    log_section "ECS SERVICE HEALTH"

    local CLUSTER_NAME="godsview-${GV_ENV}"

    # Check if cluster exists
    log_check "ECS cluster exists"
    if aws ecs describe-clusters \
        --cluster "$CLUSTER_NAME" \
        --region "$GV_REGION" \
        --query 'clusters[0].clusterName' \
        --output text &> /dev/null; then
        check_pass
    else
        check_skip
        debug_log "ECS cluster not found (may not be deployed)"
        return 0
    fi

    # Get service status
    log_check "ECS ApiService exists"
    SERVICE_STATUS=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services ApiService \
        --region "$GV_REGION" \
        --query 'services[0].status' \
        --output text 2>/dev/null || echo "")

    if [[ -z "$SERVICE_STATUS" || "$SERVICE_STATUS" == "None" ]]; then
        check_skip
        debug_log "Service not found"
        return 0
    fi
    check_pass

    # Check service health
    log_check "ECS ApiService is ACTIVE"
    if [[ "$SERVICE_STATUS" == "ACTIVE" ]]; then
        check_pass
        debug_log "Service status: ACTIVE"
    else
        check_warn
        debug_log "Service status: $SERVICE_STATUS"
    fi

    # Check running tasks
    log_check "ECS ApiService has running tasks"
    RUNNING_COUNT=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services ApiService \
        --region "$GV_REGION" \
        --query 'services[0].runningCount' \
        --output text 2>/dev/null || echo "0")

    if [[ "$RUNNING_COUNT" -gt 0 ]]; then
        check_pass
        success_detail "Running tasks: $RUNNING_COUNT"
    else
        check_warn
        debug_log "No running tasks found"
    fi

    # Check task definitions
    log_check "ECS task definition exists"
    TASK_DEF=$(aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services ApiService \
        --region "$GV_REGION" \
        --query 'services[0].taskDefinition' \
        --output text 2>/dev/null || echo "")

    if [[ -n "$TASK_DEF" ]]; then
        check_pass
        debug_log "Task definition: $TASK_DEF"
    else
        check_fail "No task definition found"
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# API Health Checks
# ──────────────────────────────────────────────────────────────────────────

check_api_health() {
    log_section "API HEALTH CHECKS (if deployed)"

    # Try to get ALB endpoint
    log_check "Retrieving API endpoint"
    ALB_DNS=$(aws cloudformation describe-stacks \
        --stack-name "godsview-${GV_ENV}-compute" \
        --region "$GV_REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
        --output text 2>/dev/null || echo "")

    if [[ -z "$ALB_DNS" || "$ALB_DNS" == "None" ]]; then
        check_skip
        debug_log "ALB DNS not found (service may not be deployed)"
        return 0
    fi
    check_pass
    debug_log "API endpoint: http://$ALB_DNS"

    # Health check endpoint
    log_check "API health check endpoint"
    if timeout 5 curl -s "http://$ALB_DNS/api/healthz" &> /dev/null; then
        check_pass
        success_detail "API responding to /api/healthz"
    else
        check_warn
        debug_log "Health check endpoint not responding"
    fi

    # Ready check endpoint
    log_check "API readiness check endpoint"
    if timeout 5 curl -s "http://$ALB_DNS/api/readyz" &> /dev/null; then
        check_pass
        success_detail "API responding to /api/readyz"
    else
        check_warn
        debug_log "Readiness check endpoint not responding"
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────

print_summary() {
    log_section "VALIDATION SUMMARY"

    printf "\n"
    printf "%sPassed:  %d%s\n" "$GREEN" "$CHECKS_PASSED" "$NC"
    printf "%sFailed:  %d%s\n" "$RED" "$CHECKS_FAILED" "$NC"
    printf "%sSkipped: %d%s\n" "$YELLOW" "$CHECKS_SKIPPED" "$NC"
    printf "%sTotal:   %d%s\n" "$BOLD" "$((CHECKS_PASSED + CHECKS_FAILED + CHECKS_SKIPPED))" "$NC"

    if [[ ${#FAILED_CHECKS[@]} -gt 0 ]]; then
        printf "\n%sFailed Checks:%s\n" "$RED" "$NC"
        for check in "${FAILED_CHECKS[@]}"; do
            printf "  %s✗ %s%s\n" "$RED" "$check" "$NC"
        done
    fi

    printf "\n"

    if [[ "$CHECKS_FAILED" -eq 0 ]]; then
        printf "%s%s✓ ALL VALIDATION CHECKS PASSED%s\n" "$BOLD" "$GREEN" "$NC"
        printf "%sDeployment infrastructure is ready.%s\n" "$GREEN" "$NC"
        return 0
    else
        printf "%s%s✗ VALIDATION FAILED (%d issues)%s\n" "$BOLD" "$RED" "$CHECKS_FAILED" "$NC"
        printf "%sPlease fix the issues above before deploying.%s\n" "$RED" "$NC"
        return 1
    fi
}

# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────

main() {
    printf "\n%s%s╔════════════════════════════════════════════════════════════════╗%s\n" "$BOLD" "$BLUE" "$NC"
    printf "%s%s║  GodsView Deployment Validation%s%s (Environment: %s)%s%s║%s\n" "$BOLD" "$BLUE" "$NC" "$BLUE" "$GV_ENV" "$BLUE" "$NC"
    printf "%s%s╚════════════════════════════════════════════════════════════════╝%s\n" "$BOLD" "$BLUE" "$NC"

    # Run validation checks
    validate_environment || exit 2
    check_prerequisites || exit 2
    check_environment_variables
    check_docker_builds
    check_aws_infrastructure
    check_database_connectivity
    check_redis_connectivity
    check_ecs_service_health
    check_api_health

    # Print summary and exit
    print_summary
}

# Run main function
main "$@"
