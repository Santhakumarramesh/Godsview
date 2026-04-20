"""Strategy DNA — (regime × session) grid builder.

A strategy's DNA is the 4 × 5 matrix of cells summarising where it
has won and lost. Each cell carries ``win_rate`` + ``mean_r`` +
``sample_size``. The grid lets operators see at a glance that
"strategy foo crushes in ranging/london but dies in volatile/ny_pm".

This module ships the *pure* builder — given a flat list of closed
trades (one per setup filled, with their ``regime`` + ``session``
labels + realised R), it emits a deterministic cell grid.

The repo layer persists cells to ``strategy_dna_cells`` with a
UniqueConstraint on ``(strategy_id, regime, session)`` — one row per
cell per strategy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from app.learning.regime import REGIME_KINDS, RegimeKindLiteral

__all__ = [
    "DNACellKey",
    "build_dna_grid",
    "select_best_cell",
    "select_worst_cell",
]


TradingSessionLiteral = str  # cross-package parity with TS literal.

SESSIONS: tuple[str, ...] = ("asia", "london", "ny_am", "ny_pm", "off_hours")


@dataclass(frozen=True, slots=True)
class DNACellKey:
    """Grid coordinate + aggregate values."""

    regime: RegimeKindLiteral
    session: str
    win_rate: float | None
    mean_r: float | None
    sample_size: int


@dataclass(frozen=True, slots=True)
class _Trade:
    regime: RegimeKindLiteral
    session: str
    win: bool
    r: float


def _coerce_trade(raw: object) -> _Trade | None:
    """Best-effort coercion — tolerates dicts + objects.

    The caller in :func:`build_dna_grid` is responsible for filtering
    rows that don't have a decided outcome (scratch / open) before
    passing them in — the builder treats anything received as a real
    sample.
    """

    if isinstance(raw, _Trade):
        return raw
    regime = _get(raw, "regime")
    session = _get(raw, "session")
    win = _get(raw, "win")
    r = _get(raw, "r")
    if regime not in REGIME_KINDS or session not in SESSIONS:
        return None
    if win is None or r is None:
        return None
    return _Trade(
        regime=regime,  # type: ignore[arg-type]
        session=str(session),
        win=bool(win),
        r=float(r),
    )


def _get(obj: object, name: str) -> object:
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def build_dna_grid(
    trades: Iterable[object],
) -> list[DNACellKey]:
    """Build a full (regime × session) grid from a list of closed trades.

    Shape:
      * Grid size is ``len(REGIME_KINDS) * len(SESSIONS) = 20`` cells.
      * Every cell is always present in the result; empty cells have
        ``sample_size=0`` and ``win_rate = mean_r = None``.
      * Ordering is deterministic: regime-major, session-minor, in
        declaration order of ``REGIME_KINDS`` and ``SESSIONS``.
    """

    buckets: dict[tuple[RegimeKindLiteral, str], list[_Trade]] = {}
    for raw in trades:
        t = _coerce_trade(raw)
        if t is None:
            continue
        key = (t.regime, t.session)
        buckets.setdefault(key, []).append(t)

    cells: list[DNACellKey] = []
    for regime in REGIME_KINDS:
        for session in SESSIONS:
            rows = buckets.get((regime, session), [])
            if not rows:
                cells.append(
                    DNACellKey(
                        regime=regime,
                        session=session,
                        win_rate=None,
                        mean_r=None,
                        sample_size=0,
                    )
                )
                continue
            wins = sum(1 for t in rows if t.win)
            total_r = sum(t.r for t in rows)
            cells.append(
                DNACellKey(
                    regime=regime,
                    session=session,
                    win_rate=round(wins / len(rows), 6),
                    mean_r=round(total_r / len(rows), 6),
                    sample_size=len(rows),
                )
            )
    return cells


def select_best_cell(cells: Iterable[DNACellKey]) -> DNACellKey | None:
    """Pick the best cell — highest ``mean_r`` with sample_size >= 3.

    Ties: the cell with more samples wins. Deeper tie: declaration order.
    Empty grid → ``None``.
    """

    best: DNACellKey | None = None
    best_key: tuple[float, int] = (-1e18, -1)
    for cell in cells:
        if cell.sample_size < 3 or cell.mean_r is None:
            continue
        key = (cell.mean_r, cell.sample_size)
        if key > best_key:
            best_key = key
            best = cell
    return best


def select_worst_cell(cells: Iterable[DNACellKey]) -> DNACellKey | None:
    """Pick the worst cell — lowest ``mean_r`` with sample_size >= 3."""

    worst: DNACellKey | None = None
    worst_key: tuple[float, int] = (1e18, -1)
    for cell in cells:
        if cell.sample_size < 3 or cell.mean_r is None:
            continue
        key = (cell.mean_r, -cell.sample_size)
        if key < worst_key:
            worst_key = key
            worst = cell
    return worst
