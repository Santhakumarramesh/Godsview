# GodsView Architecture — Definitive Technical Reference

Complete technical documentation of GodsView's 16-system architecture, component relationships, and data flow.

## System Overview

GodsView is organized into 16 core systems across 4 functional layers:

### Layer 1: Market Intelligence (4 systems)
1. **SMC Engine** — Smart Money Concepts structural analysis
2. **Order Flow Engine** — Cumulative Volume Delta and order imbalance
3. **Regime Engine** — Market regime classification
4. **Macro Engine** — Macroeconomic bias and sentiment

### Layer 2: Strategy & Intelligence (4 systems)
5. **Strategy Engine** — Strategy parsing, compilation, lifecycle management
6. **Super Intelligence** — Ensemble ML with regime adaptation
7. **Context Fusion** — Multi-timeframe signal fusion and confluence
8. **Adaptive Learning** — Model drift detection and continuous retraining

### Layer 3: Execution & Safety (4 systems)
9. **Execution Engine** — Order placement and fill tracking
10. **Risk Engine** — Portfolio risk analysis and VaR/CVaR
11. **Circuit Breaker** — Automatic drawdown protection
12. **Safety Supervisor** — 5-layer guard stack validation

### Layer 4: Intelligence & Governance (4 systems)
13. **Brain** — Real-time subsystem health monitoring
14. **Governance** — Strategy promotion and approval workflows
15. **Portfolio Intelligence** — Multi-strategy allocation and rebalancing
16. **Recall Engine** — LanceDB vector store for strategy memory

---

## Detailed System Reference

### SYSTEM 1: SMC Engine (Smart Money Concepts)

**Location**: `/artifacts/api-server/src/lib/smc_engine.ts`

**Purpose**: Structural market analysis detecting support/resistance, order blocks, fair value gaps

**Key Components**:
- `SwingAnalyzer` — Identify swing highs/lows
- `OrderBlockDetector` — Find institutional order blocks
- `FVGDetector` — Fair value gap identification
- `LiquidityLevelAnalyzer` — Liquidity void detection

**API Endpoints**:
```
GET /api/market/smc/{symbol}
  → { swings, orderBlocks, fvgs, support_resistance, levels }

GET /api/market/structure
  → { high_probability_zones, resistance_layers, support_zones }
```

**Data Flow**:
```
Market Data (OHLCV bars)
  ↓
Swing Analysis (highs/lows)
  ↓
Order Block Detection
  ↓
FVG Detection
  ↓
Liquidity Level Analysis
  ↓
Output: Structural Levels
```

**Key Algorithms**:
- Swing identification: 2-3 bar pullback confirmation
- Order blocks: Supply/demand imbalance zones
- FVG: Unmitigated price gaps in orderflow
- Support/resistance: Confluence of structural levels

**Connected To**: Context Fusion, Strategy Engine, Chart Overlay

---

### SYSTEM 2: Order Flow Engine

**Location**: `/artifacts/api-server/src/lib/orderflow_engine.ts` + `/lib/market_microstructure/`

**Purpose**: Order flow analysis (CVD, imbalances, trade tape reading)

**Key Components**:
- `CVDCalculator` — Cumulative Volume Delta
- `ImbalanceEngine` — Buy/sell pressure detection
- `TradeAbsorptionEngine` — Large trade impact analysis
- `LiquidityHeatmapEngine` — Liquidity distribution across price levels

**API Endpoints**:
```
GET /api/market/orderflow/{symbol}
  → { cvd, imbalance_score, buy_pressure, sell_pressure, absorbers }

GET /api/orderbook/l2
  → { bids, asks, spread, imbalance_percentage }

GET /api/microstructure/{symbol}
  → { absorption_zones, imbalance_heatmap, trade_tape_analysis }
```

**Data Flow**:
```
Trade Stream (tick data)
  ↓
Volume Aggregation
  ↓
CVD Calculation
  ↓
Imbalance Detection
  ↓
Trade Tape Analysis
  ↓
Output: Order Flow Scores
```

**Key Metrics**:
- CVD: Sum of volume on up bars - down bars (trend indicator)
- Imbalance: (Buy Volume - Sell Volume) / Total Volume
- Trade Absorption: How much volume absorbed at price level

**Connected To**: Context Fusion, Super Intelligence, Signal Detection

---

### SYSTEM 3: Regime Engine

**Location**: `/artifacts/api-server/src/lib/regime_engine.ts`

**Purpose**: Classify current market regime for adaptive strategy sizing

**Regimes Detected**:
- **Trend Day** — Unidirectional move with limited retracements (e.g., +2% daily)
- **Mean Reversion** — Price bounces between support/resistance
- **Breakout** — Price breaks structural level with conviction
- **Chop** — Tight ranging without directional bias
- **News-Distorted** — Economic event causing volatility spike

