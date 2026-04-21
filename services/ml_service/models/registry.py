"""
GodsView v2 — Model registry.

Maintains an in-memory + on-disk registry of trained models.
Supports: list, get_latest, load, promote.
"""
from __future__ import annotations

import json
import pickle
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.shared.logging import get_logger

log = get_logger(__name__)

_MODEL_DIR    = Path("./data/models")
_REGISTRY_FILE = _MODEL_DIR / "registry.json"
_MODEL_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class ModelEntry:
    model_id:       str
    symbol:         str | None
    timeframe:      str
    model_path:     str
    test_accuracy:  float
    roc_auc:        float
    train_rows:     int
    test_rows:      int
    trained_at:     str
    is_active:      bool = False
    mlflow_run_id:  str = ""
    notes:          str = ""


class ModelRegistry:
    def __init__(self) -> None:
        self._entries: list[ModelEntry] = []
        self._load()

    def _load(self) -> None:
        if _REGISTRY_FILE.exists():
            try:
                data = json.loads(_REGISTRY_FILE.read_text())
                self._entries = [ModelEntry(**e) for e in data]
            except Exception as exc:
                log.warning("registry_load_failed", err=str(exc))

    def _save(self) -> None:
        try:
            _REGISTRY_FILE.write_text(
                json.dumps([asdict(e) for e in self._entries], indent=2)
            )
        except Exception as exc:
            log.error("registry_save_failed", err=str(exc))

    def register(self, entry: ModelEntry, activate: bool = True) -> None:
        """Add or update a model in the registry."""
        # Deactivate previous active model for this symbol
        if activate:
            for e in self._entries:
                if e.symbol == entry.symbol and e.timeframe == entry.timeframe:
                    e.is_active = False
            entry.is_active = True

        existing_ids = {e.model_id for e in self._entries}
        if entry.model_id not in existing_ids:
            self._entries.append(entry)
        else:
            for i, e in enumerate(self._entries):
                if e.model_id == entry.model_id:
                    self._entries[i] = entry
                    break

        self._entries.sort(key=lambda e: e.trained_at, reverse=True)
        self._save()
        log.info("model_registered", model_id=entry.model_id, active=activate)

    def get_active(self, symbol: str | None, timeframe: str) -> ModelEntry | None:
        for e in self._entries:
            if e.symbol == symbol and e.timeframe == timeframe and e.is_active:
                return e
        # Fallback: most recent
        candidates = [e for e in self._entries if e.timeframe == timeframe]
        return candidates[0] if candidates else None

    def get_latest(self) -> ModelEntry | None:
        active = [e for e in self._entries if e.is_active]
        return active[0] if active else (self._entries[0] if self._entries else None)

    def list_all(self, symbol: str | None = None) -> list[ModelEntry]:
        if symbol:
            return [e for e in self._entries if e.symbol == symbol]
        return list(self._entries)

    def load_model(self, model_id: str) -> tuple[Any, list[str]] | None:
        """Load the sklearn/xgb model and its feature keys from disk."""
        entry = next((e for e in self._entries if e.model_id == model_id), None)
        if not entry:
            return None
        path = Path(entry.model_path)
        if not path.exists():
            log.error("model_file_missing", model_id=model_id, path=str(path))
            return None
        try:
            with open(path, "rb") as f:
                data = pickle.load(f)
            return data["model"], data["feature_keys"]
        except Exception as exc:
            log.error("model_load_failed", model_id=model_id, err=str(exc))
            return None


# Module-level singleton
registry = ModelRegistry()
