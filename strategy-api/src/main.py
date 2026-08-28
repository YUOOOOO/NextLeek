from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Optional

# Windows 默认 GBK，print/日志里的 ⚠ 会炸；任务输出统一 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import load_config, reload_config, tradeable_symbols
from .jobs.runner import get_job, get_result, list_jobs, submit_job
from .jobs.scheduler import schedule_info, start_scheduler
from .sealed_publish import PRIMARY_STRATEGY_NAME, publish_primary_strategy
from .factor_catalog import build_factor_catalog
from .stock_strategy.auction_long import score_auction_long
from .stock_strategy.screeners import available_dates as stock_cache_dates
from .stock_strategy.screeners import list_strategies as list_stock_screens
from .history_store import (
    list_signal_dates,
    list_stock_pick_dates,
    load_signal_snapshot,
    load_stock_picks,
    neighbors,
    save_signal_snapshot,
    save_stock_picks,
)


from .data.symbols import market_of, normalize_code, parquet_stem
from .paths import CONFIG_PATH, JOBS_DIR, LIVE_DIR, RAW_DAILY_DIR, SIGNAL_STATE_PATH, ensure_data_dirs

# 日线收盘缓存：path -> (mtime, [(YYYYMMDD, adj_close), ...])
_CLOSE_CACHE: dict[str, tuple[float, list[tuple[str, float]]]] = {}


def _shadow_strategies() -> list[dict[str, Any]]:
    path = CONFIG_PATH.parent / "shadow_strategies.yaml"
    if not path.exists():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return list(raw.get("shadow_strategies", []))


