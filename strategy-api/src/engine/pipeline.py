from __future__ import annotations

from typing import Any, Callable

import numpy as np

from ..config import load_config, sealed_strategies, tradeable_symbols
from ..data.loader import load_panel, panel_to_close_matrix
from .backtest import run_event_backtest, run_vectorized_backtest
from .factors import combine_scores, compute_all_factors
from .regime import vol_regime_exposure
from .signal import generate_signal_for_strategy, load_state, save_state
from .wfo import run_wfo

ProgressCb = Callable[[str, float], None]


def _bt_params(cfg: dict[str, Any]) -> dict[str, Any]:
    b = cfg["backtest"]
    h = b.get("hysteresis", {})
    w = cfg.get("wfo", {}).get("scoring", {})
    return {
        "freq": int(b.get("freq", 5)),
        "pos_size": int(b.get("pos_size", 2)),
        "lookback": int(b.get("lookback_window", 252)),
        "commission": float(b.get("commission_rate", 0.0002)),
        "delta_rank": float(h.get("delta_rank", 0.1)),
        "min_hold_days": int(h.get("min_hold_days", 9)),
        "initial_capital": float(b.get("initial_capital", 1_000_000)),
        "w_return": float(w.get("return", 0.4)),
        "w_sharpe": float(w.get("sharpe", 0.3)),
        "w_maxdd": float(w.get("maxdd", 0.3)),
    }


def _load_market(cfg: dict[str, Any]):
    symbols = tradeable_symbols(cfg)
    start = cfg["data"].get("start_date") or None
    end = cfg["data"].get("end_date") or None
    panel = load_panel(symbols, start=start, end=end or None)
    if len(panel) < 3:
        raise RuntimeError(f"not enough local data ({len(panel)} symbols). Run update-data first.")
    close, dates, codes, fields = panel_to_close_matrix(panel)
    return close, dates, codes, fields


def _regime(cfg: dict[str, Any], close: np.ndarray, codes: list[str]) -> np.ndarray | None:
    rg = cfg["backtest"].get("regime_gate", {})
    if not rg.get("enabled", True):
        return None
    proxy = str(rg.get("proxy_symbol", "510300"))
    if proxy not in codes:
        return np.ones(close.shape[0], dtype=np.float64)
    j = codes.index(proxy)
    return vol_regime_exposure(
        close[:, j],
        window=int(rg.get("window", 20)),
        thresholds_pct=list(rg.get("thresholds_pct", [25, 30, 40])),
        exposures=list(rg.get("exposures", [1.0, 0.7, 0.4, 0.1])),
        shift_days=1,
    )


def run_backtest_job(
    engine: str,
    factors: list[str] | None = None,
    progress: ProgressCb | None = None,
) -> dict[str, Any]:
    cfg = load_config()
    if progress:
        progress("load data", 5)
    close, dates, codes, fields = _load_market(cfg)
    names = factors or list(sealed_strategies()[0]["factors"])
    if progress:
        progress("factors", 25)
    fmap = compute_all_factors(
        names,
        close,
        fields["high"],
        fields["low"],
        fields["vol"],
        cfg.get("factor_signs", {}),
        dates=dates,
        codes=codes,
    )
    usable = [name for name in names if name in fmap]
    scores = combine_scores(fmap, usable)

    regime = _regime(cfg, close, codes)
    params = _bt_params(cfg)
    if progress:
        progress("backtest", 60)
    fn = run_vectorized_backtest if engine == "vec" else run_event_backtest
    result = fn(
        close,
        fields["open"],
        scores,
        dates,
        codes,
        regime_exposure=regime,
        **{k: params[k] for k in ("freq", "pos_size", "lookback", "commission", "delta_rank", "min_hold_days", "initial_capital")},
    )
    result["factors"] = usable
    result["requested_factors"] = names
    result["n_symbols"] = len(codes)
    if progress:
        progress("done", 100)
    return result


def run_wfo_job(progress: ProgressCb | None = None) -> dict[str, Any]:
    cfg = load_config()
    if progress:
        progress("load data", 5)
    close, dates, codes, fields = _load_market(cfg)
    wfo_cfg = cfg.get("wfo", {})
    names = list(cfg.get("active_factors", []))
    params = _bt_params(cfg)
    regime = _regime(cfg, close, codes)
    if progress:
        progress("wfo screen", 30)
    out = run_wfo(
        close,
        fields["open"],
        fields["high"],
        fields["low"],
        fields["vol"],
        dates,
        codes,
        names,
        cfg.get("factor_signs", {}),
        combo_sizes=list(wfo_cfg.get("combo_sizes", [2, 3])),
        max_combos=int(wfo_cfg.get("max_combos", 80)),
        train_ratio=float(wfo_cfg.get("train_ratio", 0.7)),
        ic_threshold=float(wfo_cfg.get("ic_threshold", 0.02)),
        bt_params=params,
        regime_exposure=regime,
    )
    # attach vec for top candidates
    top_n = int(wfo_cfg.get("top_n_vec", 10))
    vec_results = []
    candidates = out.get("candidates", [])[:top_n]
    for i, c in enumerate(candidates):
        if progress:
            progress(f"vec {i+1}/{len(candidates)}", 40 + 50 * (i / max(len(candidates), 1)))
        fmap = compute_all_factors(
            c["factors"],
            close,
            fields["high"],
            fields["low"],
            fields["vol"],
            cfg.get("factor_signs", {}),
            dates=dates,
            codes=codes,
        )
        scores = combine_scores(fmap, c["factors"])
        met = run_vectorized_backtest(
            close,
            fields["open"],
            scores,
            dates,
            codes,
            regime_exposure=regime,
            **{k: params[k] for k in ("freq", "pos_size", "lookback", "commission", "delta_rank", "min_hold_days", "initial_capital")},
        )
        vec_results.append(
            {
                "factors": c["factors"],
                "total_return": met["total_return"],
                "sharpe": met["sharpe"],
                "max_drawdown": met["max_drawdown"],
                "trades": met["trades"],
            }
        )
    out["vec_top"] = vec_results
    if progress:
        progress("done", 100)
    return out


