from __future__ import annotations

import itertools
from typing import Any

import numpy as np

from .backtest import run_vectorized_backtest
from .factors import combine_scores, compute_all_factors


def _ic_series(scores: np.ndarray, forward_ret: np.ndarray) -> float:
    """Mean cross-sectional Spearman-ish via Pearson on ranks."""
    t, n = scores.shape
    ics = []
    for i in range(t):
        s = scores[i]
        r = forward_ret[i]
        m = np.isfinite(s) & np.isfinite(r)
        if m.sum() < 5:
            continue
        rs = s[m].argsort().argsort().astype(np.float64)
        rr = r[m].argsort().argsort().astype(np.float64)
        if rs.std() < 1e-12 or rr.std() < 1e-12:
            continue
        ics.append(float(np.corrcoef(rs, rr)[0, 1]))
    if not ics:
        return 0.0
    return float(np.nanmean(ics))


def run_wfo(
    close: np.ndarray,
    open_: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    vol: np.ndarray,
    dates: list[str],
    codes: list[str],
    factor_names: list[str],
    factor_signs: dict[str, int],
    *,
    combo_sizes: list[int],
    max_combos: int,
    train_ratio: float,
    ic_threshold: float,
    bt_params: dict[str, Any],
    regime_exposure: np.ndarray | None,
) -> dict[str, Any]:
    factors = compute_all_factors(factor_names, close, high, low, vol, factor_signs)
    # forward 5d return for IC
    fwd = np.full_like(close, np.nan)
    horizon = int(bt_params.get("freq", 5))
    fwd[:-horizon] = close[horizon:] / close[:-horizon] - 1.0

    combos: list[tuple[str, ...]] = []
    for k in combo_sizes:
        combos.extend(itertools.combinations(factor_names, k))
    if max_combos and len(combos) > max_combos:
        # deterministic sample
        step = max(1, len(combos) // max_combos)
        combos = combos[::step][:max_combos]

    t = close.shape[0]
    split = int(t * train_ratio)
    split = max(split, int(bt_params.get("lookback", 252)) + 30)
    split = min(split, t - 30)

    rows: list[dict[str, Any]] = []
    for combo in combos:
        names = list(combo)
        scores = combine_scores(factors, names)
        ic = _ic_series(scores[:split], fwd[:split])
        pos_rate = float(
            np.mean(
                [
                    1.0
                    for i in range(split)
                    if np.isfinite(scores[i]).sum() >= 5
                    and _day_ic(scores[i], fwd[i]) > 0
                ]
            )
        ) if split > 0 else 0.0

        if ic < ic_threshold and pos_rate < 0.55:
            continue

        # train vec metrics
        train_met = run_vectorized_backtest(
            close[:split],
            open_[:split],
            scores[:split],
            dates[:split],
            codes,
            regime_exposure=None if regime_exposure is None else regime_exposure[:split],
            **{k: bt_params[k] for k in ("freq", "pos_size", "lookback", "commission", "delta_rank", "min_hold_days", "initial_capital") if k in bt_params},
        )
        # strip heavy curve
        score = (
            bt_params.get("w_return", 0.4) * train_met["total_return"]
            + bt_params.get("w_sharpe", 0.3) * (train_met["sharpe"] / 3.0)
            + bt_params.get("w_maxdd", 0.3) * (1.0 + train_met["max_drawdown"])
        )
        rows.append(
            {
                "factors": names,
                "ic": round(ic, 4),
                "ic_pos_rate": round(pos_rate, 4),
                "train_return": train_met["total_return"],
                "train_sharpe": train_met["sharpe"],
                "train_maxdd": train_met["max_drawdown"],
                "score": round(float(score), 6),
            }
        )

    rows.sort(key=lambda r: r["score"], reverse=True)
    return {
        "combo_count_tested": len(combos),
        "combo_count_passed": len(rows),
        "split_index": split,
        "split_date": dates[split] if split < len(dates) else None,
        "candidates": rows[:50],
    }


def _day_ic(s: np.ndarray, r: np.ndarray) -> float:
    m = np.isfinite(s) & np.isfinite(r)
    if m.sum() < 5:
        return 0.0
    rs = s[m].argsort().argsort().astype(np.float64)
    rr = r[m].argsort().argsort().astype(np.float64)
    if rs.std() < 1e-12 or rr.std() < 1e-12:
        return 0.0
    return float(np.corrcoef(rs, rr)[0, 1])