**API Endpoints**:
```
GET /api/market/regime
  → { regime, confidence, regime_duration_minutes, volatility_multiplier }

GET /api/regime-intelligence
  → { current_regime, regime_stack [1H, 4H, daily], strength_score }
```

**Detection Logic**:
```
For each timeframe (1m, 5m, 15m, 1H, 4H):
  1. Calculate average true range (ATR)
  2. Measure range as % of open price
  3. Check for directional bias (RSI, MACD)
  4. Detect breakout conditions
  5. Classify regime

Multi-timeframe confluence:
  If 1H AND 4H agree → HIGH confidence
  If only 1H agrees → MEDIUM confidence
  If disagreement → LOW confidence (watch)
```

**Position Sizing Impact**:
```
Trend Day:        Position size × 1.5  (exploit momentum)
Mean Reversion:   Position size × 1.0  (standard)
Breakout:         Position size × 1.2  (higher conviction)
Chop:             Position size × 0.5  (reduce exposure)
News-Distorted:   Position size × 0.0  (no trades)
```

**Connected To**: Super Intelligence, Position Sizing, Strategy Validation

---

### SYSTEM 4: Macro Engine

**Location**: `/artifacts/api-server/src/lib/macro_engine.ts`

**Purpose**: Macroeconomic bias, economic calendar integration, sentiment analysis

**Components**:
- `EconomicCalendarParser` — Parse economic events and impact
- `NewsMonitor` — Monitor market-moving news
- `SentimentAnalyzer` — Calculate market sentiment score
- `MacroBiasCalculator` — Risk-on/risk-off bias detection

**API Endpoints**:
```
GET /api/macro
  → { risk_sentiment, econ_calendar, next_event, impact_score }

GET /api/economic-calendar
  → { events[], current_time, next_events_30min, next_events_2h }

GET /api/sentiment
  → { market_sentiment, news_sentiment, vix_proxy, implied_vol_rank }
```

**Economic Calendar Data**:
- **High Impact**: Non-farm payroll, inflation, Fed decisions (skip trading)
- **Medium Impact**: Earnings surprises, unemployment claims (reduce size)
- **Low Impact**: Housing starts, existing home sales (normal trading)

**Market Sentiment Calculation**:
```
sentiment = (
  vix_percentile * 0.3 +
  risk_sentiment * 0.3 +
  news_sentiment * 0.2 +
  institutional_flows * 0.2
)

sentiment > 0.7  → Risk-off (favor short bias)
sentiment < 0.3  → Risk-on (favor long bias)
0.3-0.7          → Neutral
```

**Connected To**: Strategy Validation, Risk Engine, Signal Filtering

---

### SYSTEM 5: Strategy Engine

**Location**: `/artifacts/api-server/src/lib/strategy_engine.ts` + `/routes/strategy_*.ts`

**Purpose**: Strategy parsing, compilation, lifecycle management

**Strategy Lifecycle**:
```
draft
  ↓ (syntax parse)
parsed
  ↓ (historical backtest)
backtested
  ↓ (walk-forward, stress test)
stress_tested
  ↓ (operator review)
paper_approved
  ↓ (min 20 paper trades)
live_assisted_approved
  ↓ (operator approval on live P&L)
autonomous_approved
  ↓ (automatic trading enabled)
(or) retired
```

**API Endpoints**:
```
GET /api/strict-setup
  → List all strategy templates and families

POST /api/strategy/parse
  Request: { prompt, symbol }
  Response: { parsed_rules, setup_family, confidence }

POST /api/strategy/backtest
  Request: { symbol, rules, date_range }
  Response: { equity_curve, metrics, drawdown, sharpe, win_rate }

POST /api/strategy/promote/:id
  Request: { promotion_stage, operator_notes }
  Response: { new_stage, backtest_check, stress_check, approval_required }

GET /api/strategy/promotion-check/:id
  → { is_ready, blockers[], required_tests[], estimated_live_date }
```

**Setup Families** (Strict pattern recognition):
1. **Support/Resistance Bounce** — Price bounces from structural level
2. **Trend Continuation** — Entry on pullback in established trend
3. **Breakout** — Entry on structural level breakout with volume
4. **Order Block Reaction** — Entry from liquidity pool bounce
5. **Fair Value Gap Fill** — Entry on FVG retest and reversal

**Strategy Validation Rules**:
- Each setup must match one of 5 families
- Minimum Sharpe ratio: 1.0 (backtest)
- Minimum win rate: 50%
- Walk-forward validation: Last 3 months must beat backtest by 10%
- No consecutive losses > 3 without trade break

**Connected To**: Context Fusion, Super Intelligence, Governance

---

### SYSTEM 6: Super Intelligence

**Location**: `/artifacts/api-server/src/lib/super_intelligence.ts` + `/lib/autonomous_brain.ts`

**Purpose**: Ensemble ML model with regime-adaptive scoring

