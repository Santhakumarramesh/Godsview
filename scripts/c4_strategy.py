#!/usr/bin/env python3
"""
GodsView — C4 Order Flow Strategy
===================================
Strict 4-confirmation strategy requiring all 4 pillars before trade.

C1 = Context      (0-25): BOS/CHOCH + OB + liquidity sweep/retest zone
C2 = Confirmation  (0-25): OB retest + rejection candle + close confirms direction
C3 = Commitment    (0-25): Order flow: delta + CVD + volume spike + imbalance + absorption
C4 = Control       (0-25): RR >= 1:2 + SL beyond OB/sweep + risk gate passes

Total C4 Score = 0-100
- >= 80: PAPER TRADE
- 65-79: WATCHLIST ONLY
- < 65:  REJECT

ALL order flow signals are OHLCV PROXY — not real order book data.

Author: GodsView Trading Systems
Mode: PAPER ONLY
"""

import numpy as np
import pandas as pd
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple, Any
from enum import Enum
import logging

# Import order flow engine components
from order_flow_engine import (
    DeltaEngine, AbsorptionDetector, ImbalanceDetector,
    LiquiditySweepDetector, TrappedTraderDetector,
    VolumeProfileEngine, VWAPEngine, ClimaxDetector,
    StackedImbalanceDetector, AccDistClassifier,
    VolumeExhaustionDetector, OrderFlowScorer,
    ExitSignalEngine
)

logger = logging.getLogger(__name__)


# ============================================================================
# C4 DATA TYPES
# ============================================================================

class C4Decision(Enum):
    TRADE = "PAPER_TRADE"
    WATCHLIST = "WATCHLIST"
    REJECT = "REJECT"


@dataclass
class C1Score:
    """C1 — Context score."""
    total: float                # 0-25
    bos_choch_score: float      # 0-10 for BOS/CHOCH quality
    ob_score: float             # 0-8 for order block quality
    sweep_zone_score: float     # 0-7 for liquidity sweep / retest zone
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class C2Score:
    """C2 — Confirmation score."""
    total: float                # 0-25
    retest_score: float         # 0-10 for OB retest quality
    rejection_score: float      # 0-8 for rejection candle
    close_confirms_score: float # 0-7 for close confirming direction
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class C3Score:
    """C3 — Commitment (Order Flow) score."""
    total: float                # 0-25
    delta_score: float          # 0-6 for delta direction alignment
    cvd_score: float            # 0-5 for cumulative delta trend
    volume_score: float         # 0-5 for volume expansion
    imbalance_score: float      # 0-5 for buy/sell imbalance
    absorption_score: float     # 0-4 for absorption / trapped traders
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class C4ControlScore:
    """C4 — Control (Risk) score."""
    total: float                # 0-25
    rr_score: float             # 0-10 for risk/reward ratio
    sl_quality_score: float     # 0-8 for stop loss placement
    risk_gate_score: float      # 0-7 for risk management gate
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class C4Result:
    """Full C4 strategy evaluation result."""
    symbol: str
    timeframe: str
    direction: str              # 'LONG' or 'SHORT'
    c1: C1Score
    c2: C2Score
    c3: C3Score
    c4: C4ControlScore
    total_score: float          # 0-100
    decision: C4Decision
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward: float
    timestamp: str
    confirmations: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    data_type: str = "OHLCV_PROXY"


@dataclass
class SwingPoint:
    """Swing high/low."""
    index: int
    price: float
    type: str   # 'high' or 'low'
    strength: float = 0


@dataclass
class OrderBlock:
    """Order block zone."""
    start_idx: int
    end_idx: int
    high: float
    low: float
    ob_type: str    # 'bullish' or 'bearish'
    strength: float


# ============================================================================
# MARKET STRUCTURE DETECTION (for C1)
# ============================================================================

