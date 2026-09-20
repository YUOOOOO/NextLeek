"""策略监控中心：当前命中池 + 进出记录 + SSE。"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.deps import get_database, require_user
from app.models import User
from app.services import alert_store
from app.services import user_strategies as svc

router = APIRouter(prefix="/api/monitor", tags=["monitor"])


def _overlay_quotes(rows: list[dict[str, Any]], quotes: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        live = quotes.get(str(row.get("symbol") or ""))
        item = dict(row)
        if live:
            if live.get("close") is not None:
                item["close"] = live["close"]
            if live.get("change_pct") is not None:
                item["change_pct"] = live["change_pct"]
            if live.get("name"):
                item["name"] = live["name"]
        out.append(item)
    out.sort(key=lambda item: float(item.get("change_pct") or 0), reverse=True)
    return out


def _quote_map(request: Request) -> dict[str, dict[str, Any]]:
    qs = getattr(request.app.state, "quote_service", None)
    if qs is None:
        return {}
    try:
        df = qs.get_quotes_compat()
    except Exception:
        return {}
    if df is None or df.is_empty() or "symbol" not in df.columns:
        return {}
    keep = [col for col in ("symbol", "name", "close", "last_price", "change_pct") if col in df.columns]
    out: dict[str, dict[str, Any]] = {}
    for row in df.select(keep).to_dicts():
        symbol = str(row.get("symbol") or "")
        if not symbol:
            continue
        close = row.get("close")
        if close is None:
            close = row.get("last_price")
        out[symbol] = {
            "name": row.get("name"),
            "close": close,
            "change_pct": row.get("change_pct"),
        }
    return out


def _as_of(request: Request):
    repo = getattr(request.app.state, "repo", None)
    if repo is None:
        return None
    try:
        return repo.latest_enriched_date()
    except Exception:
        return None


@router.get("")
def monitor_snapshot(
    request: Request,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> dict:
    watches = svc.list_user_watches(database, user.id)
    monitor = getattr(request.app.state, "user_strategy_monitor", None)
    as_of = _as_of(request)
    frame = None
    qs = getattr(request.app.state, "quote_service", None)
    if qs is not None:
        try:
            frame, _ = qs.get_enriched_today()
        except Exception:
            frame = None
    if monitor is not None and as_of is not None:
        monitor.fill_missing(request.app.state, user.id, as_of, frame)
    pools = monitor.pools_for_user(user.id) if monitor is not None else {}
    quotes = _quote_map(request)
    strategies = []
    for watch in watches:
        strategy = watch.strategy
        if strategy is None:
            continue
        rows = _overlay_quotes(pools.get(strategy.id, []), quotes)
        strategies.append(
            {
                "id": strategy.id,
                "name": strategy.name,
                "kind": strategy.kind,
                "rows": rows,
                "total": len(rows),
            }
        )
    repo = getattr(request.app.state, "repo", None)
    data_dir = None if repo is None else repo.store.data_dir
    events = []
    if data_dir is not None:
        events = [
            event
            for event in alert_store.list_recent(data_dir, days=7, limit=500, source="strategy")
            if event.get("user_id") == user.id
        ]
    return {
        "as_of": None if as_of is None else as_of.isoformat(),
        "strategies": strategies,
        "events": events[:200],
        "watch_count": len(strategies),
        "hit_count": sum(item["total"] for item in strategies),
    }


@router.get("/stream")
async def monitor_stream(request: Request, user: User = Depends(require_user)):
    qs = getattr(request.app.state, "quote_service", None)

    async def event_generator():
        if qs is None:
            while True:
                await asyncio.sleep(30)

        sub = qs.subscribe()
        try:
            while True:
                if await request.is_disconnected():
                    break
                await asyncio.to_thread(sub.wait, 5.0)
                data = sub.pop()
                alerts = [
                    alert
                    for alert in data["alerts"]
                    if not alert.get("user_id") or alert.get("user_id") == user.id
                ]
                for start in range(0, len(alerts), 20):
                    chunk = alerts[start : start + 20]
                    yield {
                        "event": "strategy_alert",
                        "data": json.dumps(
                            {"ts": int(time.time() * 1000), "alerts": chunk},
                            ensure_ascii=False,
                        ),
                    }
                if data["quote_updated"] or data["strategy_results_updated"]:
                    yield {
                        "event": "pool_updated",
                        "data": json.dumps({"ts": int(time.time() * 1000)}),
                    }
        finally:
            qs.unsubscribe(sub)

    return EventSourceResponse(event_generator())