**ML Architecture**:
```
Raw Signals (18-dimensional feature vector)
  ├─ SMC Score (0-1)
  ├─ Order Flow Score (0-1)
  ├─ Regime Alignment (0-1)
  ├─ Macro Bias (0-1)
  ├─ Time of Day Factor (0-1)
  └─ ... 13 more features
  ↓
L2-Logistic Regression Model
  ↓
Prediction: P(win)
Approval Threshold: 70% confidence
```

**18-Dimensional Feature Set**:
1. SMC structure quality score
2. Order flow CVD momentum
3. Order flow imbalance ratio
4. Regime alignment (setup matches regime)
5. Regime volatility multiplier
6. Macro sentiment bias
7. Time of day seasonality
8. Win rate at current time
9. Consecutive losses penalty
10. Symbol liquidity score
11. Daily momentum (SPY beta)
12. 5-minute volatility (ATR)
13. Spread efficiency
14. VIX percentile rank
15. Support/resistance proximity
16. Volume profile alignment
17. Entry distance from highs
18. Account equity % risk

**Training Data**: 136k+ labeled trades with outcomes

**API Endpoints**:
```
GET /api/super-intelligence
  → { ml_score, approval_status, confidence, regime_adjustment, last_retrain }

POST /api/ml/predict
  Request: { symbol, setup_type, features }
  Response: { win_probability, approval_decision, confidence_interval }

POST /api/ml/train
  Request: { force: true, lookback_days: 90 }
  Response: { training_started, expected_duration }

GET /api/ml/drift
  → { drift_status, accuracy_vs_baseline, recommendation }
```

**Drift Detection**:
```
baseline_accuracy = accuracy on training data (95%)
current_accuracy = rolling 20-trade accuracy

If current_accuracy < baseline * 0.85 (81%):
  status = "drift"
  action = "Retrain model, reduce position sizes"

If baseline * 0.85 ≤ current_accuracy < baseline * 0.95:
  status = "watch"
  action = "Monitor closely, consider retraining"

If current_accuracy ≥ baseline * 0.95:
  status = "stable"
  action = "Continue normal trading"
```

**Regime Adaptation**:
```
For each regime, maintain separate Kelly criterion multiplier:

Trend Day:        kelly_multiplier = 1.5  (higher edge, can size up)
Mean Reversion:   kelly_multiplier = 1.0  (baseline)
Breakout:         kelly_multiplier = 1.2
Chop:             kelly_multiplier = 0.5
News-Distorted:   kelly_multiplier = 0.0
```

**Connected To**: Execution Engine, Risk Engine, Context Fusion

---

### SYSTEM 7: Context Fusion

**Location**: `/artifacts/api-server/src/lib/context_fusion_engine.ts`

**Purpose**: Multi-timeframe signal fusion and confluence scoring

**Confluence Scoring**:
```
C4 Score = Structure (0-25pts) + OrderFlow (0-25pts) + Context (0-25pts) + Confirmation (0-25pts)

Structure (0-25):
  SMC quality ×25

OrderFlow (0-25):
  CVD alignment + imbalance + volume profile

Context (0-25):
  Regime alignment + macro bias + time-of-day

Confirmation (0-25):
  1H structure confirms 15m ×10
  4H structure confirms 1H ×10
  Prior similar setup won ×5

Total Score: 0-100

Execution Threshold:
  > 75pts → High confidence, standard size
  60-75pts → Medium confidence, 75% size
  45-60pts → Lower confidence, 50% size
  < 45pts → Do not trade
```

**Multi-Timeframe Stack**:
```
1-minute:   Entry timing, exact order placement level
5-minute:   Setup formation, micro-structure
15-minute:  Primary setup structure, order blocks
1-hour:     Intermediate trend, regime context
4-hour:     Macro trend, support/resistance
Daily:      Market macro bias, larger structure
```

**API Endpoints**:
```
GET /api/context-fusion/{symbol}
  → { c4_score, component_breakdown, confluence_matrix, recommendation }

GET /api/signals
  → [{ symbol, setup_type, c4_score, regime, ml_probability, created_at }]
```

**Connected To**: Signal Detection, Strategy Validation, Execution

---

### SYSTEM 8: Adaptive Learning

**Location**: `/artifacts/api-server/src/lib/adaptive_learning_engine.ts`

**Purpose**: Continuous model retraining and regime detection

**Retraining Schedule**:
- **Hourly**: Quick accuracy check on last 100 trades
- **Daily**: Full retraining on last 500 trades
- **Weekly**: Archive old model, full dataset retraining

**Drift Detection Loop**:
```
Every trade completion:
  1. Predict: win/loss probability
  2. Execute trade
  3. Record outcome
  4. Calculate prediction accuracy (rolling 20 trades)
  5. Compare to baseline:
     - If accuracy drops > 15% → Declare drift
     - If drifting → Reduce position sizes
     - If drifting > 24hrs → Alert operator
     - If drifting > 72hrs → Disable autonomous trading
```

