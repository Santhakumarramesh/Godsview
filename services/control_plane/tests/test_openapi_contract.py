"""Contract tests that guard ``packages/api-client/openapi.json``.

These run in-process so developers catch drift before pushing a PR that the
``contract-validation.yml`` workflow would otherwise reject. The committed
spec is the source of truth for client codegen.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.scripts.dump_openapi import build_spec

REPO_ROOT = Path(__file__).resolve().parents[3]
COMMITTED_SPEC = REPO_ROOT / "packages" / "api-client" / "openapi.json"

# Phase 0 public surface (keep in sync with contract-validation.yml).
PUBLIC_PATHS = frozenset(
    {
        "/health/live",
        "/health/ready",
        "/auth/login",
        "/auth/refresh",
    }
)


@pytest.fixture(scope="module")
def generated_spec() -> dict:
    return build_spec()


@pytest.fixture(scope="module")
def committed_spec() -> dict:
    if not COMMITTED_SPEC.exists():
        pytest.skip(
            "packages/api-client/openapi.json missing — run `make openapi` "
            "before committing."
        )
    return json.loads(COMMITTED_SPEC.read_text())


def test_committed_spec_matches_generated(
    generated_spec: dict, committed_spec: dict
) -> None:
    """The committed spec MUST equal what the live app produces.

    When this fails, run ``make openapi`` and commit the diff.
    """
    # Compare by serialized form to surface the exact delta if any.
    gen = json.dumps(generated_spec, indent=2, sort_keys=True)
    com = json.dumps(committed_spec, indent=2, sort_keys=True)
    assert gen == com, (
        "OpenAPI spec drift detected.\n"
        "Regenerate with: make openapi\n"
        "Or: python -m app.scripts.dump_openapi\n"
    )


def test_error_envelope_shape(generated_spec: dict) -> None:
    schemas = generated_spec["components"]["schemas"]
    assert "ErrorEnvelope" in schemas, "ErrorEnvelope missing from components/schemas"
    assert "ErrorBody" in schemas, "ErrorBody missing from components/schemas"

    body = schemas["ErrorBody"]
    for field in ("code", "message", "correlation_id"):
        assert field in body.get("required", []), (
            f"ErrorBody missing required field '{field}'"
        )


def test_every_auth_gated_route_declares_401_or_403(generated_spec: dict) -> None:
    paths = generated_spec["paths"]
    missing: list[str] = []
    for path, ops in paths.items():
        if path in PUBLIC_PATHS:
            continue
        for method, op in ops.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            responses = op.get("responses", {}) or {}
            if not ({"401", "403"} & set(responses.keys())):
                missing.append(f"{method.upper()} {path}")
    assert not missing, f"Auth-gated routes missing 401/403: {missing}"


def test_spec_is_deterministic() -> None:
    """build_spec must be a pure function for contract diffing to work."""
    first = json.dumps(build_spec(), sort_keys=True)
    second = json.dumps(build_spec(), sort_keys=True)
    assert first == second, "build_spec() is non-deterministic — contract CI will flap."
