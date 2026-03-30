from __future__ import annotations

from collections import Counter
from dataclasses import asdict

from app.state.schemas import Regime, StockBrainState, SupremeBrainState
from app.state.store import BrainStore


def _derive_regime(stocks: list[StockBrainState]) -> Regime:
    if not stocks:
        return Regime.RANGING
    labels = [s.structure.sk_sequence_stage for s in stocks if s.structure.sk_sequence_stage]
    if not labels:
        return Regime.RANGING
    top = Counter(labels).most_common(1)[0][0].lower()
    if "bear" in top:
        return Regime.TRENDING_BEAR
    if "trend" in top or "bull" in top:
        return Regime.TRENDING_BULL
    if "vol" in top:
        return Regime.VOLATILE
    if "chop" in top:
        return Regime.CHOP
    return Regime.RANGING


class SupremeNode:
    name = "supreme_node"

    def run(self, store: BrainStore) -> SupremeBrainState:
        stocks = store.list_active_stocks()
        supreme = store.get_supreme()
        regime = _derive_regime(stocks)

        rankings = sorted(
            [{"symbol": s.symbol, "attention_score": s.attention_score, "state": s.decision.state.value} for s in stocks],
            key=lambda r: r["attention_score"],
            reverse=True,
        )
        degraded = len([s for s in stocks if s.node_health.value != "live"])
        healthy = "healthy" if degraded == 0 else "degraded"

        supreme.market_regime = regime
        supreme.market_regime_confidence = 0.65 if stocks else 0.0
        supreme.active_symbols = [s.symbol for s in stocks]
        supreme.symbol_rankings = rankings
        supreme.total_nodes_active = len(stocks)
        supreme.total_nodes_degraded = degraded
        supreme.system_health = healthy
        supreme.available_capital_pct = max(0.0, 100.0 - (len(stocks) * 5.0))
        store.update_supreme(supreme)
        return supreme

    def board_payload(self, store: BrainStore) -> dict:
        supreme = store.get_supreme()
        return {
            "generated_at": supreme.last_update,
            "supreme": asdict(supreme),
            "cards": [asdict(card) for card in store.get_consciousness_board()],
        }

