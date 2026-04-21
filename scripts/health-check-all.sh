#!/bin/bash
# GodsView Production Health Check
# Checks all 12 microservices + frontend

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

BASE_URL="${API_BASE_URL:-http://localhost}"
SERVICES=(
  "api-gateway:8000"
  "market-data:8001"
  "feature:8002"
  "backtest:8003"
  "ml:8004"
  "execution:8005"
  "risk:8006"
  "memory:8007"
  "scheduler:8008"
  "tradingview-bridge:8009"
  "orderflow:8010"
  "control-plane:8020"
)

echo "=================================="
echo "  GodsView Health Check"
echo "=================================="
echo ""

passed=0
failed=0
total=${#SERVICES[@]}

for svc in "${SERVICES[@]}"; do
  name="${svc%%:*}"
  port="${svc##*:}"
  url="$BASE_URL:$port/health"

  if curl -sf --connect-timeout 3 "$url" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} $name (port $port)"
    passed=$((passed + 1))
  else
    echo -e "  ${RED}✗${NC} $name (port $port)"
    failed=$((failed + 1))
  fi
done

echo ""
echo "=================================="
echo "  Results: $passed/$total healthy"
if [ "$failed" -gt 0 ]; then
  echo -e "  ${RED}$failed service(s) unhealthy${NC}"
  exit 1
else
  echo -e "  ${GREEN}All services healthy${NC}"
fi
echo "=================================="
