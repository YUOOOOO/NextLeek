from __future__ import annotations

from typing import Any

import numpy as np

from .hysteresis import apply_hysteresis, stable_topk_indices
from .rebalance import generate_rebalance_schedule


def _metrics(equity: np.ndarray, dates: list[str], trades: int) -> dict[str, Any]:
    if len(equity) < 2:
        return {
            "total_return": 0.0,
            "sharpe": 0.0,
            "max_drawdown": 0.0,
            "trades": trades,
            "days": len(equity),
        }
    rets = equity[1:] / equity[:-1] - 1.0
    rets = rets[np.isfinite(rets)]
    total = float(equity[-1] / equity[0] - 1.0)
    vol = float(np.std(rets)) if len(rets) else 0.0
    mu = float(np.mean(rets)) if len(rets) else 0.0
    sharpe = (mu / vol * np.sqrt(252)) if vol > 1e-12 else 0.0
    peak = np.maximum.accumulate(equity)
    dd = equity / peak - 1.0
    mdd = float(np.min(dd)) if len(dd) else 0.0
    return {
        "total_return": round(total, 6),
        "sharpe": round(float(sharpe), 4),
        "max_drawdown": round(mdd, 6),
        "trades": int(trades),
        "days": int(len(equity)),
        "start": dates[0] if dates else None,
        "end": dates[-1] if dates else None,
    }


