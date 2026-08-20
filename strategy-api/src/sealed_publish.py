"""Publish research combo into the primary sealed production strategy."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from .config import load_config
from .paths import CONFIG_PATH, ROOT

PRIMARY_STRATEGY_NAME = "v8_composite_1"
MIN_FACTORS = 2
MAX_FACTORS = 8


def _shadow_path() -> Path:
    return CONFIG_PATH.parent / "shadow_strategies.yaml"


def _backup_dir() -> Path:
    return CONFIG_PATH.parent / "backups"


def _normalize_factors(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.replace(",", "+")
        parts = [p.strip() for p in text.split("+") if p.strip()]
        return parts
    if isinstance(raw, (list, tuple)):
        out: list[str] = []
        for item in raw:
            s = str(item).strip()
            if not s:
                continue
            if "+" in s or "," in s:
                out.extend(_normalize_factors(s))
            else:
                out.append(s)
        return out
    raise ValueError("combo must be a string or list of factor names")


def _dedupe_keep_order(factors: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for f in factors:
        if f in seen:
            continue
        seen.add(f)
        out.append(f)
    return out


def _public_factor_pool() -> set[str]:
    cfg = load_config()
    active = {str(x).strip() for x in (cfg.get("active_factors") or []) if str(x).strip()}
    if active:
        return active
    # Fallback: allow whatever is already sealed if active_factors missing
    return set()


def _resolve_factor_signs(factors: list[str], explicit: str | None) -> str:
    if explicit and str(explicit).strip():
        parts = [p.strip() for p in str(explicit).split(",") if p.strip()]
        if len(parts) != len(factors):
            raise ValueError(
                f"factor_signs length {len(parts)} != factors length {len(factors)}"
            )
        cleaned: list[str] = []
        for p in parts:
            if p in {"1", "+1", "1.0"}:
                cleaned.append("1")
            elif p in {"-1", "-1.0"}:
                cleaned.append("-1")
            else:
                raise ValueError(f"invalid factor_signs token: {p}")
        return ",".join(cleaned)

    # Prefer registry via main helper pattern (lazy import to avoid cycles)
    low_is_good = {
        "SHARE_CHG_5D",
        "SHARE_CHG_10D",
        "SHARE_CHG_20D",
        "SHARE_ACCEL",
        "MARGIN_CHG_10D",
        "MARGIN_BUY_RATIO",
        "AMIHUD_ILLIQUIDITY",
        "MAX_DD_60D",
        "RET_VOL_20D",
        "REALIZED_VOL_20D",
    }
    try:
        import importlib.util

        registry_path = (
            Path(__file__).resolve().parent / "etf_strategy" / "core" / "factor_registry.py"
        )
        spec = importlib.util.spec_from_file_location("_nl_factor_registry_pub", registry_path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            get_dir = getattr(module, "get_factor_direction", None)
            if callable(get_dir):
                return ",".join(
                    "-1" if get_dir(f) == "low_is_good" else "1" for f in factors
                )
    except Exception:
        pass
    return ",".join("-1" if f in low_is_good else "1" for f in factors)


def _find_primary_index(strategies: list[dict[str, Any]]) -> int:
    for i, item in enumerate(strategies):
        name = str(item.get("name") or item.get("id") or "")
        if name == PRIMARY_STRATEGY_NAME or item.get("primary") is True:
            return i
    if strategies:
        # Fallback: first entry is primary production slot
        return 0
    raise ValueError("shadow_strategies.yaml has no strategies to update")


def publish_primary_strategy(
    *,
    combo: Any,
    source_job_id: str | None = None,
    factor_signs: str | None = None,
    note: str | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Replace primary sealed combo. Returns publish result payload."""
    factors = _dedupe_keep_order(_normalize_factors(combo))
    if len(factors) < MIN_FACTORS:
        raise ValueError(f"need at least {MIN_FACTORS} factors")
    if len(factors) > MAX_FACTORS:
        raise ValueError(f"at most {MAX_FACTORS} factors allowed")

    pool = _public_factor_pool()
    if pool:
        unknown = [f for f in factors if f not in pool]
        if unknown:
            raise ValueError(
                "factors not in public pool (active_factors): " + ", ".join(unknown)
            )

    signs = _resolve_factor_signs(factors, factor_signs)
    combo_str = "+".join(factors)

    path = _shadow_path()
    if not path.exists():
        raise FileNotFoundError(f"missing sealed config: {path}")

    raw_text = path.read_text(encoding="utf-8")
    raw = yaml.safe_load(raw_text) or {}
    strategies = list(raw.get("shadow_strategies") or [])
    if not strategies:
        raise ValueError("shadow_strategies.yaml is empty")

    idx = _find_primary_index(strategies)
    before = dict(strategies[idx])
    before_combo = str(before.get("combo") or "")
    if before_combo == combo_str and str(before.get("factor_signs") or "") == signs:
        return {
            "changed": False,
            "message": "primary strategy already has this combo",
            "primary": {
                "name": str(before.get("name") or PRIMARY_STRATEGY_NAME),
                "combo": combo_str,
                "factors": factors,
                "factor_signs": signs,
            },
            "backup": None,
        }

    # Backup original bytes (preserve comments)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_dir = _backup_dir()
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"shadow_strategies_{stamp}.yaml"
    backup_path.write_text(raw_text, encoding="utf-8")

    sealed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    updated = dict(strategies[idx])
    updated["name"] = str(updated.get("name") or PRIMARY_STRATEGY_NAME)
    updated["combo"] = combo_str
    updated["factor_signs"] = signs
    updated["sealed_at"] = sealed_at
    if source_job_id:
        updated["source_job_id"] = str(source_job_id)
    if note:
        updated["note"] = str(note)[:500]
    if metrics:
        # Keep only compact numeric-ish fields
        compact = {
            k: metrics[k]
            for k in (
                "total_return",
                "sharpe",
                "max_drawdown",
                "engine",
                "start",
                "end",
            )
            if k in metrics and metrics[k] is not None
        }
        if compact:
            updated["seal_metrics"] = compact

    strategies[idx] = updated
    raw["shadow_strategies"] = strategies

    # Rewrite file with a short header + dump (backup keeps old comments)
    try:
        backup_rel = str(backup_path.relative_to(ROOT))
    except ValueError:
        backup_rel = str(backup_path)
    header = (
        "# Shadow / sealed production strategies.\n"
        "# Primary slot is replaced via POST /api/sealed/publish.\n"
        "# factor_signs: 1=high_is_good, -1=low_is_good (from factor_registry).\n"
        f"# Last publish: {sealed_at}\n"
        f"# Backup: {backup_rel}\n"
        "\n"
    )
    body = yaml.safe_dump(
        raw,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    )
    path.write_text(header + body, encoding="utf-8")

    return {
        "changed": True,
        "message": "primary sealed strategy updated",
        "backup": str(backup_path),
        "before": {
            "name": str(before.get("name") or PRIMARY_STRATEGY_NAME),
            "combo": before_combo,
            "factors": [f.strip() for f in before_combo.split("+") if f.strip()],
            "factor_signs": before.get("factor_signs"),
        },
        "primary": {
            "name": updated["name"],
            "combo": combo_str,
            "factors": factors,
            "factor_signs": signs,
            "sealed_at": sealed_at,
            "source_job_id": updated.get("source_job_id"),
            "note": updated.get("note"),
            "seal_metrics": updated.get("seal_metrics"),
        },
        "hint": "因子配方已锁定。持仓不会自动变；请再跑「生成今日信号」。",
    }