def _strategy_id(strategy: dict[str, Any]) -> str:
    return str(strategy.get("name") or strategy.get("id") or strategy.get("combo") or "unknown")


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _factor_signs(factors: list[str]) -> dict[str, int]:
    """优先读 registry；失败时按 low_is_good 名单兜底。"""
    low_is_good = {
        "SHARE_CHG_5D",
        "SHARE_CHG_10D",
        "SHARE_CHG_20D",
        "MARGIN_CHG_10D",
        "MARGIN_BUY_RATIO",
        "VOL_20D",
        "MAX_DD_60D",
        "AMIHUD_ILLIQUIDITY",
    }
    try:
        import importlib.util

        registry_path = Path(__file__).resolve().parent / "etf_strategy" / "core" / "factor_registry.py"
        spec = importlib.util.spec_from_file_location("_nl_factor_registry", registry_path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            get_dir = getattr(module, "get_factor_direction", None)
            if callable(get_dir):
                return {
                    factor: -1 if get_dir(factor) == "low_is_good" else 1
                    for factor in factors
                }
    except Exception:
        pass
    return {factor: -1 if factor in low_is_good else 1 for factor in factors}

def _find_daily_parquet(code: str):
    """优先 ohlcv 日线，其次旧文件名。"""
    bare = normalize_code(code)
    market = market_of(code)
    for name in (f"{parquet_stem(code)}.parquet", f"{bare}.{market}_daily.parquet"):
        path = RAW_DAILY_DIR / name
        if path.exists():
            return path
    matches = sorted(RAW_DAILY_DIR.glob(f"{bare}.*_daily*.parquet"))
    return matches[0] if matches else None


def _load_closes(code: str) -> list[tuple[str, float]]:
    """读本地 parquet 的 adj_close，按交易日升序。"""
    path = _find_daily_parquet(code)
    if path is None:
        return []
    key = str(path)
    mtime = path.stat().st_mtime
    cached = _CLOSE_CACHE.get(key)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        import pandas as pd

        df = pd.read_parquet(path, columns=["trade_date", "adj_close"])
    except Exception:
        return []
    rows: list[tuple[str, float]] = []
    for _, item in df.iterrows():
        stamp = str(item["trade_date"]).replace("-", "")[:8]
        if len(stamp) != 8 or not stamp.isdigit():
            continue
        try:
            close = float(item["adj_close"])
        except (TypeError, ValueError):
            continue
        if close <= 0:
            continue
        rows.append((stamp, close))
    rows.sort(key=lambda x: x[0])
    _CLOSE_CACHE[key] = (mtime, rows)
    return rows


def _count_weekdays(start, end) -> int:
    """不含起始日、含结束日的工作日数（周末不算）。"""
    from datetime import timedelta

    if start is None or end is None or end <= start:
        return 0
    n = 0
    cursor = start
    while cursor < end:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            n += 1
    return n


def _holding_period_stats(
    symbol: str,
    *,
    asof: Any,
    hold_days: int,
    since: Any,
) -> dict[str, Any]:
    """本轮起始日、已持工作日、持有期收益。

    since_date 用信号日/换仓日，不被过期 parquet 吸回 8/20。
    进出场收盘必须落在目标日；缺 K 线就返回空收益，不要用旧价算出 0%。
    """
    from datetime import date as date_cls

    asof_dt = _parse_ymd(asof)
    since_dt = _parse_ymd(since) or asof_dt
    today = date_cls.today()
    since_stamp = since_dt.strftime("%Y%m%d") if since_dt else None
    last_wanted = today.strftime("%Y%m%d")

    closes = _load_closes(symbol)
    close_map = dict(closes)
    # 最新收盘：进场日（含）到今天之间本地最后一根，27 号未收盘就用 26 号
    eligible = [
        row for row in closes
        if since_stamp and last_wanted and since_stamp <= row[0] <= last_wanted
    ]
    price_date = eligible[-1][0] if eligible else None

    elapsed = _count_weekdays(since_dt, today)
    if elapsed < 0:
        elapsed = 0

    entry = close_map.get(since_stamp) if since_stamp else None
    last = close_map.get(price_date) if price_date else None
    hold_return = None
    if entry is not None and last is not None:
        hold_return = last / entry - 1.0
    return {
        "since_date": since_stamp,
        "hold_days": elapsed,
        "hold_return": None if hold_return is None else round(hold_return, 6),
        "entry_close": None if entry is None else round(entry, 4),
        "last_close": None if last is None else round(last, 4),
        "price_date": price_date,
    }


def _parse_ymd(value: Any) -> Any:
    """把 YYYYMMDD / YYYY-MM-DD 解析成 date；失败返回 None。"""
    if value is None:
        return None
    text = str(value).strip().replace("-", "").replace("/", "")[:8]
    if len(text) != 8 or not text.isdigit():
        return None
    try:
        from datetime import date

        return date(int(text[:4]), int(text[4:6]), int(text[6:8]))
    except Exception:
        return None


def _resolve_last_rebalance(
    raw: dict[str, Any],
    *,
    asof: Any = None,
    hold_days: dict[str, int] | None = None,
    default_asof: Any = None,
) -> Any:
    """解析上次换仓参考日。

    - canonical shadow 状态文件：只在调仓日写入，父级 last_asof_date 即上次换仓日
    - shadow_snapshots.jsonl：仅信任 is_rebalance=true 行带来的 explicit last_rebalance
    - legacy signal_state：简化引擎曾写入一次性 last_rebalance，若与 asof/hold_days 明显矛盾则丢弃
    """
    explicit = raw.get("last_rebalance")
    source = str(raw.get("source") or "")
    has_canonical_portfolio = raw.get("signal_portfolio") is not None

    # 快照回退：非调仓日 asof 不能冒充换仓参考日
    if source.startswith("shadow_snapshot"):
        return explicit

    # canonical shadow 状态文件 / 扁平 shadow：优先用父状态 last_asof_date
    if has_canonical_portfolio or source.startswith("shadow"):
        return explicit or raw.get("last_asof_date") or default_asof


    if explicit is None:
        return None

    # legacy：用 hold_days 与 asof 校验，避免永久钉死在首次错误 asof（如 20260210）
    asof_dt = _parse_ymd(asof)
    rebal_dt = _parse_ymd(explicit)
    if asof_dt is None or rebal_dt is None:
        return explicit

    max_hold = 0
    for days in (hold_days or {}).values():
        try:
            max_hold = max(max_hold, int(days))
        except Exception:
            continue

    gap = (asof_dt - rebal_dt).days
    # hold_days 按交易日计，日历 gap 远大于持有天数 → 参考日不可信
    if max_hold >= 0 and gap > max(max_hold + 20, 30):
        return None
    return explicit



def _score_map(picks: list[str], scores: Any) -> dict[str, float]:
    """picks 与 scores 按位对齐成 {代码: 评分}。"""
    if not isinstance(scores, list):
        return {}
    out: dict[str, float] = {}
    for i, symbol in enumerate(picks):
        if i >= len(scores):
            break
        try:
            out[str(symbol)] = float(scores[i])
        except (TypeError, ValueError):
            continue
    return out


def _normalize_rank_top(raw: Any) -> list[dict[str, Any]]:
    """截面前 10：[{symbol, score, rank}]。"""
    if not isinstance(raw, list):
        return []
    rows: list[dict[str, Any]] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or item.get("code") or "").strip()
        if not symbol:
            continue
        score = item.get("score")
        try:
            score_n = None if score is None else round(float(score), 4)
        except (TypeError, ValueError):
            score_n = None
        try:
            rank = int(item.get("rank") or i + 1)
        except (TypeError, ValueError):
            rank = i + 1
        rows.append({"symbol": symbol, "score": score_n, "rank": rank})
        if len(rows) >= 10:
            break
    return rows


