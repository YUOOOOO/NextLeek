"""选股：先剔除噪音票，再按百分位综合得分排名（不再做阈值硬筛）。

数据目录：results/_auction_long_research/
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

RESEARCH_DIR = Path(__file__).resolve().parents[2] / "results" / "_auction_long_research"

# 流通市值单位：Tushare 万元。200 亿 = 2_000_000 万元
CIRC_MV_MAX_WAN = 2_000_000.0
MIN_PRICE = 5.0
MIN_LISTED_DAYS = 60
DEFAULT_TOP_N = 20

# 公开语义 → 本地可算因子。权重用于百分位加权求和，不再用阈值筛选。
STRATEGY_DEFS: list[dict[str, Any]] = [
    {
        "id": "auction-long",
        "name": "竞价多头策略",
        "principle": "剔除次新/超大盘/昨涨跌停/低价股后，竞价涨幅、成交额、量比百分位加权：0.3+0.3+0.4，取综合得分前 20。",
        "factor_codes": ["AUCTION_PCT", "AUCTION_AMOUNT", "AUCTION_VOLUME_RATIO"],
        "score_cols": ["auction_pct", "amount_auc", "volume_ratio"],
        "weights": [0.3, 0.3, 0.4],
    },
    {
        "id": "premarket-strong",
        "name": "盘前强势量化",
        "principle": "同一观察池内，竞价涨幅、量比、换手百分位加权，量比权重最高。",
        "factor_codes": ["AUCTION_PCT", "AUCTION_VOLUME_RATIO", "AUCTION_TURNOVER"],
        "score_cols": ["auction_pct", "volume_ratio", "turnover_rate"],
        "weights": [0.3, 0.4, 0.3],
    },
    {
        "id": "morning-star",
        "name": "晨星量化",
        "principle": "同一观察池内，开盘涨幅、竞价涨幅、日内振幅（低更好）百分位加权。",
        "factor_codes": ["OPEN_PCT", "AUCTION_PCT", "INTRADAY_RANGE"],
        "score_cols": ["open_pct", "auction_pct", "intraday_range_inv"],
        "weights": [1 / 3, 1 / 3, 1 / 3],
    },
    {
        "id": "auction-alpha",
        "name": "竞价阿尔法",
        "principle": "同一观察池内，竞价超额、竞价涨幅、量比百分位加权。",
        "factor_codes": ["AUCTION_ALPHA", "AUCTION_PCT", "VOLUME_RATIO"],
        "score_cols": ["auction_alpha", "auction_pct", "volume_ratio"],
        "weights": [0.3, 0.3, 0.4],
    },
    {
        "id": "open-star",
        "name": "早盘之星",
        "principle": "同一观察池内，开盘涨幅、开盘到收盘、当日涨跌幅百分位加权。",
        "factor_codes": ["OPEN_PCT", "OPEN_TO_CLOSE", "PCT_CHG"],
        "score_cols": ["open_pct", "open_to_close", "pct_chg"],
        "weights": [1 / 3, 1 / 3, 1 / 3],
    },
    {
        "id": "t1-flash",
        "name": "T+1闪电",
        "principle": "同一观察池内，涨跌幅、量比、换手百分位加权，量比权重最高。",
        "factor_codes": ["PCT_CHG", "VOLUME_RATIO", "TURNOVER"],
        "score_cols": ["pct_chg", "volume_ratio", "turnover_rate_f"],
        "weights": [0.3, 0.4, 0.3],
    },
    {
        "id": "gold-1430",
        "name": "金色2点半",
        "principle": "同一观察池内，收盘位置、涨跌幅、日内斜率百分位加权。",
        "factor_codes": ["CLOSE_POS", "PCT_CHG", "SLOPE_PROXY"],
        "score_cols": ["close_pos", "pct_chg", "open_to_close"],
        "weights": [1 / 3, 1 / 3, 1 / 3],
    },
    {
        "id": "large-cap",
        "name": "大市值",
        "principle": "已剔除超 200 亿大盘后，在剩余池里按市值、涨幅、换手百分位加权。",
        "factor_codes": ["CIRC_MV", "PCT_CHG", "TURNOVER"],
        "score_cols": ["circ_mv", "pct_chg", "turnover_rate_f"],
        "weights": [1 / 3, 1 / 3, 1 / 3],
    },
]

FACTOR_LABEL: dict[str, str] = {
    "AUCTION_PCT": "竞价涨幅",
    "AUCTION_AMOUNT": "竞价成交额",
    "AUCTION_VOLUME_RATIO": "竞价量比",
    "AUCTION_TURNOVER": "竞价换手",
    "OPEN_PCT": "开盘涨幅",
    "INTRADAY_RANGE": "日内振幅（低更好）",
    "AUCTION_ALPHA": "竞价超额",
    "VOLUME_RATIO": "量比",
    "OPEN_TO_CLOSE": "开盘到收盘",
    "PCT_CHG": "当日涨跌幅",
    "TURNOVER": "换手率",
    "CLOSE_POS": "收盘位置",
    "SLOPE_PROXY": "日内斜率",
    "CIRC_MV": "流通市值",
}


def _read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return pd.read_csv(path, encoding=enc)
        except Exception:
            continue
    return pd.read_csv(path)


def available_dates() -> list[str]:
    dates = sorted(
        {p.stem.replace("daily_", "").replace("_all", "") for p in RESEARCH_DIR.glob("daily_*_all.csv")}
    )
    return [d for d in dates if d.isdigit() and len(d) == 8]


def _percentile(series: pd.Series) -> pd.Series:
    # 平均排名百分位，取值 0~1；缺失当 0，不参与拉高得分
    return series.rank(method="average", pct=True).fillna(0.0)


def _parse_ymd(value: Any):
    text = str(value or "").replace("-", "").replace("/", "")[:8]
    if len(text) != 8 or not text.isdigit():
        return None
    try:
        return datetime(int(text[:4]), int(text[4:6]), int(text[6:8])).date()
    except Exception:
        return None


def _limit_threshold(ts_code: str) -> float:
    code = str(ts_code)
    # 创业板 / 科创板 20%；其余主板约 10%
    if code.startswith("30") or code.startswith("68"):
        return 19.5
    return 9.8


def _prev_trade_date(date: str) -> str | None:
    dates = available_dates()
    if date in dates:
        i = dates.index(date)
        return dates[i - 1] if i > 0 else None
    earlier = [d for d in dates if d < date]
    return earlier[-1] if earlier else None


def _load_cross_section(date: str) -> pd.DataFrame:
    daily = _read_csv(RESEARCH_DIR / f"daily_{date}_all.csv")
    if daily.empty:
        raise FileNotFoundError(f"daily cache missing for {date}")
    basic = _read_csv(RESEARCH_DIR / f"daily_basic_{date}.csv")
    auction = _read_csv(RESEARCH_DIR / f"stk_auction_{date}.csv")
    names = pd.concat(
        [
            _read_csv(RESEARCH_DIR / "stock_basic_L.csv"),
            _read_csv(RESEARCH_DIR / "stock_basic_SSE.csv"),
        ],
        ignore_index=True,
    )
    if not names.empty:
        keep_n = [c for c in ("ts_code", "name", "industry", "market", "list_date") if c in names.columns]
        names = names.drop_duplicates("ts_code", keep="last")[keep_n]

    frame = daily.copy()
    for col in ("open", "high", "low", "close", "pre_close", "pct_chg", "vol", "amount"):
        if col in frame.columns:
            frame[col] = pd.to_numeric(frame[col], errors="coerce")
    # 只要沪深 A 股，去掉 ETF / 北交所
    code = frame["ts_code"].astype(str)
    a_share = (
        code.str.endswith(".SH") & code.str.match(r"^(60|68)\d{4}\.SH$")
    ) | (
        code.str.endswith(".SZ") & code.str.match(r"^(00|30)\d{4}\.SZ$")
    )
    frame = frame.loc[a_share].copy()
    if names is not None and not names.empty:
        frame = frame.merge(names, on="ts_code", how="left")
    if "name" in frame.columns:
        frame = frame.loc[~frame["name"].fillna("").str.contains("ST", case=False, regex=False)]

    if not basic.empty:
        keep = [c for c in ("ts_code", "turnover_rate", "turnover_rate_f", "volume_ratio", "circ_mv", "total_mv") if c in basic.columns]
        b = basic[keep].copy()
        for c in keep:
            if c != "ts_code":
                b[c] = pd.to_numeric(b[c], errors="coerce")
        frame = frame.merge(b, on="ts_code", how="left", suffixes=("", "_b"))
        if "volume_ratio" not in frame.columns and "volume_ratio_b" in frame.columns:
            frame["volume_ratio"] = frame["volume_ratio_b"]

    if not auction.empty:
        a = auction.rename(columns={"vol": "vol_auc", "amount": "amount_auc", "price": "auction_price"})
        keep_a = [c for c in ("ts_code", "auction_price", "amount_auc", "vol_auc", "turnover_rate", "volume_ratio", "pre_close") if c in a.columns]
        a = a[keep_a].copy()
        for c in keep_a:
            if c != "ts_code":
                a[c] = pd.to_numeric(a[c], errors="coerce")
        frame = frame.merge(a, on="ts_code", how="left", suffixes=("", "_auc"))
        pre = frame["pre_close"] if "pre_close" in frame.columns else frame.get("pre_close_auc")
        frame["auction_pct"] = np.where(
            frame.get("auction_price", pd.Series(index=frame.index)).gt(0) & pd.to_numeric(pre, errors="coerce").gt(0),
            frame["auction_price"] / pd.to_numeric(pre, errors="coerce") - 1.0,
            np.nan,
        )
        if "amount_auc" not in frame.columns and "amount_auc_auc" in frame.columns:
            frame["amount_auc"] = frame["amount_auc_auc"]
        if "volume_ratio_auc" in frame.columns:
            frame["volume_ratio"] = frame["volume_ratio"].fillna(frame["volume_ratio_auc"])
        if "turnover_rate_auc" in frame.columns and "turnover_rate" in frame.columns:
            frame["turnover_rate"] = frame["turnover_rate"].fillna(frame["turnover_rate_auc"])

    frame["open_pct"] = np.where(frame["pre_close"].gt(0), frame["open"] / frame["pre_close"] - 1.0, np.nan)
    rng = (frame["high"] - frame["low"]).replace(0, np.nan)
    frame["intraday_range"] = rng / frame["close"].replace(0, np.nan)
    frame["intraday_range_inv"] = -frame["intraday_range"]
    frame["open_to_close"] = np.where(frame["open"].gt(0), frame["close"] / frame["open"] - 1.0, np.nan)
    frame["close_pos"] = np.where(rng.gt(0), (frame["close"] - frame["low"]) / rng, np.nan)
    if "auction_pct" in frame.columns:
        frame["auction_alpha"] = frame["auction_pct"] - frame["pct_chg"] / 100.0
    if "turnover_rate_f" not in frame.columns:
        frame["turnover_rate_f"] = frame.get("turnover_rate")
    if "circ_mv" not in frame.columns:
        frame["circ_mv"] = np.nan
    if "total_mv" in frame.columns:
        frame["circ_mv"] = frame["circ_mv"].fillna(frame["total_mv"])
    frame["code"] = frame["ts_code"].astype(str).str.replace(r"\.(SZ|SH)$", "", regex=True)
    return frame


def _exclude_noise(frame: pd.DataFrame, date: str) -> tuple[pd.DataFrame, dict[str, int]]:
    """硬剔除噪音票；剩下的才做百分位排名。"""
    out = frame.copy()
    stats = {"start": int(len(out))}

    asof = _parse_ymd(date)
    if asof is not None and "list_date" in out.columns:
        listed = out["list_date"].map(_parse_ymd)
        listed_days = [
            np.busday_count(np.datetime64(d), np.datetime64(asof)) if d is not None else MIN_LISTED_DAYS
            for d in listed
        ]
        out["listed_days"] = listed_days
        out = out.loc[out["listed_days"] >= MIN_LISTED_DAYS]
    stats["after_listed"] = int(len(out))

    # 流通市值缺失时用总市值；单位万元，>200 亿剔除
    mv = pd.to_numeric(out.get("circ_mv"), errors="coerce")
    out = out.loc[~(mv > CIRC_MV_MAX_WAN)]
    stats["after_cap"] = int(len(out))

    prev = _prev_trade_date(date)
    if prev:
        prev_daily = _read_csv(RESEARCH_DIR / f"daily_{prev}_all.csv")
        if not prev_daily.empty and "pct_chg" in prev_daily.columns:
            prev_pct = prev_daily.set_index("ts_code")["pct_chg"]
            prev_pct = pd.to_numeric(prev_pct, errors="coerce")
            mapped = out["ts_code"].map(prev_pct)
            thr = out["ts_code"].map(_limit_threshold)
            limited = mapped.abs() >= thr
            out = out.loc[~limited.fillna(False)]
    stats["after_limit"] = int(len(out))

    price = pd.to_numeric(out.get("pre_close"), errors="coerce")
    if "close" in out.columns:
        price = price.fillna(pd.to_numeric(out["close"], errors="coerce"))
    out = out.loc[~(price < MIN_PRICE)]
    stats["after_price"] = int(len(out))
    return out, stats


def _composite_score(frame: pd.DataFrame, cols: list[str], weights: list[float]) -> pd.Series:
    score = pd.Series(0.0, index=frame.index)
    used_w = 0.0
    for col, w in zip(cols, weights):
        if col not in frame.columns:
            continue
        score = score + _percentile(frame[col]) * float(w)
        used_w += float(w)
    if used_w <= 0:
        return pd.Series(np.nan, index=frame.index)
    return score / used_w * 100.0


def screen_strategy(strategy_id: str, date: str | None = None, top_n: int = DEFAULT_TOP_N) -> dict[str, Any]:
    defs = {item["id"]: item for item in STRATEGY_DEFS}
    if strategy_id not in defs:
        raise KeyError(strategy_id)
    dates = available_dates()
    if not dates:
        raise FileNotFoundError("no daily cache")
    date = date or dates[-1]
    if date not in dates:
        date = dates[-1]
    spec = defs[strategy_id]
    frame = _load_cross_section(date)
    pool, excl = _exclude_noise(frame, date)
    weights = list(spec.get("weights") or [1.0] * len(spec["score_cols"]))
    pool = pool.assign(score=_composite_score(pool, spec["score_cols"], weights))
    ranked = pool.sort_values(["score", "pct_chg"], ascending=[False, False]).head(top_n)

    rows: list[dict[str, Any]] = []
    for i, rec in enumerate(ranked.to_dict(orient="records"), start=1):
        rows.append(
            {
                "rank": i,
                "code": str(rec.get("code") or "")[:6],
                "ts_code": rec.get("ts_code"),
                "name": rec.get("name") or "",
                "changePct": None if pd.isna(rec.get("pct_chg")) else round(float(rec["pct_chg"]), 2),
                "price": None if pd.isna(rec.get("close")) else round(float(rec["close"]), 2),
                "score": None if pd.isna(rec.get("score")) else round(float(rec["score"]), 2),
            }
        )
    return {
        "id": spec["id"],
        "name": spec["name"],
        "principle": spec["principle"],
        "factor_codes": spec["factor_codes"],
        "factor_labels": [FACTOR_LABEL.get(c, c) for c in spec["factor_codes"]],
        "date": date,
        "universe_size": int(len(frame)),
        "matched": int(len(pool)),
        "exclusions": excl,
        "top_n": int(top_n),
        "rows": rows,
    }


def list_strategies(date: str | None = None, top_n: int = DEFAULT_TOP_N) -> dict[str, Any]:
    dates = available_dates()
    date = date or (dates[-1] if dates else None)
    items = []
    for spec in STRATEGY_DEFS:
        try:
            items.append(screen_strategy(spec["id"], date=date, top_n=top_n))
        except Exception as exc:  # noqa: BLE001
            items.append(
                {
                    "id": spec["id"],
                    "name": spec["name"],
                    "principle": spec["principle"],
                    "factor_codes": spec["factor_codes"],
                    "factor_labels": [FACTOR_LABEL.get(c, c) for c in spec["factor_codes"]],
                    "date": date,
                    "error": str(exc),
                    "rows": [],
                }
            )
    return {"date": date, "available_dates": dates, "strategies": items}
