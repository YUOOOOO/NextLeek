from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from ..paths import RAW_FUND_SHARE_DIR, RAW_MARGIN_DIR


DEFAULT_NEGATIVE_FACTORS = {
    "SHARE_CHG_5D",
    "SHARE_CHG_10D",
    "SHARE_CHG_20D",
    "MARGIN_CHG_10D",
    "MARGIN_BUY_RATIO",
    "VOL_20D",
    "MAX_DD_60D",
}


def _ymd(value: object) -> str:
    text = str(value).replace("-", "")
    return text[:8]


def load_fund_share_panel(dates: list[str], codes: list[str]) -> np.ndarray | None:
    """Return (T, N) fd_share panel aligned to dates/codes, or None if empty."""
    if not RAW_FUND_SHARE_DIR.exists():
        return None
    series: dict[str, pd.Series] = {}
    for code in codes:
        path = RAW_FUND_SHARE_DIR / f"fund_share_{code}.parquet"
        if not path.exists():
            continue
        df = pd.read_parquet(path)
        if "trade_date" not in df.columns or "fd_share" not in df.columns:
            continue
        idx = pd.to_datetime(df["trade_date"].map(_ymd), format="%Y%m%d", errors="coerce")
        s = pd.Series(pd.to_numeric(df["fd_share"], errors="coerce").to_numpy(), index=idx)
        s = s[~s.index.isna()].sort_index()
        s = s[~s.index.duplicated(keep="last")]
        series[code] = s
    if not series:
        return None
    frame = pd.DataFrame(series)
    cal = pd.to_datetime(dates, format="%Y%m%d")
    frame = frame.reindex(cal).ffill()
    out = np.full((len(dates), len(codes)), np.nan, dtype=np.float64)
    for j, code in enumerate(codes):
        if code in frame.columns:
            out[:, j] = frame[code].to_numpy(dtype=np.float64)
    return out


def load_margin_field_panel(
    field: str,
    dates: list[str],
    codes: list[str],
) -> np.ndarray | None:
    """Load one margin field as (T, N) panel from consolidated parquet."""
    path = RAW_MARGIN_DIR / "margin_pool43_2020_now.parquet"
    if not path.exists():
        return None
    df = pd.read_parquet(path)
    needed = {"trade_date", "ts_code", field}
    if not needed.issubset(df.columns):
        return None
    df = df.copy()
    df["trade_date"] = df["trade_date"].map(_ymd)
    df["code"] = df["ts_code"].astype(str).str.split(".").str[0]
    df[field] = pd.to_numeric(df[field], errors="coerce")
    pivot = df.pivot_table(index="trade_date", columns="code", values=field, aggfunc="last")
    pivot = pivot.reindex(dates).ffill()
    out = np.full((len(dates), len(codes)), np.nan, dtype=np.float64)
    for j, code in enumerate(codes):
        if code in pivot.columns:
            out[:, j] = pivot[code].to_numpy(dtype=np.float64)
    return out


def _pct_change(arr: np.ndarray, lag: int) -> np.ndarray:
    out = np.full_like(arr, np.nan, dtype=np.float64)
    if lag <= 0 or arr.shape[0] <= lag:
        return out
    prev = arr[:-lag]
    cur = arr[lag:]
    with np.errstate(divide="ignore", invalid="ignore"):
        chg = (cur - prev) / (np.abs(prev) + 1e-10)
    chg = np.where(np.abs(prev) > 1e-10, chg, np.nan)
    out[lag:] = chg
    return out


def compute_non_ohlcv_factor_map(
    names: list[str],
    dates: list[str],
    codes: list[str],
    close: np.ndarray,
    vol: np.ndarray,
    signs: dict[str, int] | None = None,
) -> dict[str, np.ndarray]:
    """Compute available non-OHLCV sealed factors as numpy panels."""
    wanted = set(names)
    out: dict[str, np.ndarray] = {}
    signs = signs or {}

    share_needed = wanted.intersection(
        {"SHARE_CHG_5D", "SHARE_CHG_10D", "SHARE_CHG_20D", "SHARE_ACCEL"}
    )
    share = load_fund_share_panel(dates, codes) if share_needed else None
    if share is not None:
        chg5 = _pct_change(share, 5)
        chg10 = _pct_change(share, 10)
        chg20 = _pct_change(share, 20)
        if "SHARE_CHG_5D" in wanted:
            out["SHARE_CHG_5D"] = chg5
        if "SHARE_CHG_10D" in wanted:
            out["SHARE_CHG_10D"] = chg10
        if "SHARE_CHG_20D" in wanted:
            out["SHARE_CHG_20D"] = chg20
        if "SHARE_ACCEL" in wanted:
            out["SHARE_ACCEL"] = chg5 - chg20

    margin_needed = wanted.intersection({"MARGIN_CHG_10D", "MARGIN_BUY_RATIO"})
    if margin_needed:
        rzye = load_margin_field_panel("rzye", dates, codes) if "MARGIN_CHG_10D" in wanted else None
        rzmre = (
            load_margin_field_panel("rzmre", dates, codes)
            if "MARGIN_BUY_RATIO" in wanted
            else None
        )
        if rzye is not None and "MARGIN_CHG_10D" in wanted:
            out["MARGIN_CHG_10D"] = _pct_change(rzye, 10)
        if rzmre is not None and "MARGIN_BUY_RATIO" in wanted:
            amount = close * vol
            with np.errstate(divide="ignore", invalid="ignore"):
                ratio = np.where(np.abs(amount) > 1e-10, rzmre / amount, np.nan)
            out["MARGIN_BUY_RATIO"] = ratio

    signed: dict[str, np.ndarray] = {}
    for name, arr in out.items():
        default = -1 if name in DEFAULT_NEGATIVE_FACTORS else 1
        sign = int(signs.get(name, default))
        signed[name] = arr * sign
    return signed


def available_non_ohlcv_dirs() -> dict[str, bool]:
    share_files = list(RAW_FUND_SHARE_DIR.glob("fund_share_*.parquet")) if RAW_FUND_SHARE_DIR.exists() else []
    margin_file = RAW_MARGIN_DIR / "margin_pool43_2020_now.parquet"
    return {
        "fund_share": bool(share_files),
        "margin": margin_file.exists(),
        "fund_share_files": len(share_files),
    }
