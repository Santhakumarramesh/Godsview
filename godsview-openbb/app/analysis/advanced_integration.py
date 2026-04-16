"""
GodsView — Advanced Integration Layer

Unified pre-trade check that combines all advanced systems:
  - Strategy DNA fitness
  - Session intelligence
  - Confidence calibration
  - Regime detection
  - Data truth validation

Returns a single go/no-go decision with reasoning.
"""
from __future__ import annotations

import time
import logging
from dataclasses import dataclass, field
from typing import Optional

from .strategy_dna import StrategyDNAEngine, classify_volatility, classify_session as classify_vol_session
from .session_intelligence import (
    SessionIntelligenceEngine,
    SessionAnalysis,
    classify_session,
)
from .confidence_calibrator import ConfidenceCalibrator
from .regime_detector import Regime, RegimeAnalysis

logger = logging.getLogger("godsview.advanced_integration")


# ── Data Models ──────────────────────────────────────────────────────────────

@dataclass
class PreTradeCheck:
    """Result of the unified pre-trade analysis."""
    timestamp: float = field(default_factory=time.time)
    symbol: str = ""
    strategy_id: str = ""

    # Overall decision
    approved: bool = False
    decision: str = "REJECT"  # "APPROVE", "REDUCE_SIZE", "REJECT"
    confidence: float = 0.0
    reasons: list[str] = field(default_factory=list)

    # Component scores
    dna_score: float = 0.0
    dna_confidence: float = 0.0
    session_score: float = 0.0
    calibrated_confidence: float = 0.0
    regime_alignment: float = 0.0
    data_health_ok: bool = True

    # Adjustments
    size_multiplier: float = 1.0  # 0.0 = no trade, 0.5 = half, 1.0 = full
    warnings: list[str] = field(default_factory=list)


# ── Thresholds ───────────────────────────────────────────────────────────────

MIN_DNA_SCORE = 25.0          # minimum strategy fitness to allow trade
MIN_CALIBRATED_CONFIDENCE = 0.4
SESSION_REVERSAL_PENALTY = 0.3
EXHAUSTION_PENALTY = 0.2
LOW_DATA_CONFIDENCE_THRESHOLD = 0.3


# ── Integration Engine ───────────────────────────────────────────────────────

