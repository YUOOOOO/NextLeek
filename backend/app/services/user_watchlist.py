"""用户自选：按账号隔离，搜索添加 / 详情加入 / 列表展示。"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import WatchlistItem


class WatchlistError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _norm_symbol(symbol: str) -> str:
    value = (symbol or "").strip().upper()
    if not value:
        raise WatchlistError("标的代码不能为空")
    return value


def list_items(database: Session, user_id: str) -> list[WatchlistItem]:
    return list(
        database.scalars(
            select(WatchlistItem)
            .where(WatchlistItem.user_id == user_id)
            .order_by(WatchlistItem.created_at.desc())
        ).all()
    )


def get_item(database: Session, user_id: str, symbol: str) -> WatchlistItem | None:
    return database.scalar(
        select(WatchlistItem).where(
            WatchlistItem.user_id == user_id,
            WatchlistItem.symbol == _norm_symbol(symbol),
        )
    )


def add_item(database: Session, user_id: str, *, symbol: str, name: str = "") -> WatchlistItem:
    symbol = _norm_symbol(symbol)
    existing = get_item(database, user_id, symbol)
    if existing is not None:
        raise WatchlistError("已在自选中", 409)
    row = WatchlistItem(user_id=user_id, symbol=symbol, name=(name or "").strip()[:64])
    database.add(row)
    database.commit()
    database.refresh(row)
    return row


def remove_item(database: Session, user_id: str, symbol: str) -> None:
    row = get_item(database, user_id, symbol)
    if row is None:
        raise WatchlistError("不在自选中", 404)
    database.delete(row)
    database.commit()


def to_read(row: WatchlistItem, quote: dict[str, Any] | None = None) -> dict[str, Any]:
    quote = quote or {}
    close = quote.get("close")
    change_pct = quote.get("change_pct")
    return {
        "id": row.id,
        "symbol": row.symbol,
        "name": quote.get("name") or row.name or row.symbol,
        "close": close,
        "change_pct": change_pct,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