def _extract_strategy_payload(
    sid: str,
    raw: dict[str, Any],
    definition: dict[str, Any],
    *,
    default_asof: Any = None,
    generated_at: Any = None,
    enrich_holdings: bool = True,
) -> dict[str, Any]:
    """把 legacy holdings 或 canonical signal_portfolio 统一成前端 payload。"""
    holdings = [
        str(symbol)
        for symbol in (
            raw.get("signal_portfolio")
            or raw.get("holdings")
            or raw.get("picks")
            or []
        )
    ]
    hold_days_src = raw.get("signal_hold_days") or raw.get("hold_days") or {}
    hold_days = {str(symbol): int(days) for symbol, days in hold_days_src.items()}
    scores = _score_map(holdings, raw.get("scores"))
    if isinstance(raw.get("score_map"), dict):
        for symbol, value in raw["score_map"].items():
            try:
                scores[str(symbol)] = float(value)
            except (TypeError, ValueError):
                continue

    actions = list(raw.get("last_actions") or [])
    if not actions:
        actions = [
            {
                "symbol": symbol,
                "action": "current",
                "label": "当前持仓",
                "reason": "最新信号持仓",
                "hold_days": hold_days.get(symbol, 0),
                "score": scores.get(symbol),
            }
            for symbol in holdings
        ]

    factors = [
        factor.strip()
        for factor in str(definition.get("combo") or "").split("+")
        if factor.strip()
    ]
    if not factors and isinstance(raw.get("factors"), list):
        factors = [str(f) for f in raw["factors"]]
    if not factors:
        factors = [str(sid)]

    asof = (
        raw.get("last_signal_asof")
        or raw.get("last_seen_asof")
        or raw.get("last_asof_date")
        or default_asof
    )
    summary = raw.get("last_summary") or (
        f"当前持仓 {len(holdings)} 只" if holdings else "暂无持仓"
    )
    last_rebalance = _resolve_last_rebalance(
        raw,
        asof=asof,
        hold_days=hold_days,
        default_asof=default_asof,
    )

    # 当日实时补持有期；历史翻页冻结快照，不再按今天重算
    enriched: list[dict[str, Any]] = []
    for action in actions:
        item = dict(action) if isinstance(action, dict) else {"symbol": str(action)}
        symbol = str(item.get("symbol") or "")
        frozen_days = int(item.get("hold_days") or hold_days.get(symbol, 0) or 0)
        if enrich_holdings:
            stats = _holding_period_stats(
                symbol,
                asof=asof,
                hold_days=frozen_days,
                since=last_rebalance or asof,
            )
            item["hold_days"] = int(stats["hold_days"])
            item["since_date"] = stats["since_date"]
            item["hold_return"] = stats["hold_return"]
            item["entry_close"] = stats["entry_close"]
            item["last_close"] = stats["last_close"]
            item["price_date"] = stats.get("price_date")
        else:
            item["hold_days"] = frozen_days
        if item.get("score") is None and symbol in scores:
            item["score"] = round(scores[symbol], 4)
        elif item.get("score") is not None:
            try:
                item["score"] = round(float(item["score"]), 4)
            except (TypeError, ValueError):
                item["score"] = scores.get(symbol)
        enriched.append(item)

    return {
        "strategy_id": str(sid),
        "name": definition.get("name") or raw.get("name") or str(sid),
        "factors": factors,
        "combo": definition.get("combo"),
        "asof": asof,
        "summary": summary,
        "actions": enriched,
        "holdings": holdings,
        "hold_days": hold_days,
        "last_rebalance": last_rebalance,
        "generated_at": raw.get("last_generated_at") or generated_at,
        "source": raw.get("source") or "signal_state",
        "rank_top": _normalize_rank_top(raw.get("rank_top")),
    }



