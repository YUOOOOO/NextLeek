"""AI 个股分析 API。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.deps import require_csrf, require_user
from app.services.stock_analyzer import analyze_stock_stream

router = APIRouter(
    prefix="/api/analysis",
    tags=["analysis"],
    dependencies=[Depends(require_csrf)],
)


class AnalyzeStockRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    focus: str = Field(default="", max_length=2000)


@router.post("/ai")
async def analyze_stock_ai(
    payload: AnalyzeStockRequest,
    request: Request,
    _: object = Depends(require_user),
) -> StreamingResponse:
    symbol = payload.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol 不能为空")

    repo = getattr(request.app.state, "repo", None)
    if repo is None:
        raise HTTPException(status_code=503, detail="行情数据服务尚未就绪")
    data_dir = repo.store.data_dir

    async def stream_gen():
        async for chunk in analyze_stock_stream(repo, data_dir, symbol, payload.focus.strip()):
            yield chunk + "\n"

    return StreamingResponse(
        stream_gen(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
