from __future__ import annotations

import numpy as np

from .rebalance import shift_timing_signal


def vol_regime_exposure(
    close_proxy: np.ndarray,
    window: int = 20,
    thresholds_pct: list[float] | None = None,
    exposures: list[float] | None = None,
    shift_days: int = 1,
) -> np.ndarray:
    """
    close_proxy: (T,) series e.g. 510300.
    Returns exposure in (0,1] per day, lagged by shift_days.
    """
    thresholds_pct = thresholds_pct or [25, 30, 40]
    exposures = exposures or [1.0, 0.7, 0.4, 0.1]
    t = len(close_proxy)
    ret = np.full(t, np.nan)
    ret[1:] = close_proxy[1:] / close_proxy[:-1] - 1.0
    vol = np.full(t, np.nan)
    for i in range(window, t):
        seg = ret[i - window + 1 : i + 1]
        vol[i] = np.nanstd(seg) * np.sqrt(252) * 100.0

    # percentile of current vol vs expanding history
    pct = np.full(t, np.nan)
    for i in range(window, t):
        hist = vol[window : i + 1]
        hist = hist[np.isfinite(hist)]
        if len(hist) < 5 or not np.isfinite(vol[i]):
            continue
        pct[i] = float(np.mean(hist <= vol[i]) * 100.0)

    exp = np.ones(t, dtype=np.float64)
    for i in range(t):
        p = pct[i]
        if not np.isfinite(p):
            exp[i] = 1.0
            continue
        # map percentile to exposure buckets
        if p < thresholds_pct[0]:
            exp[i] = exposures[0]
        elif p < thresholds_pct[1]:
            exp[i] = exposures[1]
        elif p < thresholds_pct[2]:
            exp[i] = exposures[2]
        else:
            exp[i] = exposures[3]

    return shift_timing_signal(exp, lag=shift_days)
