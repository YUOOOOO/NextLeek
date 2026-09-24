"""财经新闻列表。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.deps import require_user
from app.models import User
from app.services import news as news_svc

router = APIRouter(prefix="/api/news", tags=["news"])


@router.get("")
def list_news(
    source: str = Query("all"),
    q: str = Query(""),
    symbol: str = Query(""),
    limit: int = Query(80, ge=1, le=200),
    _: User = Depends(require_user),
) -> dict:
    return news_svc.list_news(source=source, keyword=q, symbol=symbol, limit=limit)
