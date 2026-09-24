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
from app.services.display_tags import enabled_custom_specs
from app.services.user_strategy_monitor import TAG_FIELDS

router = APIRouter(prefix="/api/monitor", tags=["monitor"])


def _overlay_quotes(
    rows: list[dict[str, Any]],
    quotes: dict[str, dict[str, Any]],
    tags: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        symbol = str(row.get("symbol") or "")
        item = dict(row)
        extra = (tags or {}).get(symbol)
        if extra:
            for key, value in extra.items():
                if value is not None:
                    item[key] = value
        live = quotes.get(symbol)
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


def _tag_map(frame: Any) -> dict[str, dict[str, Any]]:
    if frame is None:
        return {}
    try:
        empty = frame.is_empty()
    except Exception:
        return {}
    if empty or "symbol" not in frame.columns:
        return {}
    keep = [
        col
        for col in frame.columns
        if col == "symbol"
        or col in TAG_FIELDS
        or str(col).startswith("csg_")
        or str(col).startswith("signal_")
    ]
    if len(keep) <= 1:
        return {}
    out: dict[str, dict[str, Any]] = {}
    extra_keys = [col for col in keep if col != "symbol"]
    for row in frame.select(keep).to_dicts():
        symbol = str(row.get("symbol") or "")
        if not symbol:
            continue
        out[symbol] = {key: row[key] for key in extra_keys if key in row}
    return out


def _attach_custom_signals(frame: Any, data_dir) -> Any:
    if frame is None or data_dir is None:
        return frame
    try:
        from app.strategy import custom_signals

        exprs = custom_signals.build_expressions(custom_signals.load_all(data_dir), allow_shift=False)
        if not exprs:
            return frame
        return custom_signals.inject(frame, exprs)
    except Exception:
        return frame


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


def _as_of(request: Request, asset_type: str = "stock"):
    repo = getattr(request.app.state, "repo", None)
    if repo is None:
        return None
    try:
        return repo.latest_enriched_date(asset_type)
    except Exception:
        return None


def _load_frame(request: Request, asset_type: str):
    repo = getattr(request.app.state, "repo", None)
    frame = None
    as_of = _as_of(request, asset_type)
    if repo is not None:
        try:
            frame, latest = repo.get_enriched_latest_asset(asset_type)
            if latest is not None:
                as_of = latest
        except Exception:
            frame = None
    if asset_type == "stock":
        qs = getattr(request.app.state, "quote_service", None)
        if qs is not None:
            try:
                live, live_date = qs.get_enriched_today()
                if live is not None:
                    frame = live
                    as_of = live_date or as_of
            except Exception:
                pass
    return frame, as_of


@router.get("")
def monitor_snapshot(
    request: Request,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
    asset_type: str = "stock",
) -> dict:
    asset_type = (asset_type or "stock").strip().lower()
    if asset_type not in {"stock", "etf"}:
        asset_type = "stock"
    watches = [
        watch
        for watch in svc.list_user_watches(database, user.id)
        if (getattr(watch.strategy, "asset_type", None) or "stock") == asset_type
    ]
    stock_frame, stock_as_of = _load_frame(request, "stock")
    frame, as_of = (stock_frame, stock_as_of) if asset_type == "stock" else _load_frame(request, asset_type)
    if monitor is not None:
        monitor.fill_missing(request.app.state, user.id, stock_as_of, stock_frame)
    pools = monitor.pools_for_user(user.id) if monitor is not None else {}
    repo = getattr(request.app.state, "repo", None)
    data_dir = None if repo is None else repo.store.data_dir
    quotes = _quote_map(request) if asset_type == "stock" else {}
    tags = _tag_map(_attach_custom_signals(frame, data_dir))
    strategies = []
    for watch in watches:
        strategy = watch.strategy
        if strategy is None:
            continue
        rows = _overlay_quotes(pools.get(strategy.id, []), quotes, tags)
        strategies.append(
            {
                "id": strategy.id,
                "name": strategy.name,
                "kind": strategy.kind,
                "asset_type": getattr(strategy, "asset_type", None) or "stock",
                "rows": rows,
                "total": len(rows),
            }
        )
    events = []
    if data_dir is not None:
        events = [
            event
            for event in alert_store.list_recent(data_dir, days=7, limit=500, source="strategy")
            if event.get("user_id") == user.id and (event.get("asset_type") or "stock") == asset_type
        ]
    return {
        "as_of": None if as_of is None else as_of.isoformat(),
        "asset_type": asset_type,
        "strategies": strategies,
        "events": events[:200],
        "watch_count": len(strategies),
        "hit_count": sum(item["total"] for item in strategies),
        "custom_tags": enabled_custom_specs(data_dir, asset_type) if data_dir is not None else [],
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