**Regime Change Detection**:
```
When regime changes detected:
  1. Snapshot current model performance
  2. Rescore all 18 features for new regime
  3. Retrain model with regime-specific data
  4. Test on holdout set
  5. If accuracy > 70% → Approve new regime model
  6. Otherwise → Keep old model, alert operator
```

**API Endpoints**:
```
GET /api/adaptive-learning/status
  → { drift_status, last_retrain, next_retrain, model_versions }

POST /api/adaptive-learning/retrain
  Request: { force: true, lookback_days: 90 }

GET /api/adaptive-learning/performance
  → { baseline_accuracy, current_accuracy, trending }
```

**Connected To**: Super Intelligence, Governance, Portfolio Intelligence

---

### SYSTEM 9: Execution Engine

**Location**: `/artifacts/api-server/src/lib/execution/execution_engine.ts`

**Purpose**: Order placement, fill tracking, slippage analysis

**Broker Abstraction**:
```
Abstract BrokerAdapter {
  submitOrder(OrderRequest): Promise<Order>
  getOrderStatus(orderId): Promise<OrderStatus>
  cancelOrder(orderId): Promise<Confirmation>
  getPosition(symbol): Promise<Position>
  getAccount(): Promise<AccountInfo>
}

Implementation: AlpacaAdapter
  ├─ Paper trading mode
  ├─ Live trading mode
  └─ Simulation mode (for backtesting)
```

**Order Lifecycle**:
```
1. Signal detected (C4 score > 45)
  ↓
2. ML approval (>70% confidence)
  ↓
3. Position sizing (Kelly criterion)
  ↓
4. Risk guards validation (5-layer)
  ↓ (all pass)
5. Order submitted to broker
  ↓
6. Fill tracking every 100ms
  ↓
7. Position opened / closed
  ↓
8. P&L calculated
  ↓
9. Execution recorded to audit trail
```

**Order Types**:
- Market: Immediate execution
- Limit: Specific price (default 5bp slippage limit)
- Stop: Emergency exit
- Stop-limit: Controlled emergency exit

**API Endpoints**:
```
POST /api/alpaca/orders
  Request: { symbol, qty, side, order_type, limit_price }
  Response: { order_id, status, fill_price, qty_filled }

GET /api/alpaca/orders
  → List all orders with fill details

GET /api/execution/pnl
  → { unrealized_pnl, realized_pnl_today, daily_change_pct }

GET /api/execution/position/{symbol}
  → { qty, entry_price, current_price, pnl, unrealized_loss_pct }
```

**Fill Quality Metrics**:
- Slippage: (fill_price - limit_price) in bps
- Fill rate: % of order filled vs requested
- Time to fill: Milliseconds from order to first fill
- Partial fills: Number of fills for single order

**Connected To**: Safety Supervisor, Risk Engine, Circuit Breaker

---

### SYSTEM 10: Risk Engine

**Location**: `/artifacts/api-server/src/lib/risk_engine.ts` + `/lib/risk_v2/`

**Purpose**: Portfolio risk analysis, VaR/CVaR, stress testing

**Risk Metrics**:

**Value at Risk (VaR)**:
```
VaR_95 = worst loss in 95% of scenarios
VaR_99 = worst loss in 99% of scenarios

Calculation:
  1. Historical returns of portfolio
  2. 95th percentile = VaR_95
  3. 99th percentile = VaR_99
```

**Conditional Value at Risk (CVaR)**:
```
CVaR = average loss in worst 5% of scenarios
More conservative than VaR (accounts for tail risk)
```

**Stress Testing**:
```
Scenario 1: 2008 crash replay (-50% equities)
Scenario 2: 2020 COVID crash (-35% equities)
Scenario 3: 2015 China devaluation (-15% FX)
Scenario 4: Volatility spike (VIX +200%)
Scenario 5: Sector rotation (sector risk)

For each: Calculate max portfolio loss
```

**API Endpoints**:
```
GET /api/risk/summary
  → { var_95, var_99, cvar_95, max_drawdown, stress_test_results }

GET /api/risk/positions
  → [{ symbol, qty, notional, greeks, stress_impact }]

POST /api/risk/stress
  Request: { scenario_id, holdings }
  Response: { max_loss, impact_by_position }

GET /api/risk/correlation
  → { correlation_matrix, diversification_ratio, effective_n }
```

**Position Risk Limits**:
```
Single position max: 2% of portfolio
Single sector max: 15% of portfolio
Long/short imbalance: Max 20% net
Notional exposure: Max 60% of account equity
```

**Connected To**: Execution Engine, Portfolio Intelligence, Safety Supervisor

---

### SYSTEM 11: Circuit Breaker

**Location**: `/artifacts/api-server/src/lib/circuit_breaker.ts` + `/routes/circuit_breaker.ts`

**Purpose**: Automatic drawdown protection and emergency liquidation

**Drawdown Levels**:
```
Level 1 (Green):    Drawdown < 1%  → Trading enabled
Level 2 (Yellow):   Drawdown 1-2%  → Reduce position sizes 50%
Level 3 (Orange):   Drawdown 2-5%  → Reduce position sizes 25%
Level 4 (Red):      Drawdown > 5%  → All positions closed, halt trading
```

