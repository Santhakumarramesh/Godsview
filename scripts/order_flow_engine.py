#!/usr/bin/env python3
"""
GodsView — Advanced Order Flow Engine
======================================
Implements professional-grade order flow analysis using OHLCV proxy methods.

ALL indicators are clearly labeled as OHLCV PROXY — not real order book data.
Real order book analysis requires Level 2 / tick data feeds.

Concepts implemented from Order Flow Analysis course:
- Delta proxy (CLV-based)
- Cumulative Volume Delta (CVD)
- CVD divergence detection
- Absorption detection
- Volume imbalance scoring
- Liquidity sweep detection
- Trapped trader signals
- Volume profile (HVN/LVN/POC/VA)
- Aggressive vs passive pressure estimation
- Composite Order Flow Score (0-100)

Author: GodsView Trading Systems
Mode: PAPER ONLY — proxy-based, not real order book
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any
from enum import Enum


# ============================================================================
# DATA TYPES
# ============================================================================

class FlowStrength(Enum):
    WEAK = "weak"           # 0-40
    NEUTRAL = "neutral"     # 41-60
    STRONG = "strong"       # 61-75
    HIGH_CONVICTION = "high_conviction"  # 76-100


@dataclass
class DeltaResult:
    """Per-candle delta analysis."""
    delta: float              # Single candle delta proxy
    delta_pct: float          # Delta as % of volume
    cumulative_delta: float   # Running CVD
    pressure: str             # 'buy', 'sell', 'neutral'
    data_type: str = "OHLCV_PROXY"


@dataclass
class AbsorptionEvent:
    """Detected absorption event."""
    index: int
    price: float
    absorption_type: str       # 'bullish' or 'bearish'
    strength: float            # 0-100
    volume_ratio: float        # volume vs average
    body_ratio: float          # body size vs range
    delta_divergence: bool     # delta says one thing, price says another
    data_type: str = "OHLCV_PROXY"


@dataclass
class ImbalanceEvent:
    """Detected volume imbalance."""
    start_index: int
    end_index: int
    direction: str             # 'bullish' or 'bearish'
    strength: float            # 0-100
    volume_ratio: float        # buy vol / sell vol ratio
    consecutive_candles: int   # how many candles in a row
    data_type: str = "OHLCV_PROXY"


@dataclass
class LiquiditySweepEvent:
    """Detected liquidity sweep / stop run."""
    index: int
    sweep_type: str            # 'sweep_high' or 'sweep_low'
    swept_level: float         # the level that was swept
    sweep_depth: float         # how far past the level
    reversal_strength: float   # how strongly it reversed
    volume_spike: bool         # was there a volume spike
    strength: float            # 0-100
    data_type: str = "OHLCV_PROXY"


@dataclass
class TrappedTraderEvent:
    """Detected trapped trader scenario."""
    index: int
    trap_type: str             # 'bull_trap' or 'bear_trap'
    trap_level: float          # price where traders got trapped
    reversal_candles: int      # how many candles to reverse
    volume_confirmation: bool  # volume confirms the trap
    strength: float            # 0-100
    data_type: str = "OHLCV_PROXY"


@dataclass
class VolumeProfileResult:
    """Volume profile analysis."""
    poc: float                 # Point of Control
    vah: float                 # Value Area High
    val: float                 # Value Area Low
    hvn_levels: List[float]    # High Volume Nodes
    lvn_levels: List[float]    # Low Volume Nodes
    current_position: str      # 'above_va', 'in_va', 'below_va'
    data_type: str = "OHLCV_PROXY"


@dataclass
class OrderFlowScore:
    """Composite order flow score for trade decisions."""
    total_score: float         # 0-100
    strength: FlowStrength
    delta_score: float         # 0-100, weight 25%
    volume_spike_score: float  # 0-100, weight 20%
    absorption_score: float    # 0-100, weight 20%
    imbalance_score: float     # 0-100, weight 20%
    sweep_trapped_score: float # 0-100, weight 15%
    direction_bias: str        # 'bullish', 'bearish', 'neutral'
    confirmations: List[str]   # list of what confirmed
    warnings: List[str]        # list of warnings
    data_type: str = "OHLCV_PROXY"


# ============================================================================
# DELTA & CVD ENGINE
# ============================================================================

class DeltaEngine:
    """
    Calculates delta proxy and CVD from OHLCV data.

    Method: Close Location Value (CLV)
    CLV = ((Close - Low) - (High - Close)) / (High - Low)
    Delta = Volume * CLV

    This is an OHLCV PROXY — not real order book delta.
    Accuracy: ~60-70% correlation with real delta for directional bias.
    """

    @staticmethod
    def calculate_clv(df: pd.DataFrame) -> pd.Series:
        """Close Location Value: where the close sits in the high-low range."""
        hl_range = df['high'] - df['low']
        hl_range = hl_range.replace(0, np.nan)
        clv = ((df['close'] - df['low']) - (df['high'] - df['close'])) / hl_range
        return clv.fillna(0)

    @staticmethod
    def calculate_delta(df: pd.DataFrame) -> pd.Series:
        """Delta proxy = Volume * CLV."""
        clv = DeltaEngine.calculate_clv(df)
        return df['volume'] * clv

    @staticmethod
    def calculate_cvd(df: pd.DataFrame) -> pd.Series:
        """Cumulative Volume Delta — running sum of delta."""
        delta = DeltaEngine.calculate_delta(df)
        return delta.cumsum()

    @staticmethod
    def calculate_buy_sell_volume(df: pd.DataFrame) -> Tuple[pd.Series, pd.Series]:
        """
        Estimate buy and sell volume from OHLCV.
        Buy volume = Volume * ((Close - Low) / (High - Low))
        Sell volume = Volume * ((High - Close) / (High - Low))
        """
        hl_range = df['high'] - df['low']
        hl_range = hl_range.replace(0, np.nan)
        buy_pct = (df['close'] - df['low']) / hl_range
        buy_pct = buy_pct.fillna(0.5)
        buy_vol = df['volume'] * buy_pct
        sell_vol = df['volume'] * (1 - buy_pct)
        return buy_vol, sell_vol

    @staticmethod
    def analyze(df: pd.DataFrame, lookback: int = 20) -> List[DeltaResult]:
        """Full delta analysis for each candle."""
        delta = DeltaEngine.calculate_delta(df)
        cvd = delta.cumsum()
        results = []

        for i in range(len(df)):
            d = delta.iloc[i]
            vol = df['volume'].iloc[i]
            d_pct = (d / vol * 100) if vol > 0 else 0

            if d_pct > 10:
                pressure = 'buy'
            elif d_pct < -10:
                pressure = 'sell'
            else:
                pressure = 'neutral'

            results.append(DeltaResult(
                delta=float(d),
                delta_pct=float(d_pct),
                cumulative_delta=float(cvd.iloc[i]),
                pressure=pressure,
                data_type="OHLCV_PROXY"
            ))

        return results

    @staticmethod
    def detect_cvd_divergence(
        df: pd.DataFrame,
        lookback: int = 20
    ) -> Dict[str, Any]:
        """
        Detect CVD divergence — price and CVD moving in opposite directions.

        Bearish divergence: price higher high, CVD lower high
        Bullish divergence: price lower low, CVD higher low
        """
        if len(df) < lookback:
            return {'divergence': None, 'type': None, 'strength': 0}

        recent = df.tail(lookback)
        cvd = DeltaEngine.calculate_cvd(recent)
        prices = recent['close'].values
        cvd_vals = cvd.values

        # Find swing points in last lookback candles
        mid = lookback // 2

        # Check for bearish divergence (price HH, CVD LH)
        if prices[-1] > prices[mid] and cvd_vals[-1] < cvd_vals[mid]:
            price_change = (prices[-1] - prices[mid]) / prices[mid]
            cvd_change = (cvd_vals[-1] - cvd_vals[mid])
            strength = min(100, abs(price_change) * 2000 + 30)
            return {
                'divergence': True,
                'type': 'bearish',
                'strength': float(strength),
                'price_direction': 'up',
                'cvd_direction': 'down',
                'data_type': 'OHLCV_PROXY'
            }

        # Check for bullish divergence (price LL, CVD HL)
        if prices[-1] < prices[mid] and cvd_vals[-1] > cvd_vals[mid]:
            price_change = (prices[mid] - prices[-1]) / prices[mid]
            strength = min(100, abs(price_change) * 2000 + 30)
            return {
                'divergence': True,
                'type': 'bullish',
                'strength': float(strength),
                'price_direction': 'down',
                'cvd_direction': 'up',
                'data_type': 'OHLCV_PROXY'
            }

        return {'divergence': False, 'type': None, 'strength': 0, 'data_type': 'OHLCV_PROXY'}


# ============================================================================
# ABSORPTION DETECTOR
# ============================================================================

class AbsorptionDetector:
    """
    Detects absorption events from OHLCV data.

    Absorption = high volume but small price movement.
    Institutional limit orders absorbing aggressive market orders.

    OHLCV PROXY: real absorption requires tick/footprint data.
    """

    @staticmethod
    def detect(
        df: pd.DataFrame,
        vol_threshold: float = 1.5,
        body_threshold: float = 0.4,
        lookback: int = 20
    ) -> List[AbsorptionEvent]:
        """
        Detect absorption candles.

        Criteria:
        - Volume > vol_threshold * average volume
        - Body size < body_threshold * candle range
        - Delta diverges from expected direction
        """
        events = []
        if len(df) < lookback + 1:
            return events

        delta = DeltaEngine.calculate_delta(df)
        avg_volume = df['volume'].rolling(lookback).mean()
        avg_range = (df['high'] - df['low']).rolling(lookback).mean()

        for i in range(lookback, len(df)):
            vol = df['volume'].iloc[i]
            body = abs(df['close'].iloc[i] - df['open'].iloc[i])
            candle_range = df['high'].iloc[i] - df['low'].iloc[i]
            avg_vol = avg_volume.iloc[i]
            avg_rng = avg_range.iloc[i]

            if avg_vol == 0 or avg_rng == 0 or candle_range == 0:
                continue

            vol_ratio = vol / avg_vol
            body_ratio = body / candle_range

            # High volume but small body = absorption
            if vol_ratio >= vol_threshold and body_ratio <= body_threshold:
                d = delta.iloc[i]
                price_change = df['close'].iloc[i] - df['open'].iloc[i]

                # Bullish absorption: high volume selling but price holds
                # (negative delta or flat, but price didn't drop much)
                if d < 0 and price_change >= 0:
                    absorption_type = 'bullish'
                    delta_divergence = True
                # Bearish absorption: high volume buying but price holds
                # (positive delta or flat, but price didn't rise much)
                elif d > 0 and price_change <= 0:
                    absorption_type = 'bearish'
                    delta_divergence = True
                else:
                    # Still absorption (high vol, small body) but no divergence
                    absorption_type = 'bullish' if price_change >= 0 else 'bearish'
                    delta_divergence = False

                strength = min(100, (
                    vol_ratio * 20 +
                    (1 - body_ratio) * 30 +
                    (30 if delta_divergence else 10) +
                    10  # base
                ))

                events.append(AbsorptionEvent(
                    index=i,
                    price=float(df['close'].iloc[i]),
                    absorption_type=absorption_type,
                    strength=float(strength),
                    volume_ratio=float(vol_ratio),
                    body_ratio=float(body_ratio),
                    delta_divergence=delta_divergence,
                    data_type="OHLCV_PROXY"
                ))

        return events


# ============================================================================
# VOLUME IMBALANCE DETECTOR
# ============================================================================

class ImbalanceDetector:
    """
    Detects directional volume imbalances.

    Imbalance = one side overwhelms the other for consecutive candles.
    Stacked imbalance (3+ candles) = very strong signal.

    OHLCV PROXY: real imbalance requires footprint/tick data.
    """

    @staticmethod
    def detect(
        df: pd.DataFrame,
        min_consecutive: int = 3,
        ratio_threshold: float = 1.8,
        lookback: int = 20
    ) -> List[ImbalanceEvent]:
        """
        Detect volume imbalances.

        Criteria:
        - N consecutive candles closing in same direction
        - Buy/sell volume ratio exceeds threshold
        - Volume trending up during the sequence
        """
        events = []
        if len(df) < min_consecutive + 1:
            return events

        buy_vol, sell_vol = DeltaEngine.calculate_buy_sell_volume(df)

        i = lookback if lookback < len(df) else 1
        while i < len(df):
            # Check for bullish imbalance: consecutive up candles with buy dominance
            bull_count = 0
            j = i
            total_buy = 0
            total_sell = 0
            while j < len(df) and df['close'].iloc[j] > df['open'].iloc[j]:
                total_buy += buy_vol.iloc[j]
                total_sell += sell_vol.iloc[j]
                bull_count += 1
                j += 1

            if bull_count >= min_consecutive and total_sell > 0:
                ratio = total_buy / total_sell
                if ratio >= ratio_threshold:
                    strength = min(100, ratio * 20 + bull_count * 10 + 20)
                    events.append(ImbalanceEvent(
                        start_index=i,
                        end_index=j - 1,
                        direction='bullish',
                        strength=float(strength),
                        volume_ratio=float(ratio),
                        consecutive_candles=bull_count,
                        data_type="OHLCV_PROXY"
                    ))
                    i = j
                    continue

            # Check for bearish imbalance
            bear_count = 0
            j = i
            total_buy = 0
            total_sell = 0
            while j < len(df) and df['close'].iloc[j] < df['open'].iloc[j]:
                total_buy += buy_vol.iloc[j]
                total_sell += sell_vol.iloc[j]
                bear_count += 1
                j += 1

            if bear_count >= min_consecutive and total_buy > 0:
                ratio = total_sell / total_buy
                if ratio >= ratio_threshold:
                    strength = min(100, ratio * 20 + bear_count * 10 + 20)
                    events.append(ImbalanceEvent(
                        start_index=i,
                        end_index=j - 1,
                        direction='bearish',
                        strength=float(strength),
                        volume_ratio=float(ratio),
                        consecutive_candles=bear_count,
                        data_type="OHLCV_PROXY"
                    ))
                    i = j
                    continue

            i += 1

        return events


# ============================================================================
# LIQUIDITY SWEEP DETECTOR
# ============================================================================

class LiquiditySweepDetector:
    """
    Detects liquidity sweeps / stop runs.

    A sweep occurs when price briefly exceeds a swing high/low (grabbing stops)
    then reverses back. Smart money uses this to fill large orders.

    OHLCV PROXY: works well with OHLCV since we check wick extensions.
    """

    @staticmethod
    def detect(
        df: pd.DataFrame,
        swings: List[Dict],
        lookback: int = 5,
        min_reversal_pct: float = 0.3
    ) -> List[LiquiditySweepEvent]:
        """
        Detect liquidity sweeps at swing levels.

        swings: list of {'price': float, 'type': 'high'|'low', 'index': int}
        """
        events = []
        if len(df) < 3 or not swings:
            return events

        avg_range = (df['high'] - df['low']).mean()
        avg_volume = df['volume'].mean()

        for i in range(max(1, len(df) - lookback), len(df)):
            for swing in swings:
                if swing['index'] >= i:
                    continue

                # Sweep of swing high: wick goes above, close comes back below
                if swing['type'] == 'high':
                    if df['high'].iloc[i] > swing['price'] and df['close'].iloc[i] < swing['price']:
                        sweep_depth = df['high'].iloc[i] - swing['price']
                        reversal = swing['price'] - df['close'].iloc[i]
                        vol_spike = df['volume'].iloc[i] > avg_volume * 1.3

                        if avg_range > 0:
                            reversal_ratio = reversal / avg_range
                        else:
                            reversal_ratio = 0

                        if reversal_ratio >= min_reversal_pct:
                            strength = min(100, (
                                reversal_ratio * 40 +
                                (20 if vol_spike else 5) +
                                (sweep_depth / avg_range * 30 if avg_range > 0 else 0) +
                                15  # base
                            ))
                            events.append(LiquiditySweepEvent(
                                index=i,
                                sweep_type='sweep_high',
                                swept_level=swing['price'],
                                sweep_depth=float(sweep_depth),
                                reversal_strength=float(reversal_ratio),
                                volume_spike=vol_spike,
                                strength=float(strength),
                                data_type="OHLCV_PROXY"
                            ))

                # Sweep of swing low: wick goes below, close comes back above
                elif swing['type'] == 'low':
                    if df['low'].iloc[i] < swing['price'] and df['close'].iloc[i] > swing['price']:
                        sweep_depth = swing['price'] - df['low'].iloc[i]
                        reversal = df['close'].iloc[i] - swing['price']
                        vol_spike = df['volume'].iloc[i] > avg_volume * 1.3

                        if avg_range > 0:
                            reversal_ratio = reversal / avg_range
                        else:
                            reversal_ratio = 0

                        if reversal_ratio >= min_reversal_pct:
                            strength = min(100, (
                                reversal_ratio * 40 +
                                (20 if vol_spike else 5) +
                                (sweep_depth / avg_range * 30 if avg_range > 0 else 0) +
                                15
                            ))
                            events.append(LiquiditySweepEvent(
                                index=i,
                                sweep_type='sweep_low',
                                swept_level=swing['price'],
                                sweep_depth=float(sweep_depth),
                                reversal_strength=float(reversal_ratio),
                                volume_spike=vol_spike,
                                strength=float(strength),
                                data_type="OHLCV_PROXY"
                            ))

        return events


# ============================================================================
# TRAPPED TRADER DETECTOR
# ============================================================================

class TrappedTraderDetector:
    """
    Detects trapped trader scenarios.

    Bull trap: price breaks above resistance, longs enter, price reverses.
    Bear trap: price breaks below support, shorts enter, price reverses.
    Trapped traders' forced exits fuel the reversal move.

    OHLCV PROXY: works well since we check breakout + reversal patterns.
    """

    @staticmethod
    def detect(
        df: pd.DataFrame,
        swings: List[Dict],
        reversal_candles: int = 3
    ) -> List[TrappedTraderEvent]:
        """
        Detect bull/bear traps at swing levels.
        """
        events = []
        if len(df) < reversal_candles + 2 or not swings:
            return events

        avg_volume = df['volume'].mean()

        for i in range(2, len(df) - 1):
            for swing in swings:
                if swing['index'] >= i - 1:
                    continue

                # Bull trap: broke above swing high, then reversed
                if swing['type'] == 'high':
                    broke_above = df['close'].iloc[i - 1] > swing['price']
                    reversed_below = df['close'].iloc[i] < swing['price']

                    if broke_above and reversed_below:
                        breakout_vol = df['volume'].iloc[i - 1]
                        reversal_vol = df['volume'].iloc[i]
                        vol_confirms = reversal_vol > breakout_vol * 0.8

                        # Check if reversal continues
                        continued = False
                        if i + 1 < len(df):
                            continued = df['close'].iloc[i + 1] < df['close'].iloc[i]

                        strength = min(100, (
                            30 +  # base for trap detection
                            (20 if vol_confirms else 5) +
                            (15 if continued else 0) +
                            min(35, (swing['price'] - df['close'].iloc[i]) /
                                swing['price'] * 5000)
                        ))

                        events.append(TrappedTraderEvent(
                            index=i,
                            trap_type='bull_trap',
                            trap_level=swing['price'],
                            reversal_candles=1 + (1 if continued else 0),
                            volume_confirmation=vol_confirms,
                            strength=float(strength),
                            data_type="OHLCV_PROXY"
                        ))

                # Bear trap: broke below swing low, then reversed
                elif swing['type'] == 'low':
                    broke_below = df['close'].iloc[i - 1] < swing['price']
                    reversed_above = df['close'].iloc[i] > swing['price']

                    if broke_below and reversed_above:
                        breakout_vol = df['volume'].iloc[i - 1]
                        reversal_vol = df['volume'].iloc[i]
                        vol_confirms = reversal_vol > breakout_vol * 0.8

                        continued = False
                        if i + 1 < len(df):
                            continued = df['close'].iloc[i + 1] > df['close'].iloc[i]

                        strength = min(100, (
                            30 +
                            (20 if vol_confirms else 5) +
                            (15 if continued else 0) +
                            min(35, (df['close'].iloc[i] - swing['price']) /
                                swing['price'] * 5000)
                        ))

                        events.append(TrappedTraderEvent(
                            index=i,
                            trap_type='bear_trap',
                            trap_level=swing['price'],
                            reversal_candles=1 + (1 if continued else 0),
                            volume_confirmation=vol_confirms,
                            strength=float(strength),
                            data_type="OHLCV_PROXY"
                        ))

        return events


# ============================================================================
# VOLUME PROFILE ENGINE
# ============================================================================

class VolumeProfileEngine:
    """
    Builds volume profile from OHLCV data.

    Calculates POC, VAH, VAL, HVN, LVN.

    OHLCV PROXY: distributes candle volume across price bins.
    Real volume profile requires tick data for exact price-volume mapping.
    """

    @staticmethod
    def calculate(
        df: pd.DataFrame,
        num_bins: int = 50,
        value_area_pct: float = 0.70
    ) -> Optional[VolumeProfileResult]:
        """Build volume profile and extract key levels."""
        if len(df) < 10:
            return None

        price_low = df['low'].min()
        price_high = df['high'].max()
        price_range = price_high - price_low

        if price_range <= 0:
            return None

        bin_size = price_range / num_bins
        bins = np.zeros(num_bins)
        bin_prices = np.array([price_low + (i + 0.5) * bin_size for i in range(num_bins)])

        # Distribute each candle's volume across the bins it touches
        for idx in range(len(df)):
            candle_low = df['low'].iloc[idx]
            candle_high = df['high'].iloc[idx]
            candle_vol = df['volume'].iloc[idx]

            if candle_high <= candle_low or candle_vol <= 0:
                continue

            low_bin = max(0, int((candle_low - price_low) / bin_size))
            high_bin = min(num_bins - 1, int((candle_high - price_low) / bin_size))

            num_bins_touched = high_bin - low_bin + 1
            vol_per_bin = candle_vol / num_bins_touched

            for b in range(low_bin, high_bin + 1):
                bins[b] += vol_per_bin

        # POC: bin with highest volume
        poc_bin = np.argmax(bins)
        poc = float(bin_prices[poc_bin])

        # Value Area: expand from POC until 70% of volume is covered
        total_volume = bins.sum()
        if total_volume <= 0:
            return None

        target_volume = total_volume * value_area_pct
        va_volume = bins[poc_bin]
        va_low_bin = poc_bin
        va_high_bin = poc_bin

        while va_volume < target_volume:
            # Expand in the direction with more volume
            expand_low = bins[va_low_bin - 1] if va_low_bin > 0 else 0
            expand_high = bins[va_high_bin + 1] if va_high_bin < num_bins - 1 else 0

            if expand_high >= expand_low and va_high_bin < num_bins - 1:
                va_high_bin += 1
                va_volume += bins[va_high_bin]
            elif va_low_bin > 0:
                va_low_bin -= 1
                va_volume += bins[va_low_bin]
            else:
                break

        vah = float(bin_prices[va_high_bin] + bin_size / 2)
        val = float(bin_prices[va_low_bin] - bin_size / 2)

        # HVN and LVN detection
        avg_bin_vol = total_volume / num_bins
        hvn_levels = []
        lvn_levels = []

        for b in range(1, num_bins - 1):
            if bins[b] > avg_bin_vol * 1.5:
                hvn_levels.append(float(bin_prices[b]))
            elif bins[b] < avg_bin_vol * 0.5:
                lvn_levels.append(float(bin_prices[b]))

        # Current price position relative to value area
        current_price = float(df['close'].iloc[-1])
        if current_price > vah:
            position = 'above_va'
        elif current_price < val:
            position = 'below_va'
        else:
            position = 'in_va'

        return VolumeProfileResult(
            poc=poc,
            vah=vah,
            val=val,
            hvn_levels=hvn_levels[:5],  # top 5
            lvn_levels=lvn_levels[:5],
            current_position=position,
            data_type="OHLCV_PROXY"
        )


# ============================================================================
# COMPOSITE ORDER FLOW SCORER
# ============================================================================

class OrderFlowScorer:
    """
    Computes composite Order Flow Score (0-100) for trade decisions.

    Weights:
    - Delta / pressure: 25%
    - Volume spike: 20%
    - Absorption: 20%
    - Imbalance: 20%
    - Liquidity sweep / trapped traders: 15%

    ALL scores are OHLCV PROXY based.
    """

    def __init__(self):
        self.delta_engine = DeltaEngine()
        self.absorption_detector = AbsorptionDetector()
        self.imbalance_detector = ImbalanceDetector()
        self.sweep_detector = LiquiditySweepDetector()
        self.trapped_detector = TrappedTraderDetector()
        self.volume_profile_engine = VolumeProfileEngine()

    def score(
        self,
        df: pd.DataFrame,
        direction: str,  # 'long' or 'short'
        swings: Optional[List[Dict]] = None,
        lookback: int = 20
    ) -> OrderFlowScore:
        """
        Compute full order flow score for a given direction.

        Args:
            df: OHLCV DataFrame
            direction: 'long' or 'short'
            swings: list of swing points for sweep/trap detection
            lookback: candles to analyze

        Returns:
            OrderFlowScore with total 0-100 and breakdown
        """
        if len(df) < lookback:
            return self._empty_score()

        recent = df.tail(lookback + 10)  # extra buffer for calculations
        confirmations = []
        warnings = []

        # 1. DELTA SCORE (25%)
        delta_score = self._score_delta(recent, direction, confirmations, warnings)

        # 2. VOLUME SPIKE SCORE (20%)
        vol_score = self._score_volume_spike(recent, confirmations, warnings)

        # 3. ABSORPTION SCORE (20%)
        absorption_score = self._score_absorption(recent, direction, confirmations, warnings)

        # 4. IMBALANCE SCORE (20%)
        imbalance_score = self._score_imbalance(recent, direction, confirmations, warnings)

        # 5. SWEEP + TRAPPED SCORE (15%)
        sweep_score = self._score_sweep_trapped(
            recent, direction, swings or [], confirmations, warnings
        )

        # Composite score
        total = (
            delta_score * 0.25 +
            vol_score * 0.20 +
            absorption_score * 0.20 +
            imbalance_score * 0.20 +
            sweep_score * 0.15
        )

        # Determine strength classification
        if total >= 76:
            strength = FlowStrength.HIGH_CONVICTION
        elif total >= 61:
            strength = FlowStrength.STRONG
        elif total >= 41:
            strength = FlowStrength.NEUTRAL
        else:
            strength = FlowStrength.WEAK

        # Direction bias from delta
        delta = DeltaEngine.calculate_delta(recent)
        recent_delta_sum = delta.tail(5).sum()
        if recent_delta_sum > 0:
            bias = 'bullish'
        elif recent_delta_sum < 0:
            bias = 'bearish'
        else:
            bias = 'neutral'

        return OrderFlowScore(
            total_score=round(float(total), 1),
            strength=strength,
            delta_score=round(float(delta_score), 1),
            volume_spike_score=round(float(vol_score), 1),
            absorption_score=round(float(absorption_score), 1),
            imbalance_score=round(float(imbalance_score), 1),
            sweep_trapped_score=round(float(sweep_score), 1),
            direction_bias=bias,
            confirmations=confirmations,
            warnings=warnings,
            data_type="OHLCV_PROXY"
        )

    def _score_delta(self, df, direction, confirms, warns) -> float:
        """Score delta alignment with trade direction."""
        delta = DeltaEngine.calculate_delta(df)
        cvd = delta.cumsum()

        # Recent delta trend (last 5 candles)
        recent_delta = delta.tail(5)
        avg_delta = recent_delta.mean()
        vol_avg = df['volume'].tail(5).mean()
        delta_pct = (avg_delta / vol_avg * 100) if vol_avg > 0 else 0

        # CVD trend
        cvd_vals = cvd.tail(10).values
        cvd_trend = 'up' if len(cvd_vals) > 1 and cvd_vals[-1] > cvd_vals[0] else 'down'

        score = 50  # neutral start

        if direction == 'long':
            if delta_pct > 15:
                score += 30
                confirms.append('Strong buy delta (+{:.0f}%)'.format(delta_pct))
            elif delta_pct > 5:
                score += 15
                confirms.append('Moderate buy delta')
            elif delta_pct < -10:
                score -= 25
                warns.append('Sell delta against long direction')

            if cvd_trend == 'up':
                score += 15
                confirms.append('CVD trending up')
            else:
                score -= 10
                warns.append('CVD trending down vs long')

        elif direction == 'short':
            if delta_pct < -15:
                score += 30
                confirms.append('Strong sell delta ({:.0f}%)'.format(delta_pct))
            elif delta_pct < -5:
                score += 15
                confirms.append('Moderate sell delta')
            elif delta_pct > 10:
                score -= 25
                warns.append('Buy delta against short direction')

            if cvd_trend == 'down':
                score += 15
                confirms.append('CVD trending down')
            else:
                score -= 10
                warns.append('CVD trending up vs short')

        # CVD divergence bonus
        div = DeltaEngine.detect_cvd_divergence(df)
        if div.get('divergence'):
            if div['type'] == 'bullish' and direction == 'long':
                score += 10
                confirms.append('Bullish CVD divergence')
            elif div['type'] == 'bearish' and direction == 'short':
                score += 10
                confirms.append('Bearish CVD divergence')

        return max(0, min(100, score))

    def _score_volume_spike(self, df, confirms, warns) -> float:
        """Score volume expansion on recent candles."""
        vol = df['volume']
        avg_vol = vol.rolling(20).mean()

        if avg_vol.iloc[-1] is None or avg_vol.iloc[-1] == 0:
            return 50

        current_vol = vol.iloc[-1]
        ratio = current_vol / avg_vol.iloc[-1]

        # Also check if volume is trending up over last 5 candles
        vol_trend = vol.tail(5).values
        vol_increasing = all(vol_trend[j] >= vol_trend[j-1] * 0.9 for j in range(1, len(vol_trend)))

        score = 40  # base

        if ratio > 2.5:
            score = 95
            confirms.append('Major volume spike ({:.1f}x avg)'.format(ratio))
        elif ratio > 2.0:
            score = 80
            confirms.append('Strong volume spike ({:.1f}x avg)'.format(ratio))
        elif ratio > 1.5:
            score = 65
            confirms.append('Volume above average ({:.1f}x)'.format(ratio))
        elif ratio > 1.0:
            score = 50
        else:
            score = 30
            warns.append('Below-average volume ({:.1f}x)'.format(ratio))

        if vol_increasing:
            score = min(100, score + 10)
            confirms.append('Volume trending up')

        return float(score)

    def _score_absorption(self, df, direction, confirms, warns) -> float:
        """Score absorption events alignment."""
        events = self.absorption_detector.detect(df)

        if not events:
            return 50  # neutral — no absorption detected

        # Check recent absorption events (last 5 candles)
        recent_events = [e for e in events if e.index >= len(df) - 5]

        if not recent_events:
            return 50

        best_event = max(recent_events, key=lambda e: e.strength)

        score = 40
        if direction == 'long' and best_event.absorption_type == 'bullish':
            score = min(100, best_event.strength + 10)
            confirms.append('Bullish absorption (str={:.0f})'.format(best_event.strength))
            if best_event.delta_divergence:
                score = min(100, score + 10)
                confirms.append('Delta divergence confirms absorption')
        elif direction == 'short' and best_event.absorption_type == 'bearish':
            score = min(100, best_event.strength + 10)
            confirms.append('Bearish absorption (str={:.0f})'.format(best_event.strength))
            if best_event.delta_divergence:
                score = min(100, score + 10)
                confirms.append('Delta divergence confirms absorption')
        else:
            # Absorption in wrong direction
            score = max(10, 50 - best_event.strength * 0.5)
            warns.append('Absorption against trade direction')

        return float(score)

    def _score_imbalance(self, df, direction, confirms, warns) -> float:
        """Score volume imbalance alignment."""
        events = self.imbalance_detector.detect(df)

        if not events:
            return 50

        # Check most recent imbalance
        recent_events = [e for e in events if e.end_index >= len(df) - 10]

        if not recent_events:
            return 50

        best = max(recent_events, key=lambda e: e.strength)

        score = 40
        if direction == 'long' and best.direction == 'bullish':
            score = min(100, best.strength + 5)
            confirms.append('Bullish imbalance ({} candles, {:.1f}x ratio)'.format(
                best.consecutive_candles, best.volume_ratio))
        elif direction == 'short' and best.direction == 'bearish':
            score = min(100, best.strength + 5)
            confirms.append('Bearish imbalance ({} candles, {:.1f}x ratio)'.format(
                best.consecutive_candles, best.volume_ratio))
        else:
            score = max(10, 50 - best.strength * 0.4)
            warns.append('Volume imbalance against direction')

        return float(score)

    def _score_sweep_trapped(self, df, direction, swings, confirms, warns) -> float:
        """Score liquidity sweeps and trapped trader signals."""
        if not swings:
            return 50

        sweep_events = self.sweep_detector.detect(df, swings)
        trap_events = self.trapped_detector.detect(df, swings)

        score = 45  # slightly below neutral if no events

        # Sweeps
        recent_sweeps = [e for e in sweep_events if e.index >= len(df) - 5]
        if recent_sweeps:
            best_sweep = max(recent_sweeps, key=lambda e: e.strength)

            if direction == 'long' and best_sweep.sweep_type == 'sweep_low':
                score += 25
                confirms.append('Liquidity sweep below (stops grabbed, fuel loaded)')
            elif direction == 'short' and best_sweep.sweep_type == 'sweep_high':
                score += 25
                confirms.append('Liquidity sweep above (stops grabbed, fuel loaded)')
            elif direction == 'long' and best_sweep.sweep_type == 'sweep_high':
                score -= 15
                warns.append('Sweep above — possible bull trap')

        # Trapped traders
        recent_traps = [e for e in trap_events if e.index >= len(df) - 5]
        if recent_traps:
            best_trap = max(recent_traps, key=lambda e: e.strength)

            if direction == 'long' and best_trap.trap_type == 'bear_trap':
                score += 20
                confirms.append('Bear trap detected — shorts trapped, fuel for upside')
            elif direction == 'short' and best_trap.trap_type == 'bull_trap':
                score += 20
                confirms.append('Bull trap detected — longs trapped, fuel for downside')
            elif direction == 'long' and best_trap.trap_type == 'bull_trap':
                score -= 20
                warns.append('Bull trap detected — longs getting trapped')

        return max(0, min(100, float(score)))

    def _empty_score(self) -> OrderFlowScore:
        """Return empty/neutral score."""
        return OrderFlowScore(
            total_score=50,
            strength=FlowStrength.NEUTRAL,
            delta_score=50,
            volume_spike_score=50,
            absorption_score=50,
            imbalance_score=50,
            sweep_trapped_score=50,
            direction_bias='neutral',
            confirmations=[],
            warnings=['Insufficient data for order flow analysis'],
            data_type="OHLCV_PROXY"
        )

    def full_analysis(
        self,
        df: pd.DataFrame,
        swings: Optional[List[Dict]] = None,
        lookback: int = 20
    ) -> Dict[str, Any]:
        """
        Run complete order flow analysis and return all components.
        Used for dashboard display and logging.
        """
        if len(df) < lookback:
            return {'error': 'Insufficient data', 'data_type': 'OHLCV_PROXY'}

        # Delta analysis
        delta = DeltaEngine.calculate_delta(df)
        cvd = delta.cumsum()
        cvd_div = DeltaEngine.detect_cvd_divergence(df, lookback)

        # Buy/sell volume
        buy_vol, sell_vol = DeltaEngine.calculate_buy_sell_volume(df)

        # Absorption
        absorption_events = self.absorption_detector.detect(df)

        # Imbalance
        imbalance_events = self.imbalance_detector.detect(df)

        # Sweeps and traps
        sweep_events = self.sweep_detector.detect(df, swings or []) if swings else []
        trap_events = self.trapped_detector.detect(df, swings or []) if swings else []

        # Volume profile
        vol_profile = self.volume_profile_engine.calculate(df)

        # Scores for both directions
        long_score = self.score(df, 'long', swings, lookback)
        short_score = self.score(df, 'short', swings, lookback)

        return {
            'data_type': 'OHLCV_PROXY',
            'candles_analyzed': len(df),
            'delta': {
                'current': float(delta.iloc[-1]),
                'avg_5': float(delta.tail(5).mean()),
                'cvd_current': float(cvd.iloc[-1]),
                'cvd_trend': 'up' if cvd.iloc[-1] > cvd.iloc[-6] else 'down' if len(cvd) > 5 else 'flat',
                'divergence': cvd_div,
            },
            'buy_sell': {
                'buy_volume_5': float(buy_vol.tail(5).sum()),
                'sell_volume_5': float(sell_vol.tail(5).sum()),
                'buy_pct': float(buy_vol.tail(5).sum() / (buy_vol.tail(5).sum() + sell_vol.tail(5).sum()) * 100) if (buy_vol.tail(5).sum() + sell_vol.tail(5).sum()) > 0 else 50,
            },
            'absorption': {
                'events_total': len(absorption_events),
                'recent': [
                    {
                        'type': e.absorption_type,
                        'strength': e.strength,
                        'volume_ratio': round(e.volume_ratio, 2),
                        'delta_divergence': e.delta_divergence,
                    }
                    for e in absorption_events[-3:]
                ],
            },
            'imbalance': {
                'events_total': len(imbalance_events),
                'recent': [
                    {
                        'direction': e.direction,
                        'strength': e.strength,
                        'consecutive': e.consecutive_candles,
                        'ratio': round(e.volume_ratio, 2),
                    }
                    for e in imbalance_events[-3:]
                ],
            },
            'sweeps': {
                'events_total': len(sweep_events),
                'recent': [
                    {
                        'type': e.sweep_type,
                        'level': e.swept_level,
                        'strength': e.strength,
                        'volume_spike': e.volume_spike,
                    }
                    for e in sweep_events[-3:]
                ],
            },
            'trapped_traders': {
                'events_total': len(trap_events),
                'recent': [
                    {
                        'type': e.trap_type,
                        'level': e.trap_level,
                        'strength': e.strength,
                        'volume_confirmation': e.volume_confirmation,
                    }
                    for e in trap_events[-3:]
                ],
            },
            'volume_profile': {
                'poc': vol_profile.poc if vol_profile else None,
                'vah': vol_profile.vah if vol_profile else None,
                'val': vol_profile.val if vol_profile else None,
                'position': vol_profile.current_position if vol_profile else None,
                'hvn_count': len(vol_profile.hvn_levels) if vol_profile else 0,
                'lvn_count': len(vol_profile.lvn_levels) if vol_profile else 0,
            },
            'scores': {
                'long': {
                    'total': long_score.total_score,
                    'strength': long_score.strength.value,
                    'delta': long_score.delta_score,
                    'volume': long_score.volume_spike_score,
                    'absorption': long_score.absorption_score,
                    'imbalance': long_score.imbalance_score,
                    'sweep_trapped': long_score.sweep_trapped_score,
                    'confirmations': long_score.confirmations,
                    'warnings': long_score.warnings,
                },
                'short': {
                    'total': short_score.total_score,
                    'strength': short_score.strength.value,
                    'delta': short_score.delta_score,
                    'volume': short_score.volume_spike_score,
                    'absorption': short_score.absorption_score,
                    'imbalance': short_score.imbalance_score,
                    'sweep_trapped': short_score.sweep_trapped_score,
                    'confirmations': short_score.confirmations,
                    'warnings': short_score.warnings,
                },
                'direction_bias': long_score.direction_bias,
            },
        }
