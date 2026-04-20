"""Deterministic PRNG wrapper used across the Quant Lab.

The lab's reproducibility contract says: given the same
(strategyVersion, symbols, window, frictionBps, latencyMs, seed) the
engine produces a bit-identical ledger + equity curve. We therefore
route *every* source of randomness (tie-break, noise injection,
imbalance-generated slippage, shuffle) through this wrapper so a single
``seed`` integer is the only entropy knob.

We wrap :class:`random.Random` instead of ``numpy.random`` so a stdlib-
only environment can run the engine in CI without extra deps.
"""

from __future__ import annotations

import random
from typing import Sequence, TypeVar

T = TypeVar("T")


class DeterministicRng:
    """Deterministic PRNG facade used by the quant-lab engine."""

    __slots__ = ("_rng", "seed")

    def __init__(self, seed: int = 0) -> None:
        self.seed: int = int(seed) & 0xFFFFFFFF
        self._rng: random.Random = random.Random(self.seed)

    # ── reset ────────────────────────────────────────────────────────
    def reset(self) -> None:
        """Rewind to the original seed. Useful for rerunning an engine."""
        self._rng = random.Random(self.seed)

    # ── primitives ───────────────────────────────────────────────────
    def uniform(self, low: float, high: float) -> float:
        """Return a float in [low, high] using the seeded PRNG."""
        if high < low:
            low, high = high, low
        return self._rng.uniform(low, high)

    def normal(self, mean: float = 0.0, stddev: float = 1.0) -> float:
        """Gaussian sample — used for synthetic slippage jitter."""
        return self._rng.gauss(mean, stddev)

    def choice(self, items: Sequence[T]) -> T:
        if not items:
            raise ValueError("DeterministicRng.choice on empty sequence")
        return self._rng.choice(list(items))

    def rand_int(self, low: int, high: int) -> int:
        """Inclusive integer in [low, high]."""
        return self._rng.randint(low, high)

    def shuffled(self, items: Sequence[T]) -> list[T]:
        """Return a shuffled copy — never mutates the input."""
        out = list(items)
        self._rng.shuffle(out)
        return out


__all__ = ["DeterministicRng"]