**Daily Loss Limit**:
```
Max daily loss: $250 (configurable)

When exceeded:
  1. Kill all open positions
  2. Halt trading for rest of day
  3. Alert operator
  4. Log incident to audit trail
  5. Reset at market open next day
```

**Kill Switch**:
```
One-button emergency halt available on dashboard:
  1. Immediately flatten all positions
  2. Cancel all pending orders
  3. Disable new order submissions
  4. Alert operator
  5. Manual re-enable required
```

**API Endpoints**:
```
GET /api/circuit-breaker/status
  → { drawdown_pct, level, positions_open, daily_pnl, daily_loss_limit }

POST /api/system/risk/kill-switch
  Request: { action: "activate", reason }
  Response: { status: "halted", positions_liquidated: N, timestamp }

GET /api/system/risk/kill-switch
  → { status, timestamp, reason, operator }
```

**Connected To**: Execution Engine, Risk Engine, Safety Supervisor

---

### SYSTEM 12: Safety Supervisor

**Location**: `/artifacts/api-server/src/lib/execution_safety_supervisor.ts`

**Purpose**: 5-layer guard stack validation before execution

**5-Layer Guard Stack**:

```
Layer 1: Kill Switch Check
  ├─ Kill switch active? → REJECT
  └─ Market hours? (9:30-16:00 EST) → otherwise REJECT

Layer 2: Risk Limit Check
  ├─ Daily loss limit exceeded? → REJECT
  ├─ Max open positions exceeded? → REJECT
  └─ Exposure limit exceeded? → REJECT

Layer 3: Guard Rules Check
  ├─ No trades in last 30min after loss? → REJECT
  ├─ No excessive leverage? → REJECT
  └─ Max consecutive losses? → REJECT

Layer 4: ML Approval Check
  ├─ ML probability > 70%? → APPROVE
  └─ Otherwise → REJECT

Layer 5: Session Rules Check
  ├─ Avoid first 30min (volatility) → WARN
  ├─ Avoid last hour before close → WARN
  ├─ No trading on major events → REJECT
  └─ Avoid news events ±15min → WARN
```

**Guard Rejection Rate Monitoring**:
```
If guard rejection rate > 30%:
  → Indicates overprotective guards or market change
  → Alert operator for review
```

**API Endpoints**:
```
POST /api/execution/validate
  Request: { symbol, qty, side, setup_type }
  Response: { is_valid, rejections[], warnings[] }

GET /api/execution/guard-stats
  → { total_evaluated: N, approved: N%, rejected: N%, rejection_reasons }
```

**Connected To**: Execution Engine, Risk Engine, Brain

---

### SYSTEM 13: Brain

**Location**: `/artifacts/api-server/src/lib/brain/` + `/lib/autonomous_brain.ts`

**Purpose**: Real-time subsystem health monitoring and decision visualization

**16 Canonical Subsystems**:
```
1. Market Intelligence   ├─ SMC Engine, Order Flow, Regime, Macro
2. Strategy Engine       ├─ Parsing, compilation, lifecycle
3. ML Pipeline           ├─ Training, prediction, drift detection
4. Signal Detection      ├─ C4 scoring, confluence
5. Risk Management       ├─ VaR, stress testing, limits
6. Execution System      ├─ Order placement, fills, tracking
7. Safety System         ├─ Guards, kill switch, breakers
8. Portfolio Mgmt        ├─ Allocation, rebalancing, correlation
9. Data Pipeline         ├─ Market data, feature engineering
10. Governance           ├─ Approvals, audit trail, policies
11. Learning System      ├─ Model retraining, drift detection
12. Memory System        ├─ Vector store, recall, knowledge base
13. Monitoring           ├─ Health checks, alerts, dashboards
14. Execution Intel      ├─ Slippage, fill quality, attribution
15. Context Fusion       ├─ Multi-timeframe, confluence
16. Adaptive Control     ├─ Position sizing, regime adjustment
```

**Subsystem Status**:
```
HEALTHY:   All metrics normal, no degradation
DEGRADED:  Some metrics outside threshold, but operational
OFFLINE:   Service not responding, trading blocked
UNKNOWN:   No recent data, assume degraded

Thresholds:
  - Signal detection latency: < 500ms (p95)
  - Execution latency: < 1000ms (p95)
  - Order fill rate: > 95%
  - API response time: < 2s (p95)
  - Database pool available: > 1 connection
```

