"""Canonical event topic names for the Godsview brain bus."""

# market ingest
MARKET_TICK_RECEIVED = "market.tick.received"
MARKET_QUOTE_RECEIVED = "market.quote.received"
MARKET_CANDLE_CLOSED = "market.candle.closed"
MARKET_NEWS_RECEIVED = "market.news.received"
MARKET_MACRO_UPDATED = "market.macro.updated"

# feature/engines
FEATURE_TICK_COMPUTED = "feature.tick.computed"
FEATURE_TIMEFRAME_COMPUTED = "feature.timeframe.computed"
STRUCTURE_UPDATED = "structure.updated"
ORDERFLOW_UPDATED = "orderflow.updated"
CONTEXT_UPDATED = "context.updated"
MEMORY_UPDATED = "memory.updated"

# decisions/execution
REASONING_REQUESTED = "reasoning.requested"
REASONING_COMPLETED = "reasoning.completed"
RISK_EVALUATED = "risk.evaluated"
SIGNAL_GENERATED = "signal.generated"
TRADE_INTENT_CREATED = "trade.intent.created"
TRADE_INTENT_APPROVED = "trade.intent.approved"
TRADE_INTENT_REJECTED = "trade.intent.rejected"
ORDER_SUBMITTED = "order.submitted"
ORDER_UPDATED = "order.updated"
FILL_RECEIVED = "fill.received"
POSITION_UPDATED = "position.updated"

# learning/supreme
TRADE_CLOSED = "trade.closed"
FEEDBACK_RECORDED = "feedback.recorded"
EVOLUTION_RECALCULATED = "evolution.recalculated"
SUPREME_UPDATED = "supreme.updated"
CONSCIOUSNESS_UPDATED = "consciousness.updated"

# system
SYSTEM_ALERT = "system.alert"
SYSTEM_HALT = "system.halt"

