from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from ..paths import RAW_DAILY_DIR
from .symbols import normalize_code, parquet_stem

REQUIRED = ("trade_date", "adj_open", "adj_high", "adj_low", "adj_close")


def _read_one(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"{path.name} missing columns: {missing}")
    if "vol" not in df.columns and "volume" in df.columns:
        df = df.rename(columns={"volume": "vol"})
    if "vol" not in df.columns:
        df["vol"] = 0.0
    df = df.copy()
    df["trade_date"] = df["trade_date"].astype(str).str.replace("-", "", regex=False)
    df = df.sort_values("trade_date").drop_duplicates("trade_date", keep="last")
    return df.reset_index(drop=True)


def list_available_codes() -> list[str]:
    codes: list[str] = []
    for p in sorted(RAW_DAILY_DIR.glob("*_daily*.parquet")):
        # 510300.SH_daily.parquet or 510300.SH_daily_xxx.parquet
        name = p.name
        code = name.split(".")[0]
        codes.append(normalize_code(code))
    return sorted(set(codes))


def load_symbol_frame(code: str) -> pd.DataFrame | None:
    stem = parquet_stem(code)
    matches = list(RAW_DAILY_DIR.glob(f"{stem}*.parquet"))
    if not matches:
        # fallback any file starting with code
        c = normalize_code(code)
        matches = list(RAW_DAILY_DIR.glob(f"{c}.*_daily*.parquet"))
    if not matches:
        return None
    # prefer longest / latest mtime
    path = max(matches, key=lambda p: p.stat().st_mtime)
    return _read_one(path)


def load_panel(
    symbols: Iterable[str],
    start: str | None = None,
    end: str | None = None,
) -> dict[str, pd.DataFrame]:
    """Load {code: df} filtered by YYYY-MM-DD or YYYYMMDD bounds."""
    out: dict[str, pd.DataFrame] = {}
    start_k = (start or "").replace("-", "")
    end_k = (end or "").replace("-", "")
    for raw in symbols:
        code = normalize_code(raw)
        df = load_symbol_frame(code)
        if df is None or df.empty:
            continue
        if start_k:
            df = df[df["trade_date"] >= start_k]
        if end_k:
            df = df[df["trade_date"] <= end_k]
        if not df.empty:
            out[code] = df.reset_index(drop=True)
    return out


def panel_to_close_matrix(
    panel: dict[str, pd.DataFrame],
) -> tuple[np.ndarray, list[str], list[str], dict[str, np.ndarray]]:
    """
    Align all symbols on union of dates (inner join on common dates with enough coverage).
    Returns close (T,N), dates, codes, fields dict open/high/low/vol same shape.
    """
    if not panel:
        raise ValueError("empty panel")

    # Use intersection of dates so matrix is dense
    date_sets = [set(df["trade_date"].tolist()) for df in panel.values()]
    common = sorted(set.intersection(*date_sets)) if date_sets else []
    if len(common) < 30:
        # fallback: outer join then ffill limited — prefer codes with most overlap
        all_dates = sorted(set().union(*date_sets))
        common = all_dates

    codes = sorted(panel.keys())
    T, N = len(common), len(codes)
    close = np.full((T, N), np.nan, dtype=np.float64)
    open_ = np.full((T, N), np.nan, dtype=np.float64)
    high = np.full((T, N), np.nan, dtype=np.float64)
    low = np.full((T, N), np.nan, dtype=np.float64)
    vol = np.full((T, N), np.nan, dtype=np.float64)

    idx = {d: i for i, d in enumerate(common)}
    for j, code in enumerate(codes):
        df = panel[code]
        for row in df.itertuples(index=False):
            d = str(row.trade_date)
            i = idx.get(d)
            if i is None:
                continue
            close[i, j] = float(row.adj_close)
            open_[i, j] = float(row.adj_open)
            high[i, j] = float(row.adj_high)
            low[i, j] = float(row.adj_low)
            vol[i, j] = float(getattr(row, "vol", 0.0) or 0.0)

    # Drop leading rows that are all-nan
    valid_row = np.isfinite(close).any(axis=1)
    if not valid_row.any():
        raise ValueError("no valid close data")
    first = int(np.argmax(valid_row))
    close, open_, high, low, vol = (
        close[first:],
        open_[first:],
        high[first:],
        low[first:],
        vol[first:],
    )
    dates = common[first:]
    fields = {"open": open_, "high": high, "low": low, "vol": vol, "close": close}
    return close, dates, codes, fields
