"""Dump the control plane OpenAPI spec to disk.

Used by:
  * Developers: ``make openapi`` → stages packages/api-client/openapi.json
  * CI:         .github/workflows/contract-validation.yml diff against committed
                copy; a breaking change fails the job.

Deterministic:
  * JSON keys sorted recursively so the output byte-matches across runs and
    across Pydantic/FastAPI minor upgrades that only reorder keys.
  * The ``servers`` list is normalized so env-specific URLs never leak in.
  * Trailing newline appended so ``git diff`` stays clean.

Usage
-----

    python -m app.scripts.dump_openapi [output_path]

``output_path`` defaults to ``packages/api-client/openapi.json`` resolved from
the monorepo root (two directories above this file).

The script is intentionally dependency-free at runtime — it only imports the
FastAPI app and the standard library ``json`` module — so CI can invoke it
without spinning up Postgres / Redis.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# Import here rather than at module load so that the file is importable from
# anywhere (the CI job runs ``python -m app.scripts.dump_openapi`` with the
# ``services/control_plane`` directory on PYTHONPATH).
from app.main import app

_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_OUTPUT = _REPO_ROOT / "packages" / "api-client" / "openapi.json"


def _sorted(value: Any) -> Any:
    """Recursively sort dict keys so output is deterministic."""
    if isinstance(value, dict):
        return {k: _sorted(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [_sorted(item) for item in value]
    return value


def _normalize(spec: dict[str, Any]) -> dict[str, Any]:
    """Strip env-specific data so staging/prod/dev all produce the same spec."""
    spec = dict(spec)
    # Drop ``servers`` entirely — downstream consumers inject their own base URL.
    spec.pop("servers", None)
    info = dict(spec.get("info", {}))
    # Leave version alone so a package bump shows up as a contract change; that
    # is the whole point of the audit trail.
    spec["info"] = info
    return spec


def build_spec() -> dict[str, Any]:
    spec = app.openapi()
    return _sorted(_normalize(spec))


def write_spec(output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(build_spec(), indent=2, sort_keys=True) + "\n"
    output.write_text(serialized, encoding="utf-8")
    return output


def _resolve_output(argv: list[str]) -> Path:
    if len(argv) > 1:
        return Path(argv[1]).expanduser().resolve()
    return _DEFAULT_OUTPUT


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv)
    output = _resolve_output(argv)
    written = write_spec(output)
    print(f"wrote openapi spec: {written}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
