from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .paths import CONFIG_PATH, DATA_DIR, ROOT


def _config_path() -> Path:
    raw = os.getenv("WFO_CONFIG_PATH") or os.getenv("STRATEGY_CONFIG_PATH")
    if not raw:
        return CONFIG_PATH
    candidate = Path(raw)
    return candidate if candidate.is_absolute() else ROOT / candidate


@lru_cache(maxsize=1)
def load_config() -> dict[str, Any]:
    path = _config_path()
    with path.open("r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    data = cfg.setdefault("data", {})
    data["data_dir"] = str((DATA_DIR / data.get("data_dir", "raw/ETF/daily")).resolve())
    data["cache_dir"] = str((ROOT / data.get("cache_dir", ".cache")).resolve())
    return cfg


def reload_config() -> dict[str, Any]:
    load_config.cache_clear()
    return load_config()


def tradeable_symbols(cfg: dict[str, Any] | None = None) -> list[str]:
    cfg = cfg or load_config()
    symbols = [str(s) for s in cfg["data"]["symbols"]]
    mode = cfg.get("universe", {}).get("mode", "A_SHARE_ONLY")
    qdii = set(str(x) for x in cfg.get("universe", {}).get("qdii_tickers", []))
    if mode == "A_SHARE_ONLY":
        return [s for s in symbols if s not in qdii]
    return symbols


def all_symbols(cfg: dict[str, Any] | None = None) -> list[str]:
    cfg = cfg or load_config()
    return [str(s) for s in cfg["data"]["symbols"]]


def sealed_strategies() -> list[dict[str, Any]]:
    path = _config_path().parent / "shadow_strategies.yaml"
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    strategies: list[dict[str, Any]] = []
    for item in raw.get("shadow_strategies", []):
        combo = str(item.get("combo", ""))
        factors = [factor.strip() for factor in combo.split("+") if factor.strip()]
        strategy_id = str(item.get("id") or item.get("name") or combo or "unknown")
        strategies.append(
            {
                "id": strategy_id,
                "name": item.get("name", strategy_id),
                "combo": combo,
                "factors": factors,
            }
        )
    return strategies