def _iter_shadow_snapshot_rows() -> list[dict[str, Any]]:
    path = LIVE_DIR / "shadow_snapshots.jsonl"
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return []
    rows: list[dict[str, Any]] = []
    for line in lines:
        text = line.strip()
        if not text:
            continue
        try:
            row = json.loads(text)
        except Exception:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _stamp8(value: Any) -> str | None:
    text = str(value or "").replace("-", "").replace("/", "")[:8]
    return text if len(text) == 8 and text.isdigit() else None


def _latest_shadow_snapshots() -> dict[str, dict[str, Any]]:
    """从 append-only shadow_snapshots.jsonl 取每策略最新一行，并附带最近一次调仓日。"""
    latest: dict[str, dict[str, Any]] = {}
    last_rebalance_asof: dict[str, Any] = {}
    for row in _iter_shadow_snapshot_rows():
        name = str(row.get("strategy") or "").strip()
        if not name:
            continue
        latest[name] = row
        if row.get("is_rebalance"):
            last_rebalance_asof[name] = row.get("asof_date")
    out: dict[str, dict[str, Any]] = {}
    for name, row in latest.items():
        item = dict(row)
        item["_last_rebalance_asof"] = last_rebalance_asof.get(name)
        out[name] = item
    return out


def _shadow_snapshots_on(date: str) -> dict[str, dict[str, Any]]:
    """某交易日每策略最后一行；调仓日取该日及之前最近一次 is_rebalance。"""
    wanted = _stamp8(date)
    if not wanted:
        return {}
    latest: dict[str, dict[str, Any]] = {}
    last_rebalance_asof: dict[str, Any] = {}
    for row in _iter_shadow_snapshot_rows():
        name = str(row.get("strategy") or "").strip()
        stamp = _stamp8(row.get("asof_date") or row.get("trade_date"))
        if not name or not stamp or stamp > wanted:
            continue
        if stamp == wanted:
            latest[name] = row
        if row.get("is_rebalance"):
            last_rebalance_asof[name] = row.get("asof_date")
    out: dict[str, dict[str, Any]] = {}
    for name, row in latest.items():
        item = dict(row)
        item["_last_rebalance_asof"] = last_rebalance_asof.get(name)
        out[name] = item
    return out


def _jsonl_signal_dates() -> list[str]:
    dates = {
        _stamp8(row.get("asof_date") or row.get("trade_date"))
        for row in _iter_shadow_snapshot_rows()
    }
    return sorted(d for d in dates if d)


