"""Tests for feature_service.builder"""
from __future__ import annotations

import math
import pytest

from services.feature_service.builder import (
    build_features,
    build_feature_vector,
    FEATURE_NAMES,
)
from services.tests.conftest import make_bars


class TestBuildFeatures:
    def test_returns_list(self):
        bars = make_bars(100)
        result = build_features(bars)
        assert isinstance(result, list)

    def test_requires_min_lookback(self):
        bars = make_bars(30)   # less than min_lookback=55
        result = build_features(bars)
        assert result == []

    def test_feature_names_present(self):
        bars = make_bars(120)
        rows = build_features(bars)
        assert len(rows) > 0
        for name in FEATURE_NAMES:
            assert name in rows[0], f"Feature '{name}' missing"

    def test_no_nan_in_features(self):
        bars = make_bars(120)
        rows = build_features(bars)
        for row in rows:
            for k in FEATURE_NAMES:
                v = row.get(k, 0.0)
                assert not math.isnan(v), f"NaN in feature '{k}'"
                assert not math.isinf(v), f"Inf in feature '{k}'"

    def test_binary_features_in_range(self):
        """Binary (0/1) features must be exactly 0 or 1."""
        binary = [
            "bullish_bar", "above_ema20", "above_ema50", "macd_positive",
            "near_bb_upper", "near_bb_lower", "is_volume_spike",
            "above_vwap", "absorption_bull", "rejection_bear",
            "near_support", "near_resistance",
        ]
        bars = make_bars(120)
        rows = build_features(bars)
        for row in rows:
            for feat in binary:
                v = row.get(feat)
                if v is not None:
                    assert v in (0.0, 1.0), f"{feat}={v}"

    def test_count_correct(self):
        bars = make_bars(150)
        rows = build_features(bars, min_lookback=55)
        assert len(rows) == 150 - 55


class TestBuildFeatureVector:
    def test_returns_dict(self):
        bars = make_bars(100)
        result = build_feature_vector(bars)
        assert result is not None
        assert isinstance(result, dict)

    def test_returns_none_insufficient_bars(self):
        bars = make_bars(20)
        result = build_feature_vector(bars)
        assert result is None

    def test_latest_bar_used(self):
        """Metadata __bar_index should equal len(bars)-1."""
        bars = make_bars(100)
        result = build_feature_vector(bars)
        assert result is not None
        assert result.get("__bar_index") == 99.0


class TestFeatureNames:
    def test_no_duplicates(self):
        assert len(FEATURE_NAMES) == len(set(FEATURE_NAMES))

    def test_count(self):
        # We expect exactly 35+ features
        assert len(FEATURE_NAMES) >= 30
