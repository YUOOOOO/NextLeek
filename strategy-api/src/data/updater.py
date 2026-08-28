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

def _normalize_share_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Map etf_share_size / fund_share payloads onto local fd_share schema."""
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    # date column aliases
    if "trade_date" not in out.columns:
        for alt in ("end_date", "nav_date", "date", "cal_date"):
            if alt in out.columns:
                out = out.rename(columns={alt: "trade_date"})
                break
    # share column aliases -> fd_share (local contract for loader/non_ohlcv)
    if "fd_share" not in out.columns:
        for alt in (
            "etf_share_size",
            "share_size",
            "total_share",
            "fund_share",
            "share",
        ):
            if alt in out.columns:
                out = out.rename(columns={alt: "fd_share"})
                break
    keep = [c for c in ("ts_code", "trade_date", "fd_share", "fund_type", "market") if c in out.columns]
    out = out[keep].copy()
    if "trade_date" not in out.columns or "fd_share" not in out.columns:
        raise ValueError(
            "share payload missing trade_date/fd_share after alias map; "
            f"columns={list(df.columns)}"
        )
    out["trade_date"] = pd.to_datetime(
        out["trade_date"].astype(str).str.replace("-", ""),
        format="%Y%m%d",
        errors="coerce",
    )
    out["fd_share"] = pd.to_numeric(out["fd_share"], errors="coerce")
    return out.dropna(subset=["trade_date", "fd_share"])

def _filter_code(df: pd.DataFrame, code: str) -> pd.DataFrame:
    """Keep only the requested ts_code when API returns mixed symbols."""
    if df is None or df.empty or "ts_code" not in df.columns:
        return df
    target = dotted(code)
    bare = normalize_code(code)
    mask = df["ts_code"].astype(str).isin({target, bare, f"{bare}.SH", f"{bare}.SZ"})
    out = df.loc[mask].copy()
    return out if not out.empty else df.iloc[0:0].copy()




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
    archive: bool = True,
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
    end_ymd = _as_ymd(end, date.today().isoformat())
    for i, code in enumerate(symbols):
        if progress:
            progress(f"fetch {code}", (i / max(n, 1)) * 100)
        path = RAW_DAILY_DIR / f"{parquet_stem(code)}.parquet"
        old: pd.DataFrame | None = None
        fetch_start = start
        if path.exists():
            try:
                old = pd.read_parquet(path)
                if old is not None and not old.empty and "trade_date" in old.columns:
                    last = str(old["trade_date"].astype(str).str.replace("-", "").str[:8].max())
                    if last >= end_ymd:
                        ok.append(code)
                        continue
                    # 从本地最后一天重叠拉，合并写入，禁止整文件截断
                    fetch_start = last
            except Exception:
                old = None
        try:
            df = _fetch_etf_hist(code, fetch_start, end, client=client)
            if df.empty:
                if old is not None and not old.empty:
                    ok.append(code)
                else:
                    failed.append({"code": code, "error": "empty"})
                continue
            if old is not None and not old.empty:
                df = pd.concat([old, df], ignore_index=True)
            df = (
                df.drop_duplicates("trade_date", keep="last")
                .sort_values("trade_date")
                .reset_index(drop=True)
            )
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
    result = {
        "provider": client.provider,
        "ok_count": len(ok),
        "fail_count": len(failed),
        "ok": ok,
        "failed": failed,
        "start": start,
        "end": end,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    if archive:
        try:
            from ..history_store import archive_market_day

            result["market_archive"] = archive_market_day(end)
        except Exception as exc:  # noqa: BLE001
            result["market_archive"] = {"ok": False, "error": str(exc)}
    return result


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
            df = _filter_code(client.fund_share(dotted(code), fetch_start, end), code)
            if df is None or df.empty:
                if old is not None and not old.empty:
                    ok.append(code)
                else:
                    failed.append({"code": code, "error": "empty"})
                continue
            df = _normalize_share_frame(df)
            if df.empty:
                if old is not None and not old.empty:
                    ok.append(code)
                else:
                    failed.append({"code": code, "error": "empty after normalize"})
                continue
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
    """Incremental consolidated margin parquet used by DataLoader.load_margin.

    Per-symbol fetch window:
    - missing code in pool file -> full [start, end]
    - existing code -> from day after its own last trade_date
    Never skip the whole job just because some codes already reach end.
    """
    ensure_data_dirs()
    cfg = load_config()
    client = client or TushareClient()
    symbols = [normalize_code(s) for s in (symbols or all_symbols(cfg))]
    full_start = _as_ymd(start, cfg["data"].get("start_date") or "2020-01-01")
    end = _as_ymd(end, cfg["data"].get("end_date") or date.today().isoformat())
    path = RAW_MARGIN_DIR / "margin_pool43_2020_now.parquet"
    old = None
    last_by_code: dict[str, str] = {}
    if path.exists():
        try:
            old = pd.read_parquet(path)
            if old is not None and not old.empty and {"trade_date", "ts_code"}.issubset(old.columns):
                tmp = old.copy()
                tmp["trade_date"] = tmp["trade_date"].astype(str).str.replace("-", "").str[:8]
                tmp["code"] = tmp["ts_code"].map(normalize_code)
                last_by_code = (
                    tmp.groupby("code")["trade_date"].max().astype(str).to_dict()
                )
        except Exception:
            old = None
            last_by_code = {}

    frames: list[pd.DataFrame] = []
    failed: list[dict[str, str]] = []
    skipped: list[str] = []
    n = len(symbols)
    for i, code in enumerate(symbols):
        if progress:
            progress(f"margin {code}", (i / max(n, 1)) * 100)
        last = last_by_code.get(code)
        if last and last >= end:
            skipped.append(code)
            continue
        fetch_start = full_start if not last else str(int(last) + 1)
        if fetch_start > end:
            skipped.append(code)
            continue
        try:
            df = _filter_code(client.margin_detail(dotted(code), fetch_start, end), code)
            if df is None or df.empty:
                if last:
                    skipped.append(code)
                else:
                    failed.append({"code": code, "error": "empty"})
                continue
            frames.append(df)
        except Exception as exc:  # noqa: BLE001
            failed.append({"code": code, "error": str(exc)})
        time.sleep(0.12)

    if not frames:
        if old is not None and not old.empty and not failed:
            return {
                "ok_count": len(skipped),
                "fail_count": 0,
                "skipped": True,
                "reason": "all symbols already up to date",
                "end": end,
            }
        if old is not None and not old.empty:
            return {
                "ok_count": len(skipped),
                "fail_count": len(failed),
                "failed": failed,
                "skipped": True,
                "reason": "no new rows",
                "end": end,
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
        "skipped_codes": skipped,
        "rows": int(len(combined)),
        "codes": int(combined["ts_code"].nunique()) if "ts_code" in combined.columns else 0,
        "start": full_start,
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
        out["daily"] = update_daily(
            symbols=symbols, start=start, end=end, progress=progress, archive=False
        )
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
    # 把当天截面再冻一份，回测对照用；主路径仍是 raw/ETF 增量湖
    try:
        from ..history_store import archive_market_day

        stamp = None
        daily = out.get("daily") or {}
        if isinstance(daily, dict) and daily.get("end"):
            stamp = str(daily.get("end"))
        out["market_archive"] = archive_market_day(stamp)
    except Exception as exc:  # noqa: BLE001
        out["market_archive"] = {"ok": False, "error": str(exc)}
    return out
