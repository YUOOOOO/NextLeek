from __future__ import annotations

from functools import lru_cache
from typing import Any

import yaml

from .paths import CONFIG_PATH


@lru_cache(maxsize=1)
def load_config() -> dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


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
