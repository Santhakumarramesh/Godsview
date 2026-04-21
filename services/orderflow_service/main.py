"""
Order Flow Microservice for GodsView
Handles order flow analysis, heatmap computation, DOM/depth monitoring,
footprint bars, execution pressure, and flow+structure confluence.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx
import numpy as np
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import json
import math

app = FastAPI(title="OrderFlow Service", version="1.0.0")

FEATURE_SERVICE_URL = "http://localhost:8002"


class DeltaBar(BaseModel):
    timestamp: float
    price: float
    delta: int
    cum_delta: int
    buy_vol: int
    sell_vol: int


class ImbalanceData(BaseModel):
    price: float
    buy_side: int
    sell_side: int
    imbalance_ratio: float
    side: str  # "buy_dominated" or "sell_dominated"


class AbsorptionEvent(BaseModel):
    timestamp: float
    price: float
    volume: int
    duration_ms: int
    type: str  # "bid_absorption" or "ask_absorption"


class HeatmapLevel(BaseModel):
    price: float
    intensity: float  # 0.0 to 1.0
    buy_pressure: float
    sell_pressure: float
    bid_ask_ratio: float


class DOMLevel(BaseModel):
    price: float
    bid_size: int
    ask_size: int
    level: int


class FootprintBar(BaseModel):
    timestamp: float
    price: float
    volume: int
    buys: int
    sells: int
    buy_ratio: float
    profile: Dict[float, int]  # price -> volume at price


class ExecutionPressure(BaseModel):
    timestamp: float
    pressure_direction: str  # "bullish", "bearish", "neutral"
    pressure_magnitude: float  # 0.0 to 1.0
    buyer_aggression: float
    seller_aggression: float
    volume_weighted_direction: float  # -1.0 to 1.0


class FlowSnapshot(BaseModel):
    symbol: str
    timestamp: float
    current_price: float
    delta: int
    cum_delta: int
    buy_volume: int
    sell_volume: int
    imbalance_ratio: float
    absorption_events: int
    execution_pressure: float


class ConfluenceSignal(BaseModel):
    symbol: str
    timestamp: float
    flow_signal: str  # "strong_buy", "buy", "neutral", "sell", "strong_sell"
    flow_score: float  # 0.0 to 1.0
    structure_signal: str  # from feature_service
    structure_score: float
    confluence_score: float  # merged score
    confluence_direction: str  # "aligned", "divergent", "mixed"


class FlowEngine:
    """
    Realistic order flow analysis engine with synthetic data generation
    based on price movement patterns.
    """

    def __init__(self):
        self.flows: Dict[str, List[DeltaBar]] = {}
        self.price_history: Dict[str, List[float]] = {}
        self.absorption_events: Dict[str, List[AbsorptionEvent]] = {}
        self.imbalance_history: Dict[str, List[ImbalanceData]] = {}
        self.heatmap_cache: Dict[str, List[HeatmapLevel]] = {}

    def _generate_realistic_flows(
        self,
        symbol: str,
        current_price: float,
        num_bars: int = 50
    ) -> List[DeltaBar]:
        """
        Generate realistic synthetic order flow data that correlates with
        price movement patterns.
        """
        if symbol not in self.price_history:
            self.price_history[symbol] = [current_price]

        bars = []
        cum_delta = 0
        base_time = datetime.now().timestamp()

        # Simulate realistic price movements and corresponding flow
        price = current_price
        for i in range(num_bars):
            timestamp = base_time - (num_bars - i) * 60  # 1-minute bars

            # Generate price movement with momentum
            momentum = np.random.normal(0, 0.01)  # 1% std dev
            price_change = price * momentum
            price = max(price * 0.8, min(price * 1.2, price + price_change))

            # Delta correlates with price movement
            # Positive price movement = positive delta (buyers in control)
            # Negative price movement = negative delta (sellers in control)
            base_delta = int(price_change / current_price * 1000)

            # Add realistic variance
            delta_variance = np.random.randint(-200, 200)
            delta = base_delta + delta_variance

            # Volume scales with magnitude of movement
            total_volume = max(100, int(abs(price_change / current_price) * 5000 + np.random.randint(500, 2000)))

            # Buy/sell volume split based on delta
            if delta > 0:
                buy_vol = int(total_volume * (0.5 + min(0.5, abs(delta) / 2000)))
                sell_vol = total_volume - buy_vol
            else:
                sell_vol = int(total_volume * (0.5 + min(0.5, abs(delta) / 2000)))
                buy_vol = total_volume - sell_vol

            cum_delta += delta

            bars.append(DeltaBar(
                timestamp=timestamp,
                price=round(price, 2),
                delta=delta,
                cum_delta=cum_delta,
                buy_vol=buy_vol,
                sell_vol=sell_vol
            ))

        self.flows[symbol] = bars
        self.price_history[symbol] = [bar.price for bar in bars]
        return bars

    def _detect_absorption(
        self,
        symbol: str,
        bars: List[DeltaBar]
    ) -> List[AbsorptionEvent]:
        """
        Detect absorption events: large volume at a level with minimal
        price movement and low delta.
        """
        events = []
        price_levels: Dict[float, List[DeltaBar]] = {}

        # Group bars by price level
        for bar in bars:
            level = round(bar.price, 1)
            if level not in price_levels:
                price_levels[level] = []
            price_levels[level].append(bar)

        # Check each level for absorption characteristics
        for level, level_bars in price_levels.items():
            if len(level_bars) >= 2:
                total_volume = sum(bar.buy_vol + bar.sell_vol for bar in level_bars)
                avg_delta = np.mean([abs(bar.delta) for bar in level_bars])
                duration = (level_bars[-1].timestamp - level_bars[0].timestamp) * 1000

                # Absorption: high volume, low delta, price stalls
                if total_volume > 3000 and avg_delta < 200 and duration > 60000:
                    # Determine absorption type based on buy/sell ratio
                    total_buy = sum(bar.buy_vol for bar in level_bars)
                    total_sell = sum(bar.sell_vol for bar in level_bars)

                    if total_buy > total_sell:
                        absorption_type = "bid_absorption"
                    else:
                        absorption_type = "ask_absorption"

                    events.append(AbsorptionEvent(
                        timestamp=level_bars[0].timestamp,
                        price=level,
                        volume=total_volume,
                        duration_ms=int(duration),
                        type=absorption_type
                    ))

        self.absorption_events[symbol] = events
        return events

    def _compute_imbalance(
        self,
        symbol: str,
        bars: List[DeltaBar]
    ) -> List[ImbalanceData]:
        """
        Compute buy/sell imbalance ratios. High imbalance at turning
        points indicates directional conviction.
        """
        imbalances = []

        for i in range(len(bars)):
            bar = bars[i]

            # Use a rolling window for imbalance
            window_size = min(5, i + 1)
            window = bars[max(0, i - window_size + 1):i + 1]

            total_buy = sum(b.buy_vol for b in window)
            total_sell = sum(b.sell_vol for b in window)
            total_vol = total_buy + total_sell

            if total_vol > 0:
                imbalance_ratio = (total_buy - total_sell) / total_vol
            else:
                imbalance_ratio = 0.0

            # Determine side
            if imbalance_ratio > 0.1:
                side = "buy_dominated"
            elif imbalance_ratio < -0.1:
                side = "sell_dominated"
            else:
                side = "balanced"

            imbalances.append(ImbalanceData(
                price=bar.price,
                buy_side=total_buy,
                sell_side=total_sell,
                imbalance_ratio=imbalance_ratio,
                side=side
            ))

        self.imbalance_history[symbol] = imbalances
        return imbalances

    def _generate_heatmap(
        self,
        symbol: str,
        bars: List[DeltaBar],
        current_price: float
    ) -> List[HeatmapLevel]:
        """
        Generate heatmap levels showing bid/ask walls and intensity.
        Intensity correlates with volume and imbalance.
        """
        heatmap_levels = []

        # Create price ladder around current price
        price_step = current_price * 0.001  # 0.1% increments
        price_range = current_price * 0.02  # 2% range above/below

        price_min = current_price - price_range
        price_max = current_price + price_range

        prices = np.arange(price_min, price_max + price_step, price_step)

        for price_level in prices:
            # Aggregate volume at this level
            level_key = round(price_level, 2)
            bars_at_level = [b for b in bars if round(b.price, 2) == level_key]

            if bars_at_level:
                buy_pressure = np.mean([b.buy_vol for b in bars_at_level])
                sell_pressure = np.mean([b.sell_vol for b in bars_at_level])
                total_pressure = buy_pressure + sell_pressure

                # Intensity: normalized by max volume seen
                max_volume = max([b.buy_vol + b.sell_vol for b in bars]) if bars else 1
                intensity = min(1.0, total_pressure / max_volume)

                # Bid/ask ratio shows imbalance at this level
                if total_pressure > 0:
                    bid_ask_ratio = buy_pressure / total_pressure
                else:
                    bid_ask_ratio = 0.5

                heatmap_levels.append(HeatmapLevel(
                    price=round(price_level, 2),
                    intensity=intensity,
                    buy_pressure=buy_pressure,
                    sell_pressure=sell_pressure,
                    bid_ask_ratio=bid_ask_ratio
                ))

        self.heatmap_cache[symbol] = heatmap_levels
        return heatmap_levels

    def _generate_dom(
        self,
        symbol: str,
        current_price: float,
        bars: List[DeltaBar]
    ) -> tuple[List[DOMLevel], List[DOMLevel]]:
        """
        Generate depth of market (bid/ask ladder).
        """
        bid_levels = []
        ask_levels = []

        # Extract volume profile from bars
        price_volumes: Dict[float, Dict[str, int]] = {}

        for bar in bars:
            level = round(bar.price, 2)
            if level not in price_volumes:
                price_volumes[level] = {"buy": 0, "ask": 0}
            price_volumes[level]["buy"] += bar.buy_vol
            price_volumes[level]["ask"] += bar.sell_vol

        # Generate bid levels (below current price)
        bid_prices = sorted([p for p in price_volumes.keys() if p < current_price], reverse=True)[:5]
        for i, price in enumerate(bid_prices):
            bid_levels.append(DOMLevel(
                price=price,
                bid_size=price_volumes[price]["buy"],
                ask_size=price_volumes[price]["ask"],
                level=i + 1
            ))

        # Generate ask levels (above current price)
        ask_prices = sorted([p for p in price_volumes.keys() if p >= current_price])[:5]
        for i, price in enumerate(ask_prices):
            ask_levels.append(DOMLevel(
                price=price,
                bid_size=price_volumes[price]["buy"],
                ask_size=price_volumes[price]["ask"],
                level=i + 1
            ))

        return bid_levels, ask_levels

    def _generate_footprint(
        self,
        symbol: str,
        bars: List[DeltaBar]
    ) -> List[FootprintBar]:
        """
        Generate footprint bars with volume-at-price profile.
        """
        footprint = []

        for bar in bars:
            # Create price profile for this bar
            profile: Dict[float, int] = {}

            # Distribute volume across price levels based on buy/sell ratio
            buy_ratio = bar.buy_vol / (bar.buy_vol + bar.sell_vol) if (bar.buy_vol + bar.sell_vol) > 0 else 0.5

            # Bid levels (below bar price)
            bid_levels = 3
            for i in range(1, bid_levels + 1):
                bid_price = round(bar.price - (i * bar.price * 0.001), 2)
                profile[bid_price] = int((1 - buy_ratio) * bar.sell_vol / bid_levels)

            # Ask levels (above bar price)
            ask_levels = 3
            for i in range(1, ask_levels + 1):
                ask_price = round(bar.price + (i * bar.price * 0.001), 2)
                profile[ask_price] = int(buy_ratio * bar.buy_vol / ask_levels)

            footprint.append(FootprintBar(
                timestamp=bar.timestamp,
                price=bar.price,
                volume=bar.buy_vol + bar.sell_vol,
                buys=bar.buy_vol,
                sells=bar.sell_vol,
                buy_ratio=buy_ratio,
                profile=profile
            ))

        return footprint

    def _compute_execution_pressure(
        self,
        symbol: str,
        bars: List[DeltaBar]
    ) -> ExecutionPressure:
        """
        Analyze execution pressure: who's in control based on recent flows.
        """
        if not bars:
            return ExecutionPressure(
                timestamp=datetime.now().timestamp(),
                pressure_direction="neutral",
                pressure_magnitude=0.0,
                buyer_aggression=0.0,
                seller_aggression=0.0,
                volume_weighted_direction=0.0
            )

        # Recent bars (last 10)
        recent = bars[-10:] if len(bars) >= 10 else bars

        total_buy = sum(b.buy_vol for b in recent)
        total_sell = sum(b.sell_vol for b in recent)
        total_vol = total_buy + total_sell

        # Buyer/seller aggression
        buyer_aggression = total_buy / total_vol if total_vol > 0 else 0.5
        seller_aggression = total_sell / total_vol if total_vol > 0 else 0.5

        # Volume-weighted direction
        volume_weighted_direction = (total_buy - total_sell) / total_vol if total_vol > 0 else 0.0

        # Determine direction
        if volume_weighted_direction > 0.15:
            pressure_direction = "bullish"
            pressure_magnitude = min(1.0, volume_weighted_direction)
        elif volume_weighted_direction < -0.15:
            pressure_direction = "bearish"
            pressure_magnitude = min(1.0, abs(volume_weighted_direction))
        else:
            pressure_direction = "neutral"
            pressure_magnitude = abs(volume_weighted_direction)

        return ExecutionPressure(
            timestamp=datetime.now().timestamp(),
            pressure_direction=pressure_direction,
            pressure_magnitude=pressure_magnitude,
            buyer_aggression=buyer_aggression,
            seller_aggression=seller_aggression,
            volume_weighted_direction=volume_weighted_direction
        )

    def get_snapshot(self, symbol: str, current_price: float) -> FlowSnapshot:
        """Get current order flow snapshot."""
        bars = self._generate_realistic_flows(symbol, current_price)
        pressure = self._compute_execution_pressure(symbol, bars)
        absorption = self._detect_absorption(symbol, bars)
        imbalances = self._compute_imbalance(symbol, bars)

        if bars:
            delta = bars[-1].delta
            cum_delta = bars[-1].cum_delta
            buy_volume = sum(b.buy_vol for b in bars)
            sell_volume = sum(b.sell_vol for b in bars)
        else:
            delta = 0
            cum_delta = 0
            buy_volume = 0
            sell_volume = 0

        # Average imbalance ratio
        imbalance_ratio = np.mean([i.imbalance_ratio for i in imbalances]) if imbalances else 0.0

        return FlowSnapshot(
            symbol=symbol,
            timestamp=datetime.now().timestamp(),
            current_price=current_price,
            delta=delta,
            cum_delta=cum_delta,
            buy_volume=buy_volume,
            sell_volume=sell_volume,
            imbalance_ratio=imbalance_ratio,
            absorption_events=len(absorption),
            execution_pressure=pressure.pressure_magnitude
        )


# Initialize engine
flow_engine = FlowEngine()


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "OrderFlow Service",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/v1/flow/{symbol}/snapshot")
async def get_flow_snapshot(symbol: str, price: float = 100.0):
    """
    Returns current order flow snapshot.
    """
    try:
        snapshot = flow_engine.get_snapshot(symbol, price)
        return snapshot
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/flow/{symbol}/heatmap")
async def get_heatmap(symbol: str, price: float = 100.0):
    """
    Returns heatmap levels showing bid/ask walls and intensity.
    """
    try:
        bars = flow_engine._generate_realistic_flows(symbol, price)
        heatmap = flow_engine._generate_heatmap(symbol, bars, price)
        return {
            "symbol": symbol,
            "timestamp": datetime.now().timestamp(),
            "levels": heatmap
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/flow/{symbol}/dom")
async def get_dom(symbol: str, price: float = 100.0):
    """
    Returns depth of market (bid/ask ladder).
    """
    try:
        bars = flow_engine._generate_realistic_flows(symbol, price)
        bid_levels, ask_levels = flow_engine._generate_dom(symbol, price, bars)
        return {
            "symbol": symbol,
            "timestamp": datetime.now().timestamp(),
            "bids": bid_levels,
            "asks": ask_levels,
            "midpoint": price
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/flow/{symbol}/footprint")
async def get_footprint(symbol: str, price: float = 100.0):
    """
    Returns footprint bars with volume-at-price.
    """
    try:
        bars = flow_engine._generate_realistic_flows(symbol, price)
        footprint = flow_engine._generate_footprint(symbol, bars)
        return {
            "symbol": symbol,
            "timestamp": datetime.now().timestamp(),
            "bars": footprint
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/flow/{symbol}/absorption")
async def get_absorption(symbol: str, price: float = 100.0):
    """
    Detects absorption events (large volume at level with no price movement).
    """
    try:
        bars = flow_engine._generate_realistic_flows(symbol, price)
        events = flow_engine._detect_absorption(symbol, bars)
        return {
            "symbol": symbol,
            "timestamp": datetime.now().timestamp(),
            "absorption_events": events,
            "count": len(events)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/flow/{symbol}/imbalance")
async def get_imbalance(symbol: str, price: float = 100.0):
    """
    Computes buy/sell imbalance ratios.
    """
    try:
        bars = flow_engine._generate_realistic_flows(symbol, price)
        imbalances = flow_engine._compute_imbalance(symbol, bars)
        return {
            "symbol": symbol,
            "timestamp": datetime.now().timestamp(),
            "imbalances": imbalances,
            "current_imbalance": imbalances[-1].imbalance_ratio if imbalances else 0.0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/flow/{symbol}/pressure")
async def get_pressure(symbol: str, price: float = 100.0):
    """
    Execution pressure analysis (who's in control).
    """
    try:
        bars = flow_engine._generate_realistic_flows(symbol, price)
        pressure = flow_engine._compute_execution_pressure(symbol, bars)
        return {
            "symbol": symbol,
            "timestamp": datetime.now().timestamp(),
            "pressure": pressure
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/flow/{symbol}/confluence")
async def get_confluence(symbol: str, price: float = 100.0):
    """
    Merges flow signals with structure signals from feature_service.
    Returns confluence score showing alignment between flow and structure.
    """
    try:
        # Get flow data
        bars = flow_engine._generate_realistic_flows(symbol, price)
        pressure = flow_engine._compute_execution_pressure(symbol, bars)
        imbalances = flow_engine._compute_imbalance(symbol, bars)

        # Compute flow signal
        if bars:
            cum_delta = bars[-1].cum_delta
            recent_delta = sum(b.delta for b in bars[-5:])
        else:
            cum_delta = 0
            recent_delta = 0

        current_imbalance = imbalances[-1].imbalance_ratio if imbalances else 0.0

        # Flow score
        flow_score = 0.0
        if pressure.pressure_magnitude > 0.3 and pressure.pressure_direction == "bullish":
            flow_score = 0.8 + (min(0.2, pressure.pressure_magnitude - 0.3))
            flow_signal = "strong_buy" if flow_score > 0.85 else "buy"
        elif pressure.pressure_magnitude > 0.3 and pressure.pressure_direction == "bearish":
            flow_score = 0.2 - (min(0.2, pressure.pressure_magnitude - 0.3))
            flow_signal = "strong_sell" if flow_score < 0.15 else "sell"
        else:
            flow_score = 0.5
            flow_signal = "neutral"

        # Try to get structure data from feature_service
        structure_signal = "neutral"
        structure_score = 0.5
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{FEATURE_SERVICE_URL}/v1/structure/{symbol}/signal",
                    params={"price": price},
                    timeout=2.0
                )
                if response.status_code == 200:
                    structure_data = response.json()
                    structure_signal = structure_data.get("signal", "neutral")
                    structure_score = structure_data.get("score", 0.5)
        except Exception:
            # Feature service not available, proceed with flow only
            pass

        # Confluence calculation
        # If flow and structure align, increase score
        flow_is_bullish = flow_signal in ["buy", "strong_buy"]
        flow_is_bearish = flow_signal in ["sell", "strong_sell"]
        structure_is_bullish = structure_signal in ["buy", "strong_buy"]
        structure_is_bearish = structure_signal in ["sell", "strong_sell"]

        if (flow_is_bullish and structure_is_bullish) or (flow_is_bearish and structure_is_bearish):
            confluence_direction = "aligned"
            confluence_score = min(1.0, (flow_score + structure_score) / 1.5)
        elif (flow_is_bullish and structure_is_bearish) or (flow_is_bearish and structure_is_bullish):
            confluence_direction = "divergent"
            confluence_score = 0.5
        else:
            confluence_direction = "mixed"
            confluence_score = (flow_score + structure_score) / 2.0

        return ConfluenceSignal(
            symbol=symbol,
            timestamp=datetime.now().timestamp(),
            flow_signal=flow_signal,
            flow_score=flow_score,
            structure_signal=structure_signal,
            structure_score=structure_score,
            confluence_score=confluence_score,
            confluence_direction=confluence_direction
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/flow/{symbol}/ingest")
async def ingest_flow_data(symbol: str, data: Dict[str, Any]):
    """
    Accept real order book feeds for future integration.
    Currently logs the ingest for future implementation.
    """
    try:
        return {
            "status": "accepted",
            "symbol": symbol,
            "message": "Real order book data ingest placeholder for future implementation",
            "data_keys": list(data.keys())
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