class C4StructureAnalyzer:
    """Detect swings, BOS/CHOCH, order blocks, liquidity sweeps for C4."""

    @staticmethod
    def detect_swings(df: pd.DataFrame, lookback: int = 5) -> List[SwingPoint]:
        """Detect swing highs and lows."""
        swings = []
        if len(df) < lookback * 2 + 1:
            return swings

        highs = df['high'].values
        lows = df['low'].values
        volumes = df['volume'].values
        avg_range = np.mean(highs - lows)

        for i in range(lookback, len(df) - lookback):
            left_h = highs[i - lookback:i]
            right_h = highs[i + 1:i + lookback + 1]

            if highs[i] >= max(left_h) and highs[i] >= max(right_h):
                strength = min(100, (highs[i] - min(min(left_h), min(right_h))) / (avg_range + 0.001) * 30 + 30)
                swings.append(SwingPoint(i, float(highs[i]), 'high', float(strength)))

            left_l = lows[i - lookback:i]
            right_l = lows[i + 1:i + lookback + 1]

            if lows[i] <= min(left_l) and lows[i] <= min(right_l):
                strength = min(100, (max(max(left_l), max(right_l)) - lows[i]) / (avg_range + 0.001) * 30 + 30)
                swings.append(SwingPoint(i, float(lows[i]), 'low', float(strength)))

        return sorted(swings, key=lambda s: s.index)

    @staticmethod
    def detect_bos_choch(swings: List[SwingPoint], df: pd.DataFrame) -> Dict[str, Any]:
        """Detect Break of Structure and Change of Character."""
        result = {
            'bos': {'detected': False, 'direction': None, 'strength': 0, 'index': None},
            'choch': {'detected': False, 'direction': None, 'strength': 0, 'index': None},
            'trend': 'neutral'
        }

        if len(swings) < 4:
            return result

        # Determine trend from last 4 swings
        recent_highs = [s for s in swings[-8:] if s.type == 'high']
        recent_lows = [s for s in swings[-8:] if s.type == 'low']

        if len(recent_highs) >= 2 and len(recent_lows) >= 2:
            hh = recent_highs[-1].price > recent_highs[-2].price
            hl = recent_lows[-1].price > recent_lows[-2].price
            lh = recent_highs[-1].price < recent_highs[-2].price
            ll = recent_lows[-1].price < recent_lows[-2].price

            if hh and hl:
                result['trend'] = 'up'
            elif lh and ll:
                result['trend'] = 'down'

        # Check BOS: price breaks swing in trend direction
        current_price = df['close'].iloc[-1]
        last_high = next((s for s in reversed(swings) if s.type == 'high'), None)
        last_low = next((s for s in reversed(swings) if s.type == 'low'), None)

        if last_high and current_price > last_high.price:
            result['bos'] = {
                'detected': True,
                'direction': 'up',
                'strength': min(100, (current_price - last_high.price) / last_high.price * 5000 + 40),
                'index': len(df) - 1,
                'level': last_high.price
            }

        if last_low and current_price < last_low.price:
            result['bos'] = {
                'detected': True,
                'direction': 'down',
                'strength': min(100, (last_low.price - current_price) / last_low.price * 5000 + 40),
                'index': len(df) - 1,
                'level': last_low.price
            }

        # Check CHOCH: break against trend
        if result['trend'] == 'up' and last_low:
            # In uptrend, break below recent low = CHOCH bearish
            if current_price < last_low.price:
                result['choch'] = {
                    'detected': True,
                    'direction': 'bearish',
                    'strength': min(100, (last_low.price - current_price) / last_low.price * 5000 + 50),
                    'index': len(df) - 1,
                    'level': last_low.price
                }
        elif result['trend'] == 'down' and last_high:
            # In downtrend, break above recent high = CHOCH bullish
            if current_price > last_high.price:
                result['choch'] = {
                    'detected': True,
                    'direction': 'bullish',
                    'strength': min(100, (current_price - last_high.price) / last_high.price * 5000 + 50),
                    'index': len(df) - 1,
                    'level': last_high.price
                }

        return result

    @staticmethod
    def detect_order_blocks(df: pd.DataFrame, swings: List[SwingPoint]) -> List[OrderBlock]:
        """Detect order blocks near swing points."""
        obs = []
        if len(df) < 20:
            return obs

        closes = df['close'].values
        opens = df['open'].values
        highs = df['high'].values
        lows = df['low'].values
        volumes = df['volume'].values
        avg_vol = np.mean(volumes)

        for swing in swings:
            idx = swing.index
            if idx < 5 or idx >= len(df) - 2:
                continue

            if swing.type == 'low':
                # Bullish OB: look for down-close candle before the swing low
                for j in range(max(0, idx - 5), idx):
                    if closes[j] < opens[j]:  # bearish candle = potential bullish OB
                        vol_ratio = volumes[j] / avg_vol if avg_vol > 0 else 1
                        body_size = abs(closes[j] - opens[j])
                        avg_body = np.mean(np.abs(closes[max(0, j - 10):j] - opens[max(0, j - 10):j]))
                        if avg_body > 0 and body_size > avg_body * 0.8:
                            strength = min(100, vol_ratio * 20 + swing.strength * 0.3 + 30)
                            obs.append(OrderBlock(
                                start_idx=j, end_idx=j,
                                high=float(opens[j]),
                                low=float(closes[j]),
                                ob_type='bullish',
                                strength=float(strength)
                            ))
                            break

            elif swing.type == 'high':
                # Bearish OB: look for up-close candle before the swing high
                for j in range(max(0, idx - 5), idx):
                    if closes[j] > opens[j]:  # bullish candle = potential bearish OB
                        vol_ratio = volumes[j] / avg_vol if avg_vol > 0 else 1
                        body_size = abs(closes[j] - opens[j])
                        avg_body = np.mean(np.abs(closes[max(0, j - 10):j] - opens[max(0, j - 10):j]))
                        if avg_body > 0 and body_size > avg_body * 0.8:
                            strength = min(100, vol_ratio * 20 + swing.strength * 0.3 + 30)
                            obs.append(OrderBlock(
                                start_idx=j, end_idx=j,
                                high=float(closes[j]),
                                low=float(opens[j]),
                                ob_type='bearish',
                                strength=float(strength)
                            ))
                            break

        return obs

    @staticmethod
    def detect_liquidity_sweeps(
        df: pd.DataFrame,
        swings: List[SwingPoint],
        lookback: int = 5
    ) -> List[Dict[str, Any]]:
        """Detect liquidity sweeps at swing levels."""
        sweeps = []
        if len(df) < 3 or not swings:
            return sweeps

        for i in range(max(1, len(df) - lookback), len(df)):
            for swing in swings:
                if swing.index >= i:
                    continue

                # Sweep high: wick above swing high, close below
                if swing.type == 'high':
                    if df['high'].iloc[i] > swing.price and df['close'].iloc[i] < swing.price:
                        depth = df['high'].iloc[i] - swing.price
                        sweeps.append({
                            'type': 'sweep_high',
                            'level': swing.price,
                            'index': i,
                            'depth': float(depth),
                            'strength': min(100, swing.strength * 0.5 + 40)
                        })

                # Sweep low: wick below swing low, close above
                elif swing.type == 'low':
                    if df['low'].iloc[i] < swing.price and df['close'].iloc[i] > swing.price:
                        depth = swing.price - df['low'].iloc[i]
                        sweeps.append({
                            'type': 'sweep_low',
                            'level': swing.price,
                            'index': i,
                            'depth': float(depth),
                            'strength': min(100, swing.strength * 0.5 + 40)
                        })

        return sweeps


