# GodsView v2 — Python services Dockerfile
# Multi-stage build for lean production image

FROM python:3.11-slim AS base

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps

COPY services/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# ── Production image ──────────────────────────────────────────────────────────
FROM deps AS prod

# Copy the entire repo (needed for relative imports)
COPY . .

# Create data directories
RUN mkdir -p /app/data/models /app/data/lancedb /app/data/market_data

# Non-root user
RUN useradd -m -u 1000 godsview && chown -R godsview /app
USER godsview

EXPOSE 8000 8001 8002 8003 8004 8005 8006 8007 8008 8009 8010

# Default to API gateway; override per service in docker-compose
CMD ["uvicorn", "services.api_gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]
