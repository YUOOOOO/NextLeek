from __future__ import annotations

import time
from datetime import date, datetime
from typing import Any, Callable

import pandas as pd

from ..config import all_symbols, load_config
from ..paths import RAW_DAILY_DIR, RAW_FUND_SHARE_DIR, RAW_MARGIN_DIR, ensure_data_dirs
from .symbols import dotted, normalize_code, parquet_stem
from .tushare_client import TushareClient

ProgressCb = Callable[[str, float], None]


def _as_ymd(value: str | None, fallback: str) -> str:
    text = (value or fallback or date.today().isoformat()).replace("-", "")
    return text[:8]


def _fetch_etf_hist(
    code: str,
    start: str,
    end: str,
    client: TushareClient | None = None,
) -> pd.DataFrame:
    client = client or TushareClient()
    df = client.fund_daily(dotted(code), start, end)
    if df is None or df.empty:
        return pd.DataFrame()

    required = {"trade_date", "open", "high", "low", "close"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"Tushare fund_daily missing columns: {sorted(missing)}")

    vol = df["vol"] if "vol" in df.columns else pd.Series(0, index=df.index)
    amount = df["amount"] if "amount" in df.columns else pd.Series(0, index=df.index)
    out = pd.DataFrame(
        {
            "trade_date": df["trade_date"].astype(str),
            "adj_open": pd.to_numeric(df["open"], errors="coerce"),
            "adj_high": pd.to_numeric(df["high"], errors="coerce"),
            "adj_low": pd.to_numeric(df["low"], errors="coerce"),
            "adj_close": pd.to_numeric(df["close"], errors="coerce"),
            "vol": pd.to_numeric(vol, errors="coerce").fillna(0),
            "amount": pd.to_numeric(amount, errors="coerce").fillna(0),
        }
    )
    return (
        out.dropna(subset=["adj_open", "adj_high", "adj_low", "adj_close"])
        .sort_values("trade_date")
        .drop_duplicates("trade_date", keep="last")
        .reset_index(drop=True)
    )


def update_daily(
    symbols: list[str] | None = None,
    start: str | None = None,
    end: str | None = None,
    progress: ProgressCb | None = None,
) -> dict[str, Any]:
    ensure_data_dirs()
    cfg = load_config()
    client = TushareClient()
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
            df = _fetch_etf_hist(code, start, end, client=client)
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
    if failed and not ok:
        first = failed[0]
        raise RuntimeError(
            f"Tushare update failed for all {len(failed)} symbols; "
            f"first failure {first['code']}: {first['error']}"
        )
    return {
        "provider": client.provider,
        "ok_count": len(ok),
        "fail_count": len(failed),
        "ok": ok,
        "failed": failed,
        "start": start,
        "end": end,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }


def update_fund_share(
    symbols: list[str] | None = None,
    start: str | None = None,
    end: str | None = None,
    progress: ProgressCb | None = None,
    client: TushareClient | None = None,
) -> dict[str, Any]:
    """Incremental per-ETF fund_share parquet under raw/ETF/fund_share/."""
    ensure_data_dirs()
    cfg = load_config()
    client = client or TushareClient()
    symbols = [normalize_code(s) for s in (symbols or all_symbols(cfg))]
    start = _as_ymd(start, cfg["data"].get("start_date") or "2019-01-01")
    end = _as_ymd(end, cfg["data"].get("end_date") or date.today().isoformat())
    ok: list[str] = []
    failed: list[dict[str, str]] = []
    n = len(symbols)
    for i, code in enumerate(symbols):
        if progress:
            progress(f"fund_share {code}", (i / max(n, 1)) * 100)
        path = RAW_FUND_SHARE_DIR / f"fund_share_{code}.parquet"
        fetch_start = start
        old = None
        if path.exists():
            try:
                old = pd.read_parquet(path)
                if not old.empty and "trade_date" in old.columns:
                    last = str(pd.to_datetime(old["trade_date"]).max().strftime("%Y%m%d"))
                    if last >= end:
                        ok.append(code)
                        continue
                    fetch_start = str(int(last) + 1)
            except Exception:
                old = None
        try:
            df = client.fund_share(dotted(code), fetch_start, end)
            if df is None or df.empty:
                if old is not None and not old.empty:
                    ok.append(code)
                else:
                    failed.append({"code": code, "error": "empty"})
                continue
            keep = [
                c
                for c in ("ts_code", "trade_date", "fd_share", "fund_type", "market")
                if c in df.columns
            ]
            df = df[keep].copy()
            df["trade_date"] = pd.to_datetime(
                df["trade_date"].astype(str).str.replace("-", ""),
                format="%Y%m%d",
                errors="coerce",
            )
            df["fd_share"] = pd.to_numeric(df.get("fd_share"), errors="coerce")
            df = df.dropna(subset=["trade_date", "fd_share"])
            if old is not None and not old.empty:
                old = old.copy()
                old["trade_date"] = pd.to_datetime(old["trade_date"])
                df = pd.concat([old, df], ignore_index=True)
            df = df.drop_duplicates(subset=["trade_date"], keep="last").sort_values("trade_date")
            df.to_parquet(path, index=False)
            ok.append(code)
        except Exception as exc:  # noqa: BLE001
            failed.append({"code": code, "error": str(exc)})
        time.sleep(0.12)
    if progress:
        progress("fund_share done", 100.0)
    return {
        "ok_count": len(ok),
        "fail_count": len(failed),
        "ok": ok,
        "failed": failed,
        "start": start,
        "end": end,
    }