def _payload_from_snapshot_row(
    name: str,
    row: dict[str, Any],
    definition: dict[str, Any],
    *,
    enrich_holdings: bool,
) -> dict[str, Any]:
    raw = dict(row)
    raw.setdefault("source", f"snapshot:{name}")
    raw.setdefault("signal_portfolio", list(row.get("picks") or []))
    return _extract_strategy_payload(
        name,
        raw,
        definition,
        default_asof=row.get("asof_date"),
        generated_at=row.get("generated_at"),
        enrich_holdings=enrich_holdings,
    )


def _archive_from_jsonl(stamp: str) -> dict[str, Any] | None:
    snaps = _shadow_snapshots_on(stamp)
    if not snaps:
        return None
    definitions = {_strategy_id(item): item for item in _shadow_strategies()}
    strategies = [
        _payload_from_snapshot_row(
            name,
            row,
            definitions.get(name, {"name": name}),
            enrich_holdings=False,
        )
        for name, row in snaps.items()
    ]
    payload = {
        "version": "v8.0-shadow",
        "runtime_default": "canonical",
        "asof": stamp,
        "strategies": strategies,
        "note": None,
        "source": "shadow_snapshots",
    }
    save_signal_snapshot(payload)
    return payload


def _seed_signal_archives() -> None:
    """把 jsonl 里还没落盘的交易日补进 history/signals。"""
    for stamp in _jsonl_signal_dates():
        if load_signal_snapshot(stamp):
            continue
        _archive_from_jsonl(stamp)


def _history_nav(extra: list[str] | None = None, current: str | None = None) -> dict[str, Any]:
    dates = sorted(set(list_signal_dates()) | set(_jsonl_signal_dates()) | set(extra or []))
    return neighbors(dates, current)


def _signal_payload_for_date(date: str | None = None) -> dict[str, Any]:
    """无 date：实时持仓并落盘；有 date：只读该日快照。"""
    ensure_data_dirs()
    _seed_signal_archives()
    wanted = _stamp8(date) if date else None
    if wanted:
        cached = load_signal_snapshot(wanted)
        if cached and cached.get("strategies"):
            cached["history"] = _history_nav(current=wanted)
            return cached
        rebuilt = _archive_from_jsonl(wanted)
        if rebuilt:
            rebuilt["history"] = _history_nav(current=wanted)
            return rebuilt
        raise HTTPException(status_code=404, detail=f"no signal snapshot for {wanted}")

    strategies = _collect_shadow_strategy_states()
    signal_dates = [str(item.get("asof")) for item in strategies if item.get("asof")]
    asof = max(signal_dates) if signal_dates else None
    note = None
    if not any(item.get("source") != "sealed_definition" for item in strategies):
        note = "no signal yet; run job type=signal (default runtime=canonical)"
    payload = {
        "version": "v8.0-shadow",
        "runtime_default": "canonical",
        "asof": asof,
        "strategies": strategies,
        "note": note,
        "source": "live",
    }
    save_signal_snapshot(payload)
    payload["history"] = _history_nav(current=_stamp8(asof))
    return payload

