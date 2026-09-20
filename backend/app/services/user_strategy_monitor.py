"""用户策略盘中监控：命中池进出，新进增加、离场移出。"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date
from typing import Any

import polars as pl

from app.db import session_scope
from app.services import user_strategies as svc
from app.services.screener import ScreenerService

logger = logging.getLogger(__name__)

EVAL_INTERVAL_S = 60.0
BATCH_LIMIT = 5


def _pool_key(user_id: str, strategy_id: str) -> str:
    return f"{user_id}:{strategy_id}"


def _stock_row(row: dict) -> dict[str, Any] | None:
    symbol = str(row.get("symbol") or "").strip()
    if not symbol:
        return None
    close = row.get("close")
    if close is None:
        close = row.get("last_price")
    name = str(row.get("name") or symbol)
    return {
        "symbol": symbol,
        "name": name,
        "close": close,
        "change_pct": row.get("change_pct"),
    }


class UserStrategyMonitor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pools: dict[str, dict[str, dict[str, Any]]] = {}
        self._meta: dict[str, dict[str, Any]] = {}
        self._last_eval = 0.0

    def drop_pool(self, user_id: str, strategy_id: str) -> None:
        key = _pool_key(user_id, strategy_id)
        with self._lock:
            self._pools.pop(key, None)
            self._meta.pop(key, None)

    def pools_for_user(self, user_id: str) -> dict[str, list[dict[str, Any]]]:
        prefix = f"{user_id}:"
        with self._lock:
            out: dict[str, list[dict[str, Any]]] = {}
            for key, rows in self._pools.items():
                if not key.startswith(prefix):
                    continue
                strategy_id = key.split(":", 1)[1]
                out[strategy_id] = list(rows.values())
            return out

    def apply_result(
        self,
        user_id: str,
        strategy_id: str,
        strategy_name: str,
        rows: list[dict],
        *,
        as_of: date | None = None,
        emit_events: bool = True,
    ) -> list[dict]:
        by_symbol: dict[str, dict[str, Any]] = {}
        for raw in rows:
            item = _stock_row(raw)
            if item is not None:
                by_symbol[item["symbol"]] = item
        symbols = set(by_symbol)
        key = _pool_key(user_id, strategy_id)
        with self._lock:
            first_round = key not in self._pools
            previous = self._pools.get(key, {})
            previous_symbols = set(previous)
            entered = symbols - previous_symbols
            exited = previous_symbols - symbols
            self._pools[key] = by_symbol
            self._meta[key] = {
                "name": strategy_name,
                "as_of": None if as_of is None else as_of.isoformat(),
                "updated_at": int(time.time() * 1000),
            }
            exited_rows = [previous[symbol] for symbol in exited if symbol in previous]
        if first_round or not emit_events:
            return []
        view = _SpecView(strategy_id, strategy_name)
        events = _pool_events(view, user_id, list(by_symbol.values()), entered, "pool_entry", "进入")
        events.extend(_pool_events(view, user_id, exited_rows, exited, "pool_exit", "移出"))
        return events

    def fill_missing(self, app_state: Any, user_id: str, as_of: date | None, frame: pl.DataFrame | None) -> None:
        if as_of is None:
            return
        factory = getattr(app_state, "session_factory", None)
        repo = getattr(app_state, "repo", None)
        if factory is None or repo is None:
            return
        with session_scope(factory) as database:
            watches = svc.list_user_watches(database, user_id)
            jobs = []
            for watch in watches:
                strategy = watch.strategy
                if strategy is None:
                    continue
                key = _pool_key(user_id, strategy.id)
                with self._lock:
                    missing = key not in self._pools
                if not missing:
                    continue
                jobs.append((strategy.id, svc.spec_for_run(database, strategy, user_id)))
        if not jobs:
            return
        from app.services.strategy_runtime import execute_spec

        screener = ScreenerService(repo)
        for strategy_id, spec in jobs:
            try:
                result = execute_spec(screener, as_of, spec, current=frame)
            except Exception as exc:  # noqa: BLE001
                logger.warning("user strategy monitor fill %s failed: %s", strategy_id, exc)
                self.apply_result(user_id, strategy_id, spec.get("name") or "", [], as_of=as_of, emit_events=False)
                continue
            self.apply_result(
                user_id,
                strategy_id,
                spec.get("name") or "",
                result.rows,
                as_of=as_of,
                emit_events=False,
            )

    def evaluate(self, app_state: Any, frame: pl.DataFrame | None, as_of: date | None) -> list[dict]:
        if as_of is None:
            return []
        now = time.time()
        with self._lock:
            if now - self._last_eval < EVAL_INTERVAL_S:
                return []
            self._last_eval = now

        factory = getattr(app_state, "session_factory", None)
        repo = getattr(app_state, "repo", None)
        if factory is None or repo is None:
            return []

        with session_scope(factory) as database:
            watches = svc.list_watches(database)
            jobs = []
            active_keys: set[str] = set()
            for watch in watches:
                strategy = watch.strategy
                if strategy is None:
                    continue
                spec = svc.spec_for_run(database, strategy, watch.user_id)
                jobs.append((watch.user_id, strategy.id, spec))
                active_keys.add(_pool_key(watch.user_id, strategy.id))
        with self._lock:
            stale = [key for key in self._pools if key not in active_keys]
            for key in stale:
                self._pools.pop(key, None)
                self._meta.pop(key, None)
        if not jobs:
            self.notify_updated(app_state)
            return []

        from app.services.strategy_runtime import execute_spec

        screener = ScreenerService(repo)
        events: list[dict] = []
        for user_id, strategy_id, spec in jobs:
            try:
                result = execute_spec(screener, as_of, spec, current=frame)
            except Exception as exc:  # noqa: BLE001
                logger.warning("user strategy monitor %s failed: %s", strategy_id, exc)
                continue
            events.extend(
                self.apply_result(
                    user_id,
                    strategy_id,
                    spec.get("name") or "",
                    result.rows,
                    as_of=as_of,
                    emit_events=True,
                )
            )

        if events:
            try:
                from app.services import alert_store

                alert_store.append_many(app_state.repo.store.data_dir, events)
            except Exception as exc:  # noqa: BLE001
                logger.warning("user strategy alerts persist failed: %s", exc)
            qs = getattr(app_state, "quote_service", None)
            if qs is not None:
                qs.push_alerts([_alert_payload(event) for event in events])
            logger.info("user strategy monitor: %d alerts", len(events))
        self.notify_updated(app_state)
        return events

    @staticmethod
    def notify_updated(app_state: Any) -> None:
        qs = getattr(app_state, "quote_service", None)
        if qs is not None:
            qs.notify_strategy_results_updated()


def _pool_events(
    strategy: Any,
    user_id: str,
    rows: list[dict],
    symbols: set[str],
    event_type: str,
    verb: str,
) -> list[dict]:
    if not symbols:
        return []
    by_symbol = {str(row.get("symbol")): row for row in rows if row.get("symbol")}
    if event_type == "pool_exit":
        hits = [by_symbol.get(symbol) or {"symbol": symbol, "name": symbol} for symbol in symbols]
    else:
        hits = [by_symbol[symbol] for symbol in symbols if symbol in by_symbol]
    if len(hits) > BATCH_LIMIT:
        return [
            _event(
                strategy,
                user_id,
                event_type,
                "_batch",
                strategy.name,
                f"策略「{strategy.name}」{verb} {len(hits)} 只",
                None,
                None,
            )
        ]
    events = []
    for row in hits:
        symbol = str(row.get("symbol") or "")
        name = str(row.get("name") or symbol)
        events.append(
            _event(
                strategy,
                user_id,
                event_type,
                symbol,
                name,
                f"策略「{strategy.name}」{verb} {name}",
                row.get("close"),
                row.get("change_pct"),
            )
        )
    return events


def _event(
    strategy: Any,
    user_id: str,
    event_type: str,
    symbol: str,
    name: str,
    message: str,
    price: Any,
    change_pct: Any,
) -> dict:
    return {
        "ts": int(time.time() * 1000),
        "source": "strategy",
        "type": event_type,
        "rule_id": f"user_strategy_{strategy.id}",
        "rule_name": strategy.name,
        "strategy_id": strategy.id,
        "user_id": user_id,
        "symbol": symbol,
        "name": name,
        "message": message,
        "price": price,
        "change_pct": change_pct,
        "signals": [],
        "severity": "info",
    }


def _alert_payload(event: dict) -> dict:
    return {
        "source": event["source"],
        "type": event["type"],
        "rule_id": event.get("rule_id"),
        "strategy_id": event.get("strategy_id"),
        "user_id": event.get("user_id"),
        "symbol": event["symbol"],
        "name": event.get("name"),
        "message": event["message"],
        "price": event.get("price"),
        "change_pct": event.get("change_pct"),
        "signals": event.get("signals") or [],
        "severity": event.get("severity", "info"),
        "ts": event.get("ts"),
    }


class _SpecView:
    def __init__(self, strategy_id: str, name: str) -> None:
        self.id = strategy_id
        self.name = name
