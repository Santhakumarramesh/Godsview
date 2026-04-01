FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ── Install deps ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY artifacts/godsview-dashboard/package.json artifacts/godsview-dashboard/
COPY packages/ packages/
RUN pnpm install --frozen-lockfile --prod=false

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY artifacts/godsview-dashboard/ artifacts/godsview-dashboard/
COPY packages/ packages/
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN cd artifacts/godsview-dashboard && pnpm run build

# ── Serve with nginx ─────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/artifacts/godsview-dashboard/dist /usr/share/nginx/html
COPY artifacts/godsview-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
