"""因子 IC 回测、策略组合回测、模板挖掘。"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import polars as pl

from app.factors.registry import FactorSpec
from app.services import formula_runtime
from app.services.portfolio_backtest import Fill, run_portfolio
from app.services.screener import ScreenerService

FACTOR_TEMPLATES = (
    ("ma{n}", "ts_mean(close, {n})", (5, 10, 20, 60, 120)),
    ("ma{n}_bias", "close / ts_mean(close, {n}) - 1", (5, 10, 20, 60, 120)),
    ("vol_ratio_{n}d", "volume / ts_mean(volume, {n})", (5, 10, 20)),
    ("mom_{n}d", "close / ts_delay(close, {n}) - 1", (5, 10, 20, 60)),
)


def _history(screener: ScreenerService, as_of: date, days: int, warmup: int) -> pl.DataFrame:
    lookback = max(days, 20) + max(warmup, 1) + 5
    return screener._load_enriched_history(as_of, lookback)

def _forward_return(frame: pl.DataFrame, horizon: int) -> pl.DataFrame:
    return frame.sort(["symbol", "date"]).with_columns(
        (pl.col("close").shift(-horizon).over("symbol") / pl.col("close") - 1).alias("_ret")
    )


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    avg = _mean(values)
    var = sum((item - avg) ** 2 for item in values) / (len(values) - 1)
    return var ** 0.5


def research_factor(
    screener: ScreenerService,
    as_of: date,
    formula: str,
    *,
    days: int = 240,
    horizon: int = 1,
    extra_specs: dict[str, FactorSpec] | None = None,
    code: str = "factor",
    start: date | None = None,
    end: date | None = None,
) -> dict[str, Any]:
    compiled = formula_runtime.compile_user_formula(formula, extra_specs.keys() if extra_specs else None)
    end_date = end or as_of
    start_date = start or (end_date - timedelta(days=max(days, 20)))
    lookback = (end_date - start_date).days + max(compiled.warmup_bars, 1) + 30
    frame = _history(screener, end_date, lookback, compiled.warmup_bars)
    if frame.is_empty():
        return {"ok": False, "warning": "本地暂无足够行情，无法回测", "days": 0}
    transformed, _ = formula_runtime.apply_formula(frame, formula, extra_specs)
    if FACTOR_MISSING(transformed):
        return {"ok": False, "warning": "公式未能产出因子列", "days": 0}
    col = "__dsl_factor__"
    scored = _forward_return(
        transformed.filter((pl.col(col).is_not_null()) & (pl.col("date") >= start_date) & (pl.col("date") <= end_date)),
        horizon,
    ).filter(pl.col("_ret").is_not_null())
    ic_frame = scored.group_by("date").agg(pl.corr(pl.col(col), pl.col("_ret"), method="spearman").alias("ic")).drop_nulls()
    ics = [float(v) for v in ic_frame["ic"].to_list() if v is not None and v == v]
    mean_ic = _mean(ics)
    ir = mean_ic / _std(ics) if _std(ics) else 0.0
    ranked = scored.with_columns(
        (((pl.col(col).rank("average").over("date") - 1) / pl.col(col).count().over("date") * 5).floor().clip(0, 4)).alias("_q")
    )
    buckets = ranked.group_by("_q").agg(pl.col("_ret").mean().alias("ret"), pl.len().alias("n")).sort("_q")
    quantiles = [
        {"bucket": int(row["_q"]) + 1, "mean_return": float(row["ret"] or 0), "count": int(row["n"])}
        for row in buckets.to_dicts()
    ]
    return {
        "ok": True,
        "code": code,
        "formula": formula,
        "days": ic_frame.height,
        "horizon": horizon,
        "ic": round(mean_ic, 6),
        "ir": round(ir, 4),
        "ic_positive_ratio": round(sum(1 for item in ics if item > 0) / len(ics), 4) if ics else 0,
        "quantiles": quantiles,
        "warmup_bars": compiled.warmup_bars,
    }


def FACTOR_MISSING(frame: pl.DataFrame) -> bool:
    return "__dsl_factor__" not in frame.columns


def research_strategy(
    screener: ScreenerService,
    as_of: date,
    formula: str,
    *,
    days: int = 90,
    horizon: int = 5,
    extra_specs: dict[str, FactorSpec] | None = None,
    basic_filter: dict | None = None,
    start: date | None = None,
    end: date | None = None,
    initial_capital: float = 1_000_000.0,
    commission_pct: float = 0.0002,
    stamp_tax_pct: float = 0.001,
    slippage_bps: float = 5.0,
    max_positions: int = 10,
    max_exposure_pct: float = 1.0,
    holding_days: int | None = None,
    entry_fill: Fill = "open_t+1",
    exit_fill: Fill = "open_t+1",
) -> dict[str, Any]:
    compiled = formula_runtime.compile_user_formula(
        formula, extra_specs.keys() if extra_specs else None, require_bool=True
    )
    end_date = end or as_of
    start_date = start or (end_date - timedelta(days=max(days, 20)))
    hold = holding_days or horizon
    lookback = (end_date - start_date).days + max(compiled.warmup_bars, 1) + 30
    frame = _history(screener, end_date, lookback, compiled.warmup_bars)
    if frame.is_empty():
        return {"ok": False, "warning": "本地暂无足够行情，无法回测", "days": 0}
    transformed, _ = formula_runtime.apply_formula(frame, formula, extra_specs)
    if FACTOR_MISSING(transformed):
        return {"ok": False, "warning": "公式未能产出信号", "days": 0}
    if basic_filter:
        from app.strategy.engine import StrategyEngine

        transformed = StrategyEngine._apply_basic_filter(transformed, basic_filter)
    scored = _forward_return(transformed, hold)
    hits = scored.filter(
        (pl.col("date") >= start_date)
        & (pl.col("date") <= end_date)
        & (pl.col("__dsl_factor__") > 0)
        & pl.col("_ret").is_not_null()
    )
    portfolio = run_portfolio(
        transformed,
        start=start_date,
        end=end_date,
        initial_capital=initial_capital,
        commission_pct=commission_pct,
        stamp_tax_pct=stamp_tax_pct,
        slippage_bps=slippage_bps,
        max_positions=max_positions,
        max_exposure_pct=max_exposure_pct,
        holding_days=hold,
        entry_fill=entry_fill,
        exit_fill=exit_fill,
    )
    if not portfolio.get("ok"):
        portfolio["formula"] = formula
        portfolio["days"] = 0
        return portfolio
    avg = 0.0
    hit_rate = 0.0
    coverage = 0.0
    if not hits.is_empty():
        daily = hits.group_by("date").agg(pl.col("_ret").mean().alias("ret"), pl.len().alias("n")).sort("date")
        rets = [float(v) for v in daily["ret"].to_list() if v is not None and v == v]
        avg = _mean(rets)
        hit_rate = sum(1 for item in rets if item > 0) / len(rets) if rets else 0
        coverage = _mean([float(n) for n in daily["n"].to_list()])
    portfolio.update(
        {
            "formula": formula,
            "days": len(portfolio.get("equity_curve") or []),
            "horizon": hold,
            "avg_return": round(avg, 6),
            "hit_rate": round(hit_rate, 4),
            "avg_names": round(coverage, 1),
            "total_hits": int(hits.height),
            "warmup_bars": compiled.warmup_bars,
        }
    )
    return portfolio


def mine_factors(
    screener: ScreenerService,
    as_of: date,
    *,
    days: int = 240,
    horizon: int = 1,
    limit: int = 8,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for stem, template, windows in FACTOR_TEMPLATES:
        for n in windows:
            formula = template.format(n=n)
            code = stem.format(n=n)
            try:
                result = research_factor(screener, as_of, formula, days=days, horizon=horizon, code=code)
            except Exception:  # noqa: BLE001
                continue
            if not result.get("ok"):
                continue
            result["score"] = abs(float(result.get("ic") or 0))
            rows.append(result)
    rows.sort(key=lambda item: item.get("score") or 0, reverse=True)
    return {"ok": True, "items": rows[:limit], "as_of": as_of.isoformat()}


def mine_strategies(
    screener: ScreenerService,
    as_of: date,
    *,
    days: int = 240,
    horizon: int = 1,
    limit: int = 6,
) -> dict[str, Any]:
    mined = mine_factors(screener, as_of, days=days, horizon=horizon, limit=limit)
    items: list[dict[str, Any]] = []
    for factor in mined.get("items") or []:
        formula = str(factor.get("formula") or "")
        ic = float(factor.get("ic") or 0)
        if ic >= 0:
            signal = f"rank({formula}) >= 0.9"
        else:
            signal = f"rank({formula}) <= 0.1"
        try:
            result = research_strategy(screener, as_of, signal, days=days, horizon=horizon)
        except Exception:  # noqa: BLE001
            continue
        if not result.get("ok"):
            continue
        result["name"] = factor.get("code")
        result["score"] = abs(float(result.get("avg_return") or 0))
        items.append(result)
    items.sort(key=lambda item: item.get("score") or 0, reverse=True)
    return {"ok": True, "items": items[:limit], "as_of": as_of.isoformat()}
