# GodsView — AI Trading Intelligence Dashboard

A real-time trading intelligence system powered by a 6-layer hybrid AI pipeline, built with React, TypeScript, and Node.js.

## Overview

GodsView combines structural analysis, order flow intelligence, pattern recall, machine learning, and Claude AI into a unified decision pipeline with a real-time risk gate. Every signal must pass through all six layers and exceed a composite quality threshold of **≥ 0.75** before execution.

### Composite Quality Score

```
Q = 0.30×Structure + 0.25×OrderFlow + 0.20×Recall + 0.15×ML + 0.10×Claude
```

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                  React Dashboard                     │
│  15 pages · WebSocket · SSE · Obsidian Terminal UI   │
├─────────────────────────────────────────────────────┤
│               Express API Server                     │
│  REST + WS · Alpaca · Risk Engine · ML Model         │
├─────────────────────────────────────────────────────┤
│            6-Layer AI Pipeline                       │
│  Structure → OrderFlow → Recall → ML → Claude → Risk│
└─────────────────────────────────────────────────────┘
```

## Dashboard Pages

| Page | Route | Purpose |
|------|-------|---------|
| Mission Control | `/` | P&L, win rate, ML accuracy, pipeline health, live chart |
| Brain | `/brain` | 3D consciousness visualization, entity intelligence |
| Live Intelligence | `/alpaca` | Real-time Alpaca analysis with chart overlays |
| Infinity Screen | `/infinity` | Multi-chart grid for simultaneous monitoring |
| Pipeline Engine | `/pipeline` | 6-layer AI pipeline visualization and signal feed |
| Candle X-Ray | `/candle-xray` | Microstructure analysis, order book, live tape |
| Signal Feed | `/signals` | Real-time pipeline signals with quality scores |
| Setup Explorer | `/setup-explorer` | Strategy matrix with sortable performance data |
| Trade Journal | `/trades` | Execution log with entry/exit analysis |
| Session Reports | `/reports` | Post-session intelligence and performance review |
| Risk Command | `/risk` | Kill switch, 9 safety rails, drawdown tracking |
| Analytics | `/performance` | Win rate, profit factor, equity curve, by-setup |
| System Core | `/system` | Diagnostics, data stack health, audit events |
| Settings | `/settings` | Connection status, risk params, session filters |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Santhakumarramesh/Godsview.git
cd Godsview
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Alpaca API keys

# 3. Run development
pnpm run dev
```

## Production Deployment

### Docker (recommended)

```bash
cp .env.example .env   # configure API keys
docker compose up -d   # starts postgres + app
# Dashboard: http://localhost:3000
# API: http://localhost:3000/api
# Health: http://localhost:3000/api/healthz
```

### Bare Metal

```bash
./scripts/start-prod.sh
# Or with custom port:
PORT=8080 ./scripts/start-prod.sh
```

## ML Model

The ML layer trains an L2-regularized logistic regression at server startup from the `accuracy_results` table (136k+ labeled win/loss records).

**Feature vector** (18 dimensions): structure score, order flow score, recall score, final quality, interaction terms (structure×flow, recall×structure), disagreement signal, direction encoding, one-hot setup type (5), one-hot regime (5).

**Metrics exposed via API**: accuracy, AUC-ROC, win rate, training sample count, cross-validated AUC, drift detection (stable/watch/drift).

**Retrain on demand**: `POST /api/system/retrain`

## Environment Variables

See `.env.example` for the full list. Key variables:

- `ALPACA_API_KEY` / `ALPACA_API_SECRET` — Alpaca paper trading credentials
- `DATABASE_URL` — PostgreSQL connection string
- `ANTHROPIC_API_KEY` — Claude reasoning layer (optional, falls back to deterministic scoring)
- `QUALITY_THRESHOLD` — Minimum composite quality for signal execution (default: 0.75)

## License

MIT