**Health Telemetry**:
```json
{
  "timestamp": "2026-04-16T12:34:56Z",
  "overall_status": "healthy",
  "subsystems": {
    "market_intelligence": {
      "status": "healthy",
      "latency_ms": 45,
      "last_signal_utc": "2026-04-16T12:34:50Z"
    },
    "strategy_engine": {
      "status": "healthy",
      "strategies_active": 5,
      "parse_latency_ms": 120
    },
    "ml_pipeline": {
      "status": "degraded",
      "drift_status": "watch",
      "accuracy": 0.83,
      "last_retrain": "2 hours ago"
    },
    "signal_detection": {
      "status": "healthy",
      "signals_per_minute": 2.3,
      "avg_c4_score": 68
    },
    "execution_system": {
      "status": "healthy",
      "positions_open": 3,
      "avg_fill_latency_ms": 285
    }
  }
}
```

**API Endpoints**:
```
GET /api/brain
  → { overall_status, subsystems[], last_update }

GET /api/brain-nodes
  → WebSocket for real-time status updates (2s intervals)

GET /api/brain-health
  → { health_summary, recent_incidents, recommendations }
```

**Connected To**: All systems (monitoring hub)

---

### SYSTEM 14: Governance

**Location**: `/artifacts/api-server/src/lib/governance/promotion_engine.ts` + `/routes/governance.ts`

**Purpose**: Strategy promotion gates, operator approvals, policy enforcement

**Promotion Gates**:

**Gate 1: Parsed Validation**
```
Checks:
- Strategy syntax valid
- Setup family identified
- Rules unambiguous

Automated: Yes
Operator approval: No
```

**Gate 2: Backtest Validation**
```
Checks:
- Sharpe ratio ≥ 1.0
- Win rate ≥ 50%
- Profit factor ≥ 1.5
- Max drawdown ≤ 20%
- Consecutive losses ≤ 5

Automated: Yes
Operator approval: No
```

**Gate 3: Stress Test Validation**
```
Checks:
- Walk-forward: Last 3 months beats backtest by ≥10%
- Regime stress: Profitable in ≥3 regimes
- Shock scenario: Survives 50% daily move
- Slippage test: Profitable with 2x assumed slippage

Automated: Yes
Operator approval: No
```

**Gate 4: Paper Approval**
```
Checks:
- Minimum 20 paper trades completed
- Avg slippage ≤ 2bp deviation from backtest
- Win rate matches within 5%
- No apparent data errors

Automated: Yes
Operator approval: Yes (manual review of backtest report)
```

**Gate 5: Live Assisted Approval**
```
Checks:
- Min 20 live trades completed
- P&L trajectory matches paper trading
- Fill quality consistent
- No safety violations

Automated: No (requires operator confirmation)
Operator approval: Yes (explicit approval required)
```

**Gate 6: Autonomous Approval**
```
Checks:
- Min 50 live trades
- Win rate ≥ backtest - 5%
- P&L consistently positive (>0)
- No model drift detected

Automated: No
Operator approval: Yes (activates autonomous trading)
```

**API Endpoints**:
```
POST /api/strategy/{id}/promote
  Request: { target_stage, operator_approval_notes }
  Response: { new_stage, gate_results, next_requirements }

GET /api/strategy/{id}/promotion-check
  → { is_ready: boolean, blockers[], estimated_days_to_approval }

GET /api/governance/policy
  → { rules[], enforcement_status, violations[] }
```

**Policy Enforcement**:
```
Policies:
1. No live trading without explicit operator token
2. Daily loss limit always enforced
3. Kill switch always available
4. Circuit breaker always active
5. All decisions logged to immutable audit trail
```

**Connected To**: Strategy Engine, Audit Trail, Autonomous Brain

---

### SYSTEM 15: Portfolio Intelligence

**Location**: `/artifacts/api-server/src/lib/portfolio_engine.ts` + `/routes/portfolio.ts`

**Purpose**: Multi-strategy allocation, correlation analysis, rebalancing

**Portfolio Metrics**:
```
Total Equity: Sum of all positions + cash
Notional Exposure: Sum of |position size| as % of equity
Net Exposure: Sum of positions (long - short) as % of equity
Gross Exposure: Sum of |positions| as % of equity
Sharpe Ratio: Risk-adjusted return
Max Drawdown: Largest peak-to-trough decline
Correlation: How strategies move together
```

**Allocation Optimization**:
```
Goal: Maximize risk-adjusted return subject to constraints

Constraints:
- Min Sharpe ratio: 0.5 for any strategy
- Max per-strategy: 40% of portfolio
- Max sector exposure: 20%
- Max notional: 100% (can be leveraged)

Method: Mean-variance optimization
```

**Rebalancing Rules**:
```
Trigger rebalancing when:
1. Any strategy drifts > 5% from target allocation
2. Correlation changes > 0.2 from baseline
3. Strategy drops below Sharpe 0.5
4. Weekly scheduled rebalancing (Sunday 4pm)

Process:
1. Calculate new optimal allocations
2. Queue rebalancing trades
3. Operator review + approval
4. Execute over 30-minute window
```

