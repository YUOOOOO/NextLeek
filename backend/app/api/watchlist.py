"""自选列表：代码 / 名称 / 拼音搜索添加，详情页加入。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.deps import get_database, require_user
from app.models import User
from app.services import user_watchlist as svc

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class WatchlistIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    name: str = ""


def _http(exc: svc.WatchlistError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


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


def _resolve_name(request: Request, symbol: str, name: str) -> str:
    if name.strip():
        return name.strip()
    repo = getattr(request.app.state, "repo", None)
    if repo is None:
        return ""
    try:
        return repo.get_name_map([symbol]).get(symbol, "")
    except Exception:
        return ""


@router.get("")
def list_watchlist(
    request: Request,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> dict:
    quotes = _quote_map(request)
    items = [svc.to_read(row, quotes.get(row.symbol)) for row in svc.list_items(database, user.id)]
    return {"items": items, "count": len(items)}


@router.post("")
def add_watchlist(
    payload: WatchlistIn,
    request: Request,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> dict:
    symbol = payload.symbol.strip().upper()
    try:
        row = svc.add_item(
            database,
            user.id,
            symbol=symbol,
            name=_resolve_name(request, symbol, payload.name),
        )
    except svc.WatchlistError as exc:
        raise _http(exc) from exc
    quotes = _quote_map(request)
    return svc.to_read(row, quotes.get(row.symbol))


@router.delete("/{symbol}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watchlist(
    symbol: str,
    user: User = Depends(require_user),
    database: Session = Depends(get_database),
) -> None:
    try:
        svc.remove_item(database, user.id, symbol)
    except svc.WatchlistError as exc:
        raise _http(exc) from exc