# ============================================================================
# C4 SCORING ENGINE
# ============================================================================

class C4Scorer:
    """
    Scores each of the 4 C's and produces a total C4 score.

    C1 Context:       0-25 (BOS/CHOCH + OB + sweep zone)
    C2 Confirmation:  0-25 (OB retest + rejection + close confirms)
    C3 Commitment:    0-25 (delta + CVD + volume + imbalance + absorption)
    C4 Control:       0-25 (RR + SL quality + risk gate)

    Total: 0-100
    """

    def __init__(self):
        self.structure = C4StructureAnalyzer()
        self.of_scorer = OrderFlowScorer()
        self.exit_engine = ExitSignalEngine()

    def evaluate(
        self,
        df: pd.DataFrame,
        symbol: str,
        timeframe: str,
        direction: str,
        max_positions: int = 3,
        current_positions: int = 0,
        paper_mode: bool = True
    ) -> Optional[C4Result]:
        """
        Run full C4 evaluation.

        Args:
            df: OHLCV DataFrame (needs at least 50 candles)
            symbol: e.g. 'BTC/USD'
            timeframe: e.g. '4h'
            direction: 'LONG' or 'SHORT'
            max_positions: max concurrent positions
            current_positions: current open positions
            paper_mode: must be True

        Returns:
            C4Result or None if insufficient data
        """
        if len(df) < 30:
            return None

        # Detect market structure
        swings = self.structure.detect_swings(df, lookback=5)
        bos_choch = self.structure.detect_bos_choch(swings, df)
        order_blocks = self.structure.detect_order_blocks(df, swings)
        sweeps = self.structure.detect_liquidity_sweeps(df, swings)

        current_price = float(df['close'].iloc[-1])
        confirms = []
        warns = []

        # ── C1: Context ──
        c1 = self._score_c1(direction, bos_choch, order_blocks, sweeps, current_price, confirms, warns)

        # Find the best matching OB for this direction
        target_ob = self._find_best_ob(order_blocks, direction, current_price)

        # ── C2: Confirmation ──
        c2 = self._score_c2(df, direction, target_ob, current_price, confirms, warns)

        # ── C3: Commitment ──
        swing_dicts = [{'index': s.index, 'price': s.price, 'type': s.type} for s in swings]
        c3 = self._score_c3(df, direction, swing_dicts, confirms, warns)

        # ── C4: Control ──
        entry_price, stop_loss, take_profit = self._calculate_levels(
            df, direction, target_ob, swings, current_price
        )
        risk_reward = self._calculate_rr(direction, entry_price, stop_loss, take_profit)
        c4 = self._score_c4(
            direction, entry_price, stop_loss, take_profit, risk_reward,
            target_ob, max_positions, current_positions, paper_mode,
            confirms, warns
        )

        # Total
        total = c1.total + c2.total + c3.total + c4.total

        if total >= 80:
            decision = C4Decision.TRADE
        elif total >= 65:
            decision = C4Decision.WATCHLIST
        else:
            decision = C4Decision.REJECT

        timestamp = str(df.index[-1]) if hasattr(df.index[-1], 'isoformat') else str(df.index[-1])

        return C4Result(
            symbol=symbol,
            timeframe=timeframe,
            direction=direction,
            c1=c1, c2=c2, c3=c3, c4=c4,
            total_score=round(total, 1),
            decision=decision,
            entry_price=round(entry_price, 6),
            stop_loss=round(stop_loss, 6),
            take_profit=round(take_profit, 6),
            risk_reward=round(risk_reward, 2),
            timestamp=timestamp,
            confirmations=confirms,
            warnings=warns,
            data_type="OHLCV_PROXY"
        )

    # ── C1: Context scoring ──

    def _score_c1(self, direction, bos_choch, order_blocks, sweeps, price, confirms, warns) -> C1Score:
        bos_score = 0
        ob_score = 0
        sweep_score = 0
        details = {}

        # BOS / CHOCH (0-10)
        bos = bos_choch.get('bos', {})
        choch = bos_choch.get('choch', {})

        if direction == 'LONG':
            if bos.get('detected') and bos.get('direction') == 'up':
                bos_score = min(10, bos.get('strength', 0) / 100 * 10)
                confirms.append(f'C1: Bullish BOS (str={bos.get("strength", 0):.0f})')
                details['bos'] = 'bullish_bos'
            elif choch.get('detected') and choch.get('direction') == 'bullish':
                bos_score = min(10, choch.get('strength', 0) / 100 * 10)
                confirms.append(f'C1: Bullish CHOCH (str={choch.get("strength", 0):.0f})')
                details['bos'] = 'bullish_choch'
            else:
                warns.append('C1: No bullish BOS/CHOCH')
                details['bos'] = 'none'

        elif direction == 'SHORT':
            if bos.get('detected') and bos.get('direction') == 'down':
                bos_score = min(10, bos.get('strength', 0) / 100 * 10)
                confirms.append(f'C1: Bearish BOS (str={bos.get("strength", 0):.0f})')
                details['bos'] = 'bearish_bos'
            elif choch.get('detected') and choch.get('direction') == 'bearish':
                bos_score = min(10, choch.get('strength', 0) / 100 * 10)
                confirms.append(f'C1: Bearish CHOCH (str={choch.get("strength", 0):.0f})')
                details['bos'] = 'bearish_choch'
            else:
                warns.append('C1: No bearish BOS/CHOCH')
                details['bos'] = 'none'

        # Order Block quality (0-8)
        matching_obs = [ob for ob in order_blocks
                        if (direction == 'LONG' and ob.ob_type == 'bullish') or
                           (direction == 'SHORT' and ob.ob_type == 'bearish')]

        if matching_obs:
            best_ob = max(matching_obs, key=lambda o: o.strength)
            ob_score = min(8, best_ob.strength / 100 * 8)
            confirms.append(f'C1: {best_ob.ob_type} OB (str={best_ob.strength:.0f})')
            details['ob'] = {'type': best_ob.ob_type, 'strength': best_ob.strength}
        else:
            warns.append(f'C1: No {direction.lower()} order block found')
            details['ob'] = None

        # Liquidity sweep / zone (0-7)
        if direction == 'LONG':
            matching_sweeps = [s for s in sweeps if s['type'] == 'sweep_low']
        else:
            matching_sweeps = [s for s in sweeps if s['type'] == 'sweep_high']

        if matching_sweeps:
            best_sweep = max(matching_sweeps, key=lambda s: s['strength'])
            sweep_score = min(7, best_sweep['strength'] / 100 * 7)
            confirms.append(f'C1: Liquidity sweep {best_sweep["type"]} (str={best_sweep["strength"]:.0f})')
            details['sweep'] = best_sweep
        else:
            # No sweep but OB retest zone counts for partial credit
            if matching_obs:
                sweep_score = 2
                details['sweep'] = 'ob_zone_only'
            else:
                warns.append('C1: No liquidity sweep or retest zone')
                details['sweep'] = None

        total = min(25, bos_score + ob_score + sweep_score)
        return C1Score(total=round(total, 1), bos_choch_score=round(bos_score, 1),
                       ob_score=round(ob_score, 1), sweep_zone_score=round(sweep_score, 1),
                       details=details)

    # ── C2: Confirmation scoring ──

    def _score_c2(self, df, direction, target_ob, price, confirms, warns) -> C2Score:
        retest_score = 0
        rejection_score = 0
        close_score = 0
        details = {}

        # OB Retest (0-10): price is in or near the OB zone
        if target_ob:
            if target_ob.low <= price <= target_ob.high:
                retest_score = 10
                confirms.append('C2: Price inside OB zone')
                details['retest'] = 'inside_ob'
            else:
                # Near the zone (within 0.5%)
                ob_mid = (target_ob.high + target_ob.low) / 2
                dist_pct = abs(price - ob_mid) / ob_mid * 100
                if dist_pct < 0.5:
                    retest_score = 7
                    confirms.append(f'C2: Price near OB zone ({dist_pct:.2f}%)')
                    details['retest'] = f'near_ob_{dist_pct:.2f}pct'
                elif dist_pct < 1.5:
                    retest_score = 3
                    details['retest'] = 'approaching_ob'
                else:
                    warns.append('C2: Price not at OB zone')
                    details['retest'] = 'away_from_ob'
        else:
            warns.append('C2: No target OB for retest check')
            details['retest'] = 'no_ob'

        # Rejection candle (0-8): look at last 2 candles for rejection pattern
        if len(df) >= 2:
            last = df.iloc[-1]
            prev = df.iloc[-2]
            candle_range = last['high'] - last['low']
            body = abs(last['close'] - last['open'])

            if candle_range > 0:
                body_ratio = body / candle_range
                upper_wick = (last['high'] - max(last['open'], last['close'])) / candle_range
                lower_wick = (min(last['open'], last['close']) - last['low']) / candle_range

                if direction == 'LONG':
                    # Long rejection: long lower wick (buyers defended)
                    if lower_wick > 0.4 and last['close'] > last['open']:
                        rejection_score = min(8, lower_wick * 12)
                        confirms.append(f'C2: Bullish rejection candle (wick={lower_wick:.2f})')
                        details['rejection'] = 'bullish_pin'
                    elif last['close'] > last['open'] and body_ratio > 0.6:
                        rejection_score = 4
                        confirms.append('C2: Bullish engulfing / strong close')
                        details['rejection'] = 'bullish_body'
                    else:
                        rejection_score = 1
                        details['rejection'] = 'weak'

                elif direction == 'SHORT':
                    # Short rejection: long upper wick (sellers defended)
                    if upper_wick > 0.4 and last['close'] < last['open']:
                        rejection_score = min(8, upper_wick * 12)
                        confirms.append(f'C2: Bearish rejection candle (wick={upper_wick:.2f})')
                        details['rejection'] = 'bearish_pin'
                    elif last['close'] < last['open'] and body_ratio > 0.6:
                        rejection_score = 4
                        confirms.append('C2: Bearish engulfing / strong close')
                        details['rejection'] = 'bearish_body'
                    else:
                        rejection_score = 1
                        details['rejection'] = 'weak'

        # Close confirms direction (0-7)
        if len(df) >= 1:
            last_close = df['close'].iloc[-1]
            last_open = df['open'].iloc[-1]

            if direction == 'LONG' and last_close > last_open:
                close_score = 7
                confirms.append('C2: Close confirms bullish')
                details['close'] = 'bullish_close'
            elif direction == 'SHORT' and last_close < last_open:
                close_score = 7
                confirms.append('C2: Close confirms bearish')
                details['close'] = 'bearish_close'
            else:
                close_score = 2
                warns.append('C2: Close does not confirm direction')
                details['close'] = 'neutral'

        total = min(25, retest_score + rejection_score + close_score)
        return C2Score(total=round(total, 1), retest_score=round(retest_score, 1),
                       rejection_score=round(rejection_score, 1),
                       close_confirms_score=round(close_score, 1), details=details)

    # ── C3: Commitment (Order Flow) scoring ──

    def _score_c3(self, df, direction, swing_dicts, confirms, warns) -> C3Score:
        delta_sc = 0
        cvd_sc = 0
        vol_sc = 0
        imb_sc = 0
        abs_sc = 0
        details = {}

        dir_arg = 'long' if direction == 'LONG' else 'short'
        of_result = self.of_scorer.score(df, direction=dir_arg, swings=swing_dicts, lookback=20)

        # Delta direction (0-6)
        if of_result.delta_score >= 70:
            delta_sc = 6
            confirms.append(f'C3: Strong delta alignment ({of_result.delta_score:.0f})')
        elif of_result.delta_score >= 55:
            delta_sc = 4
            confirms.append(f'C3: Moderate delta ({of_result.delta_score:.0f})')
        elif of_result.delta_score >= 40:
            delta_sc = 2
        else:
            delta_sc = 0
            warns.append(f'C3: Delta against direction ({of_result.delta_score:.0f})')
        details['delta'] = of_result.delta_score

        # CVD trend (0-5) — use direction bias
        if of_result.direction_bias == dir_arg.replace('long', 'bullish').replace('short', 'bearish'):
            cvd_sc = 5
            confirms.append(f'C3: CVD bias = {of_result.direction_bias}')
        elif of_result.direction_bias == 'neutral':
            cvd_sc = 2
        else:
            cvd_sc = 0
            warns.append(f'C3: CVD bias against ({of_result.direction_bias})')
        details['cvd_bias'] = of_result.direction_bias

        # Volume spike (0-5)
        if of_result.volume_spike_score >= 70:
            vol_sc = 5
            confirms.append(f'C3: Volume expansion ({of_result.volume_spike_score:.0f})')
        elif of_result.volume_spike_score >= 50:
            vol_sc = 3
        else:
            vol_sc = 1
            warns.append('C3: Low volume')
        details['volume'] = of_result.volume_spike_score

        # Imbalance (0-5)
        if of_result.imbalance_score >= 65:
            imb_sc = 5
            confirms.append(f'C3: Imbalance confirms ({of_result.imbalance_score:.0f})')
        elif of_result.imbalance_score >= 50:
            imb_sc = 3
        else:
            imb_sc = 1
        details['imbalance'] = of_result.imbalance_score

        # Absorption / trapped (0-4)
        combined_abs = (of_result.absorption_score * 0.6 + of_result.sweep_trapped_score * 0.4)
        if combined_abs >= 65:
            abs_sc = 4
            confirms.append(f'C3: Absorption/trapped confirms ({combined_abs:.0f})')
        elif combined_abs >= 50:
            abs_sc = 2
        else:
            abs_sc = 1
        details['absorption_trapped'] = round(combined_abs, 1)
        details['of_confirmations'] = of_result.confirmations
        details['of_warnings'] = of_result.warnings

        total = min(25, delta_sc + cvd_sc + vol_sc + imb_sc + abs_sc)
        return C3Score(total=round(total, 1), delta_score=round(delta_sc, 1),
                       cvd_score=round(cvd_sc, 1), volume_score=round(vol_sc, 1),
                       imbalance_score=round(imb_sc, 1), absorption_score=round(abs_sc, 1),
                       details=details)

    # ── C4: Control (Risk) scoring ──

    def _score_c4(self, direction, entry, sl, tp, rr, target_ob,
                  max_pos, current_pos, paper_mode, confirms, warns) -> C4ControlScore:
        rr_score = 0
        sl_score = 0
        gate_score = 0
        details = {}

        # Risk/Reward (0-10)
        if rr >= 3.0:
            rr_score = 10
            confirms.append(f'C4: Excellent RR ({rr:.1f}:1)')
        elif rr >= 2.0:
            rr_score = 8
            confirms.append(f'C4: Good RR ({rr:.1f}:1)')
        elif rr >= 1.5:
            rr_score = 5
            confirms.append(f'C4: Acceptable RR ({rr:.1f}:1)')
        elif rr >= 1.0:
            rr_score = 2
            warns.append(f'C4: Low RR ({rr:.1f}:1)')
        else:
            rr_score = 0
            warns.append(f'C4: FAIL — RR below 1:1 ({rr:.1f}:1)')
        details['rr'] = rr

        # SL placement quality (0-8)
        if target_ob:
            if direction == 'LONG':
                sl_beyond_ob = sl < target_ob.low
                sl_dist_pct = (entry - sl) / entry * 100 if entry > 0 else 0
            else:
                sl_beyond_ob = sl > target_ob.high
                sl_dist_pct = (sl - entry) / entry * 100 if entry > 0 else 0

            if sl_beyond_ob and 0.5 < sl_dist_pct < 5.0:
                sl_score = 8
                confirms.append(f'C4: SL beyond OB ({sl_dist_pct:.1f}%)')
            elif sl_beyond_ob:
                sl_score = 5
                confirms.append(f'C4: SL beyond OB (wide: {sl_dist_pct:.1f}%)')
            else:
                sl_score = 3
                warns.append('C4: SL not beyond OB boundary')
        else:
            # No OB — just check SL distance is reasonable
            sl_dist = abs(entry - sl) / entry * 100 if entry > 0 else 0
            if 0.3 < sl_dist < 5.0:
                sl_score = 5
            elif sl_dist > 0:
                sl_score = 2
            else:
                sl_score = 0
                warns.append('C4: No stop loss')
        details['sl_placement'] = sl_score

        # Risk gate (0-7)
        if not paper_mode:
            gate_score = 0
            warns.append('C4: FAIL — not in paper mode')
        elif current_pos >= max_pos:
            gate_score = 0
            warns.append(f'C4: FAIL — max positions ({max_pos}) reached')
        else:
            gate_score = 7
            confirms.append('C4: Risk gate PASS (paper mode)')
        details['risk_gate'] = 'pass' if gate_score > 0 else 'fail'

        total = min(25, rr_score + sl_score + gate_score)
        return C4ControlScore(total=round(total, 1), rr_score=round(rr_score, 1),
                              sl_quality_score=round(sl_score, 1),
                              risk_gate_score=round(gate_score, 1), details=details)

    # ── Helpers ──

    def _find_best_ob(self, order_blocks, direction, price) -> Optional[OrderBlock]:
        """Find the best OB matching direction and near current price."""
        matching = []
        for ob in order_blocks:
            if direction == 'LONG' and ob.ob_type == 'bullish':
                if ob.low <= price * 1.02:  # within 2% above OB
                    matching.append(ob)
            elif direction == 'SHORT' and ob.ob_type == 'bearish':
                if ob.high >= price * 0.98:  # within 2% below OB
                    matching.append(ob)

        if not matching:
            return None
        return max(matching, key=lambda o: o.strength)

    def _calculate_levels(self, df, direction, target_ob, swings, price):
        """Calculate entry, SL, TP levels."""
        entry = price

        if direction == 'LONG':
            if target_ob:
                sl = target_ob.low * 0.995  # SL below OB with 0.5% buffer
            else:
                # Use recent swing low
                recent_lows = [s for s in swings if s.type == 'low' and s.price < price]
                sl = recent_lows[-1].price * 0.995 if recent_lows else price * 0.98

            risk = entry - sl
            # Target: 2R or next swing high
            recent_highs = [s for s in swings if s.type == 'high' and s.price > price]
            if recent_highs:
                structure_target = recent_highs[0].price
                tp = max(entry + risk * 2, structure_target)
            else:
                tp = entry + risk * 2

        else:  # SHORT
            if target_ob:
                sl = target_ob.high * 1.005  # SL above OB with 0.5% buffer
            else:
                recent_highs = [s for s in swings if s.type == 'high' and s.price > price]
                sl = recent_highs[-1].price * 1.005 if recent_highs else price * 1.02

            risk = sl - entry
            recent_lows = [s for s in swings if s.type == 'low' and s.price < price]
            if recent_lows:
                structure_target = recent_lows[-1].price
                tp = min(entry - risk * 2, structure_target)
            else:
                tp = entry - risk * 2

        return entry, sl, tp

    def _calculate_rr(self, direction, entry, sl, tp) -> float:
        """Calculate risk/reward ratio."""
        if direction == 'LONG':
            risk = entry - sl
            reward = tp - entry
        else:
            risk = sl - entry
            reward = entry - tp

        if risk <= 0:
            return 0
        return reward / risk


