"""NextLeek Data API — AkShare backend for A-share indices / stocks / ETFs."""

from __future__ import annotations

import os
import time
from datetime import date, datetime, timedelta
from typing import Any, Optional

# Bypass broken local system proxies (e.g. 127.0.0.1:2080) for Eastmoney calls.
os.environ.setdefault("NO_PROXY", "*")
os.environ.setdefault("no_proxy", "*")

import urllib.request

urllib.request.getproxies = lambda: {}  # type: ignore[assignment]

import requests

_orig_request = requests.Session.request


def _no_proxy_request(self: requests.Session, *args: Any, **kwargs: Any):
    kwargs.setdefault("proxies", {"http": None, "https": None})
    self.trust_env = False
    return _orig_request(self, *args, **kwargs)


requests.Session.request = _no_proxy_request  # type: ignore[method-assign]

import akshare as ak
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="NextLeek Data API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INDEX_CODES = {
    "000001": "上证指数",
    "399001": "深证成指",
    "399006": "创业板指",
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return default
        if isinstance(value, str) and value.strip() in {"", "-", "--"}:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(_safe_float(value, float(default)))
    except (TypeError, ValueError):
        return default


def _normalize_symbol(symbol: str) -> tuple[str, str, str]:
    """Return (bare_code, market SH|SZ, dotted code like 510300.SH)."""
    raw = (symbol or "").strip().upper()
    if not raw:
        raise HTTPException(status_code=400, detail="symbol 不能为空")

    raw = raw.replace("_", ".")

    if raw.startswith("SH") and len(raw) >= 8 and raw[2:].replace(".", "").isdigit():
        raw = raw[2:] if not raw[2] == "." else raw[3:]
        if "." not in raw:
            raw = f"{raw}.SH"
    elif raw.startswith("SZ") and len(raw) >= 8 and raw[2:].replace(".", "").isdigit():
        raw = raw[2:] if not raw[2] == "." else raw[3:]
        if "." not in raw:
            raw = f"{raw}.SZ"
    elif raw.startswith("SS") and len(raw) >= 8 and raw[2:].replace(".", "").isdigit():
        raw = raw[2:] if not raw[2] == "." else raw[3:]
        if "." not in raw:
            raw = f"{raw}.SH"

    if "." in raw:
        code, market = raw.split(".", 1)
        market = "SH" if market in {"SH", "SS"} else "SZ" if market == "SZ" else market
    else:
        code = raw
        if code.startswith(("5", "6", "9")):
            market = "SH"
        elif code.startswith(("15", "16", "18", "12", "0", "1", "2", "3")):
            market = "SZ"
        else:
            market = "SZ"

    code = "".join(ch for ch in code if ch.isdigit())
    if len(code) < 5:
        raise HTTPException(status_code=400, detail=f"无效代码: {symbol}")

    if market not in {"SH", "SZ"}:
        market = "SH" if code.startswith(("5", "6", "9")) else "SZ"

    # Tracked indices: force exchange by code family.
    if code in INDEX_CODES:
        market = "SH" if code.startswith("000") else "SZ"

    return code, market, f"{code}.{market}"


def _default_start(end: Optional[str] = None) -> str:
    end_dt = datetime.strptime(end, "%Y-%m-%d") if end else datetime.now()
    return (end_dt - timedelta(days=365)).strftime("%Y-%m-%d")


def _to_ak_date(value: str) -> str:
    return value.replace("-", "")


def _row_date(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def _upstream_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=502, detail=f"AkShare 上游失败: {exc}")


