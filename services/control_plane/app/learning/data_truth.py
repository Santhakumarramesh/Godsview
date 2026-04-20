"""Data truth + kill-switch aggregator.

The DataTruthCheck table carries one row per health probe:

  * ``bar_latency``     — ms between TV bar close and ingest.
  * ``bar_gap``         — seconds of missing bars in the stream.
  * ``book_staleness``  — ms since last orderbook update.
  * ``feed_desync``     — |market-time - broker-time| in ms.
  * ``symbol_missing``  — count of expected symbols with no recent bar.
  * ``broker_heartbeat``— ms since last broker heartbeat.

Each check has its own ``amber_threshold`` and ``red_threshold``. This
module provides the pure policy:

  * :func:`classify_data_truth_status` — turn one ``(measurement,
    amber, red)`` triple into ``green`` / ``amber`` / ``red``.
  * :func:`aggregate_data_truth` — roll a list of checks up into the
    worst-of status.
  * :func:`evaluate_kill_switch` — decide if the live-gate kill-switch
    must be tripped (any ``red`` trips it; also any sustained ``amber``
    when the ``strict`` flag is on).

The module is pure — no DB, no IO. The repo serialises the result.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, Sequence

__all__ = [
    "DATA_TRUTH_STATUSES",
    "DataTruthCheckInput",
    "DataTruthStatusLiteral",
    "aggregate_data_truth",
    "classify_data_truth_status",
    "evaluate_kill_switch",
]


DataTruthStatusLiteral = Literal["green", "amber", "red"]

DATA_TRUTH_STATUSES: tuple[DataTruthStatusLiteral, ...] = (
    "green",
    "amber",
    "red",
)

# Worst-of-ordering used by the aggregator.
_STATUS_RANK: dict[DataTruthStatusLiteral, int] = {
    "green": 0,
    "amber": 1,
    "red": 2,
}


@dataclass(frozen=True, slots=True)
class DataTruthCheckInput:
    """Input tuple for a single check being aggregated.

    ``kind`` is free-form here; the route layer + ORM table enforce the
    allow-list. The dataclass carries only what the status classifier
    needs.
    """

    kind: str
    measurement: float
    amber_threshold: float
    red_threshold: float


def classify_data_truth_status(
    measurement: float,
    amber_threshold: float,
    red_threshold: float,
) -> DataTruthStatusLiteral:
    """Classify a single measurement against its thresholds.

    Convention: *higher measurement = worse*. ``amber`` trips at
    ``measurement >= amber_threshold``, ``red`` trips at
    ``measurement >= red_threshold``.

    The thresholds must satisfy ``amber_threshold <= red_threshold``.
    If they cross, the classifier degrades to the single ``red``
    threshold (defence in depth).
    """

    if red_threshold < amber_threshold:
        # Degrade gracefully — caller likely swapped the args.
        red_threshold = amber_threshold

    if measurement >= red_threshold:
        return "red"
    if measurement >= amber_threshold:
        return "amber"
    return "green"


def aggregate_data_truth(
    checks: Iterable[DataTruthCheckInput],
) -> tuple[DataTruthStatusLiteral, list[tuple[DataTruthCheckInput, DataTruthStatusLiteral]]]:
    """Roll a list of checks up into a worst-of status + per-check verdicts.

    Returns ``(overall_status, [(check, status), ...])``. If no checks
    are supplied the overall status is ``green`` — the monitor has no
    evidence of failure.
    """

    verdicts: list[tuple[DataTruthCheckInput, DataTruthStatusLiteral]] = []
    overall_rank = _STATUS_RANK["green"]
    overall: DataTruthStatusLiteral = "green"
    for check in checks:
        status = classify_data_truth_status(
            check.measurement, check.amber_threshold, check.red_threshold
        )
        verdicts.append((check, status))
        r = _STATUS_RANK[status]
        if r > overall_rank:
            overall_rank = r
            overall = status
    return overall, verdicts


def evaluate_kill_switch(
    verdicts: Sequence[tuple[DataTruthCheckInput, DataTruthStatusLiteral]],
    *,
    strict: bool = False,
) -> tuple[bool, str | None]:
    """Decide whether the live-gate kill-switch must be tripped.

    Rules:
      * any ``red`` verdict → trip, reason names the first red check.
      * any two+ ``amber`` verdicts when ``strict=True`` → trip, reason
        summarises the amber cluster.
      * otherwise → no trip.

    Returns ``(tripped, reason)``. ``reason`` is ``None`` when not
    tripped; a short human-readable narrative otherwise.
    """

    reds = [c for c, s in verdicts if s == "red"]
    if reds:
        first = reds[0]
        return True, (
            f"data-truth red — check {first.kind!r} at "
            f"measurement={first.measurement:g} "
            f"(red threshold={first.red_threshold:g})"
        )

    if strict:
        ambers = [c for c, s in verdicts if s == "amber"]
        if len(ambers) >= 2:
            names = ", ".join(c.kind for c in ambers)
            return True, f"strict-mode trip — {len(ambers)} amber checks: {names}"

    return False, None
