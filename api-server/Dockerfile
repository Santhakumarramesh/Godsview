FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ── Install deps ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY artifacts/api-server/package.json artifacts/api-server/
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
COPY --from=build /app/artifacts/api-server/dist artifacts/api-server/dist
COPY --from=build /app/artifacts/api-server/package.json artifacts/api-server/
COPY --from=build /app/packages packages

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/artifacts/api-server
CMD ["node", "dist/index.js"]