def run_pipeline_job(progress: ProgressCb | None = None) -> dict[str, Any]:
    from ..data.updater import update_daily

    if progress:
        progress("update-data", 5)
    # optional light update skipped if data exists — still call for freshness of few symbols is slow;
    # pipeline assumes data present; user can run update-data separately. We only update if empty.
    from ..data.loader import list_available_codes

    if len(list_available_codes()) < 5:
        upd = update_daily(progress=lambda m, p: progress(f"update:{m}", p * 0.3) if progress else None)
    else:
        upd = {"skipped": True, "reason": "local data present"}

    if progress:
        progress("wfo", 35)
    wfo = run_wfo_job(progress=lambda m, p: progress(f"wfo:{m}", 35 + p * 0.35) if progress else None)

    cfg = load_config()
    params = _bt_params(cfg)
    # BT top candidates
    if progress:
        progress("bt", 75)
    close, dates, codes, fields = _load_market(cfg)
    regime = _regime(cfg, close, codes)
    bt_top = []
    for c in (wfo.get("vec_top") or [])[: int(cfg.get("wfo", {}).get("top_n_bt", 5))]:
        fmap = compute_all_factors(
            c["factors"],
            close,
            fields["high"],
            fields["low"],
            fields["vol"],
            cfg.get("factor_signs", {}),
            dates=dates,
            codes=codes,
        )
        scores = combine_scores(fmap, c["factors"])
        met = run_event_backtest(
            close,
            fields["open"],
            scores,
            dates,
            codes,
            regime_exposure=regime,
            **{k: params[k] for k in ("freq", "pos_size", "lookback", "commission", "delta_rank", "min_hold_days", "initial_capital")},
        )
        bt_top.append(
            {
                "factors": c["factors"],
                "total_return": met["total_return"],
                "sharpe": met["sharpe"],
                "max_drawdown": met["max_drawdown"],
                "trades": met["trades"],
            }
        )

    if progress:
        progress("signal", 92)
    sig = run_signal_job(progress=None)

    if progress:
        progress("done", 100)
    return {"update": upd, "wfo": wfo, "bt_top": bt_top, "signal": sig}


def run_signal_job(progress: ProgressCb | None = None) -> dict[str, Any]:
    cfg = load_config()
    if progress:
        progress("load", 10)
    close, dates, codes, fields = _load_market(cfg)
    params = _bt_params(cfg)
    state = load_state()
    state["version"] = "v2"
    state["freq"] = params["freq"]
    state["universe_mode"] = cfg.get("universe", {}).get("mode", "A_SHARE_ONLY")
    sealed = sealed_strategies()
    outputs: list[dict[str, Any]] = []
    for i, s in enumerate(sealed):
        if progress:
            progress(f"signal {s['id']}", 20 + 70 * (i / max(len(sealed), 1)))
        names = list(s["factors"])
        fmap = compute_all_factors(
            names,
            close,
            fields["high"],
            fields["low"],
            fields["vol"],
            cfg.get("factor_signs", {}),
            dates=dates,
            codes=codes,
        )
        usable = [name for name in names if name in fmap]
        scores = combine_scores(fmap, usable)
        last = scores[-1]
        out = generate_signal_for_strategy(
            s["id"],
            last,
            codes,
            dates,
            pos_size=params["pos_size"],
            delta_rank=params["delta_rank"],
            min_hold_days=params["min_hold_days"],
            freq=params["freq"],
            universe_mode=state["universe_mode"],
            state=state,
            strategy_name=s.get("name", s["id"]),
            factors=usable,
        )
        outputs.append(out)
    active_strategy_ids = {s["id"] for s in sealed}
    state["strategies"] = {
        sid: strategy_state
        for sid, strategy_state in state.get("strategies", {}).items()
        if sid in active_strategy_ids
    }
    save_state(state)
    if progress:
        progress("done", 100)
    return {"asof": dates[-1] if dates else None, "strategies": outputs}