**API Endpoints**:
```
GET /api/portfolio
  → { total_equity, positions, allocation, metrics, correlation_matrix }

GET /api/portfolio/exposure
  → { gross_exposure, net_exposure, sector_breakdown, strategy_breakdown }

POST /api/portfolio/rebalance
  Request: { target_allocation, rebalance_method }
  Response: { trades_queued, estimated_cost, approval_required }

GET /api/portfolio/allocator
  → { current_allocation, optimal_allocation, gap, recommendation }
```

**Connected To**: Governance, Risk Engine, Adaptive Learning

---

### SYSTEM 16: Recall Engine

**Location**: `/artifacts/api-server/src/lib/phase103/recall_engine/`

**Purpose**: LanceDB vector store for strategy memory and retrieval

**Memory Types**:
1. **Strategy Patterns** — Embeddings of successful setups
2. **Market Regimes** — Historical regime transitions
3. **Trade Outcomes** — Similar historical trades and their outcomes
4. **Decision Context** — Market state at prior decisions

**Vector Store Architecture**:
```
Strategy Name: "Support Bounce on Supply"
  Vector 1: Setup structure (SMC levels, FVG, confluence)
  Vector 2: Order flow state (CVD, imbalance)
  Vector 3: Market regime (volatility, trend, bias)
  Vector 4: Time context (hour, day, VIX level)

  Historical instances: 47 trades
    Similar setups found: 34 trades
    Win rate in similar context: 68%
    Avg profit when similar: +$320
```

**Recall Process**:
```
When signal detected:
  1. Calculate embedding for current market state
  2. Query vector store: "Find similar setups"
  3. Return top 10 most similar historical trades
  4. Extract patterns: "68% win when context is similar"
  5. Adjust ML approval threshold based on similarity
```

**API Endpoints**:
```
GET /api/memory/recall/{symbol}
  → { similar_patterns[], historical_outcomes[], context_similarity }

POST /api/memory/store
  Request: { trade_data, outcome, market_context }
  Response: { embedding_stored, accessible_for_recall }

GET /api/memory/search
  Request: { query_embedding, k: 10 }
  Response: { similar_trades[], relevance_scores[] }
```

**Connected To**: Strategy Engine, Super Intelligence, Adaptive Learning

---

## Data Flow Diagram

### Complete Trade Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ MARKET DATA STREAM (from Alpaca WebSocket)                      │
│ OHLCV bars every 1min, tick data, orderbook updates            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ Market Intelligence Layer  │
        ├────────────────────────────┤
        │ • SMC: levels, OBs, FVGs   │
        │ • OrderFlow: CVD, imbalance│
        │ • Regime: classify         │
        │ • Macro: sentiment, bias   │
        └────────────┬───────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ Signal Detection           │
        ├────────────────────────────┤
        │ • Context Fusion           │
        │ • C4 Scoring               │
        │ • Confluence check         │
        │ • Setup identification     │
        └────────────┬───────────────┘
                     │
        ┌────────────▼────────────┐
        │ Raw Signal Generated    │
        │ C4 Score: 0-100         │
        │ Setup Family: identified│
        └────────────┬────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ ML Approval Gate           │
        ├────────────────────────────┤
        │ • Super Intelligence       │
        │ • 18D feature vector       │
        │ • Win probability calc     │
        │ • Drift check              │
        └────────────┬───────────────┘
                     │
        ┌────────────▼────────────┐
        │ ML Approval Decision    │
        │ P(win) = 0-100%         │
        │ Threshold: 70%          │
        └────────────┬────────────┘
                     │
      ┌──────────────▼──────────────┐
      │ Position Sizing (Kelly)     │
      ├──────────────────────────────┤
      │ • Win probability            │
      │ • Risk/reward ratio          │
      │ • Regime adjustment          │
      │ • Portfolio constraints      │
      └──────────────┬───────────────┘
                     │
        ┌────────────▼────────────┐
        │ Position Size           │
        │ Determined              │
        └────────────┬────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ 5-Layer Safety Guard       │
        ├────────────────────────────┤
        │ 1. Kill switch active?     │
        │ 2. Risk limits OK?         │
        │ 3. Guard rules OK?         │
        │ 4. ML approved?            │
        │ 5. Session rules OK?       │
        └────────────┬───────────────┘
                     │
      ┌──────────────▼──────────────────┐
      │ ALL GUARDS PASS?              │
      ├──────────────────────────────────┤
      │ NO → Log rejection, alert     │
      │ YES → Execute order           │
      └──────────────┬──────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ Execution Engine           │
        ├────────────────────────────┤
        │ Submit order to Alpaca     │
        │ Track fills every 100ms    │
        │ Log to execution trail     │
        └────────────┬───────────────┘
                     │
        ┌────────────▼────────────┐
        │ Order Filled            │
        │ Fill price tracked      │
        │ Slippage calculated     │
        └────────────┬────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ Position Opened            │
        ├────────────────────────────┤
        │ • Real-time P&L            │
        │ • Monitor for exit         │
        │ • Risk tracking active     │
        │ • Circuit breaker active   │
        └────────────┬───────────────┘
                     │
        ┌────────────▼────────────┐
        │ Continuous Monitoring   │
        │ • Target hit? Exit      │
        │ • Stop hit? Exit        │
        │ • Time limit? Exit      │
        │ • Drawdown limit? Exit  │
        │ • Regime change? Review │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │ Position Closed         │
        │ Exit price tracked      │
        │ Profit/loss recorded    │
        └────────────┬────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │ Trade Completion           │
        ├────────────────────────────┤
        │ • Execution recorded       │
        │ • Outcome logged           │
        │ • ML feedback loop         │
        │ • Adaptive learning update │
        │ • Audit trail entry        │
        │ • Dashboard update         │
        └────────────────────────────┘
