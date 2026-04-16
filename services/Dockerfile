# GodsView v2 — Python services Dockerfile
# Multi-stage build for lean production image
# Installs all Python dependencies for 14 microservices

FROM python:3.11-slim AS base

WORKDIR /app

# Install system dependencies including build tools and utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc \
    g++ \
    build-essential \
    git \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps

COPY services/requirements.txt /tmp/requirements.txt

# Install all Python dependencies
# Includes: httpx, mplfinance/matplotlib, lancedb, numpy, scipy, and more
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# ── Production image ──────────────────────────────────────────────────────────
FROM deps AS prod

# Copy the entire repo (needed for relative imports in all services)
COPY . .

# Create data directories for SQLite databases and artifacts
RUN mkdir -p \
    /app/data/models \
    /app/data/lancedb \
    /app/data/market_data \
    /app/data/governance \
    /app/data/screenshots \
    /app/data/experiments \
    /app/data/promotions

# Non-root user for security
RUN useradd -m -u 1000 godsview && chown -R godsview /app
USER godsview

# Expose ports for all 9 Python services
EXPOSE 8000 8001 8002 8003 8004 8005 8006 8007 8008

# Health check via gateway
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Default to API gateway; override per service in docker-compose
CMD ["uvicorn", "services.api_gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]