# ============================================================================
# C4 BACKTESTER
# ============================================================================

class C4Backtester:
    """Backtest C4 strategy on historical OHLCV data."""

    def __init__(self):
        self.scorer = C4Scorer()

    def run(
        self,
        df: pd.DataFrame,
        symbol: str,
        timeframe: str,
        min_score: float = 80,
        max_concurrent: int = 1
    ) -> Dict[str, Any]:
        """
        Run C4 backtest.

        Returns dict with trades, metrics, and per-trade C4 breakdown.
        """
        trades = []
        active_position = None
        bars_in_trade = 0

        # Slide window forward
        window = 50
        for i in range(window, len(df)):
            chunk = df.iloc[max(0, i - 100):i + 1].copy()

            if active_position:
                bars_in_trade += 1
                current_price = float(chunk['close'].iloc[-1])
                pos = active_position

                # Check SL
                hit_sl = (pos['direction'] == 'LONG' and current_price <= pos['stop_loss']) or \
                         (pos['direction'] == 'SHORT' and current_price >= pos['stop_loss'])
                # Check TP
                hit_tp = (pos['direction'] == 'LONG' and current_price >= pos['take_profit']) or \
                         (pos['direction'] == 'SHORT' and current_price <= pos['take_profit'])
                # Time exit
                time_exit = bars_in_trade >= 30

                if hit_tp:
                    pnl = abs(pos['take_profit'] - pos['entry_price'])
                    if pos['direction'] == 'SHORT':
                        pnl = abs(pos['entry_price'] - pos['take_profit'])
                    pos['exit_price'] = pos['take_profit']
                    pos['exit_reason'] = 'TP'
                    pos['pnl'] = pnl
                    pos['pnl_pct'] = pnl / pos['entry_price'] * 100
                    pos['bars_held'] = bars_in_trade
                    pos['exit_index'] = i
                    trades.append(pos)
                    active_position = None
                    bars_in_trade = 0
                elif hit_sl:
                    risk = abs(pos['entry_price'] - pos['stop_loss'])
                    pos['exit_price'] = pos['stop_loss']
                    pos['exit_reason'] = 'SL'
                    pos['pnl'] = -risk
                    pos['pnl_pct'] = -risk / pos['entry_price'] * 100
                    pos['bars_held'] = bars_in_trade
                    pos['exit_index'] = i
                    trades.append(pos)
                    active_position = None
                    bars_in_trade = 0
                elif time_exit:
                    if pos['direction'] == 'LONG':
                        pnl = current_price - pos['entry_price']
                    else:
                        pnl = pos['entry_price'] - current_price
                    pos['exit_price'] = current_price
                    pos['exit_reason'] = 'TIME'
                    pos['pnl'] = pnl
                    pos['pnl_pct'] = pnl / pos['entry_price'] * 100
                    pos['bars_held'] = bars_in_trade
                    pos['exit_index'] = i
                    trades.append(pos)
                    active_position = None
                    bars_in_trade = 0
                continue

            # No active position — evaluate C4 for both directions
            for direction in ['LONG', 'SHORT']:
                result = self.scorer.evaluate(
                    chunk, symbol, timeframe, direction,
                    max_positions=1, current_positions=0, paper_mode=True
                )
                if result and result.total_score >= min_score:
                    active_position = {
                        'direction': direction,
                        'entry_price': result.entry_price,
                        'stop_loss': result.stop_loss,
                        'take_profit': result.take_profit,
                        'c4_score': result.total_score,
                        'c1': result.c1.total,
                        'c2': result.c2.total,
                        'c3': result.c3.total,
                        'c4_control': result.c4.total,
                        'risk_reward': result.risk_reward,
                        'decision': result.decision.value,
                        'entry_index': i,
                        'confirmations': result.confirmations,
                        'warnings': result.warnings,
                    }
                    bars_in_trade = 0
                    break  # Take first valid signal

        # Calculate metrics
        metrics = self._calculate_metrics(trades)

        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'total_candles': len(df),
            'trades': trades,
            'metrics': metrics,
            'data_type': 'OHLCV_PROXY'
        }

    def _calculate_metrics(self, trades: List[Dict]) -> Dict[str, Any]:
        """Calculate backtest performance metrics."""
        if not trades:
            return {
                'total_trades': 0, 'wins': 0, 'losses': 0,
                'win_rate': 0, 'profit_factor': 0,
                'avg_rr': 0, 'max_drawdown_pct': 0,
                'avg_c4_score': 0, 'total_pnl_pct': 0,
                'long_trades': 0, 'short_trades': 0,
                'long_win_rate': 0, 'short_win_rate': 0
            }

        wins = [t for t in trades if t['pnl'] > 0]
        losses = [t for t in trades if t['pnl'] <= 0]
        longs = [t for t in trades if t['direction'] == 'LONG']
        shorts = [t for t in trades if t['direction'] == 'SHORT']
        long_wins = [t for t in longs if t['pnl'] > 0]
        short_wins = [t for t in shorts if t['pnl'] > 0]

        gross_profit = sum(t['pnl'] for t in wins) if wins else 0
        gross_loss = abs(sum(t['pnl'] for t in losses)) if losses else 0.001

        # Drawdown
        equity_curve = []
        running = 0
        for t in trades:
            running += t['pnl_pct']
            equity_curve.append(running)
        peak = 0
        max_dd = 0
        for eq in equity_curve:
            if eq > peak:
                peak = eq
            dd = peak - eq
            if dd > max_dd:
                max_dd = dd

        return {
            'total_trades': len(trades),
            'wins': len(wins),
            'losses': len(losses),
            'win_rate': round(len(wins) / len(trades) * 100, 1) if trades else 0,
            'profit_factor': round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0,
            'avg_rr': round(np.mean([t['risk_reward'] for t in trades]), 2) if trades else 0,
            'max_drawdown_pct': round(max_dd, 2),
            'avg_c4_score': round(np.mean([t['c4_score'] for t in trades]), 1) if trades else 0,
            'total_pnl_pct': round(sum(t['pnl_pct'] for t in trades), 2),
            'long_trades': len(longs),
            'short_trades': len(shorts),
            'long_win_rate': round(len(long_wins) / len(longs) * 100, 1) if longs else 0,
            'short_win_rate': round(len(short_wins) / len(shorts) * 100, 1) if shorts else 0,
            'avg_bars_held': round(np.mean([t['bars_held'] for t in trades]), 1) if trades else 0,
            'tp_exits': len([t for t in trades if t['exit_reason'] == 'TP']),
            'sl_exits': len([t for t in trades if t['exit_reason'] == 'SL']),
            'time_exits': len([t for t in trades if t['exit_reason'] == 'TIME']),
        }