def run_vectorized_backtest(
    close: np.ndarray,
    open_: np.ndarray,
    scores: np.ndarray,
    dates: list[str],
    codes: list[str],
    *,
    freq: int = 5,
    pos_size: int = 2,
    lookback: int = 252,
    commission: float = 0.0002,
    delta_rank: float = 0.10,
    min_hold_days: int = 9,
    regime_exposure: np.ndarray | None = None,
    initial_capital: float = 1_000_000.0,
) -> dict[str, Any]:
    """
    VEC-style: float shares, signal on rebalance day t uses scores[t],
    fill at next open (T+1 open). Holdings earn close-to-close between.
    """
    t, n = close.shape
    schedule = set(generate_rebalance_schedule(t, lookback, freq).tolist())
    if regime_exposure is None:
        regime_exposure = np.ones(t, dtype=np.float64)

    equity = np.full(t, np.nan, dtype=np.float64)
    cash = initial_capital
    shares = np.zeros(n, dtype=np.float64)
    holdings = np.zeros(n, dtype=bool)
    hold_days = np.zeros(n, dtype=np.int64)
    trades = 0
    equity_curve = []
    weight_hist = []

    # mark start
    equity[0] = initial_capital

    pending_target: np.ndarray | None = None

    for i in range(t):
        # execute pending from previous signal at today's open
        if pending_target is not None and i > 0:
            px = open_[i]
            # liquidate
            for j in range(n):
                if shares[j] != 0 and np.isfinite(px[j]):
                    cash += shares[j] * px[j] * (1 - commission)
                    if shares[j] != 0:
                        trades += 1
                    shares[j] = 0.0
            holdings[:] = False
            # allocate
            tgt = pending_target
            active = np.where(tgt & np.isfinite(px) & (px > 0))[0]
            exp = float(regime_exposure[i]) if np.isfinite(regime_exposure[i]) else 1.0
            exp = min(max(exp, 0.0), 1.0)
            if len(active) > 0 and cash > 0:
                w = exp / len(active)
                for j in active:
                    notional = cash * w
                    sh = notional / px[j]
                    cost = sh * px[j] * (1 + commission)
                    if cost > cash:
                        sh = cash / (px[j] * (1 + commission))
                        cost = sh * px[j] * (1 + commission)
                    cash -= cost
                    shares[j] = sh
                    holdings[j] = sh > 0
                    trades += 1
            hold_days[:] = 0
            hold_days[holdings] = 1
            pending_target = None
        else:
            hold_days[holdings] = hold_days[holdings] + 1

        # mark to close
        mtm = cash
        for j in range(n):
            if shares[j] != 0 and np.isfinite(close[i, j]):
                mtm += shares[j] * close[i, j]
        equity[i] = mtm
        equity_curve.append({"date": dates[i], "equity": float(mtm)})

        if i in schedule:
            sc = scores[i]
            top = stable_topk_indices(sc, pos_size)
            target = apply_hysteresis(
                sc,
                holdings.copy(),
                hold_days.copy(),
                top,
                pos_size,
                delta_rank,
                min_hold_days,
            )
            pending_target = target
            held_codes = [codes[j] for j in range(n) if target[j]]
            weight_hist.append({"date": dates[i], "targets": held_codes})

    # fill leading nan
    if np.isnan(equity[0]):
        equity[0] = initial_capital
    for i in range(1, t):
        if np.isnan(equity[i]):
            equity[i] = equity[i - 1]

    met = _metrics(equity, dates, trades)
    met["equity_curve"] = equity_curve[:: max(1, len(equity_curve) // 500)]  # downsample
    met["rebalances"] = weight_hist[-50:]
    met["engine"] = "vec"
    return met


def run_event_backtest(
    close: np.ndarray,
    open_: np.ndarray,
    scores: np.ndarray,
    dates: list[str],
    codes: list[str],
    **kwargs: Any,
) -> dict[str, Any]:
    """
    BT ground-truth-ish: integer lots (100 shares), same schedule/hysteresis.
    """
    t, n = close.shape
    freq = int(kwargs.get("freq", 5))
    pos_size = int(kwargs.get("pos_size", 2))
    lookback = int(kwargs.get("lookback", 252))
    commission = float(kwargs.get("commission", 0.0002))
    delta_rank = float(kwargs.get("delta_rank", 0.10))
    min_hold_days = int(kwargs.get("min_hold_days", 9))
    regime_exposure = kwargs.get("regime_exposure")
    initial_capital = float(kwargs.get("initial_capital", 1_000_000.0))
    lot = 100

    if regime_exposure is None:
        regime_exposure = np.ones(t, dtype=np.float64)

    schedule = set(generate_rebalance_schedule(t, lookback, freq).tolist())
    cash = initial_capital
    lots = np.zeros(n, dtype=np.int64)
    holdings = np.zeros(n, dtype=bool)
    hold_days = np.zeros(n, dtype=np.int64)
    trades = 0
    equity = np.zeros(t, dtype=np.float64)
    equity_curve = []
    pending: np.ndarray | None = None

    for i in range(t):
        if pending is not None and i > 0:
            px = open_[i]
            # sell all
            for j in range(n):
                if lots[j] > 0 and np.isfinite(px[j]) and px[j] > 0:
                    cash += lots[j] * lot * px[j] * (1 - commission)
                    trades += 1
                    lots[j] = 0
            holdings[:] = False
            active = [j for j in range(n) if pending[j] and np.isfinite(px[j]) and px[j] > 0]
            exp = float(regime_exposure[i]) if np.isfinite(regime_exposure[i]) else 1.0
            exp = min(max(exp, 0.0), 1.0)
            if active and cash > 0:
                budget = cash * exp
                per = budget / len(active)
                for j in active:
                    affordable = int(per // (px[j] * lot * (1 + commission)))
                    if affordable <= 0:
                        continue
                    cost = affordable * lot * px[j] * (1 + commission)
                    if cost > cash:
                        continue
                    cash -= cost
                    lots[j] = affordable
                    holdings[j] = True
                    trades += 1
            hold_days[:] = 0
            hold_days[holdings] = 1
            pending = None
        else:
            hold_days[holdings] = hold_days[holdings] + 1

        mtm = cash + float(np.nansum(lots * lot * close[i]))
        equity[i] = mtm
        equity_curve.append({"date": dates[i], "equity": float(mtm)})

        if i in schedule:
            sc = scores[i]
            top = stable_topk_indices(sc, pos_size)
            pending = apply_hysteresis(
                sc,
                holdings.copy(),
                hold_days.copy(),
                top,
                pos_size,
                delta_rank,
                min_hold_days,
            )

    met = _metrics(equity, dates, trades)
    met["equity_curve"] = equity_curve[:: max(1, len(equity_curve) // 500)]
    met["engine"] = "bt"
    return met
