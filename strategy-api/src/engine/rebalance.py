from __future__ import annotations

import numpy as np


def generate_rebalance_schedule(total_periods: int, lookback_window: int, freq: int) -> np.ndarray:
    """Trading-day indices when rebalance is allowed (after lookback warmup)."""
    if total_periods <= lookback_window:
        return np.array([], dtype=np.int64)
    start = lookback_window
    idxs = list(range(start, total_periods, max(freq, 1)))
    return np.array(idxs, dtype=np.int64)


def shift_timing_signal(signal: np.ndarray, lag: int = 1) -> np.ndarray:
    """Lag signal by `lag` bars to avoid lookahead (row 0..lag-1 → nan/1)."""
    out = np.full_like(signal, np.nan, dtype=np.float64)
    if lag <= 0:
        return signal.astype(np.float64)
    out[lag:] = signal[:-lag]
    # default full exposure before lag known
    out[:lag] = 1.0
    return out