```

---

## Storage Systems

### PostgreSQL (Persistent)

**Tables**:
```
orders
  ├─ id (UUID)
  ├─ symbol
  ├─ qty
  ├─ side (long/short)
  ├─ order_type
  ├─ limit_price
  ├─ fill_price
  ├─ status (pending/filled/canceled)
  └─ created_at, filled_at

positions
  ├─ id (UUID)
  ├─ symbol
  ├─ qty_current
  ├─ entry_price
  ├─ current_price
  ├─ pnl
  └─ opened_at, closed_at

trades
  ├─ id (UUID)
  ├─ symbol
  ├─ entry_order_id
  ├─ exit_order_id
  ├─ entry_price, exit_price
  ├─ duration_seconds
  ├─ pnl, pnl_pct
  ├─ win (boolean)
  ├─ setup_type
  ├─ c4_score
  ├─ ml_probability
  └─ completed_at

risk_assessments
  ├─ id (UUID)
  ├─ timestamp
  ├─ portfolio_var_95
  ├─ portfolio_var_99
  ├─ portfolio_cvar_95
  ├─ max_drawdown
  └─ stress_test_results (JSON)

audit_events
  ├─ id (UUID)
  ├─ event_type (order_placed, guard_rejected, etc)
  ├─ symbol
  ├─ details (JSON)
  ├─ operator_token
  ├─ approval_decision
  └─ timestamp
```

### Redis (Cache & Streaming)

**Data Structures**:
```
stream: signals
  → Real-time signal feed (retained 1 hour)

hash: position:{symbol}
  → Current position size, entry price, current price

hash: subsystem_status
  → Last 16 subsystem health states

key: ml_model_v2
  → Current ML model weights/parameters

set: open_orders
  → Set of order IDs currently pending
```

### LanceDB (Vector Store)

**Collections**:
```
strategy_patterns
  → Embeddings of successful setups (dim=768)

market_regimes
  → Historical regime states and transitions

trade_outcomes
  → Similar trades and their outcomes

decision_contexts
  → Market states at prior decisions
```

---

## API Response Schemas (Key)

### Signal Response
```json
{
  "symbol": "AAPL",
  "setup_type": "Support Bounce",
  "timestamp": "2026-04-16T12:34:56Z",
  "c4_score": 72,
  "components": {
    "structure": 20,
    "orderflow": 23,
    "context": 18,
    "confirmation": 11
  },
  "regime": "trend_day",
  "ml_probability": 0.78,
  "recommendation": "LONG"
}
```

### Order Response
```json
{
  "order_id": "abc123",
  "symbol": "AAPL",
  "qty": 100,
  "side": "BUY",
  "status": "filled",
  "fill_price": 150.23,
  "avg_fill_price": 150.24,
  "filled_at": "2026-04-16T12:35:01Z",
  "slippage_bps": 0.5
}
```

### Brain Health Response
```json
{
  "timestamp": "2026-04-16T12:34:56Z",
  "overall_status": "healthy",
  "subsystems": {
    "market_intelligence": {
      "status": "healthy",
      "latency_ms": 45,
      "last_update": "2026-04-16T12:34:50Z"
    },
    "ml_pipeline": {
      "status": "degraded",
      "drift_status": "watch",
      "accuracy": 0.83
    }
  }
}
```

---

## Performance Targets

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Signal detection latency | < 500ms (p95) | > 1000ms |
| Order submission latency | < 1000ms (p95) | > 2000ms |
| Order fill latency | < 2000ms (p95) | > 5000ms |
| API response time | < 1000ms (p95) | > 2000ms |
| Signal detection rate | 2-5 per minute | < 1 per minute |
| ML model retraining | Daily | > 7 days |
| Uptime | 99.5% | < 99% |
| Database connection pool | > 1 free | < 0 free |

---

## Monitoring & Alerting

22 Prometheus alerts configured covering:
- **Trading Safety**: Kill switch, circuit breaker, daily loss, consecutive losses
- **Brain Health**: Subsystem degradation, high latency, signal stall
- **Execution**: High slippage, order rejection, exposure breach, margin warnings
- **Infrastructure**: Service down, WebSocket disconnect, DB pool exhausted

See `PRODUCTION.md` for alert configuration and response procedures.
