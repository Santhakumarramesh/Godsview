# ─────────────────────────────────────────────────────────────────
# GodsView — Multi-stage Production Dockerfile
# Stage 1: deps     → install all workspace dependencies
# Stage 2: build    → compile API (esbuild) + Dashboard (vite)
# Stage 3: prod     → minimal runtime image with artifacts only
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: Dependencies ────────────────────────────────────────
FROM node:22-slim AS deps

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config first (cache-friendly layer)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy all package.json files for workspace packages
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/strategy-core/package.json lib/strategy-core/
COPY lib/common-types/package.json lib/common-types/
COPY lib/api-spec/package.json lib/api-spec/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/godsview-dashboard/package.json artifacts/godsview-dashboard/
COPY scripts/package.json scripts/

# Install ALL dependencies (dev included — needed for build)
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ───────────────────────────────────────────────
FROM deps AS build

WORKDIR /app

# Copy full source tree
COPY . .

# Build shared libs (TypeScript declarations)
RUN pnpm run typecheck:libs

# Build API server (esbuild → dist/index.mjs)
RUN cd artifacts/api-server && pnpm run build

# Build Dashboard (vite → dist/public/)
RUN cd artifacts/godsview-dashboard && pnpm run build

# ── Stage 3: Production Runtime ──────────────────────────────────
FROM node:22-slim AS prod

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install curl for Docker health checks + tini for PID 1
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl tini \
  && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN groupadd --gid 1001 godsview && \
    useradd --uid 1001 --gid godsview --shell /bin/sh --create-home godsview

WORKDIR /app

# Copy workspace config for production install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/strategy-core/package.json lib/strategy-core/
COPY lib/common-types/package.json lib/common-types/
COPY lib/api-spec/package.json lib/api-spec/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/godsview-dashboard/package.json artifacts/godsview-dashboard/
COPY scripts/package.json scripts/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Install tsx globally for running migration scripts (.ts)
RUN npm install -g tsx

# Copy built API bundle
COPY --from=build /app/artifacts/api-server/dist ./artifacts/api-server/dist

# Copy built Dashboard static assets
# Copy built Dashboard static assets into API server public dir (SPA serving)
COPY --from=build /app/artifacts/godsview-dashboard/dist/public/. ./artifacts/api-server/public/

# Copy shared lib source (needed at runtime for drizzle schema + migrate)
COPY --from=build /app/lib/db/src ./lib/db/src
COPY --from=build /app/lib/db/migrations ./lib/db/migrations
COPY --from=build /app/lib/db/drizzle.config.ts ./lib/db/drizzle.config.ts
COPY --from=build /app/lib/api-zod/src ./lib/api-zod/src

# Copy entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create data directories for SQLite databases and artifacts
RUN mkdir -p /app/data/{governance,screenshots,experiments,promotions} && \
    chown -R godsview:godsview /app

# Switch to non-root user
USER godsview

ENV NODE_ENV=production
ENV PORT=3001
ENV PY_SERVICES_ENABLED=true
ENV GODSVIEW_SYSTEM_MODE=paper

EXPOSE 3001

# Health check — hits the liveness probe every 30s
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/healthz || exit 1

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