class AdvancedIntegration:
    """
    Combines all advanced analysis systems into a unified
    pre-trade decision engine.
    """

    def __init__(
        self,
        dna_engine: Optional[StrategyDNAEngine] = None,
        session_engine: Optional[SessionIntelligenceEngine] = None,
        calibrator: Optional[ConfidenceCalibrator] = None,
    ) -> None:
        self._dna = dna_engine or StrategyDNAEngine()
        self._session = session_engine or SessionIntelligenceEngine()
        self._calibrator = calibrator or ConfidenceCalibrator()

    def pre_trade_check(
        self,
        symbol: str,
        strategy_id: str,
        raw_confidence: float,
        regime: str = "unknown",
        hour_utc: int = 12,
        day_of_week: str = "unknown",
        atr: float = 0.0,
        avg_atr: float = 0.0,
        session_analysis: Optional[SessionAnalysis] = None,
        data_sources_healthy: bool = True,
    ) -> PreTradeCheck:
        """
        Run all advanced checks and return a unified go/no-go decision.
        """
        check = PreTradeCheck(
            symbol=symbol,
            strategy_id=strategy_id,
        )

        reasons: list[str] = []
        warnings: list[str] = []
        multiplier = 1.0

        # ── 1. Data Truth ────────────────────────────────────────────────
        check.data_health_ok = data_sources_healthy
        if not data_sources_healthy:
            check.approved = False
            check.decision = "REJECT"
            check.reasons = ["Data sources unhealthy — trading disabled"]
            check.size_multiplier = 0.0
            logger.warning("pre_trade_reject symbol=%s reason=data_health", symbol)
            return check

        # ── 2. Confidence Calibration ────────────────────────────────────
        calibrated = self._calibrator.calibrate(
            raw_confidence=raw_confidence,
            strategy=strategy_id,
            regime=regime,
        )
        check.calibrated_confidence = calibrated

        if calibrated < MIN_CALIBRATED_CONFIDENCE:
            reasons.append(
                f"Calibrated confidence too low ({calibrated:.0%} < {MIN_CALIBRATED_CONFIDENCE:.0%})"
            )
            multiplier *= 0.0
        elif calibrated < 0.6:
            warnings.append(f"Moderate confidence ({calibrated:.0%})")
            multiplier *= 0.7

        # ── 3. Strategy DNA Fitness ──────────────────────────────────────
        session_str = classify_vol_session(hour_utc)
        vol_str = classify_volatility(atr, avg_atr) if avg_atr > 0 else "medium"

        fitness = self._dna.get_fitness(
            strategy_id=strategy_id,
            regime=regime,
            session=session_str,
            day_of_week=day_of_week,
            volatility=vol_str,
        )
        check.dna_score = fitness["composite_score"]
        check.dna_confidence = fitness["confidence"]

        if fitness["confidence"] > LOW_DATA_CONFIDENCE_THRESHOLD:
            # Only penalize if we have enough data to trust the score
            if fitness["composite_score"] < MIN_DNA_SCORE:
                reasons.append(
                    f"Strategy DNA score too low ({fitness['composite_score']:.0f} < {MIN_DNA_SCORE:.0f}) "
                    f"in regime={regime}, session={session_str}, vol={vol_str}"
                )
                multiplier *= 0.0
            elif fitness["composite_score"] < 40:
                warnings.append(f"Marginal DNA fitness ({fitness['composite_score']:.0f})")
                multiplier *= 0.6
        else:
            warnings.append("Insufficient DNA data — using default sizing")

        # ── 4. Session Intelligence ──────────────────────────────────────
        if session_analysis:
            # Reversal zone penalty
            if session_analysis.reversal_zone:
                warnings.append(
                    f"Session reversal zone: {session_analysis.reversal_reason}"
                )
                multiplier *= (1.0 - SESSION_REVERSAL_PENALTY)

            # Range exhaustion penalty
            if session_analysis.range_exhaustion_pct > 1.5:
                warnings.append(
                    f"Extreme range exhaustion ({session_analysis.range_exhaustion_pct:.0%})"
                )
                multiplier *= (1.0 - EXHAUSTION_PENALTY)

            # Session bias alignment
            if session_analysis.session_bias == "bullish":
                check.session_score = 0.7
            elif session_analysis.session_bias == "bearish":
                check.session_score = 0.3
            else:
                check.session_score = 0.5
        else:
            check.session_score = 0.5

        # ── 5. Regime Alignment ──────────────────────────────────────────
        # Penalize trading in CHAOTIC regime
        if regime.upper() == "CHAOTIC":
            warnings.append("Chaotic regime detected — reducing exposure")
            multiplier *= 0.5
            check.regime_alignment = 0.3
        elif regime.upper() in ("TREND_UP", "TREND_DOWN"):
            check.regime_alignment = 0.9
        elif regime.upper() == "RANGE":
            check.regime_alignment = 0.6
        else:
            check.regime_alignment = 0.5

        # ── Final Decision ───────────────────────────────────────────────
        check.size_multiplier = round(max(0.0, min(1.0, multiplier)), 4)
        check.reasons = reasons
        check.warnings = warnings
        check.confidence = calibrated

        if multiplier <= 0.0 or reasons:
            check.approved = False
            check.decision = "REJECT"
        elif multiplier < 0.7:
            check.approved = True
            check.decision = "REDUCE_SIZE"
        else:
            check.approved = True
            check.decision = "APPROVE"

        logger.info(
            "pre_trade_check symbol=%s strategy=%s decision=%s mult=%.2f conf=%.2f dna=%.0f",
            symbol, strategy_id, check.decision,
            check.size_multiplier, calibrated, check.dna_score,
        )
        return check

    def record_trade_outcome(
        self,
        strategy_id: str,
        raw_confidence: float,
        pnl: float,
        rr: float = 0.0,
        regime: str = "unknown",
        session: str = "unknown",
        day_of_week: str = "unknown",
        volatility: str = "medium",
        instrument: str = "unknown",
    ) -> None:
        """
        Record a completed trade outcome into all subsystems
        for continuous learning.
        """
        outcome = pnl > 0

        # Update DNA
        self._dna.record_trade(
            strategy_id=strategy_id,
            pnl=pnl,
            rr=rr,
            regime=regime,
            session=session,
            day_of_week=day_of_week,
            volatility=volatility,
            instrument=instrument,
        )

        # Update calibration
        self._calibrator.record_outcome(
            raw_confidence=raw_confidence,
            outcome=outcome,
            strategy=strategy_id,
            regime=regime,
        )

        logger.info(
            "trade_outcome_recorded strategy=%s pnl=%.4f outcome=%s",
            strategy_id, pnl, outcome,
        )
