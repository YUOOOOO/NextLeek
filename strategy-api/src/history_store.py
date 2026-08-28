"""轮动信号 / 选股截面 / 当日行情按日存档。"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .paths import (
    LIVE_DIR,
    RAW_DAILY_DIR,
    RAW_FUND_SHARE_DIR,
    RAW_MARGIN_DIR,
    ensure_data_dirs,
)

SIGNAL_DIR = LIVE_DIR / "history" / "signals"
PICKS_DIR = LIVE_DIR / "history" / "stock_picks"
MARKET_DIR = LIVE_DIR / "history" / "market"


def _stamp(value: Any) -> str | None:
    text = str(value or "").replace("-", "").replace("/", "")[:8]
    return text if len(text) == 8 and text.isdigit() else None


def _ensure() -> None:
    ensure_data_dirs()
    SIGNAL_DIR.mkdir(parents=True, exist_ok=True)
    PICKS_DIR.mkdir(parents=True, exist_ok=True)
    MARKET_DIR.mkdir(parents=True, exist_ok=True)


def _write(path: Path, payload: dict[str, Any]) -> None:
    _ensure()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def _read(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _list_dates(folder: Path) -> list[str]:
    if not folder.exists():
        return []
    dates = sorted(
        {p.stem for p in folder.glob("*.json") if len(p.stem) == 8 and p.stem.isdigit()}
    )
    return dates


def neighbors(dates: list[str], current: str | None) -> dict[str, Any]:
    if not dates:
        return {"dates": [], "current": current, "prev": None, "next": None, "index": None, "total": 0}
    cur = current if current in dates else dates[-1]
    i = dates.index(cur)
    return {
        "dates": dates,
        "current": cur,
        "prev": dates[i - 1] if i > 0 else None,
        "next": dates[i + 1] if i + 1 < len(dates) else None,
        "index": i + 1,
        "total": len(dates),
    }


def save_signal_snapshot(payload: dict[str, Any]) -> Path | None:
    """把当日轮动信号写成 history/signals/YYYYMMDD.json。"""
    stamp = _stamp(payload.get("asof"))
    if not stamp:
        return None
    out = dict(payload)
    out["saved_at"] = datetime.now().isoformat(timespec="seconds")
    path = SIGNAL_DIR / f"{stamp}.json"
    _write(path, out)
    return path


def load_signal_snapshot(date: str) -> dict[str, Any] | None:
    stamp = _stamp(date)
    if not stamp:
        return None
    return _read(SIGNAL_DIR / f"{stamp}.json")


def list_signal_dates() -> list[str]:
    _ensure()
    return _list_dates(SIGNAL_DIR)


def save_stock_picks(payload: dict[str, Any]) -> Path | None:
    stamp = _stamp(payload.get("date"))
    if not stamp:
        return None
    out = dict(payload)
    out["saved_at"] = datetime.now().isoformat(timespec="seconds")
    path = PICKS_DIR / f"{stamp}.json"
    _write(path, out)
    return path


def load_stock_picks(date: str) -> dict[str, Any] | None:
    stamp = _stamp(date)
    if not stamp:
        return None
    return _read(PICKS_DIR / f"{stamp}.json")


def list_stock_pick_dates() -> list[str]:
    _ensure()
    return _list_dates(PICKS_DIR)


def _slice_parquets(folder: Path, stamp: str, pattern: str = "*.parquet"):
    import pandas as pd

    frames = []
    for path in sorted(folder.glob(pattern)):
        try:
            df = pd.read_parquet(path)
        except Exception:
            continue
        if df is None or df.empty or "trade_date" not in df.columns:
            continue
        dates = df["trade_date"].astype(str).str.replace("-", "", regex=False).str[:8]
        part = df.loc[dates == stamp].copy()
        if part.empty:
            continue
        if "source_file" not in part.columns:
            part["source_file"] = path.name
        frames.append(part)
    if not frames:
        return None
    return pd.concat(frames, ignore_index=True)


def archive_market_day(stamp: str | None = None) -> dict[str, Any]:
    """从 parquet 湖切出某一交易日，写入 history/market/YYYYMMDD/，给回测对照。

    主回测仍读增量合并后的 raw/ETF/*；这里是按日冻结，避免以后整文件被改掉对不上。
    """
    import pandas as pd

    _ensure()
    wanted = _stamp(stamp)
    if not wanted:
        # 没有指定日：用日线湖里出现过的最大交易日
        latest = None
        for path in RAW_DAILY_DIR.glob("*.parquet"):
            try:
                df = pd.read_parquet(path, columns=["trade_date"])
            except Exception:
                continue
            if df is None or df.empty:
                continue
            cur = str(df["trade_date"].astype(str).str.replace("-", "", regex=False).str[:8].max())
            if len(cur) == 8 and cur.isdigit() and (latest is None or cur > latest):
                latest = cur
        wanted = latest
    if not wanted:
        return {"ok": False, "reason": "no trade_date in daily lake"}

    day_dir = MARKET_DIR / wanted
    day_dir.mkdir(parents=True, exist_ok=True)
    written: dict[str, Any] = {}

    daily = _slice_parquets(RAW_DAILY_DIR, wanted)
    if (daily is None or daily.empty) and stamp:
        # 指定日还没有 K 线（周末/未收盘）时，冻湖里最近一个交易日
        latest = None
        import pandas as pd

        for path in RAW_DAILY_DIR.glob("*.parquet"):
            try:
                df = pd.read_parquet(path, columns=["trade_date"])
            except Exception:
                continue
            if df is None or df.empty:
                continue
            cur = str(df["trade_date"].astype(str).str.replace("-", "", regex=False).str[:8].max())
            if len(cur) == 8 and cur.isdigit() and (latest is None or cur > latest):
                latest = cur
        if latest and latest != wanted:
            wanted = latest
            day_dir = MARKET_DIR / wanted
            day_dir.mkdir(parents=True, exist_ok=True)
            daily = _slice_parquets(RAW_DAILY_DIR, wanted)
    if daily is not None and not daily.empty:
        daily.to_parquet(day_dir / "daily.parquet", index=False)
        written["daily_rows"] = int(len(daily))
        written["daily_files"] = int(daily["source_file"].nunique()) if "source_file" in daily.columns else None

    share = _slice_parquets(RAW_FUND_SHARE_DIR, wanted)
    if share is not None and not share.empty:
        share.to_parquet(day_dir / "fund_share.parquet", index=False)
        written["share_rows"] = int(len(share))

    margin = _slice_parquets(RAW_MARGIN_DIR, wanted)
    if margin is not None and not margin.empty:
        margin.to_parquet(day_dir / "margin.parquet", index=False)
        written["margin_rows"] = int(len(margin))

    manifest = {
        "date": wanted,
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "path": str(day_dir),
        **written,
    }
    _write(day_dir / "manifest.json", manifest)
    return {"ok": True, **manifest}


def list_market_dates() -> list[str]:
    _ensure()
    if not MARKET_DIR.exists():
        return []
    return sorted(p.name for p in MARKET_DIR.iterdir() if p.is_dir() and len(p.name) == 8 and p.name.isdigit())
