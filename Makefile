# GodsView v2 — developer Makefile
# Blueprint: docs/blueprint/BLUEPRINT.md
# Phase 0 surface: bootstrap, dev stack, typecheck, test, migrate, seed
#
# Usage:
#   make help        # list targets
#   make bootstrap   # install deps + init dev services
#   make up / down   # docker compose dev stack
#   make typecheck   # TS typecheck across workspaces + control_plane mypy
#   make test        # unit + contract (pytest + vitest)
#   make migrate     # alembic upgrade head for control_plane
#   make seed        # bootstrap admin + feature flags
#   make verify      # phase gate: typecheck + unit + build

SHELL := /bin/bash
.DEFAULT_GOAL := help

PNPM       ?= corepack pnpm
PY         ?= python3
COMPOSE    ?= docker compose -f infra/compose/docker-compose.yml
CONTROL_PLANE_DIR := services/control_plane

.PHONY: help
help: ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "\nGodsView v2 Make targets:\n\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

.PHONY: bootstrap
bootstrap: ## Install pnpm deps and python deps for control_plane
	$(PNPM) install
	cd $(CONTROL_PLANE_DIR) && $(PY) -m pip install --upgrade pip && $(PY) -m pip install -e .[dev]

.PHONY: up
up: ## Start dev stack (postgres, redis, minio, localstack, mailhog)
	$(COMPOSE) up -d
	@echo "Dev stack up. Postgres=5432 Redis=6379 MinIO=9000 LocalStack=4566 Mailhog=8025"

.PHONY: down
down: ## Stop dev stack
	$(COMPOSE) down

.PHONY: logs
logs: ## Tail dev stack logs
	$(COMPOSE) logs -f --tail=50

.PHONY: typecheck
typecheck: ## Typecheck TS workspaces and control_plane python
	$(PNPM) -w run typecheck
	cd $(CONTROL_PLANE_DIR) && $(PY) -m mypy app || true

.PHONY: test
test: ## Run unit and contract tests
	cd $(CONTROL_PLANE_DIR) && $(PY) -m pytest -q
	$(PNPM) -r --if-present run test

.PHONY: migrate
migrate: ## Apply alembic migrations on control_plane
	cd $(CONTROL_PLANE_DIR) && $(PY) -m alembic upgrade head

.PHONY: seed
seed: ## Seed admin user + default feature flags
	cd $(CONTROL_PLANE_DIR) && $(PY) -m app.scripts.seed_bootstrap

.PHONY: dev
dev: ## Run web + control_plane in dev mode (requires `make up`)
	$(PNPM) -w run dev

.PHONY: build
build: ## Build web + packages
	$(PNPM) -w run build

.PHONY: clean
clean: ## Remove build artifacts and caches
	rm -rf .turbo apps/*/.next apps/*/dist packages/*/dist packages/*/.turbo
	cd $(CONTROL_PLANE_DIR) && rm -rf .pytest_cache .mypy_cache .ruff_cache

.PHONY: verify
verify: typecheck test build ## Phase gate: typecheck + tests + build

.PHONY: openapi
openapi: ## Dump control_plane OpenAPI to packages/api-client
	cd $(CONTROL_PLANE_DIR) && $(PY) -m app.scripts.dump_openapi ../../packages/api-client/openapi.json

.PHONY: codegen
codegen: openapi ## Regenerate TS api-client from OpenAPI
	$(PNPM) --filter @gv/api-client run codegen

# ── friendly aliases (used by ops/scripts + docs/blueprint) ────────────
.PHONY: dev-up
dev-up: up ## Alias for `make up`

.PHONY: dev-down
dev-down: down ## Alias for `make down`

.PHONY: dev-logs
dev-logs: logs ## Alias for `make logs`

.PHONY: dev-reset
dev-reset: ## DESTRUCTIVE — stop compose stack + remove all dev volumes
	RESET_FORCE=1 ops/scripts/reset.sh

.PHONY: api
api: ## Run control plane uvicorn in the foreground
	cd $(CONTROL_PLANE_DIR) && $(PY) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

.PHONY: web
web: ## Run the Next.js dev server
	$(PNPM) --filter @gv/web run dev
