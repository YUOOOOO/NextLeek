"""用户公式运行时：编译、物化自定义因子、过滤选股。不写入全局注册表。"""
from __future__ import annotations

from collections.abc import Collection, Mapping
from typing import Any

import polars as pl

from app.factors.dsl import BASE_COLUMNS, FACTOR_COLUMN, OPERATORS, compile_formula
from app.factors.registry import FactorSpec, all_factors, get_factor


def known_identifiers(extra: Collection[str] | None = None) -> frozenset[str]:
    try:
        from app.indicators.pipeline import ENRICHED_COLUMNS
        from app.strategy import custom_signals

        known = BASE_COLUMNS | frozenset(ENRICHED_COLUMNS) | custom_signals.ALLOWED_FIELDS
    except Exception:  # noqa: BLE001
        known = BASE_COLUMNS
    known = known | frozenset(spec.id for spec in all_factors())
    if extra:
        known = known | frozenset(extra)
    return known


def compile_user_formula(
    formula: str,
    extra: Collection[str] | None = None,
    *,
    require_bool: bool = False,
):
    compiled = compile_formula(formula, extra_identifiers=known_identifiers(extra))
    if not compiled.ok:
        first = compiled.errors[0]
        raise ValueError(f"公式无效 [{first.code}]: {first.message}")
    if require_bool:
        text = formula.lower()
        if not any(token in text for token in (">", "<", "==", "!=", " and ", " or ")):
            raise ValueError("策略公式须为布尔表达式，例如 close > ts_mean(close, 120)")
    return compiled


def preview(formula: str, extra: Collection[str] | None = None) -> dict:
    compiled = compile_formula(formula, extra_identifiers=known_identifiers(extra))
    return {
        "ok": compiled.ok,
        "formula": formula,
        "warmup_bars": compiled.warmup_bars,
        "dependencies": sorted(compiled.dependencies),
        "errors": [error.to_dict() for error in compiled.errors],
    }


def formula_meta() -> dict:
    return {
        "operators": sorted(OPERATORS),
        "base_columns": sorted(BASE_COLUMNS),
        "examples": [
            {
                "label": "站上 120 日均线",
                "kind": "strategy",
                "formula": "close > ts_mean(close, 120)",
            },
            {
                "label": "均线多头且放量",
                "kind": "strategy",
                "formula": "close > ts_mean(close, 20) and volume > ts_mean(volume, 20)",
            },
            {
                "label": "120 日均线",
                "kind": "factor",
                "code": "ma120",
                "formula": "ts_mean(close, 120)",
            },
            {
                "label": "MA120 乖离",
                "kind": "factor",
                "code": "ma120_bias",
                "formula": "close / ts_mean(close, 120) - 1",
            },
        ],
    }


def _topo(specs: Mapping[str, FactorSpec]) -> list[FactorSpec]:
    remaining = dict(specs)
    ordered: list[FactorSpec] = []
    seen: set[str] = set()
    while remaining:
        progress = False
        for code, spec in list(remaining.items()):
            deps = [dep for dep in spec.dependencies if dep in remaining and dep != code]
            if deps:
                continue
            ordered.append(spec)
            seen.add(code)
            remaining.pop(code)
            progress = True
        if not progress:
            ordered.extend(remaining.values())
            break
    return ordered


def materialize_user_specs(frame: pl.DataFrame, specs: Mapping[str, FactorSpec]) -> pl.DataFrame:
    if not specs or frame.is_empty():
        return frame
    from app.strategy.scoring import materialize_scoring_columns

    extra_ids = frozenset(specs)
    for spec in _topo(specs):
        if spec.id in frame.columns:
            continue
        compiled = compile_formula(spec.formula_text, extra_identifiers=known_identifiers(extra_ids))
        if not compiled.ok or compiled.frame_transform is None:
            continue
        registry_names = [name for name in compiled.referenced_factors if name not in extra_ids]
        if registry_names:
            frame = materialize_scoring_columns(frame, registry_names)
        transformed = compiled.frame_transform(frame)
        if transformed is None:
            continue
        frame = transformed.with_columns(pl.col(FACTOR_COLUMN).alias(spec.id)).drop(FACTOR_COLUMN)
    return frame


def apply_formula(
    frame: pl.DataFrame,
    formula: str,
    extra_specs: Mapping[str, FactorSpec] | None = None,
) -> tuple[pl.DataFrame, Any]:
    extra_specs = extra_specs or {}
    compiled = compile_user_formula(formula, extra_specs.keys())
    from app.strategy.scoring import materialize_scoring_columns

    extra_ids = frozenset(extra_specs)
    registry_names = [name for name in compiled.referenced_factors if name not in extra_ids and get_factor(name) is not None]
    if registry_names:
        frame = materialize_scoring_columns(frame, registry_names)
    needed = {code: spec for code, spec in extra_specs.items() if code in compiled.referenced_factors or code in compiled.dependencies}
    if needed:
        # include transitive user-factor deps
        pending = set(needed)
        while pending:
            code = pending.pop()
            spec = extra_specs.get(code)
            if spec is None:
                continue
            needed[code] = spec
            for dep in spec.dependencies:
                if dep in extra_specs and dep not in needed:
                    pending.add(dep)
        frame = materialize_user_specs(frame, needed)
    transformed = compiled.frame_transform(frame) if compiled.frame_transform is not None else None
    if transformed is None:
        raise ValueError("公式计算失败：缺列或窗口不足")
    return transformed, compiled
