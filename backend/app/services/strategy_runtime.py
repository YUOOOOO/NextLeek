"""用户策略执行：条件 DSL 与叠加并集/交集共用入口。"""
from __future__ import annotations

import time
from datetime import date
from typing import Any

from app.services.screener import ScreenerResult, ScreenerService


def execute_spec(
    screener: ScreenerService,
    as_of: date,
    spec: dict[str, Any],
    current: Any = None,
) -> ScreenerResult:
    kind = str(spec.get("kind") or "conditions")
    extra_specs = spec.get("_extra_specs") or {}
    if kind == "composite":
        children = list(spec.get("children") or [])
        if len(children) < 2:
            return ScreenerResult(as_of=as_of, strategy=spec.get("name"), rows=[], total=0, elapsed_ms=0)
        started = time.perf_counter()
        results = []
        for child in children:
            child_spec = dict(child)
            child_spec.setdefault("_extra_specs", extra_specs)
            results.append(execute_spec(screener, as_of, child_spec, current))
        merged = _merge_children(as_of, spec, results)
        merged.elapsed_ms = (time.perf_counter() - started) * 1000
        return merged
    if kind == "formula":
        return screener.run_formula(
            as_of,
            spec.get("formula") or "",
            extra_specs=extra_specs,
            basic_filter=spec.get("basic_filter") or {},
            order_by=spec.get("order_by") or "change_pct",
            descending=True if spec.get("descending") is None else bool(spec.get("descending")),
            limit=int(spec.get("result_limit") or spec.get("limit") or 100),
            current=current,
        )
    return screener.run_conditions(
        as_of,
        spec.get("conditions") or [],
        basic_filter=spec.get("basic_filter") or {},
        order_by=spec.get("order_by") or "change_pct",
        descending=True if spec.get("descending") is None else bool(spec.get("descending")),
        limit=int(spec.get("result_limit") or spec.get("limit") or 100),
        current=current,
    )


def _merge_children(as_of: date, spec: dict[str, Any], results: list[ScreenerResult]) -> ScreenerResult:
    mode = str(spec.get("merge_mode") or "union")
    counts: dict[str, int] = {}
    by_symbol: dict[str, dict] = {}
    for result in results:
        seen: set[str] = set()
        for row in result.rows:
            symbol = str(row.get("symbol") or "")
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            counts[symbol] = counts.get(symbol, 0) + 1
            by_symbol.setdefault(symbol, row)

    child_count = len(results)
    if mode == "intersect":
        needed = child_count
        symbols = [symbol for symbol, count in counts.items() if count >= needed]
    else:
        symbols = list(counts)

    filt = spec.get("basic_filter") or {}
    rows = [by_symbol[symbol] for symbol in symbols if _passes_basic(by_symbol[symbol], filt)]
    order_by = str(spec.get("order_by") or "change_pct")
    descending = True if spec.get("descending") is None else bool(spec.get("descending"))
    rows.sort(key=lambda row: _sort_key(row.get(order_by)), reverse=descending)
    limit = int(spec.get("result_limit") or spec.get("limit") or 100)
    rows = rows[: max(1, min(limit, 500))]
    return ScreenerResult(
        as_of=as_of,
        strategy=spec.get("name"),
        rows=rows,
        total=len(rows),
        elapsed_ms=0,
    )


def _sort_key(value: Any) -> tuple[int, float | str]:
    if isinstance(value, (int, float)) and value == value:
        return (1, float(value))
    if value is None:
        return (0, 0.0)
    return (1, str(value))


def _passes_basic(row: dict, filt: dict) -> bool:
    if not filt:
        return True
    close = row.get("close")
    price_min = filt.get("price_min")
    price_max = filt.get("price_max")
    if price_min is not None and close is not None and close < price_min:
        return False
    if price_max is not None and close is not None and close > price_max:
        return False
    cap = row.get("market_cap")
    cap_min = filt.get("market_cap_min")
    if cap_min is not None and cap is not None and cap < cap_min:
        return False
    amount = row.get("amount")
    amount_min = filt.get("amount_min")
    if amount_min is not None and amount is not None and amount < amount_min:
        return False
    if filt.get("exclude_st"):
        name = str(row.get("name") or "")
        if "ST" in name.upper():
            return False
    boards = filt.get("boards")
    board = row.get("board")
    if boards and board and board not in boards:
        return False
    return True
