"""把历史 shadow_snapshots 补上 rank_top（截面前 10），不改持仓。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from etf_strategy.core.data_loader import DataLoader  # noqa: E402
from etf_strategy.core.factor_cache import FactorCache  # noqa: E402
from etf_strategy.scripts.generate_today_signal import (  # noqa: E402
    _top_rank_rows,
)


def load_std_factors(asof: str):
    cfg = yaml.safe_load((ROOT / "configs" / "combo_wfo_config.yaml").read_text(encoding="utf-8"))
    proto_symbols = [str(s) for s in cfg["data"]["symbols"]]
    loader = DataLoader(data_dir=cfg["data"].get("data_dir"), cache_dir=cfg["data"].get("cache_dir"))
    ohlcv = loader.load_ohlcv(etf_codes=proto_symbols, start_date="2020-01-01", end_date=asof)
    cache = FactorCache(cache_dir=Path(cfg["data"].get("cache_dir") or ROOT / ".cache"))
    cached = cache.get_or_compute(ohlcv=ohlcv, config=cfg, data_dir=loader.data_dir, loader=loader)
    return ohlcv["close"], cached["std_factors"], cfg


def score_combo(std_factors, tickers, asof_ts, combo: str, signs_raw: str):
    factors = [s.strip() for s in combo.split("+") if s.strip()]
    signs = [int(s) for s in str(signs_raw).split(",")] if signs_raw else [1] * len(factors)
    n = len(factors)
    weights = [1.0 / n] * n
    scores = np.full(len(tickers), -np.inf, dtype=float)
    for i, ticker in enumerate(tickers):
        s = 0.0
        has = False
        for f, sign, w in zip(factors, signs, weights):
            if f not in std_factors:
                continue
            try:
                v = std_factors[f].at[asof_ts, ticker]
            except Exception:
                continue
            if pd.notna(v):
                s += sign * w * n * float(v)
                has = True
        if has and s != 0.0:
            scores[i] = s
    return scores


def main() -> int:
    jsonl = ROOT / "data" / "live" / "shadow_snapshots.jsonl"
    rows = []
    for line in jsonl.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    dates = sorted({str(r.get("asof_date")) for r in rows if r.get("asof_date")})
    defs = yaml.safe_load((ROOT / "configs" / "shadow_strategies.yaml").read_text(encoding="utf-8"))
    by_name = {s["name"]: s for s in defs.get("shadow_strategies", [])}

    patched = 0
    for asof in dates:
        close_df, std_factors, _cfg = load_std_factors(asof)
        asof_ts = pd.Timestamp(asof)
        if asof_ts not in close_df.index:
            print("skip missing asof", asof)
            continue
        tickers = close_df.columns.tolist()
        for row in rows:
            if str(row.get("asof_date")) != asof:
                continue
            spec = by_name.get(row.get("strategy"))
            if not spec:
                continue
            scores = score_combo(std_factors, tickers, asof_ts, spec["combo"], spec.get("factor_signs", ""))
            row["rank_top"] = _top_rank_rows(scores, tickers, 10)
            patched += 1
            print(asof, row["strategy"], [x["symbol"] for x in row["rank_top"][:5]])

    jsonl.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    print("patched jsonl", patched)

    hist = ROOT / "data" / "live" / "history" / "signals"
    for path in hist.glob("*.json"):
        path.unlink()
        print("cleared", path.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
