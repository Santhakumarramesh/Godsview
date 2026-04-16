FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
RUN apk add --no-cache curl
WORKDIR /app

# ── Install deps ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY lib/ lib/
COPY packages/ packages/
RUN pnpm install --frozen-lockfile --prod=false

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY artifacts/api-server/ artifacts/api-server/
COPY packages/ packages/
RUN cd artifacts/api-server && pnpm run build

# ── Production ───────────────────────────────────────────────────────────────
FROM base AS runtime
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/artifacts/api-server/node_modules artifacts/api-server/node_modules
COPY --from=deps /app/lib lib
COPY --from=build /app/artifacts/api-server/dist artifacts/api-server/dist
COPY --from=build /app/artifacts/api-server/package.json artifacts/api-server/
COPY --from=build /app/packages packages

# Copy entrypoint and migration infrastructure
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Default CMD (overridden by railway.toml startCommand)
WORKDIR /app
CMD ["/app/docker-entrypoint.sh"]