def _collect_shadow_strategy_states() -> list[dict[str, Any]]:
    """优先读 canonical shadow 状态文件，再回退 signal_state.json。"""
    definitions = {_strategy_id(item): item for item in _shadow_strategies()}
    payloads: list[dict[str, Any]] = []
    seen: set[str] = set()

    for path in sorted(LIVE_DIR.glob("signal_state_shadow_*.json")):
        state = _load_json(path)
        name = path.stem.replace("signal_state_shadow_", "", 1)
        definition = definitions.get(name, {"name": name})
        strategies = state.get("strategies") or {}
        if strategies:
            # canonical 状态以 combo 为 key；对外统一成策略名。
            for combo, raw in strategies.items():
                raw = dict(raw or {})
                raw.setdefault("source", f"shadow:{name}")
                # 状态文件没有评分，从最新 snapshot 按代码补上
                snap = _latest_shadow_snapshots().get(name) or {}
                if not raw.get("scores") and snap.get("scores"):
                    raw["scores"] = list(snap.get("scores") or [])
                    if not raw.get("signal_portfolio") and snap.get("picks"):
                        raw["signal_portfolio"] = [str(x) for x in snap.get("picks") or []]
                if not raw.get("rank_top") and snap.get("rank_top"):
                    raw["rank_top"] = list(snap.get("rank_top") or [])
                if not definition.get("combo"):
                    definition = {**definition, "combo": combo}
                payload = _extract_strategy_payload(
                    name,
                    raw,
                    definition,
                    default_asof=state.get("last_asof_date"),
                    generated_at=state.get("generated_at"),
                )
                payloads.append(payload)
                seen.add(name)
                break
        else:
            # 兼容扁平 shadow 文件
            payload = _extract_strategy_payload(
                name,
                state,
                definition,
                default_asof=state.get("last_asof_date"),
                generated_at=state.get("generated_at"),
            )
            payloads.append(payload)
            seen.add(name)

    # 回退：canonical 非调仓日不写 shadow 状态文件时，读最新 snapshot
    for name, row in _latest_shadow_snapshots().items():
        if name in seen:
            continue
        definition = definitions.get(name, {"name": name, "combo": row.get("combo")})
        if not definition.get("combo") and row.get("combo"):
            definition = {**definition, "combo": row.get("combo")}
        picks = [str(symbol) for symbol in (row.get("picks") or []) if symbol]
        hold_days = {
            str(symbol): int(days)
            for symbol, days in (row.get("hold_days") or {}).items()
        }
        raw = {
            "signal_portfolio": picks,
            "signal_hold_days": hold_days,
            "scores": list(row.get("scores") or []),
            "rank_top": list(row.get("rank_top") or []),
            "last_signal_asof": row.get("asof_date"),
            "last_rebalance": row.get("_last_rebalance_asof"),
            "source": f"shadow_snapshot:{name}",
        }
        payloads.append(
            _extract_strategy_payload(
                name,
                raw,
                definition,
                default_asof=row.get("asof_date"),
                generated_at=None,
            )
        )
        seen.add(name)

    # 回退：旧 legacy signal_state.json（按策略 id）
    legacy = _load_json(SIGNAL_STATE_PATH)
    for sid, raw in (legacy.get("strategies") or {}).items():
        sid = str(sid)
        if sid in seen:
            continue
        definition = definitions.get(sid, {"name": sid})
        raw = dict(raw or {})
        raw.setdefault("source", "legacy_signal_state")
        payloads.append(
            _extract_strategy_payload(
                sid,
                raw,
                definition,
                default_asof=legacy.get("last_asof_date"),
                generated_at=legacy.get("generated_at"),
            )
        )
        seen.add(sid)

    # 保证封版策略都出现在列表中（即便还没跑过信号）
    for item in _shadow_strategies():
        sid = _strategy_id(item)
        if sid in {p["strategy_id"] for p in payloads}:
            continue
        payloads.append(
            {
                "strategy_id": sid,
                "name": item.get("name", sid),
                "factors": [
                    f.strip() for f in str(item.get("combo", "")).split("+") if f.strip()
                ],
                "combo": item.get("combo"),
                "asof": None,
                "summary": "尚未生成信号",
                "actions": [],
                "holdings": [],
                "hold_days": {},
                "last_rebalance": None,
                "generated_at": None,
                "source": "sealed_definition",
            }
        )

    return payloads

app = FastAPI(title="NextLeek Strategy API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobCreate(BaseModel):
    type: str = Field(..., description="update-data|wfo|vec|bt|pipeline|signal")
    params: Optional[dict[str, Any]] = None


class SealPublishBody(BaseModel):
    combo: Any = Field(..., description="factor list or A+B+C string")
    source_job_id: Optional[str] = None
    factor_signs: Optional[str] = None
    note: Optional[str] = None
    metrics: Optional[dict[str, Any]] = None


@app.on_event("startup")
def _startup() -> None:
    ensure_data_dirs()
    # 每个交易日 15:30（北京时间）自动更新行情并生成信号
    start_scheduler()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "strategy-api",
        "runtime_default": "canonical",
        "sealed_count": len(_shadow_strategies()),
        "schedule": schedule_info(),
    }


