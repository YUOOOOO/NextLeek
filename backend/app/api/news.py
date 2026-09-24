"""财经新闻列表。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import require_csrf, require_user
from app.models import User
from app.schemas import NewsAnalyzeIn
from app.services import formula_ai, news as news_svc

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


@router.get("/members")
def news_members(
    kind: str = Query("board"),
    name: str = Query("", min_length=1, max_length=40),
    limit: int = Query(200, ge=1, le=500),
    _: User = Depends(require_user),
) -> dict:
    from app.services.news_tags import list_members

    kind = kind.strip().lower()
    if kind not in {"board", "concept", "industry"}:
        raise HTTPException(status_code=400, detail="kind 须为 board/concept/industry")
    return list_members(kind, name, limit=limit)

@router.post("/analyze")
async def analyze_news(
    payload: NewsAnalyzeIn,
    _: User = Depends(require_user),
    __: None = Depends(require_csrf),
) -> dict:
    try:
        return await formula_ai.analyze_news(payload.prompt)
    except formula_ai.FormulaAIError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
