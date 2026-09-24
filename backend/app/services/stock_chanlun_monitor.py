"""个股缠论监控：按标的+周期+买卖点评估，命中写入告警。"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.chanlun import SIGNAL_LABELS, build_chanlun, chanlun_position, chanlun_summary
from app.models import StockMonitor
from app.security import utcnow

logger = logging.getLogger(__name__)

PERIODS = {"day", "d5"}
THEORIES = {"chanlun"}
SIGNALS = set(SIGNAL_LABELS) | {"all"}
PERIOD_LABELS = {"day": "日K", "d5": "5日K"}
RECENT_BARS = 20
DAILY_LOOKBACK_DAYS = 800

_cache_lock = threading.Lock()
_result_cache: dict[tuple[str, str, str], tuple[float, dict[str, Any]]] = {}
CACHE_TTL_S = 30.0


class StockMonitorError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _normalize_symbol(symbol: str) -> str:
    value = symbol.strip().upper()
    if not value:
        raise StockMonitorError("标的不能为空")
    return value


def _validate(period: str, signal: str) -> tuple[str, str]:
    period = (period or "day").strip().lower()
    signal = (signal or "all").strip().lower()
    if period not in PERIODS:
        raise StockMonitorError("周期仅支持日K / 5日K")
    if signal not in SIGNALS:
        raise StockMonitorError("信号必须是买1/卖1/买2/卖2/买3/卖3，或全部")
    return period, signal


def to_read(row: StockMonitor, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "id": row.id,
        "symbol": row.symbol,
        "name": row.name or row.symbol,
        "theory": "chanlun",
        "period": row.period,
        "period_label": PERIOD_LABELS.get(row.period, row.period),
        "signal": row.signal,
        "signal_label": "缠论" if row.signal == "all" else SIGNAL_LABELS.get(row.signal, row.signal),
        "created_at": None if row.created_at is None else row.created_at.isoformat(),
    }
    if extra:
        payload.update(extra)
    return payload


def list_for_user(database: Session, user_id: str) -> list[StockMonitor]:
    return list(
        database.scalars(
            select(StockMonitor)
            .where(StockMonitor.user_id == user_id)
            .order_by(StockMonitor.created_at.desc())
        ).all()
    )


def create(
    database: Session,
    user_id: str,
    *,
    symbol: str,
    name: str = "",
    period: str = "day",
    signal: str = "all",
    theory: str = "chanlun",
) -> StockMonitor:
    if (theory or "chanlun").strip().lower() not in THEORIES:
        raise StockMonitorError("暂只支持缠论")
    symbol = _normalize_symbol(symbol)
    period, signal = _validate(period, signal)
    existing = database.scalar(
        select(StockMonitor).where(
            StockMonitor.user_id == user_id,
            StockMonitor.symbol == symbol,
            StockMonitor.period == period,
            StockMonitor.signal == signal,
        )
    )
    if existing is not None:
        raise StockMonitorError("该标的已在监控中", 409)
    row = StockMonitor(
        user_id=user_id,
        symbol=symbol,
        name=(name or "").strip()[:64],
        period=period,
        signal=signal,
    )
    database.add(row)
    database.commit()
    database.refresh(row)
    return row


def delete(database: Session, user_id: str, monitor_id: str) -> None:
    row = database.scalar(
        select(StockMonitor).where(StockMonitor.id == monitor_id, StockMonitor.user_id == user_id)
    )
    if row is None:
        raise StockMonitorError("监控不存在", 404)
    database.delete(row)
    database.commit()


def resample_kline(rows: list[dict[str, Any]], size: int) -> list[dict[str, Any]]:
    if size <= 1:
        return rows
    out: list[dict[str, Any]] = []
    for i in range(0, len(rows), size):
        chunk = rows[i : i + size]
        first, last = chunk[0], chunk[-1]
        highs = [v for v in (_num(r.get("high")) for r in chunk) if v is not None]
        lows = [v for v in (_num(r.get("low")) for r in chunk) if v is not None]
        out.append(
            {
                "date": last.get("date"),
                "open": first.get("open"),
                "close": last.get("close"),
                "high": max(highs) if highs else last.get("high"),
                "low": min(lows) if lows else last.get("low"),
                "volume": sum(_num(r.get("volume")) or 0 for r in chunk),
                "amount": sum(_num(r.get("amount")) or 0 for r in chunk),
            }
        )
    return out



def _num(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _as_of_key(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    return str(rows[-1].get("date") or "")


def load_rows(app_state: Any, symbol: str, period: str) -> list[dict[str, Any]]:
    repo = getattr(app_state, "repo", None)
    if repo is None:
        return []
    end = date.today()
    start = end - timedelta(days=DAILY_LOOKBACK_DAYS)
    try:
        asset_type = repo.resolve_asset_type(symbol)
        df = repo.get_daily_asset(asset_type, symbol, start, end)
    except Exception as exc:  # noqa: BLE001
        logger.warning("stock monitor load %s failed: %s", symbol, exc)
        return []
    if df is None or df.is_empty():
        return []
    rows = df.to_dicts()
    if period == "d5":
        rows = resample_kline(rows, 5)
    return rows


def evaluate_rows(rows: list[dict[str, Any]], signal: str) -> dict[str, Any]:
    result = build_chanlun(rows)
    summary = chanlun_summary(result)
    position = chanlun_position(result, len(rows))
    kinds = list(SIGNAL_LABELS) if signal == "all" else [signal]
    cutoff = max(0, len(rows) - RECENT_BARS)
    hit_kinds: list[str] = []
    keys: list[str] = []
    last_date = None
    for kind in kinds:
        matches = [s for s in result.signals if s.kind == kind]
        last = matches[-1] if matches else None
        if last is not None and last.at.x >= cutoff:
            hit_kinds.append(kind)
            keys.append(f"{last.kind}:{last.at.x}:{last.at.price}")
            last_date = last.at.date
    last_close = _num(rows[-1].get("close")) if rows else None
    last_pct = _num(rows[-1].get("change_pct")) if rows else None
    return {
        "hit": bool(hit_kinds),
        "hit_key": "|".join(keys) if keys else None,
        "hit_signals": hit_kinds,
        "signal_labels": [SIGNAL_LABELS.get(kind, kind) for kind in hit_kinds],
        "summary": summary,
        "position": position,
        "signal_at": last_date,
        "close": last_close,
        "change_pct": last_pct,
        "xianduan": len(result.xianduan),
        "zhongshu": len(result.xd_zhongshu) or len(result.zhongshu),
    }


def _cached_eval(app_state: Any, symbol: str, period: str, signal: str) -> dict[str, Any]:
    rows = load_rows(app_state, symbol, period)
    stamp = _as_of_key(rows)
    cache_key = (symbol, period, stamp)
    now = time.time()
    with _cache_lock:
        cached = _result_cache.get(cache_key)
        if cached is not None and now - cached[0] < CACHE_TTL_S:
            built = cached[1]
        else:
            built = None
    if built is None:
        built = {"rows": rows, "by_signal": {}}
        with _cache_lock:
            _result_cache[cache_key] = (now, built)
            if len(_result_cache) > 256:
                oldest = sorted(_result_cache.items(), key=lambda item: item[1][0])[:64]
                for key, _ in oldest:
                    _result_cache.pop(key, None)
    by_signal = built["by_signal"]
    if signal not in by_signal:
        by_signal[signal] = evaluate_rows(built["rows"], signal)
    return by_signal[signal]


def evaluate_user(
    database: Session,
    app_state: Any,
    user_id: str,
    *,
    emit_events: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = list_for_user(database, user_id)
    watches: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    dirty = False
    for watch in rows:
        first = watch.last_eval_at is None
        try:
            extra = _cached_eval(app_state, watch.symbol, watch.period, watch.signal)
        except Exception as exc:  # noqa: BLE001
            logger.warning("stock chanlun %s failed: %s", watch.symbol, exc)
            extra = {"hit": False, "hit_key": None, "hit_signals": [], "signal_labels": [], "summary": "评估失败", "position": "", "close": None, "change_pct": None}
        hit_key = extra.get("hit_key")
        if emit_events and not first:
            prev_keys = set(filter(None, (watch.last_hit_key or "").split("|")))
            curr_keys = set(filter(None, str(hit_key or "").split("|")))
            period_label = PERIOD_LABELS.get(watch.period, watch.period)
            name = watch.name or watch.symbol
            for key in sorted(curr_keys - prev_keys):
                kind = key.split(":", 1)[0]
                label = SIGNAL_LABELS.get(kind, kind)
                events.append(
                    {
                        "source": "stock_chanlun",
                        "type": "signal_hit",
                        "rule_id": watch.id,
                        "strategy_id": watch.id,
                        "user_id": user_id,
                        "asset_type": "stock",
                        "symbol": watch.symbol,
                        "name": name,
                        "message": f"{name} {period_label}出现缠论{label}",
                        "price": extra.get("close"),
                        "change_pct": extra.get("change_pct"),
                        "signals": [label],
                        "severity": "info",
                        "ts": int(time.time() * 1000),
                    }
                )
        if watch.last_hit_key != hit_key or watch.last_eval_at is None:
            watch.last_hit_key = hit_key
            watch.last_eval_at = utcnow()
            dirty = True
        watches.append(to_read(watch, extra))
    if dirty:
        database.commit()
    return watches, events


def persist_events(app_state: Any, events: list[dict[str, Any]]) -> None:
    if not events:
        return
    repo = getattr(app_state, "repo", None)
    if repo is not None:
        try:
            from app.services import alert_store

            alert_store.append_many(repo.store.data_dir, events)
        except Exception as exc:  # noqa: BLE001
            logger.warning("stock chanlun alerts persist failed: %s", exc)
    qs = getattr(app_state, "quote_service", None)
    if qs is not None:
        qs.push_alerts(
            [
                {
                    "source": event["source"],
                    "type": event["type"],
                    "rule_id": event.get("rule_id"),
                    "strategy_id": event.get("strategy_id"),
                    "user_id": event.get("user_id"),
                    "asset_type": event.get("asset_type") or "stock",
                    "symbol": event["symbol"],
                    "name": event.get("name"),
                    "message": event["message"],
                    "price": event.get("price"),
                    "change_pct": event.get("change_pct"),
                    "signals": event.get("signals") or [],
                    "severity": event.get("severity", "info"),
                    "ts": event.get("ts"),
                }
                for event in events
            ]
        )
        qs.notify_strategy_results_updated()
