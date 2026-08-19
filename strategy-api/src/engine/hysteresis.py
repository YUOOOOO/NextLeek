"""Exp4 hysteresis — pure numpy (same rules as zhangsensen @njit kernel)."""

from __future__ import annotations

import numpy as np


def stable_topk_indices(scores: np.ndarray, k: int) -> np.ndarray:
    """Best-first indices; NaN/-inf last. Stable on ties via original index."""
    n = len(scores)
    k = min(k, n)
    safe = np.where(np.isfinite(scores), scores, -np.inf)
    # lexsort: primary key last
    order = np.lexsort((np.arange(n), -safe))
    return order[:k].astype(np.int64)


def apply_hysteresis(
    combined_score: np.ndarray,
    holdings_mask: np.ndarray,
    hold_days: np.ndarray,
    top_indices: np.ndarray,
    pos_size: int,
    delta_rank: float,
    min_hold_days_val: int,
) -> np.ndarray:
    n = len(combined_score)
    top_count = len(top_indices)
    target_mask = np.zeros(n, dtype=bool)

    if delta_rank <= 0.0 and min_hold_days_val <= 0:
        for i in range(top_count):
            target_mask[int(top_indices[i])] = True
        return target_mask

    held_count = int(holdings_mask.sum())

    if held_count < pos_size:
        for i in range(n):
            if holdings_mask[i]:
                target_mask[i] = True
        for i in range(top_count):
            idx = int(top_indices[i])
            if target_mask.sum() >= pos_size:
                break
            target_mask[idx] = True
        return target_mask

    safe_score = np.where(np.isfinite(combined_score), combined_score, -np.inf)
    order = np.argsort(safe_score)  # ascending worst first
    denom = float(n - 1) if n > 1 else 1.0
    rank01 = np.zeros(n, dtype=np.float64)
    for j in range(n):
        rank01[order[j]] = float(j) / denom

    target_mask = holdings_mask.copy()

    worst_idx = -1
    worst_rank = 2.0
    for i in range(n):
        if holdings_mask[i] and rank01[i] < worst_rank:
            worst_rank = rank01[i]
            worst_idx = i

    best_new_idx = -1
    for i in range(top_count):
        idx = int(top_indices[i])
        if not holdings_mask[idx]:
            best_new_idx = idx
            break

    if worst_idx >= 0 and best_new_idx >= 0:
        rank_gap = rank01[best_new_idx] - rank01[worst_idx]
        rank_ok = rank_gap >= delta_rank
        days_ok = hold_days[worst_idx] >= min_hold_days_val
        if rank_ok and days_ok:
            target_mask[worst_idx] = False
            target_mask[best_new_idx] = True

    return target_mask
