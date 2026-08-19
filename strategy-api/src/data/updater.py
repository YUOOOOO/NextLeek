from __future__ import annotations

import time
from datetime import date, datetime
from typing import Any, Callable

import pandas as pd

from ..config import all_symbols, load_config
from .. import net_patch as _net_patch  # noqa: F401 — side effect
from ..paths import RAW_DAILY_DIR, ensure_data_dirs
from .symbols import normalize_code, parquet_stem

ProgressCb = Callable[[str, float], None]


def _ak_call(fn, *args, retries: int = 3, **kwargs):
    last: Exception | None = None
    for i in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.8 * (i + 1))
    assert last is not None
    raise last


def _to_ak_date(s: str) -> str:
    return s.replace("-", "")


def _fetch_etf_hist(code: str, start: str, end: str) -> pd.DataFrame:
    import akshare as ak

    df = _ak_call(
        ak.fund_etf_hist_em,
        symbol=code,
        period="daily",
        start_date=_to_ak_date(start),
        end_date=_to_ak_date(end),
        adjust="qfq",
    )
    if df is None or df.empty:
        return pd.DataFrame()
    # columns: 日期 开盘 收盘 最高 最低 成交量 成交额 振幅 涨跌幅 涨跌额 换手率
    out = pd.DataFrame(
        {
            "trade_date": pd.to_datetime(df["日期"]).dt.strftime("%Y%m%d"),
            "adj_open": pd.to_numeric(df["开盘"], errors="coerce"),
            "adj_high": pd.to_numeric(df["最高"], errors="coerce"),
            "adj_low": pd.to_numeric(df["最低"], errors="coerce"),
            "adj_close": pd.to_numeric(df["收盘"], errors="coerce"),
            "vol": pd.to_numeric(df["成交量"], errors="coerce").fillna(0),
            "amount": pd.to_numeric(df.get("成交额", 0), errors="coerce").fillna(0),
        }
    )
    return out.dropna(subset=["adj_close"]).reset_index(drop=True)


def update_daily(
    symbols: list[str] | None = None,
    start: str | None = None,
    end: str | None = None,
    progress: ProgressCb | None = None,
) -> dict[str, Any]:
    ensure_data_dirs()
    cfg = load_config()
    symbols = [normalize_code(s) for s in (symbols or all_symbols(cfg))]
    start = start or cfg["data"].get("start_date") or "2020-01-01"
    end = end or cfg["data"].get("end_date") or date.today().isoformat()
    if not end:
        end = date.today().isoformat()

    ok: list[str] = []
    failed: list[dict[str, str]] = []
    n = len(symbols)
    for i, code in enumerate(symbols):
        if progress:
            progress(f"fetch {code}", (i / max(n, 1)) * 100)
        try:
            df = _fetch_etf_hist(code, start, end)
            if df.empty:
                failed.append({"code": code, "error": "empty"})
                continue
            path = RAW_DAILY_DIR / f"{parquet_stem(code)}.parquet"
            df.to_parquet(path, index=False)
            ok.append(code)
        except Exception as exc:  # noqa: BLE001
            failed.append({"code": code, "error": str(exc)})
        time.sleep(0.15)

    if progress:
        progress("done", 100.0)
    return {
        "ok_count": len(ok),
        "fail_count": len(failed),
        "ok": ok,
        "failed": failed,
        "start": start,
        "end": end,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
