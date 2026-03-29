from __future__ import annotations

from statistics import mean, pstdev

from app.agents.base import Agent, AgentState
from app.brain.schema import AssetEntity, SemanticMemory
from app.data_fetch import fetch_price_history


class DataAgent(Agent):
    name = "data_agent"

    def run(self, state: AgentState) -> AgentState:
        if state.blocked:
            return state

        try:
            df = fetch_price_history(state.symbol)
            if len(df) < 80:
                state.set_blocked("insufficient_market_data")
                return state

            closes = df["Close"].tail(100).tolist()
            rets = [0.0]
            for i in range(1, len(closes)):
                prev = closes[i - 1]
                rets.append((closes[i] - prev) / prev if prev else 0.0)
            vol = pstdev(rets) if len(rets) > 1 else 0.0
            trend = (closes[-1] / closes[-20] - 1.0) if len(closes) >= 20 else 0.0

            regime = "chop"
            if abs(trend) > 0.035 and vol < 0.035:
                regime = "trend"
            elif vol > 0.045:
                regime = "high_volatility"
            elif abs(trend) < 0.01:
                regime = "mean_reversion"

            state.data["bars"] = df
            state.data["market"] = {
                "last_price": float(closes[-1]),
                "avg_price_20": float(mean(closes[-20:])),
                "trend_20": float(trend),
                "volatility_100": float(vol),
                "regime": regime,
            }

            entity = AssetEntity(
                symbol=state.symbol,
                entity_type="crypto" if state.symbol.endswith("USD") else "stock",
                regime=regime,
                volatility=float(vol),
                last_price=float(closes[-1]),
                state={
                    "trend_20": trend,
                    "avg_price_20": mean(closes[-20:]),
                },
            )
            state.brain.upsert_entity(entity)
            state.brain.add_memory(
                SemanticMemory(
                    symbol=state.symbol,
                    title="Market regime snapshot",
                    content=f"Regime={regime}, trend_20={trend:.4f}, vol_100={vol:.4f}",
                    confidence=0.55,
                    tags=["regime", "market_state"],
                    context=state.data["market"],
                )
            )
            return state
        except Exception as err:  # noqa: BLE001
            state.add_error(f"data_agent_error: {err}")
            state.set_blocked("data_agent_failed")
            return state

