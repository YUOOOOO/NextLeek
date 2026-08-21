#!/usr/bin/env python
"""竞价多头样例股共性研究（可断点续跑）。

目标样例（用户口述「竞价多头」命中池）:
  飞龙股份 / 晓程科技 / 中海远控 / 广汇能源 / 五洲交通 / 经纬辉开

用法（在 strategy-api 目录）:
  python scripts/research_auction_long_commonality.py
  python scripts/research_auction_long_commonality.py --start 20260801 --end 20260821
  python scripts/research_auction_long_commonality.py --skip-fetch   # 只基于已落盘 CSV 做共性
  python scripts/research_auction_long_commonality.py --force-fetch  # 忽略缓存重拉

依赖:
  - strategy-api/.env 的 Tushare Promax/Pro 配置（TushareClient）
  - 不把 token/key 写进仓库

输出目录:
  strategy-api/results/_auction_long_research/
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from data.tushare_client import TushareClient  # noqa: E402

OUT = ROOT / "results" / "_auction_long_research"

# 用户给的 6 个名称；「中海远控」在 stock_basic 无精确命中，暂用 中远海控 作候选并标注
STOCKS: list[tuple[str, str]] = [
    ("飞龙股份", "002536.SZ"),
    ("晓程科技", "300139.SZ"),
    ("广汇能源", "600256.SH"),
    ("五洲交通", "600368.SH"),
    ("经纬辉开", "300120.SZ"),
    ("中远海控(疑似中海远控)", "601919.SH"),
]
CODES = [c for _, c in STOCKS]
LABEL = {c: n for n, c in STOCKS}

# 默认排除规则（研究用，可在 summarize 调整）
MIN_CIRC_MV_YI = 30.0  # 流通市值下限（亿元）；Tushare circ_mv 单位为万元
EXCLUDE_ST = True


def _log(msg: str) -> None:
    print(msg, flush=True)


def _to_num(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    out = df.copy()
    for c in cols:
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    return out


def fetch_frame(client: TushareClient, api: str, cache: Path, force: bool, **params) -> pd.DataFrame:
    """带本地缓存的 Tushare 查询。"""
    if cache.exists() and cache.stat().st_size > 0 and not force:
        _log(f"cache hit {cache.name}")
        return pd.read_csv(cache)
    _log(f"fetch {api} {params}")
    df = client.query(api, **params)
    cache.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(cache, index=False, encoding="utf-8-sig")
    time.sleep(0.25)
    return df


def fetch_per_code(
    client: TushareClient,
    api: str,
    start: str,
    end: str,
    cache_name: str,
    force: bool,
) -> pd.DataFrame:
    """按代码拉 daily / daily_basic / stk_limit。"""
    cache = OUT / cache_name
    if cache.exists() and cache.stat().st_size > 0 and not force:
        _log(f"cache hit {cache.name}")
        return pd.read_csv(cache)
    frames: list[pd.DataFrame] = []
    for name, code in STOCKS:
        df = client.query(api, ts_code=code, start_date=start, end_date=end)
        if df is None or df.empty:
            _log(f"empty {api} {code}")
            continue
        df = df.copy()
        df["label"] = name
        frames.append(df)
        time.sleep(0.2)
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    cache.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(cache, index=False, encoding="utf-8-sig")
    return out


def fetch_auction_days(
    client: TushareClient,
    days: list[str],
    force: bool,
) -> pd.DataFrame:
    """按交易日拉 stk_auction 全表后过滤 6 只（单票过滤在部分网关不稳定）。"""
    rows: list[pd.DataFrame] = []
    for d in days:
        day_cache = OUT / f"stk_auction_{d}.csv"
        if day_cache.exists() and day_cache.stat().st_size > 1000 and not force:
            df = pd.read_csv(day_cache)
            _log(f"cache hit auction {d} rows={len(df)}")
        else:
            _log(f"fetch stk_auction trade_date={d}")
            df = client.query("stk_auction", trade_date=d)
            df.to_csv(day_cache, index=False, encoding="utf-8-sig")
            time.sleep(0.5)
        if df is None or df.empty:
            continue
        sub = df[df["ts_code"].isin(CODES)].copy()
        if sub.empty:
            _log(f"auction {d}: 0 hits")
            continue
        sub["trade_date"] = str(d)
        rows.append(sub)
        _log(f"auction {d}: hits={len(sub)} {sorted(sub['ts_code'].tolist())}")
    if not rows:
        return pd.DataFrame()
    auc = pd.concat(rows, ignore_index=True)
    auc = _to_num(
        auc,
        ["vol", "price", "amount", "pre_close", "turnover_rate", "volume_ratio", "float_share"],
    )
    auc["auction_pct"] = (auc["price"] / auc["pre_close"] - 1.0) * 100.0
    auc["label"] = auc["ts_code"].map(LABEL)
    auc.to_csv(OUT / "six_auction.csv", index=False, encoding="utf-8-sig")
    return auc


def open_days(client: TushareClient, start: str, end: str, force: bool) -> list[str]:
    cal = fetch_frame(
        client,
        "trade_cal",
        OUT / f"trade_cal_{start}_{end}.csv",
        force,
        exchange="SSE",
        start_date=start,
        end_date=end,
        is_open="1",
    )
    days = sorted(cal.loc[cal["is_open"].astype(str).isin(["1", "1.0"]), "cal_date"].astype(str).unique())
    return days


def summarize(daily: pd.DataFrame, basic: pd.DataFrame, lim: pd.DataFrame, auc: pd.DataFrame) -> str:
    """生成共性摘要 Markdown。"""
    lines: list[str] = []
    lines.append("# 竞价多头样例股 · 共性快照（自动生成）")
    lines.append("")
    lines.append("生成脚本: `strategy-api/scripts/research_auction_long_commonality.py`")
    lines.append("")

    lines.append("## 代码表")
    lines.append("")
    lines.append("| 名称 | ts_code | 备注 |")
    lines.append("|---|---|---|")
    for n, c in STOCKS:
        note = "名称待确认" if "疑似" in n else ""
        lines.append(f"| {n} | `{c}` | {note} |")
    lines.append("")

    if daily is None or daily.empty:
        lines.append("尚无 daily 数据。")
        return "\n".join(lines)

    daily = daily.copy()
    daily["label"] = daily["ts_code"].map(LABEL)
    daily = _to_num(daily, ["open", "high", "low", "close", "pre_close", "pct_chg", "vol", "amount"])

    if lim is not None and not lim.empty:
        lim = _to_num(lim, ["up_limit", "down_limit"])
        daily = daily.merge(lim[["ts_code", "trade_date", "up_limit", "down_limit"]], on=["ts_code", "trade_date"], how="left")
        daily["open_pct"] = (daily["open"] / daily["pre_close"] - 1.0) * 100.0
        daily["is_open_limit"] = (daily["open"] - daily["up_limit"]).abs() <= 0.011
        daily["is_close_limit"] = (daily["close"] - daily["up_limit"]).abs() <= 0.011
    else:
        daily["open_pct"] = (daily["open"] / daily["pre_close"] - 1.0) * 100.0
        daily["is_open_limit"] = False
        daily["is_close_limit"] = False

    if basic is not None and not basic.empty:
        basic = basic.copy()
        basic["label"] = basic["ts_code"].map(LABEL)
        for c in basic.columns:
            if c not in ("ts_code", "trade_date", "label"):
                basic[c] = pd.to_numeric(basic[c], errors="coerce")
        # 最新有 circ_mv 的交易日
        d_mv = None
        for d in sorted(basic["trade_date"].astype(str).unique(), reverse=True):
            x = basic[basic["trade_date"].astype(str) == d]
            if x["circ_mv"].notna().sum() >= 4:
                d_mv = d
                mv = x
                break
        if d_mv:
            mv = mv.copy()
            mv["circ_mv_yi"] = mv["circ_mv"] / 10000.0  # 万元 -> 亿元
            lines.append(f"## 市值/换手（daily_basic @ {d_mv}）")
            lines.append("")
            lines.append("| 名称 | 流通市值(亿) | 总市值(亿) | 换手% | 量比 |")
            lines.append("|---|---:|---:|---:|---:|")
            for _, r in mv.sort_values("circ_mv_yi").iterrows():
                lines.append(
                    f"| {r['label']} | {r['circ_mv_yi']:.2f} | {(r['total_mv']/10000):.2f} | "
                    f"{r.get('turnover_rate', np.nan):.2f} | {r.get('volume_ratio', np.nan):.2f} |"
                )
            lines.append("")
            lines.append(
                f"排除规则试算: 非ST + 流通市值 ≥ {MIN_CIRC_MV_YI:.0f} 亿 → "
                f"通过 {int((mv['circ_mv_yi'] >= MIN_CIRC_MV_YI).sum())}/{len(mv)} "
                f"(最小 {mv['circ_mv_yi'].min():.2f} 亿 = {mv.loc[mv['circ_mv_yi'].idxmin(), 'label']})"
            )
            lines.append("")

    dmax = str(sorted(daily["trade_date"].astype(str).unique())[-1])
    z = daily[daily["trade_date"].astype(str) == dmax].copy()
    lines.append(f"## 开盘缺口 / 涨停（daily @ {dmax}）")
    lines.append("")
    lines.append("| 名称 | 开盘涨幅% | 收盘涨幅% | 开盘涨停 | 收盘涨停 |")
    lines.append("|---|---:|---:|---|---|")
    for _, r in z.sort_values("open_pct", ascending=False).iterrows():
        lines.append(
            f"| {r['label']} | {r['open_pct']:.2f} | {r['pct_chg']:.2f} | "
            f"{'Y' if r['is_open_limit'] else ''} | {'Y' if r['is_close_limit'] else ''} |"
        )
    lines.append("")
    lines.append(
        f"当日共性: 开盘涨幅全 > 0? **{(z['open_pct'] > 0).all()}**；"
        f"最小开盘涨幅 **{z['open_pct'].min():.2f}%**；"
        f"开盘即涨停数 **{int(z['is_open_limit'].sum())}**"
    )
    lines.append("")

    if auc is not None and not auc.empty:
        auc = auc.copy()
        auc = _to_num(
            auc,
            ["vol", "price", "amount", "pre_close", "turnover_rate", "volume_ratio", "float_share", "auction_pct"],
        )
        if "auction_pct" not in auc.columns:
            auc["auction_pct"] = (auc["price"] / auc["pre_close"] - 1.0) * 100.0
        amax = str(sorted(auc["trade_date"].astype(str).unique())[-1])
        a = auc[auc["trade_date"].astype(str) == amax]
        lines.append(f"## 集合竞价（stk_auction @ {amax}）")
        lines.append("")
        lines.append("| 名称 | 竞价涨幅% | 量比 | 换手% | 竞价额 |")
        lines.append("|---|---:|---:|---:|---:|")
        for _, r in a.sort_values("auction_pct", ascending=False).iterrows():
            lines.append(
                f"| {r.get('label', r['ts_code'])} | {r['auction_pct']:.2f} | "
                f"{r.get('volume_ratio', np.nan):.2f} | {r.get('turnover_rate', np.nan):.4f} | "
                f"{r.get('amount', np.nan):.0f} |"
            )
        lines.append("")
        lines.append(
            f"竞价涨幅: min={a['auction_pct'].min():.2f} / median={a['auction_pct'].median():.2f} / "
            f"max={a['auction_pct'].max():.2f}; 全>0? **{(a['auction_pct']>0).all()}**"
        )
        lines.append("")
    else:
        lines.append("## 集合竞价")
        lines.append("")
        lines.append("尚无 `six_auction.csv`。重新跑脚本不要加 `--skip-fetch`。")
        lines.append("")

    lines.append("## 初步因子假设（待竞价面板补全后修订）")
    lines.append("")
    lines.append("1. **硬过滤**: 非 ST/*ST；主板/创业板 A 股；流通市值 ≥ 约 30 亿（样本最小约 47 亿）。")
    lines.append("2. **竞价多头核心**: 集合竞价涨幅 `auction_pct = price/pre_close-1` > 0（样本日开盘缺口亦全为正）。")
    lines.append("3. **强度**: 竞价量比 / 竞价额 / 竞价换手 居前（需全市场分位确认，不可只看 6 只绝对值）。")
    lines.append("4. **未必**: 开盘即涨停、同一行业、同一市值带——样本行业分散，市值 47 亿～2000 亿+。")
    lines.append("5. **Tushare 接口**: `stk_auction`（vol/price/amount/pre_close/turnover_rate/volume_ratio/float_share）+ `daily` + `daily_basic` + `stk_limit`。")
    lines.append("6. **未决**: 「中海远控」代码未在 basic 精确命中；现用 `601919.SH 中远海控` 候选。")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="竞价多头样例股共性研究")
    parser.add_argument("--start", default="20260801")
    parser.add_argument("--end", default="20260821")
    parser.add_argument("--skip-fetch", action="store_true", help="不请求网络，只用已有 CSV")
    parser.add_argument("--force-fetch", action="store_true", help="忽略缓存重拉")
    parser.add_argument("--auction-last", type=int, default=4, help="拉最近 N 个交易日的 stk_auction")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    client = None if args.skip_fetch else TushareClient()

    if args.skip_fetch:
        daily = pd.read_csv(OUT / "six_daily.csv") if (OUT / "six_daily.csv").exists() else pd.DataFrame()
        basic = pd.read_csv(OUT / "six_daily_basic.csv") if (OUT / "six_daily_basic.csv").exists() else pd.DataFrame()
        lim = pd.read_csv(OUT / "six_limit.csv") if (OUT / "six_limit.csv").exists() else pd.DataFrame()
        auc = pd.read_csv(OUT / "six_auction.csv") if (OUT / "six_auction.csv").exists() else pd.DataFrame()
    else:
        assert client is not None
        daily = fetch_per_code(client, "daily", args.start, args.end, "six_daily.csv", args.force_fetch)
        basic = fetch_per_code(client, "daily_basic", args.start, args.end, "six_daily_basic.csv", args.force_fetch)
        lim = fetch_per_code(client, "stk_limit", args.start, args.end, "six_limit.csv", args.force_fetch)
        days = open_days(client, args.start, args.end, args.force_fetch)
        use_days = days[-max(args.auction_last, 1) :]
        _log(f"auction days: {use_days}")
        auc = fetch_auction_days(client, use_days, args.force_fetch)

    # 合并开盘/涨停
    if not daily.empty:
        merged = daily.copy()
        merged["label"] = merged["ts_code"].map(LABEL)
        if not lim.empty:
            merged = merged.merge(
                lim[["ts_code", "trade_date", "up_limit", "down_limit"]],
                on=["ts_code", "trade_date"],
                how="left",
            )
        merged = _to_num(merged, ["open", "close", "pre_close", "pct_chg", "up_limit", "down_limit", "vol", "amount"])
        merged["open_pct"] = (merged["open"] / merged["pre_close"] - 1.0) * 100.0
        if "up_limit" in merged.columns:
            merged["is_open_limit"] = (merged["open"] - merged["up_limit"]).abs() <= 0.011
            merged["is_close_limit"] = (merged["close"] - merged["up_limit"]).abs() <= 0.011
        if not auc.empty:
            a2 = auc.copy()
            if "auction_pct" not in a2.columns:
                a2 = _to_num(a2, ["price", "pre_close"])
                a2["auction_pct"] = (a2["price"] / a2["pre_close"] - 1.0) * 100.0
            keep = [
                c
                for c in [
                    "ts_code",
                    "trade_date",
                    "price",
                    "auction_pct",
                    "vol",
                    "amount",
                    "turnover_rate",
                    "volume_ratio",
                    "float_share",
                ]
                if c in a2.columns
            ]
            merged = merged.merge(a2[keep], on=["ts_code", "trade_date"], how="left", suffixes=("", "_auc"))
        merged.to_csv(OUT / "six_merged.csv", index=False, encoding="utf-8-sig")
        _log(f"wrote {OUT / 'six_merged.csv'}")

    md = summarize(daily, basic, lim, auc)
    md_path = OUT / "commonality_summary.md"
    md_path.write_text(md, encoding="utf-8")
    _log(f"wrote {md_path}")
    print("\n" + md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