@app.get("/api/universe")
def universe() -> dict[str, Any]:
    cfg = load_config()
    active_factors = list(cfg.get("active_factors") or [])
    catalog = build_factor_catalog(active_factors)
    return {
        "mode": cfg.get("universe", {}).get("mode", "A_SHARE_ONLY"),
        "qdii_tickers": cfg.get("universe", {}).get("qdii_tickers", []),
        "symbols": cfg.get("data", {}).get("symbols", []),
        "tradeable": tradeable_symbols(cfg),
        "active_factors": active_factors,
        "factor_catalog": catalog,
        "factor_count": len(catalog),
        "backtest": {
            "freq": cfg.get("backtest", {}).get("freq"),
            "pos_size": cfg.get("backtest", {}).get("pos_size"),
            "lookback_window": cfg.get("backtest", {}).get("lookback_window"),
            "hysteresis": cfg.get("backtest", {}).get("hysteresis", {}),
        },
        "schedule": schedule_info(),
    }


@app.get("/api/stock-picks")
def stock_picks(date: str = "", top_n: int = 20) -> dict[str, Any]:
    """选股页：剔除噪音后百分位综合得分，默认 Top 20。"""
    import re

    if date and not re.fullmatch(r"\d{8}", date):
        raise HTTPException(status_code=400, detail="date must be YYYYMMDD")
    if top_n < 1 or top_n > 50:
        raise HTTPException(status_code=400, detail="top_n must be between 1 and 50")

    cache_dates = stock_cache_dates()
    dates = sorted(set(cache_dates) | set(list_stock_pick_dates()))
    wanted = date or None
    if wanted and wanted not in dates and dates:
        raise HTTPException(status_code=404, detail=f"no stock-pick snapshot for {wanted}")
    current = wanted or (dates[-1] if dates else None)
    if current:
        cached = load_stock_picks(current)
        if cached and cached.get("strategies"):
            cached["history"] = neighbors(sorted(set(dates) | set(list_stock_pick_dates())), current)
            return cached
    try:
        payload = list_stock_screens(date=current, top_n=top_n)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    save_stock_picks(payload)
    stamp = str(payload.get("date") or current or "")
    all_dates = sorted(set(dates) | set(list_stock_pick_dates()) | ({stamp} if stamp else set()))
    payload["history"] = neighbors(all_dates, stamp)
    return payload


@app.get("/api/auction-long")
def auction_long(date: str = "", top_n: int = 6) -> dict[str, Any]:
    """Return the transparent auction-long ranking for a cached trade date."""
    import re

    if not re.fullmatch(r"\d{8}", date):
        raise HTTPException(status_code=400, detail="date must be YYYYMMDD")
    if top_n < 1 or top_n > 100:
        raise HTTPException(status_code=400, detail="top_n must be between 1 and 100")

    cache = Path(__file__).resolve().parents[1] / "results" / "_auction_long_research" / f"stk_auction_{date}.csv"
    if not cache.is_file():
        raise HTTPException(status_code=404, detail=f"auction cache not found for {date}")
    try:
        import pandas as pd

        scored = score_auction_long(pd.read_csv(cache), top_n=top_n)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"auction scoring failed: {exc}") from exc

    component_names = {
        "auction_strength_score": "auction_strength",
        "auction_amount_score": "auction_amount",
        "volume_ratio_score": "volume_ratio",
        "turnover_score": "turnover",
        "momentum_score": "momentum",
    }
    rows = []
    for record in scored.to_dict(orient="records"):
        rows.append(
            {
                "rank": int(record["rank"]),
                "ts_code": record["ts_code"],
                "auction_pct": round(float(record["auction_pct"]) * 100, 4),
                "total_score": round(float(record["total_score"]), 4),
                "selected": bool(record["selected"]),
                "components": {
                    label: round(float(record[column]) * 100, 4)
                    for column, label in component_names.items()
                },
            }
        )
    return {
        "strategy": "auction-long-v1",
        "date": date,
        "top_n": top_n,
        "universe_size": len(scored),
        "weights": {
            "auction_strength": 0.45,
            "auction_amount": 0.20,
            "volume_ratio": 0.15,
            "turnover": 0.10,
            "momentum": 0.10,
        },
        "rows": rows,
    }


