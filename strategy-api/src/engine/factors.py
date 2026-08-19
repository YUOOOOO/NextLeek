from __future__ import annotations

import numpy as np


def _roll_mean(x: np.ndarray, w: int) -> np.ndarray:
    t, n = x.shape
    out = np.full_like(x, np.nan, dtype=np.float64)
    if w <= 1:
        return x.astype(np.float64)
    csum = np.nancumsum(np.where(np.isfinite(x), x, 0.0), axis=0)
    ccnt = np.cumsum(np.isfinite(x).astype(np.float64), axis=0)
    for i in range(w - 1, t):
        s = csum[i] - (csum[i - w] if i >= w else 0)
        c = ccnt[i] - (ccnt[i - w] if i >= w else 0)
        with np.errstate(invalid="ignore", divide="ignore"):
            out[i] = np.where(c > 0, s / c, np.nan)
    return out


def _roll_std(x: np.ndarray, w: int) -> np.ndarray:
    mean = _roll_mean(x, w)
    mean2 = _roll_mean(x * x, w)
    var = mean2 - mean * mean
    return np.sqrt(np.maximum(var, 0.0))


def _pct_change(close: np.ndarray, periods: int) -> np.ndarray:
    out = np.full_like(close, np.nan, dtype=np.float64)
    out[periods:] = close[periods:] / close[:-periods] - 1.0
    return out


def _rolling_max(x: np.ndarray, w: int) -> np.ndarray:
    t, n = x.shape
    out = np.full_like(x, np.nan)
    for i in range(w - 1, t):
        out[i] = np.nanmax(x[i - w + 1 : i + 1], axis=0)
    return out


def _rolling_min(x: np.ndarray, w: int) -> np.ndarray:
    t, n = x.shape
    out = np.full_like(x, np.nan)
    for i in range(w - 1, t):
        out[i] = np.nanmin(x[i - w + 1 : i + 1], axis=0)
    return out


def _max_drawdown_window(close: np.ndarray, w: int) -> np.ndarray:
    t, n = close.shape
    out = np.full_like(close, np.nan)
    for i in range(w - 1, t):
        window = close[i - w + 1 : i + 1]
        peak = np.maximum.accumulate(window, axis=0)
        dd = window / peak - 1.0
        out[i] = np.nanmin(dd, axis=0)
    return out


def _slope(close: np.ndarray, w: int) -> np.ndarray:
    """Linear regression slope of log price over w bars, annualized-ish."""
    t, n = close.shape
    out = np.full_like(close, np.nan)
    x = np.arange(w, dtype=np.float64)
    x = x - x.mean()
    denom = (x * x).sum()
    for i in range(w - 1, t):
        y = np.log(np.clip(close[i - w + 1 : i + 1], 1e-12, None))
        y = y - np.nanmean(y, axis=0, keepdims=True)
        # handle nan columns
        cov = np.nansum(x[:, None] * y, axis=0)
        out[i] = cov / denom
    return out


FACTOR_FUNCS = {}


def compute_factor(name: str, close: np.ndarray, high: np.ndarray, low: np.ndarray, vol: np.ndarray) -> np.ndarray:
    ret1 = _pct_change(close, 1)

    if name == "MOM_20D":
        return _pct_change(close, 20)
    if name == "MOM_60D":
        return _pct_change(close, 60)
    if name == "SHARPE_RATIO_20D":
        mu = _roll_mean(ret1, 20)
        sd = _roll_std(ret1, 20)
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(sd > 1e-12, mu / sd * np.sqrt(252), np.nan)
    if name == "VOL_20D":
        return _roll_std(ret1, 20) * np.sqrt(252)
    if name == "MAX_DD_60D":
        return _max_drawdown_window(close, 60)
    if name == "PRICE_POSITION_20D":
        hi = _rolling_max(close, 20)
        lo = _rolling_min(close, 20)
        with np.errstate(divide="ignore", invalid="ignore"):
            return (close - lo) / (hi - lo)
    if name == "PRICE_POSITION_120D":
        hi = _rolling_max(close, 120)
        lo = _rolling_min(close, 120)
        with np.errstate(divide="ignore", invalid="ignore"):
            return (close - lo) / (hi - lo)
    if name == "BREAKOUT_20D":
        hi = _rolling_max(close, 20)
        prev_hi = np.roll(hi, 1, axis=0)
        prev_hi[0] = np.nan
        return close / prev_hi - 1.0
    if name == "SLOPE_20D":
        return _slope(close, 20)
    if name == "CALMAR_RATIO_60D":
        mom = _pct_change(close, 60)
        dd = np.abs(_max_drawdown_window(close, 60))
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(dd > 1e-12, mom / dd, np.nan)
    raise KeyError(f"unknown factor: {name}")


def compute_all_factors(
    names: list[str],
    close: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    vol: np.ndarray,
    signs: dict[str, int] | None = None,
) -> dict[str, np.ndarray]:
    signs = signs or {}
    out: dict[str, np.ndarray] = {}
    for name in names:
        arr = compute_factor(name, close, high, low, vol)
        sign = int(signs.get(name, 1))
        out[name] = arr * sign
    return out


def combine_scores(factor_map: dict[str, np.ndarray], names: list[str]) -> np.ndarray:
    """Equal-weight z-score cross-section per day then average."""
    mats = [factor_map[n] for n in names if n in factor_map]
    if not mats:
        raise ValueError("no factors")
    t, n = mats[0].shape
    acc = np.zeros((t, n), dtype=np.float64)
    cnt = np.zeros((t, n), dtype=np.float64)
    for m in mats:
        # cross-sectional zscore
        mu = np.nanmean(m, axis=1, keepdims=True)
        sd = np.nanstd(m, axis=1, keepdims=True)
        sd = np.where(sd < 1e-12, np.nan, sd)
        z = (m - mu) / sd
        valid = np.isfinite(z)
        acc = np.where(valid, acc + z, acc)
        cnt = np.where(valid, cnt + 1.0, cnt)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(cnt > 0, acc / cnt, np.nan)
    return out
