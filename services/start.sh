#!/usr/bin/env bash
# GodsView v2 — Python microservices quick-start script
# Usage: ./services/start.sh [all|gateway|market|feature|backtest|ml|execution|risk|memory|scheduler]
set -euo pipefail

SERVICE=${1:-all}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env if present
if [[ -f "$ROOT_DIR/.env" ]]; then
    set -o allexport
    source "$ROOT_DIR/.env"
    set +o allexport
fi

export PYTHONPATH="$ROOT_DIR:${PYTHONPATH:-}"

start_service() {
    local name=$1
    local module=$2
    local port=$3
    echo "▶ Starting $name on port $port ..."
    uvicorn "$module" --host 0.0.0.0 --port "$port" --reload --log-level info &
    echo "  PID $! → $name"
}

case "$SERVICE" in
    all)
        start_service "api-gateway"     services.api_gateway.main:app         "${API_GATEWAY_PORT:-8000}"
        start_service "market-data"     services.market_data_service.main:app  "${MARKET_DATA_PORT:-8001}"
        start_service "feature"         services.feature_service.main:app      "${FEATURE_PORT:-8002}"
        start_service "backtest"        services.backtest_service.main:app     "${BACKTEST_PORT:-8003}"
        start_service "ml"              services.ml_service.main:app           "${ML_PORT:-8004}"
        start_service "execution"       services.execution_service.main:app    "${EXECUTION_PORT:-8005}"
        start_service "risk"            services.risk_service.main:app         "${RISK_PORT:-8006}"
        start_service "memory"          services.memory_service.main:app       "${MEMORY_PORT:-8007}"
        start_service "scheduler"       services.scheduler_service.main:app    "${SCHEDULER_PORT:-8008}"
        echo ""
        echo "✅ All 9 services started. Press Ctrl+C to stop."
        wait
        ;;
    gateway)     start_service "api-gateway"  services.api_gateway.main:app        "${API_GATEWAY_PORT:-8000}" ; wait ;;
    market)      start_service "market-data"  services.market_data_service.main:app "${MARKET_DATA_PORT:-8001}" ; wait ;;
    feature)     start_service "feature"      services.feature_service.main:app    "${FEATURE_PORT:-8002}" ; wait ;;
    backtest)    start_service "backtest"     services.backtest_service.main:app   "${BACKTEST_PORT:-8003}" ; wait ;;
    ml)          start_service "ml"           services.ml_service.main:app         "${ML_PORT:-8004}" ; wait ;;
    execution)   start_service "execution"    services.execution_service.main:app  "${EXECUTION_PORT:-8005}" ; wait ;;
    risk)        start_service "risk"         services.risk_service.main:app       "${RISK_PORT:-8006}" ; wait ;;
    memory)      start_service "memory"       services.memory_service.main:app     "${MEMORY_PORT:-8007}" ; wait ;;
    scheduler)   start_service "scheduler"    services.scheduler_service.main:app  "${SCHEDULER_PORT:-8008}" ; wait ;;
    *)
        echo "Usage: $0 [all|gateway|market|feature|backtest|ml|execution|risk|memory|scheduler]"
        exit 1
        ;;
esac