# ============================================================================
# C4 SCAN LOGGER
# ============================================================================

def log_c4_scan(result: C4Result):
    """Log C4 scan in structured format."""
    logger.info(
        f"\n{'='*60}\n"
        f"C4 SCAN: {result.symbol} {result.timeframe} {result.direction}\n"
        f"{'='*60}\n"
        f"C1 Context:      {result.c1.total:5.1f}/25  "
        f"(BOS={result.c1.bos_choch_score:.1f} OB={result.c1.ob_score:.1f} "
        f"Sweep={result.c1.sweep_zone_score:.1f})\n"
        f"C2 Confirmation: {result.c2.total:5.1f}/25  "
        f"(Retest={result.c2.retest_score:.1f} Reject={result.c2.rejection_score:.1f} "
        f"Close={result.c2.close_confirms_score:.1f})\n"
        f"C3 Commitment:   {result.c3.total:5.1f}/25  "
        f"(Delta={result.c3.delta_score:.1f} CVD={result.c3.cvd_score:.1f} "
        f"Vol={result.c3.volume_score:.1f} Imb={result.c3.imbalance_score:.1f} "
        f"Abs={result.c3.absorption_score:.1f})\n"
        f"C4 Control:      {result.c4.total:5.1f}/25  "
        f"(RR={result.c4.rr_score:.1f} SL={result.c4.sl_quality_score:.1f} "
        f"Gate={result.c4.risk_gate_score:.1f})\n"
        f"{'─'*60}\n"
        f"Total C4 Score:  {result.total_score:5.1f}/100\n"
        f"Decision:        {result.decision.value}\n"
        f"Entry: {result.entry_price}  SL: {result.stop_loss}  "
        f"TP: {result.take_profit}  RR: {result.risk_reward}:1\n"
        f"Confirmations: {result.confirmations}\n"
        f"Warnings:      {result.warnings}\n"
        f"{'='*60}"
    )


# ============================================================================
# MAIN (test)
# ============================================================================

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Quick test with synthetic data
    np.random.seed(42)
    n = 100
    dates = pd.date_range('2024-01-01', periods=n, freq='4h')
    base = 50000
    prices = base + np.cumsum(np.random.randn(n) * 100)

    df = pd.DataFrame({
        'open': prices,
        'high': prices + np.random.rand(n) * 200,
        'low': prices - np.random.rand(n) * 200,
        'close': prices + np.random.randn(n) * 50,
        'volume': np.random.randint(100, 5000, n).astype(float)
    }, index=dates)

    scorer = C4Scorer()

    # Evaluate both directions
    for d in ['LONG', 'SHORT']:
        result = scorer.evaluate(df, 'BTC/USD', '4h', d)
        if result:
            log_c4_scan(result)

    # Quick backtest
    bt = C4Backtester()
    bt_result = bt.run(df, 'BTC/USD', '4h', min_score=65)
    print(f"\nBacktest: {bt_result['metrics']['total_trades']} trades, "
          f"WR={bt_result['metrics']['win_rate']}%, "
          f"PF={bt_result['metrics']['profit_factor']}")