def update_margin(
    symbols: list[str] | None = None,
    start: str | None = None,
    end: str | None = None,
    progress: ProgressCb | None = None,
    client: TushareClient | None = None,
) -> dict[str, Any]:
    """Incremental consolidated margin parquet used by DataLoader.load_margin."""
    ensure_data_dirs()
    cfg = load_config()
    client = client or TushareClient()
    symbols = [normalize_code(s) for s in (symbols or all_symbols(cfg))]
    end = _as_ymd(end, cfg["data"].get("end_date") or date.today().isoformat())
    path = RAW_MARGIN_DIR / "margin_pool43_2020_now.parquet"
    old = None
    fetch_start = _as_ymd(start, cfg["data"].get("start_date") or "2020-01-01")
    if path.exists():
        try:
            old = pd.read_parquet(path)
            if not old.empty and "trade_date" in old.columns:
                last = str(old["trade_date"].astype(str).str.replace("-", "").max())[:8]
                if last >= end:
                    return {
                        "ok_count": 0,
                        "fail_count": 0,
                        "skipped": True,
                        "last": last,
                        "end": end,
                    }
                fetch_start = str(int(last) + 1)
        except Exception:
            old = None

    frames: list[pd.DataFrame] = []
    failed: list[dict[str, str]] = []
    n = len(symbols)
    for i, code in enumerate(symbols):
        if progress:
            progress(f"margin {code}", (i / max(n, 1)) * 100)
        try:
            df = client.margin_detail(dotted(code), fetch_start, end)
            if df is None or df.empty:
                continue
            frames.append(df)
        except Exception as exc:  # noqa: BLE001
            failed.append({"code": code, "error": str(exc)})
        time.sleep(0.12)

    if not frames:
        if old is not None and not old.empty:
            return {
                "ok_count": 0,
                "fail_count": len(failed),
                "failed": failed,
                "skipped": True,
                "reason": "no new rows",
            }
        raise RuntimeError(f"margin update returned no rows; failures={failed[:3]}")

    new_df = pd.concat(frames, ignore_index=True)
    if "trade_date" in new_df.columns:
        new_df["trade_date"] = new_df["trade_date"].astype(str).str.replace("-", "").str[:8]
    if old is not None and not old.empty:
        old = old.copy()
        old["trade_date"] = old["trade_date"].astype(str).str.replace("-", "").str[:8]
        combined = pd.concat([old, new_df], ignore_index=True)
    else:
        combined = new_df
    if {"trade_date", "ts_code"}.issubset(combined.columns):
        combined = combined.drop_duplicates(subset=["trade_date", "ts_code"], keep="last")
        combined = combined.sort_values(["trade_date", "ts_code"])
    combined.to_parquet(path, index=False)
    if progress:
        progress("margin done", 100.0)
    return {
        "ok_count": len(symbols) - len(failed),
        "fail_count": len(failed),
        "failed": failed,
        "rows": int(len(combined)),
        "start": fetch_start,
        "end": end,
        "path": str(path),
    }


def update_market_data(
    symbols: list[str] | None = None,
    start: str | None = None,
    end: str | None = None,
    progress: ProgressCb | None = None,
    include_daily: bool = True,
    include_share: bool = True,
    include_margin: bool = True,
) -> dict[str, Any]:
    """Update daily and/or non-OHLCV raw lakes used by sealed factors."""
    client = TushareClient()
    out: dict[str, Any] = {"provider": client.provider}
    if include_daily:
        if progress:
            progress("daily", 5)
        out["daily"] = update_daily(symbols=symbols, start=start, end=end, progress=progress)
    if include_share:
        if progress:
            progress("fund_share", 40)
        out["fund_share"] = update_fund_share(
            symbols=symbols, start=start, end=end, progress=progress, client=client
        )
    if include_margin:
        if progress:
            progress("margin", 75)
        out["margin"] = update_margin(
            symbols=symbols, start=start, end=end, progress=progress, client=client
        )
    if progress:
        progress("done", 100)
    out["updated_at"] = datetime.now().isoformat(timespec="seconds")
    return out
