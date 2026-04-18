"""Tests for market_data_service.validator"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from services.market_data_service.validator import quick_validate, validate_bars
from services.shared.types import Bar
from services.tests.conftest import make_bar, make_bars


class TestValidateBars:
    def test_empty_input(self):
        bars, report = validate_bars([])
        assert bars == []
        assert report.total_bars == 0

    def test_valid_bars_pass(self):
        bars = make_bars(50)
        cleaned, report = validate_bars(bars)
        assert report.valid_bars == len(bars)
        assert report.removed_bars == 0

    def test_negative_price_removed(self):
        bad = make_bar(close=-1.0, open_=-1.0, high=0.0, low=-2.0)
        good = make_bar(close=100.0)
        cleaned, report = validate_bars([bad, good])
        assert len(cleaned) == 1
        assert cleaned[0].close == 100.0

    def test_nan_price_removed(self):
        import math

        bad = make_bar(close=float("nan"))
        good = make_bar(close=100.0)
        cleaned, report = validate_bars([bad, good])
        assert len(cleaned) == 1

    def test_ohlc_inconsistency_corrected(self):
        """High below close should be corrected, not removed."""
        now = datetime.now(timezone.utc)
        bad = Bar(
            symbol="TEST",
            timestamp=now,
            open=100.0,
            high=98.0,  # Below close — invalid
            low=97.0,
            close=99.0,
            volume=1000.0,
            timeframe="15min",
        )
        cleaned, report = validate_bars([bad])
        assert len(cleaned) == 1
        assert cleaned[0].high >= cleaned[0].close

    def test_duplicate_timestamps_removed(self):
        now = datetime.now(timezone.utc)
        b1 = make_bar(close=100.0, ts=now)
        b2 = make_bar(close=101.0, ts=now)  # same ts → duplicate
        cleaned, report = validate_bars([b1, b2])
        assert len(cleaned) == 1
        assert report.duplicates == 1

    def test_pass_rate_computed(self):
        bars = make_bars(100)
        _, report = validate_bars(bars)
        assert 0.0 <= report.pass_rate <= 1.0
        assert report.pass_rate == report.valid_bars / report.total_bars

    def test_is_usable_threshold(self):
        bars = make_bars(100)
        _, report = validate_bars(bars)
        assert report.is_usable  # 100 valid bars → pass_rate = 1.0

    def test_gap_detection(self):
        """Insert a 100-bar gap; should register as a gap."""
        now = datetime.now(timezone.utc)
        bars = [
            make_bar(close=100.0, ts=now - timedelta(hours=2)),
            make_bar(close=101.0, ts=now),  # 2h gap on 15min TF
        ]
        _, report = validate_bars(bars)
        assert report.gaps_detected >= 1


class TestQuickValidate:
    def test_valid_bars(self):
        bars = make_bars(10)
        assert quick_validate(bars) is True

    def test_empty(self):
        assert quick_validate([]) is False

    def test_invalid_ohlc(self):
        now = datetime.now(timezone.utc)
        bad = Bar(
            symbol="X",
            timestamp=now,
            open=100.0,
            high=90.0,  # high < low
            low=95.0,
            close=92.0,
            volume=1000.0,
            timeframe="15min",
        )
        assert quick_validate([bad]) is False
