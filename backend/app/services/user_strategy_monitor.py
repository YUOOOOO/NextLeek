"""用户条件策略盘中监控：复用 Screener DSL，进出场通知。"""
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


class UserStrategyMonitor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pools: dict[str, set[str]] = {}
        self._last_eval = 0.0

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
            for watch in watches:
                strategy = watch.strategy
                if strategy is None:
                    continue
                spec = svc.spec_for_run(database, strategy, watch.user_id)
                jobs.append((watch.user_id, strategy.id, spec))
        if not jobs:
            return []

        from app.services.strategy_runtime import execute_spec

        screener = ScreenerService(repo)
        events: list[dict] = []
        for user_id, strategy_id, spec in jobs:
            pool_key = f"{user_id}:{strategy_id}"
            try:
                result = execute_spec(screener, as_of, spec, current=frame)
            except Exception as exc:  # noqa: BLE001
                logger.warning("user strategy monitor %s failed: %s", strategy_id, exc)
                continue
            symbols = {str(row.get("symbol")) for row in result.rows if row.get("symbol")}
            with self._lock:
                previous = self._pools.get(pool_key, set())
                entered = symbols - previous
                exited = previous - symbols
                first_round = pool_key not in self._pools
                self._pools[pool_key] = symbols
            if first_round:
                continue
            view = _SpecView(strategy_id, spec)
            events.extend(_pool_events(view, result.rows, entered, "pool_entry", "新进场"))
            events.extend(_pool_events(view, result.rows, exited, "pool_exit", "离场"))

        if events:
            try:
                from app.services import alert_store

                alert_store.append_many(app_state.repo.store.data_dir, events)
            except Exception as exc:  # noqa: BLE001
                logger.warning("user strategy alerts persist failed: %s", exc)
            qs = getattr(app_state, "quote_service", None)
            if qs is not None:
                qs.push_alerts(
                    [
                        {
                            "source": event["source"],
                            "type": event["type"],
                            "rule_id": event.get("rule_id"),
                            "strategy_id": event.get("strategy_id"),
                            "symbol": event["symbol"],
                            "name": event.get("name"),
                            "message": event["message"],
                            "price": event.get("price"),
                            "change_pct": event.get("change_pct"),
                            "signals": event.get("signals") or [],
                            "severity": event.get("severity", "info"),
                        }
                        for event in events
                    ]
                )
            logger.info("user strategy monitor: %d alerts", len(events))
        return events


def _pool_events(
    strategy: Any,
    rows: list[dict],
    symbols: set[str],
    event_type: str,
    verb: str,
) -> list[dict]:
    if not symbols:
        return []
    by_symbol = {str(row.get("symbol")): row for row in rows if row.get("symbol")}
    hits = [by_symbol[symbol] for symbol in symbols if symbol in by_symbol]
    if event_type == "pool_exit":
        hits = [{"symbol": symbol, "name": symbol, "close": None, "change_pct": None} for symbol in symbols]
    if len(hits) > BATCH_LIMIT:
        return [
            _event(
                strategy,
                event_type,
                "_batch",
                f"{strategy.name} {verb} {len(hits)} 只",
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
                event_type,
                symbol,
                f"{strategy.name} {verb} {name}",
                row.get("close"),
                row.get("change_pct"),
            )
        )
    return events


def _event(
    strategy: Any,
    event_type: str,
    symbol: str,
    message: str,
    price: Any,
    change_pct: Any,
) -> dict:
    return {
        "source": "strategy",
        "type": event_type,
        "rule_id": f"user_strategy_{strategy.id}",
        "rule_name": strategy.name,
        "strategy_id": strategy.id,
        "symbol": symbol,
        "name": strategy.name if symbol == "_batch" else symbol,
        "message": message,
        "price": price,
        "change_pct": change_pct,
        "signals": [],
        "severity": "info",
        "conditions": list(strategy.conditions or []),
        "logic": "and",
    }

class _SpecView:
    def __init__(self, strategy_id: str, spec: dict) -> None:
        self.id = strategy_id
        self.name = spec.get("name") or ""
        self.conditions = spec.get("conditions") or []
