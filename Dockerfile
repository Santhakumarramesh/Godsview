# ── GodsView Trading Dashboard — Multi-stage Production Build ────────
# Produces a lean Node.js image serving both API + static dashboard.
#
# Build:  docker build -t godsview .
# Run:    docker run -p 3000:3000 --env-file .env godsview

# ─── Stage 1: Install + Build ───────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY lib/db/package.json lib/db/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/godsview-dashboard/package.json artifacts/godsview-dashboard/

# Install all dependencies (dev + prod for build step)
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy source code
COPY lib/ lib/
COPY artifacts/ artifacts/

# Build shared libs
RUN pnpm run typecheck:libs 2>/dev/null || true

# Build API server (esbuild → dist/index.mjs)
RUN cd artifacts/api-server && pnpm run build

# Build dashboard (Vite → dist/public/)
RUN cd artifacts/godsview-dashboard && pnpm run build

# ─── Stage 2: Production Runtime ────────────────────────────────────
FROM node:22-slim AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/artifacts/api-server/package.json artifacts/api-server/
COPY --from=builder /app/artifacts/api-server/dist/ artifacts/api-server/dist/
COPY --from=builder /app/artifacts/godsview-dashboard/dist/public/ artifacts/godsview-dashboard/dist/public/
COPY --from=builder /app/lib/db/package.json lib/db/
COPY --from=builder /app/lib/db/src/ lib/db/src/

# Install production deps only
RUN pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod

# Runtime config
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Health check — hits the /api/system/status endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/system/status').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
