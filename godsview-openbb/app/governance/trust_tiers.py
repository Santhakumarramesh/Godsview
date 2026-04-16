from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TrustTierLevel(Enum):
    """Trust tier enumeration with numeric ordering."""
    TIER_0_DISABLED = 0
    TIER_1_OBSERVER = 1
    TIER_2_SUPERVISED = 2
    TIER_3_ASSISTED = 3
    TIER_4_AUTONOMOUS = 4


@dataclass
class TrustTierConfig:
    """Configuration for a trust tier with operational limits and requirements."""

    tier: TrustTierLevel
    name: str
    description: str

    max_position_size_pct: float = 0.0
    """Maximum position size as % of account equity"""

    max_daily_trades: int = 0
    """Maximum number of trades allowed per day"""

    max_single_trade_usd: float = 0.0
    """Maximum dollar amount per single trade"""

    requires_human_approval: bool = True
    """Whether human approval required before trade execution"""

    allowed_strategies: list[str] = field(default_factory=lambda: [])
    """List of allowed strategy names ('all' for any strategy)"""

    min_consecutive_profitable_days: int = 0
    """Days of profitability required for tier promotion"""

    profit_factor_threshold: float = 1.0
    """Minimum profit factor required for this tier"""

    max_drawdown_threshold_pct: float = 100.0
    """Maximum drawdown % threshold for this tier"""

    @classmethod
    def tier_0_disabled(cls) -> TrustTierConfig:
        """Tier 0: No trading allowed. Manual re-enablement required."""
        return cls(
            tier=TrustTierLevel.TIER_0_DISABLED,
            name="DISABLED",
            description="Strategy cannot trade. Requires manual re-enablement.",
            max_position_size_pct=0.0,
            max_daily_trades=0,
            max_single_trade_usd=0.0,
            requires_human_approval=True,
            allowed_strategies=[],
        )

    @classmethod
    def tier_1_observer(cls) -> TrustTierConfig:
        """Tier 1: Can analyze but cannot submit orders. Learning mode."""
        return cls(
            tier=TrustTierLevel.TIER_1_OBSERVER,
            name="OBSERVER",
            description="Can analyze but cannot submit orders. Learning mode.",
            max_position_size_pct=0.0,
            max_daily_trades=0,
            max_single_trade_usd=0.0,
            requires_human_approval=True,
            allowed_strategies=["all"],
        )

    @classmethod
    def tier_2_supervised(cls) -> TrustTierConfig:
        """Tier 2: Can submit orders but requires human approval for every trade."""
        return cls(
            tier=TrustTierLevel.TIER_2_SUPERVISED,
            name="SUPERVISED",
            description="Can submit orders but requires human approval for every trade.",
            max_position_size_pct=0.5,
            max_daily_trades=5,
            max_single_trade_usd=1000.0,
            requires_human_approval=True,
            allowed_strategies=["all"],
            profit_factor_threshold=1.1,
            max_drawdown_threshold_pct=30.0,
        )

    @classmethod
    def tier_3_assisted(cls) -> TrustTierConfig:
        """Tier 3: Can auto-execute small trades. Large trades need approval."""
        return cls(
            tier=TrustTierLevel.TIER_3_ASSISTED,
            name="ASSISTED",
            description="Can auto-execute small trades (< threshold). Large trades need approval.",
            max_position_size_pct=1.0,
            max_daily_trades=10,
            max_single_trade_usd=5000.0,
            requires_human_approval=False,
            allowed_strategies=["all"],
            min_consecutive_profitable_days=3,
            profit_factor_threshold=1.3,
            max_drawdown_threshold_pct=20.0,
        )

    @classmethod
    def tier_4_autonomous(cls) -> TrustTierConfig:
        """Tier 4: Full auto-execution within risk limits. Highest trust."""
        return cls(
            tier=TrustTierLevel.TIER_4_AUTONOMOUS,
            name="AUTONOMOUS",
            description="Full auto-execution within risk limits. Highest trust.",
            max_position_size_pct=2.0,
            max_daily_trades=20,
            max_single_trade_usd=25000.0,
            requires_human_approval=False,
            allowed_strategies=["all"],
            min_consecutive_profitable_days=5,
            profit_factor_threshold=1.5,
            max_drawdown_threshold_pct=15.0,
        )


def get_tier_config(tier: TrustTierLevel) -> TrustTierConfig:
    """Retrieve configuration for a trust tier.

    Args:
        tier: The trust tier level

    Returns:
        Configuration object for the tier

    Raises:
        ValueError: If tier is not recognized
    """
    configs = {
        TrustTierLevel.TIER_0_DISABLED: TrustTierConfig.tier_0_disabled(),
        TrustTierLevel.TIER_1_OBSERVER: TrustTierConfig.tier_1_observer(),
        TrustTierLevel.TIER_2_SUPERVISED: TrustTierConfig.tier_2_supervised(),
        TrustTierLevel.TIER_3_ASSISTED: TrustTierConfig.tier_3_assisted(),
        TrustTierLevel.TIER_4_AUTONOMOUS: TrustTierConfig.tier_4_autonomous(),
    }
    if tier not in configs:
        raise ValueError(f"Unknown trust tier: {tier}")
    return configs[tier]


def get_all_tier_configs() -> list[TrustTierConfig]:
    """Get all trust tier configurations in order.

    Returns:
        List of TrustTierConfig objects from TIER_0 to TIER_4
    """
    return [
        TrustTierConfig.tier_0_disabled(),
        TrustTierConfig.tier_1_observer(),
        TrustTierConfig.tier_2_supervised(),
        TrustTierConfig.tier_3_assisted(),
        TrustTierConfig.tier_4_autonomous(),
    ]