def _ak_call(fn, *args: Any, retries: int = 3, **kwargs: Any):
    """Call AkShare with short retries for flaky Eastmoney connections."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt + 1 < retries:
                time.sleep(0.8 * (attempt + 1))
    assert last is not None
    raise last


@app.get("/")
def read_root():
    return {"message": "Welcome to NextLeek Data API", "provider": "akshare"}


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "data-api", "provider": "akshare"}


@app.get("/api/indices")
def get_indices():
    frames = []
    last_exc: Exception | None = None
    for symbol in ("沪深重要指数", "上证系列指数", "深证系列指数"):
        try:
            part = _ak_call(ak.stock_zh_index_spot_em, symbol=symbol, retries=2)
            if part is not None and not part.empty:
                frames.append(part)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            continue

    if frames:
        df = pd.concat(frames, ignore_index=True)
        if "代码" in df.columns:
            df = df.drop_duplicates(subset=["代码"], keep="first")
    else:
        df = pd.DataFrame(columns=["代码", "最新价", "涨跌幅"])

    items = []
    found = set()
    for code, name in INDEX_CODES.items():
        rows = df[df["代码"].astype(str) == code]
        if rows.empty:
            continue
        row = rows.iloc[0]
        market = "SH" if code.startswith("000") else "SZ"
        items.append(
            {
                "name": name,
                "code": f"{code}.{market}",
                "price": round(_safe_float(row.get("最新价")), 2),
                "change": round(_safe_float(row.get("涨跌幅")), 2),
            }
        )
        found.add(code)

    # Spot 表偶发缺深证/创业板：用日线末根兜底
    for code, name in INDEX_CODES.items():
        if code in found:
            continue
        market = "SH" if code.startswith("000") else "SZ"
        ak_symbol = f"{'sh' if market == 'SH' else 'sz'}{code}"
        try:
            hist = _ak_call(ak.stock_zh_index_daily_em, symbol=ak_symbol, retries=2)
        except Exception:
            continue
        if hist is None or hist.empty:
            continue
        last = hist.iloc[-1]
        prev = hist.iloc[-2] if len(hist) > 1 else last
        close = _safe_float(last.get("close"))
        prev_close = _safe_float(prev.get("close"))
        change = ((close - prev_close) / prev_close * 100) if prev_close else 0.0
        items.append(
            {
                "name": name,
                "code": f"{code}.{market}",
                "price": round(close, 2),
                "change": round(change, 2),
            }
        )

    if not items:
        raise HTTPException(status_code=502, detail="未匹配到目标指数")
    # keep stable order of INDEX_CODES
    order = {c: i for i, c in enumerate(INDEX_CODES)}
    items.sort(key=lambda x: order.get(str(x["code"]).split(".")[0], 99))
    return items


def _quote_from_index(code: str) -> Optional[dict]:
    if code not in INDEX_CODES:
        return None
    try:
        frames = []
        for symbol in ("沪深重要指数", "上证系列指数", "深证系列指数"):
            try:
                part = _ak_call(ak.stock_zh_index_spot_em, symbol=symbol, retries=2)
                if part is not None and not part.empty:
                    frames.append(part)
            except Exception:
                continue
        if not frames:
            return None
        df = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["代码"], keep="first")
    except Exception as exc:  # noqa: BLE001
        raise _upstream_error(exc) from exc
    rows = df[df["代码"].astype(str) == code]
    if rows.empty:
        return None
    row = rows.iloc[0]
    market = "SH" if code.startswith("000") else "SZ"
    return {
        "symbol": f"{code}.{market}",
        "name": INDEX_CODES[code],
        "price": round(_safe_float(row.get("最新价")), 2),
        "open": round(_safe_float(row.get("今开")), 2),
        "prev_close": round(_safe_float(row.get("昨收")), 2),
        "high": round(_safe_float(row.get("最高")), 2),
        "low": round(_safe_float(row.get("最低")), 2),
        "volume": _safe_int(row.get("成交量")),
        "change_percent": round(_safe_float(row.get("涨跌幅")), 2),
    }


def _quote_from_etf_spot(code: str) -> Optional[dict]:
    try:
        df = _ak_call(ak.fund_etf_spot_em)
    except Exception as exc:  # noqa: BLE001
        raise _upstream_error(exc) from exc
    rows = df[df["代码"].astype(str) == code]
    if rows.empty:
        return None
    row = rows.iloc[0]
    _c, _m, dotted = _normalize_symbol(code)
    return {
        "symbol": dotted,
        "name": str(row.get("名称", "")),
        "price": round(_safe_float(row.get("最新价")), 2),
        "open": round(_safe_float(row.get("开盘价")), 2),
        "prev_close": round(_safe_float(row.get("昨收")), 2),
        "high": round(_safe_float(row.get("最高价")), 2),
        "low": round(_safe_float(row.get("最低价")), 2),
        "volume": _safe_int(row.get("成交量")),
        "change_percent": round(_safe_float(row.get("涨跌幅")), 2),
    }


def _quote_from_stock_hist(code: str) -> dict:
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=12)).strftime("%Y%m%d")
    try:
        df = _ak_call(
            ak.stock_zh_a_hist,
            symbol=code,
            period="daily",
            start_date=start,
            end_date=end,
            adjust="qfq",
        )
    except Exception as exc:  # noqa: BLE001
        raise _upstream_error(exc) from exc
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"未找到行情: {code}")
    row = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else row
    _c, _m, dotted = _normalize_symbol(code)
    close = _safe_float(row.get("收盘"))
    prev_close = _safe_float(prev.get("收盘"))
    change = (
        (close - prev_close) / prev_close * 100
        if prev_close
        else _safe_float(row.get("涨跌幅"))
    )
    return {
        "symbol": dotted,
        "name": code,
        "price": round(close, 2),
        "open": round(_safe_float(row.get("开盘")), 2),
        "prev_close": round(prev_close, 2),
        "high": round(_safe_float(row.get("最高")), 2),
        "low": round(_safe_float(row.get("最低")), 2),
        "volume": _safe_int(row.get("成交量")),
        "change_percent": round(change, 2),
    }


@app.get("/api/quote")
def get_quote(
    symbol: str = Query(
        ..., description="股票/指数/ETF 代码，如 600519 / 600519.SH / sh600519"
    ),
):
    code, _market, _dotted = _normalize_symbol(symbol)

    if code in INDEX_CODES:
        q = _quote_from_index(code)
        if q:
            return q

    # Common ETF prefixes
    if code.startswith(("15", "16", "18", "50", "51", "52", "56", "58", "159")):
        q = _quote_from_etf_spot(code)
        if q:
            return q

    return _quote_from_stock_hist(code)


@app.get("/api/history")
def get_history(
    symbol: str = Query(..., description="股票/指数代码"),
    start_date: str = Query("", description="开始日期 YYYY-MM-DD"),
    end_date: str = Query("", description="结束日期 YYYY-MM-DD"),
):
    code, market, _dotted = _normalize_symbol(symbol)
    end = end_date or datetime.now().strftime("%Y-%m-%d")
    start = start_date or _default_start(end)

    try:
        if code in INDEX_CODES:
            ak_symbol = f"{'sh' if market == 'SH' else 'sz'}{code}"
            df = _ak_call(ak.stock_zh_index_daily_em, symbol=ak_symbol)
            if df is None or df.empty:
                raise HTTPException(status_code=404, detail=f"无指数历史: {code}")
            df = df.copy()
            df["date"] = pd.to_datetime(df["date"])
            mask = (df["date"] >= start) & (df["date"] <= end)
            df = df.loc[mask]
            return [
                {
                    "date": _row_date(row["date"]),
                    "open": round(_safe_float(row["open"]), 2),
                    "high": round(_safe_float(row["high"]), 2),
                    "low": round(_safe_float(row["low"]), 2),
                    "close": round(_safe_float(row["close"]), 2),
                    "volume": _safe_int(row["volume"]),
                }
                for _, row in df.iterrows()
            ]

        df = _ak_call(
            ak.stock_zh_a_hist,
            symbol=code,
            period="daily",
            start_date=_to_ak_date(start),
            end_date=_to_ak_date(end),
            adjust="qfq",
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _upstream_error(exc) from exc

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"无历史数据: {code}")

    return [
        {
            "date": _row_date(row["日期"]),
            "open": round(_safe_float(row["开盘"]), 2),
            "high": round(_safe_float(row["最高"]), 2),
            "low": round(_safe_float(row["最低"]), 2),
            "close": round(_safe_float(row["收盘"]), 2),
            "volume": _safe_int(row["成交量"]),
        }
        for _, row in df.iterrows()
    ]


def _etf_item_from_row(row: pd.Series) -> dict:
    code = str(row.get("代码", ""))
    _c, _m, dotted = _normalize_symbol(code)
    return {
        "code": dotted,
        "name": str(row.get("名称", "")),
        "price": round(_safe_float(row.get("最新价")), 2),
        "change_percent": round(_safe_float(row.get("涨跌幅")), 2),
        "volume": _safe_int(row.get("成交量")),
        "amount": _safe_float(row.get("成交额")),
    }


@app.get("/api/etf/list")
def list_etfs(
    q: str = Query("", description="按代码或名称模糊搜索"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    try:
        df = _ak_call(ak.fund_etf_spot_em)
    except Exception as exc:  # noqa: BLE001
        raise _upstream_error(exc) from exc

    if df is None or df.empty:
        return {"total": 0, "limit": limit, "offset": offset, "items": []}

    filtered = df
    keyword = (q or "").strip()
    if keyword:
        key = keyword.lower()
        bare = key.lstrip("shsz.").replace(".sh", "").replace(".sz", "")
        code_series = filtered["代码"].astype(str).str.lower()
        name_series = filtered["名称"].astype(str).str.lower()
        filtered = filtered[
            code_series.str.contains(bare, na=False)
            | name_series.str.contains(key, na=False)
        ]

    total = int(len(filtered))
    page = filtered.iloc[offset : offset + limit]
    items = [_etf_item_from_row(row) for _, row in page.iterrows()]
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@app.get("/api/etf/quote")
def etf_quote(symbol: str = Query(..., description="ETF 代码，如 510300")):
    code, _market, dotted = _normalize_symbol(symbol)
    try:
        df = _ak_call(ak.fund_etf_spot_em)
    except Exception as exc:  # noqa: BLE001
        raise _upstream_error(exc) from exc

    rows = df[df["代码"].astype(str) == code]
    if rows.empty:
        raise HTTPException(status_code=404, detail=f"未找到 ETF: {dotted}")
    row = rows.iloc[0]
    return {
        "symbol": dotted,
        "name": str(row.get("名称", "")),
        "price": round(_safe_float(row.get("最新价")), 2),
        "open": round(_safe_float(row.get("开盘价")), 2),
        "prev_close": round(_safe_float(row.get("昨收")), 2),
        "high": round(_safe_float(row.get("最高价")), 2),
        "low": round(_safe_float(row.get("最低价")), 2),
        "volume": _safe_int(row.get("成交量")),
        "amount": _safe_float(row.get("成交额")),
        "change_percent": round(_safe_float(row.get("涨跌幅")), 2),
        "iopv": round(_safe_float(row.get("IOPV实时估值")), 4),
        "premium_rate": round(_safe_float(row.get("基金折价率")), 2),
    }


@app.get("/api/etf/history")
def etf_history(
    symbol: str = Query(..., description="ETF 代码"),
    start_date: str = Query("", description="开始日期 YYYY-MM-DD"),
    end_date: str = Query("", description="结束日期 YYYY-MM-DD"),
):
    code, _market, _dotted = _normalize_symbol(symbol)
    end = end_date or datetime.now().strftime("%Y-%m-%d")
    start = start_date or _default_start(end)

    try:
        df = _ak_call(
            ak.fund_etf_hist_em,
            symbol=code,
            period="daily",
            start_date=_to_ak_date(start),
            end_date=_to_ak_date(end),
            adjust="qfq",
        )
    except Exception as exc:  # noqa: BLE001
        raise _upstream_error(exc) from exc

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"无 ETF 历史: {code}")

    return [
        {
            "date": _row_date(row["日期"]),
            "open": round(_safe_float(row["开盘"]), 2),
            "high": round(_safe_float(row["最高"]), 2),
            "low": round(_safe_float(row["最低"]), 2),
            "close": round(_safe_float(row["收盘"]), 2),
            "volume": _safe_int(row["成交量"]),
        }
        for _, row in df.iterrows()
    ]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
