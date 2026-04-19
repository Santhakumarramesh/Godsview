"""Recall engine tests — store + calibrator.

Covers:

* :class:`InMemoryRecallStore` — add, search, filter, eviction,
  ``update_outcome``.
* :func:`feature_fingerprint` — stable order, normalisation safety.
* :func:`neighbour_win_rate` — weighted vote, scratch handling,
  similarity threshold.
* :func:`calibrate_confidence` — cold-start passthrough, win-heavy
  pull-up, loss-heavy pull-down, clamp boundaries.
* :func:`calibrate_with_store` — end-to-end fingerprint → search → blend.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.recall import (
    InMemoryRecallStore,
    RecallNeighbour,
    RecallRecord,
    calibrate_confidence,
    feature_fingerprint,
    get_recall_store,
    neighbour_win_rate,
    reset_recall_store,
)
from app.recall.calibrator import calibrate_with_store
from app.setups.types import SetupConfidenceComponents

_UTC = timezone.utc


def _components(
    *,
    structure: float = 0.6,
    of: float = 0.6,
    regime: float = 0.5,
    session: float = 0.5,
    history: float = 0.5,
) -> SetupConfidenceComponents:
    return SetupConfidenceComponents(
        structure_score=structure,
        order_flow_score=of,
        regime_score=regime,
        session_score=session,
        history_score=history,
    )


def _record(
    *,
    rid: str,
    setup_type: str = "ob_retest",
    direction: str = "long",
    tf: str = "5m",
    symbol: str = "EURUSD",
    features: tuple[float, ...] = (1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 2.0, 1.5, 1.0, 0.6, 0.6, 0.5, 0.5, 0.0),
    outcome: str = "win",
    pnl_r: float | None = 1.5,
    minutes_ago: int = 30,
) -> RecallRecord:
    now = datetime.now(_UTC)
    return RecallRecord(
        id=rid,
        setup_type=setup_type,
        direction=direction,
        tf=tf,
        symbol_id=symbol,
        features=features,
        outcome=outcome,  # type: ignore[arg-type]
        pnl_r=pnl_r,
        detected_at=now - timedelta(minutes=minutes_ago + 60),
        closed_at=now - timedelta(minutes=minutes_ago),
    )


# ─────────────────────────── store basics ────────────────────────────


def test_store_add_size_clear():
    s = InMemoryRecallStore(max_size=10)
    assert s.size() == 0
    s.add(_record(rid="r1"))
    s.add(_record(rid="r2"))
    assert s.size() == 2
    s.clear()
    assert s.size() == 0


def test_store_search_returns_top_k_by_similarity():
    s = InMemoryRecallStore(max_size=10)
    # Three records along three different directions in feature space.
    near = _record(rid="near", features=(1.0, 0.0, 0.0))
    mid = _record(rid="mid", features=(1.0, 1.0, 0.0))
    far = _record(rid="far", features=(0.0, 0.0, 1.0))
    s.add(near)
    s.add(mid)
    s.add(far)
    out = s.search([1.0, 0.0, 0.0], k=3)
    assert [n.record.id for n in out] == ["near", "mid", "far"]
    assert out[0].similarity > out[1].similarity > out[2].similarity


def test_store_search_filters_by_setup_direction_tf_symbol():
    s = InMemoryRecallStore(max_size=10)
    s.add(_record(rid="match", setup_type="ob_retest", direction="long", tf="5m", symbol="EURUSD"))
    s.add(_record(rid="wrong_type", setup_type="fvg_reaction"))
    s.add(_record(rid="wrong_dir", direction="short"))
    s.add(_record(rid="wrong_tf", tf="1h"))
    s.add(_record(rid="wrong_sym", symbol="GBPUSD"))
    out = s.search(
        [1.0, 0.0, 0.0],
        setup_type="ob_retest",
        direction="long",
        tf="5m",
        symbol_id="EURUSD",
    )
    assert [n.record.id for n in out] == ["match"]


def test_store_search_skips_open_when_only_closed():
    s = InMemoryRecallStore(max_size=10)
    s.add(_record(rid="closed", outcome="win"))
    s.add(_record(rid="open", outcome="open", pnl_r=None))
    out = s.search([1.0, 0.0, 0.0], only_closed=True)
    assert [n.record.id for n in out] == ["closed"]
    out_all = s.search([1.0, 0.0, 0.0], only_closed=False)
    assert {n.record.id for n in out_all} == {"closed", "open"}


def test_store_search_empty_features_returns_empty():
    s = InMemoryRecallStore(max_size=5)
    s.add(_record(rid="x"))
    assert s.search([]) == []
    # Zero vector also degrades gracefully.
    assert s.search([0.0, 0.0, 0.0]) == []


def test_store_eviction_keeps_newest():
    s = InMemoryRecallStore(max_size=3)
    for i in range(5):
        s.add(_record(rid=f"r{i}"))
    assert s.size() == 3
    out = s.search([1.0, 0.0, 0.0], k=10)
    ids = {n.record.id for n in out}
    assert ids == {"r2", "r3", "r4"}


def test_store_update_outcome_replaces_record():
    s = InMemoryRecallStore(max_size=5)
    s.add(_record(rid="r1", outcome="open", pnl_r=None))
    ok = s.update_outcome(record_id="r1", outcome="win", pnl_r=2.4)
    assert ok is True
    out = s.search([1.0, 0.0, 0.0], only_closed=False)
    assert out[0].record.outcome == "win"
    assert out[0].record.pnl_r == 2.4
    assert out[0].record.closed_at is not None


def test_store_update_outcome_unknown_id_returns_false():
    s = InMemoryRecallStore(max_size=5)
    assert s.update_outcome(record_id="missing", outcome="win", pnl_r=1.0) is False


def test_get_recall_store_singleton_returns_same_instance():
    reset_recall_store()
    a = get_recall_store()
    b = get_recall_store()
    assert a is b
    reset_recall_store()
    c = get_recall_store()
    assert c is not a


# ─────────────────────── feature fingerprint ────────────────────────


def test_feature_fingerprint_is_deterministic_and_ordered():
    f1 = feature_fingerprint(
        setup_type="ob_retest",
        direction="long",
        tf="5m",
        rr=2.0,
        entry_ref=1.1,
        of_score=0.7,
        structure_score=0.6,
        regime_score=0.5,
        session_score=0.4,
        atr_ratio=1.2,
    )
    f2 = feature_fingerprint(
        setup_type="ob_retest",
        direction="long",
        tf="5m",
        rr=2.0,
        entry_ref=1.1,
        of_score=0.7,
        structure_score=0.6,
        regime_score=0.5,
        session_score=0.4,
        atr_ratio=1.2,
    )
    assert f1 == f2
    # 6 setup-type slots + 9 numeric features = 15
    assert len(f1) == 15


def test_feature_fingerprint_one_hot_for_setup_type():
    f = feature_fingerprint(
        setup_type="momentum_continuation",
        direction="short",
        tf="1h",
        rr=1.5,
        entry_ref=100.0,
        of_score=0.5,
        structure_score=0.5,
        regime_score=0.5,
        session_score=0.5,
    )
    # First six slots are the one-hot setup-type encoding.
    one_hot = list(f[:6])
    assert sum(one_hot) == 1.0
    # momentum_continuation is index 4 in the canonical order.
    assert one_hot[4] == 1.0


def test_feature_fingerprint_direction_polarity():
    long_vec = feature_fingerprint(
        setup_type="ob_retest", direction="long", tf="5m", rr=2.0,
        entry_ref=1.1, of_score=0.5, structure_score=0.5,
        regime_score=0.5, session_score=0.5,
    )
    short_vec = feature_fingerprint(
        setup_type="ob_retest", direction="short", tf="5m", rr=2.0,
        entry_ref=1.1, of_score=0.5, structure_score=0.5,
        regime_score=0.5, session_score=0.5,
    )
    # Direction is the slot right after the one-hot block.
    assert long_vec[6] == 1.0
    assert short_vec[6] == -1.0


# ───────────────────── neighbour win-rate stats ─────────────────────


def _nb(outcome: str, sim: float, *, rid: str = "x") -> RecallNeighbour:
    return RecallNeighbour(record=_record(rid=rid, outcome=outcome), similarity=sim)


def test_neighbour_win_rate_pure_wins():
    rate, support, count = neighbour_win_rate(
        [_nb("win", 0.9), _nb("win", 0.8)]
    )
    assert rate == 1.0
    assert support == pytest.approx(1.7, abs=1e-6)
    assert count == 2


def test_neighbour_win_rate_pure_losses():
    rate, support, count = neighbour_win_rate(
        [_nb("loss", 0.9), _nb("loss", 0.8)]
    )
    assert rate == 0.0
    assert count == 2


def test_neighbour_win_rate_scratch_counts_half():
    rate, _, count = neighbour_win_rate(
        [_nb("scratch", 1.0), _nb("scratch", 1.0)]
    )
    assert rate == 0.5
    assert count == 2


def test_neighbour_win_rate_skips_low_similarity():
    rate, _, count = neighbour_win_rate(
        [_nb("win", 0.05), _nb("loss", 0.9)]
    )
    # Below threshold neighbour is dropped.
    assert rate == 0.0
    assert count == 1


def test_neighbour_win_rate_skips_open_outcomes():
    rate, _, count = neighbour_win_rate(
        [_nb("open", 0.9), _nb("win", 0.9)]
    )
    assert rate == 1.0
    assert count == 1


def test_neighbour_win_rate_empty_returns_zeros():
    rate, support, count = neighbour_win_rate([])
    assert (rate, support, count) == (0.0, 0.0, 0)


# ─────────────────────── calibration blending ───────────────────────


def test_calibrate_cold_start_returns_raw_score():
    components = _components(history=0.5)
    out = calibrate_confidence(
        components=components, raw_score=0.62, neighbours=[]
    )
    assert out.score == 0.62
    assert out.history_count == 0
    # Components are passed through untouched on cold start.
    assert out.components == components


def test_calibrate_low_support_falls_back_to_raw():
    # Only one barely-eligible neighbour ⇒ support below threshold.
    components = _components(history=0.5)
    out = calibrate_confidence(
        components=components,
        raw_score=0.7,
        neighbours=[_nb("loss", 0.25)],  # weight 0.25 < _MIN_SUPPORT 0.6
    )
    assert out.score == 0.7
    assert out.history_count == 0


def test_calibrate_winning_history_pulls_score_up():
    components = _components(history=0.5)
    out = calibrate_confidence(
        components=components,
        raw_score=0.55,
        neighbours=[_nb("win", 0.9, rid=f"w{i}") for i in range(5)],
    )
    assert out.score > 0.55
    assert out.score <= 0.95
    assert out.history_count == 5
    # history_score now reflects the empirical win-rate.
    assert out.components.history_score == pytest.approx(1.0, abs=1e-6)


def test_calibrate_losing_history_pulls_score_down():
    components = _components(history=0.5)
    out = calibrate_confidence(
        components=components,
        raw_score=0.65,
        neighbours=[_nb("loss", 0.9, rid=f"l{i}") for i in range(5)],
    )
    assert out.score < 0.65
    assert out.score >= 0.05
    assert out.components.history_score == pytest.approx(0.0, abs=1e-6)


def test_calibrate_clamps_score_to_band():
    components = _components(history=0.5)
    # All wins with raw_score 0.95 should not exceed clamp.
    out = calibrate_confidence(
        components=components,
        raw_score=0.95,
        neighbours=[_nb("win", 0.9, rid=f"w{i}") for i in range(20)],
    )
    assert out.score <= 0.95
    assert out.score >= 0.05


def test_calibrate_with_store_end_to_end():
    s = InMemoryRecallStore(max_size=20)
    # Seed the store with 4 winning + 1 losing memory at the same fingerprint.
    feats = feature_fingerprint(
        setup_type="ob_retest",
        direction="long",
        tf="5m",
        rr=2.0,
        entry_ref=1.1,
        of_score=0.7,
        structure_score=0.7,
        regime_score=0.5,
        session_score=0.5,
    )
    for i in range(4):
        s.add(_record(rid=f"w{i}", features=feats, outcome="win"))
    s.add(_record(rid="l0", features=feats, outcome="loss", pnl_r=-1.0))

    components = _components(history=0.5)
    out = calibrate_with_store(
        components=components,
        raw_score=0.55,
        store=s,
        setup_type="ob_retest",
        direction="long",
        tf="5m",
        symbol_id="EURUSD",
        rr=2.0,
        entry_ref=1.1,
        of_score=0.7,
        structure_score=0.7,
        regime_score=0.5,
        session_score=0.5,
    )
    assert out.history_count == 5
    # Win-rate is 0.8, raw is 0.55 → blended score should be > 0.55.
    assert out.score > 0.55
    assert out.components.history_score == pytest.approx(0.8, abs=1e-6)


def test_calibrate_with_store_filters_other_setups():
    s = InMemoryRecallStore(max_size=20)
    feats_ob = feature_fingerprint(
        setup_type="ob_retest", direction="long", tf="5m", rr=2.0,
        entry_ref=1.1, of_score=0.7, structure_score=0.7,
        regime_score=0.5, session_score=0.5,
    )
    feats_fvg = feature_fingerprint(
        setup_type="fvg_reaction", direction="long", tf="5m", rr=2.0,
        entry_ref=1.1, of_score=0.7, structure_score=0.7,
        regime_score=0.5, session_score=0.5,
    )
    # Wins live only on the *other* setup type — should be invisible.
    for i in range(5):
        s.add(_record(rid=f"w{i}", setup_type="fvg_reaction", features=feats_fvg, outcome="win"))

    components = _components(history=0.5)
    out = calibrate_with_store(
        components=components,
        raw_score=0.55,
        store=s,
        setup_type="ob_retest",
        direction="long",
        tf="5m",
        symbol_id="EURUSD",
        rr=2.0,
        entry_ref=1.1,
        of_score=0.7,
        structure_score=0.7,
        regime_score=0.5,
        session_score=0.5,
    )
    # No matching neighbours ⇒ cold-start passthrough.
    assert out.score == 0.55
    assert out.history_count == 0
