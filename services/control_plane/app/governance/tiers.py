"""Trust-tier ordering + guard helpers.

Keys the whole governance layer. The enum is ordered weakest → strongest,
and every guard uses ``rank(tier)`` for ≥ comparisons so a typo in a
string literal fails loud.
"""

from __future__ import annotations

from typing import Final, Tuple

# Ordered weakest → strongest. Keep in sync with
# packages/types/src/governance.ts ``TrustTierSchema``.
TRUST_TIERS: Final[Tuple[str, ...]] = (
    "readonly",
    "operator",
    "senior_operator",
    "admin",
    "owner",
)

_RANK = {tier: idx for idx, tier in enumerate(TRUST_TIERS)}


def is_valid_tier(tier: str) -> bool:
    return tier in _RANK


def rank(tier: str) -> int:
    """Numeric rank; higher = more privileged.

    Raises ``ValueError`` for unknown tiers so bugs in string literals
    fail fast rather than silently misordering.
    """
    try:
        return _RANK[tier]
    except KeyError as exc:
        raise ValueError(f"unknown trust tier: {tier!r}") from exc


def at_least(actor_tier: str, required_tier: str) -> bool:
    """Return True if ``actor_tier`` ≥ ``required_tier``."""
    return rank(actor_tier) >= rank(required_tier)


__all__ = ["TRUST_TIERS", "is_valid_tier", "rank", "at_least"]
