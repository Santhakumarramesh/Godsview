"""Legacy control_plane tests — DEPRECATED.

The control_plane module has been replaced by 11 v2 microservices.
These tests are kept for historical reference but are skipped automatically.
"""

from __future__ import annotations

import pytest

# Skip all tests in this directory — the `app` module they import no longer exists.
collect_ignore_glob = ["test_*.py"]


def pytest_collect_file(parent, file_path):
    """Prevent collection of all test files in the legacy control_plane suite."""
    return None
