from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config import ROOT_DIR


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(relative_path: str, payload: dict[str, Any]) -> Path:
    target = ROOT_DIR / relative_path
    ensure_dir(target.parent)
    target.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return target


def read_json(relative_path: str) -> dict[str, Any] | None:
    target = ROOT_DIR / relative_path
    if not target.exists():
        return None
    return json.loads(target.read_text(encoding="utf-8"))