@app.get("/api/sealed")
def sealed() -> dict[str, Any]:
    strategies = _shadow_strategies()
    factors = sorted(
        {
            factor
            for strategy in strategies
            for factor in str(strategy.get("combo", "")).split("+")
            if factor
        }
    )
    signs = _factor_signs(factors)
    return {
        "runtime_default": "canonical",
        "sealed": [
            {
                "id": _strategy_id(strategy),
                "name": strategy.get("name", _strategy_id(strategy)),
                "factors": [
                    f.strip()
                    for f in str(strategy.get("combo", "")).split("+")
                    if f.strip()
                ],
                "combo": strategy.get("combo"),
                "factor_signs": strategy.get("factor_signs")
                or ",".join(
                    str(
                        signs.get(f.strip(), 1)
                    )
                    for f in str(strategy.get("combo", "")).split("+")
                    if f.strip()
                ),
            }
            for strategy in strategies
        ],
        "factor_signs": signs,
    }

@app.post("/api/sealed/publish")
def sealed_publish(body: SealPublishBody) -> dict[str, Any]:
    """研究通过后：用公共池内因子替换主策略封版（不改持仓、不自动 signal）。"""
    try:
        result = publish_primary_strategy(
            combo=body.combo,
            source_job_id=body.source_job_id,
            factor_signs=body.factor_signs,
            note=body.note,
            metrics=body.metrics,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"publish failed: {exc}") from exc

    # Ensure subsequent reads see new yaml (config cache is separate file)
    return {
        **result,
        "primary_slot": PRIMARY_STRATEGY_NAME,
        "sealed": sealed().get("sealed"),
    }


@app.post("/api/jobs")
def create_job(body: JobCreate) -> dict[str, str]:
    allowed = {"update-data", "wfo", "vec", "bt", "pipeline", "signal", "precompute"}
    if body.type not in allowed:
        raise HTTPException(status_code=400, detail=f"type must be one of {sorted(allowed)}")
    job_id = submit_job(body.type, body.params or {})
    return {"job_id": job_id}


@app.get("/api/jobs")
def jobs(limit: int = 50) -> dict[str, Any]:
    return {"items": list_jobs(limit=limit)}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    st = get_job(job_id)
    if not st:
        raise HTTPException(status_code=404, detail="job not found")
    return st


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: str) -> Any:
    st = get_job(job_id)
    if not st:
        raise HTTPException(status_code=404, detail="job not found")
    if st.get("status") != "succeeded":
        raise HTTPException(status_code=409, detail=f"job status is {st.get('status')}")
    result = get_result(job_id)
    if result is None:
        raise HTTPException(status_code=404, detail="result missing")
    return result


@app.get("/api/artifacts/{job_id}/{name:path}")
def artifact(job_id: str, name: str) -> FileResponse:
    job_dir = (JOBS_DIR / job_id).resolve()
    candidate = (job_dir / name).resolve()
    if job_dir not in candidate.parents or not candidate.is_file():
        raise HTTPException(status_code=404, detail="artifact not found")
    return FileResponse(candidate)


@app.get("/api/signal/latest")
def signal_latest(date: str = "") -> dict[str, Any]:
    """最新信号；date=YYYYMMDD 时读历史快照。"""
    import re

    if date and not re.fullmatch(r"\d{8}|\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=400, detail="date must be YYYYMMDD")
    return _signal_payload_for_date(date or None)



@app.post("/api/config/reload")
def config_reload() -> dict[str, str]:
    reload_config()
    return {"status": "reloaded"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8001, reload=True)
