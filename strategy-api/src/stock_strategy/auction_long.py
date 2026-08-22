"""Transparent auction-long stock scoring.

The scorer is deliberately independent from any third-party site's hidden score.
It consumes one trading day's auction cross-section and optional prior-day returns,
then returns explainable component scores and a deterministic top-N ranking.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class AuctionScoreWeights:
    auction_strength: float = 0.45
    auction_amount: float = 0.20
    volume_ratio: float = 0.15
    turnover: float = 0.10
    momentum: float = 0.10

    def as_dict(self) -> dict[str, float]:
        return {
            "auction_strength": self.auction_strength,
            "auction_amount": self.auction_amount,
            "volume_ratio": self.volume_ratio,
            "turnover": self.turnover,
            "momentum": self.momentum,
        }

    def validate(self) -> None:
        values = self.as_dict()
        if any(value < 0 for value in values.values()):
            raise ValueError("score weights must be non-negative")
        if not np.isclose(sum(values.values()), 1.0):
            raise ValueError("score weights must sum to 1")


def _numeric(frame: pd.DataFrame, columns: Iterable[str]) -> pd.DataFrame:
    out = frame.copy()
    for column in columns:
        if column in out:
            out[column] = pd.to_numeric(out[column], errors="coerce")
    return out


def _percentile(series: pd.Series) -> pd.Series:
    """Cross-sectional percentile in [0, 1], with ties receiving midranks."""
    return series.rank(method="average", pct=True).fillna(0.0)


def score_auction_long(
    auction: pd.DataFrame,
    *,
    prior_returns: pd.DataFrame | None = None,
    top_n: int = 6,
    weights: AuctionScoreWeights | None = None,
) -> pd.DataFrame:
    """Score one trading day's stock auction cross-section.

    Required auction columns: ``ts_code``, ``price``, ``pre_close``, ``amount``.
    Optional columns: ``volume_ratio``, ``turnover_rate``.
    ``prior_returns`` may contain ``ts_code`` and ``prior_return`` (decimal or %
    values are accepted; values above 1 are interpreted as percentages).

    Invalid/empty auctions are excluded. The result is sorted by score descending
    and includes only ``top_n`` rows marked ``selected=True``; callers can inspect
    the full scored universe by passing ``top_n=None``.
    """
    if top_n is not None and top_n < 1:
        raise ValueError("top_n must be positive or None")
    required = {"ts_code", "price", "pre_close", "amount"}
    missing = required - set(auction.columns)
    if missing:
        raise ValueError(f"auction data missing columns: {sorted(missing)}")

    weights = weights or AuctionScoreWeights()
    weights.validate()
    frame = _numeric(
        auction,
        ["price", "pre_close", "amount", "volume_ratio", "turnover_rate"],
    )
    frame = frame.loc[
        frame["price"].gt(0)
        & frame["pre_close"].gt(0)
        & frame["amount"].ge(0)
    ].copy()
    if frame.empty:
        return pd.DataFrame()

    frame["auction_pct"] = frame["price"] / frame["pre_close"] - 1.0
    frame["auction_strength_score"] = _percentile(frame["auction_pct"])
    frame["auction_amount_score"] = _percentile(np.log1p(frame["amount"]))
    frame["volume_ratio_score"] = _percentile(frame.get("volume_ratio", pd.Series(index=frame.index)))
    frame["turnover_score"] = _percentile(frame.get("turnover_rate", pd.Series(index=frame.index)))

    frame["momentum"] = 0.0
    if prior_returns is not None and not prior_returns.empty:
        prior = prior_returns[["ts_code", "prior_return"]].copy()
        prior["prior_return"] = pd.to_numeric(prior["prior_return"], errors="coerce")
        prior.loc[prior["prior_return"].abs().gt(1), "prior_return"] /= 100.0
        frame = frame.merge(prior, on="ts_code", how="left", suffixes=("", "_input"))
        frame["momentum"] = frame["prior_return"].fillna(0.0)
    frame["momentum_score"] = _percentile(frame["momentum"])

    frame["total_score"] = (
        weights.auction_strength * frame["auction_strength_score"]
        + weights.auction_amount * frame["auction_amount_score"]
        + weights.volume_ratio * frame["volume_ratio_score"]
        + weights.turnover * frame["turnover_score"]
        + weights.momentum * frame["momentum_score"]
    ) * 100.0
    frame = frame.sort_values(["total_score", "auction_pct", "ts_code"], ascending=[False, False, True])
    frame["rank"] = np.arange(1, len(frame) + 1)
    frame["selected"] = frame["rank"].le(top_n) if top_n is not None else True
    return frame.reset_index(drop=True)
