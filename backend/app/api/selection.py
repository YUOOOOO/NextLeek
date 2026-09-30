"""选股管线 API"""

from __future__ import annotations

import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.deps import require_csrf, require_user
from app.models import User
from app.schemas import SelectionRunIn
from app.services import alert_store

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/selection",
    tags=["selection"],
    dependencies=[Depends(require_csrf)],
)


def _data_dir(request: Request) -> str:
    """获取数据目录"""
    return str(request.app.state.repo.store.data_dir)


def _pipeline(request: Request):
    """构造 SelectionPipeline"""
    from app.services.selection_pipeline import SelectionPipeline
    return SelectionPipeline(request.app.state.repo, _data_dir(request))


def _tracker(request: Request):
    """构造 StockTracker"""
    from app.services.stock_tracker import StockTracker
    return StockTracker(_data_dir(request))

def _live_price(request: Request, symbol: str) -> float | None:
    """读取行情缓存，同时兼容带/不带交易所后缀的代码。"""
    quote_service = getattr(request.app.state, "quote_service", None)
    if quote_service is None:
        return None
    try:
        frame = quote_service.get_quotes_compat()
    except Exception:
        return None
    if frame is None or frame.is_empty() or "symbol" not in frame.columns:
        return None
    target = symbol.strip().upper()
    bare = target.split(".", 1)[0]
    for row in reversed(frame.to_dicts()):
        candidate = str(row.get("symbol") or "").strip().upper()
        if candidate != target and candidate.split(".", 1)[0] != bare:
            continue
        for column in ("close", "last_price"):
            value = row.get(column)
            if value is not None:
                return float(value)
    return None


# ──────────────────────────────────────────────
# 选股
# ──────────────────────────────────────────────

@router.post("/run")
async def run_selection(
    payload: SelectionRunIn,
    request: Request,
    _: User = Depends(require_user),
) -> dict[str, Any]:
    """运行选股管线"""
    pipeline = _pipeline(request)

    try:
        target_date = date.fromisoformat(payload.date) if payload.date else None
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid date format")

    try:
        result = pipeline.run(
            strategy_id=payload.strategy_id,
            target_date=target_date,
            sector_filter=payload.sector_filter,
            phase_filter=payload.phase_filter,
            limit=payload.limit,
            position_limit_override=payload.position_limit,
        )
    except Exception as e:  # noqa: BLE001
        logger.error("selection run failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Selection failed: {str(e)}")

    # 序列化
    return _serialize_result(result)


@router.get("/strategies")
async def list_strategies_for_selection(
    _: User = Depends(require_user),
) -> list[dict[str, Any]]:
    """列出可用于选股的策略"""
    from app.services.market_catalog import MARKET_STRATEGIES
    return [
        {
            "id": s.get("name", ""),
            "name": s.get("name", ""),
            "description": s.get("description", ""),
            "tags": s.get("tags", []),
            "scoring": s.get("scoring", {}),
            "conditions": s.get("conditions", []),
        }
        for s in MARKET_STRATEGIES
    ]


@router.get("/environment")
async def get_environment(
    request: Request,
    target_date: date | None = None,
    _: User = Depends(require_user),
) -> dict[str, Any]:
    """获取市场环境"""
    pipeline = _pipeline(request)
    if target_date is None:
        target_date = date.today()
    env = pipeline._get_environment(target_date)
    return {
        "phase": env.phase,
        "phase_label": env.phase_label,
        "position_limit": env.position_limit,
        "main_sectors": env.main_sectors,
        "height": env.height,
        "limit_up_count": env.limit_up_count,
        "promotion_rate": env.promotion_rate,
        "seal_rate": env.seal_rate,
    }


# ──────────────────────────────────────────────
# 个股跟踪
# ──────────────────────────────────────────────

@router.post("/track")
async def start_tracking(
    payload: dict[str, Any],
    request: Request,
    _: User = Depends(require_user),
) -> dict[str, Any]:
    """开始跟踪一只股票"""
    tracker = _tracker(request)
    record = tracker.add(
        symbol=payload["symbol"],
        name=payload.get("name", payload["symbol"]),
        entry_price=float(payload["entry_price"]),
        stop_loss=float(payload["stop_loss"]),
        take_profit=float(payload.get("take_profit")) if payload.get("take_profit") else None,
        max_hold_days=int(payload.get("max_hold_days", 5)),
        reason=payload.get("reason", ""),
        strategy_id=payload.get("strategy_id", ""),
        score=float(payload.get("score", 0)),
        factor_summary=payload.get("factor_summary", ""),
        sector=payload.get("sector"),
        phase_at_entry=payload.get("phase", ""),
    )
    return record.to_dict()


@router.get("/tracks")
async def list_tracks(
    request: Request,
    status: str | None = None,
    _: User = Depends(require_user),
) -> list[dict[str, Any]]:
    """列出跟踪记录"""
    tracker = _tracker(request)
    records = tracker.list_all(status=status)
    return [r.to_dict() for r in records]


@router.get("/tracks/{symbol}")
async def get_track(
    symbol: str,
    request: Request,
    _: User = Depends(require_user),
) -> dict[str, Any]:
    """获取单条跟踪记录"""
    tracker = _tracker(request)
    record = tracker.get(symbol)
    if record is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return record.to_dict()


@router.delete("/tracks/{symbol}")
async def remove_track(
    symbol: str,
    request: Request,
    _: User = Depends(require_user),
) -> dict[str, Any]:
    """删除跟踪记录"""
    tracker = _tracker(request)
    ok = tracker.remove(symbol)
    return {"ok": ok}


@router.post("/tracks/{symbol}/close")
async def close_track(
    symbol: str,
    payload: dict[str, Any],
    request: Request,
    _: User = Depends(require_user),
) -> dict[str, Any]:
    """手动关闭跟踪"""
    tracker = _tracker(request)
    record = tracker.close(
        symbol=symbol,
        exit_price=float(payload["exit_price"]),
        reason=payload.get("reason", "手动卖出"),
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return record.to_dict()


@router.get("/tracks/stats")
async def track_stats(
    request: Request,
    _: User = Depends(require_user),
) -> dict[str, Any]:
    """跟踪统计"""
    tracker = _tracker(request)
    return tracker.get_stats()


# ──────────────────────────────────────────────
# 个股分析
# ──────────────────────────────────────────────

@router.get("/analysis/{symbol}")
async def analyze_stock(
    symbol: str,
    request: Request,
    _: User = Depends(require_user),
) -> dict[str, Any]:
    tracker = _tracker(request)
    from app.services.stock_analysis import StockAnalysisService
    track_record = tracker.get(symbol)
    live_price = _live_price(request, symbol)
    if track_record is not None and live_price is not None:
        tracker.update_price(symbol, live_price)
        track_record = tracker.get(symbol)

    svc = StockAnalysisService(request.app.state.repo, _data_dir(request))
    analysis = svc.analyze(
        symbol=symbol,
        strategy_hits=[track_record.strategy_id] if track_record else [],
        sector=track_record.sector if track_record else None,
        phase=track_record.phase_at_entry if track_record else "",
        track_record=track_record,
    )
    if analysis is None:
        raise HTTPException(status_code=404, detail="No data for symbol")

    data_dir = Path(_data_dir(request))
    history = alert_store.list_recent(data_dir, days=7, limit=100)
    symbol_events = [
        event for event in history
        if event.get("user_id") == str(_.id)
        and str(event.get("symbol") or "").upper().split(".", 1)[0] == symbol.upper().split(".", 1)[0]
    ]
    serialized = _serialize_analysis(analysis)
    serialized["alerts"] = (analysis.alerts + symbol_events)[:100]
    return serialized


# ──────────────────────────────────────────────
# 序列化
# ──────────────────────────────────────────────

def _serialize_result(result) -> dict[str, Any]:
    """序列化 SelectionResult"""
    return {
        "as_of": str(result.as_of),
        "strategy_id": result.strategy_id,
        "strategy_name": result.strategy_name,
        "skip_reason": result.skip_reason,
        "environment": {
            "phase": result.environment.phase,
            "phase_label": result.environment.phase_label,
            "position_limit": result.environment.position_limit,
            "main_sectors": result.environment.main_sectors,
            "height": result.environment.height,
            "limit_up_count": result.environment.limit_up_count,
            "promotion_rate": result.environment.promotion_rate,
            "seal_rate": result.environment.seal_rate,
        },
        "candidates": [
            {
                "symbol": c.symbol,
                "name": c.name,
                "score": c.score,
                "close": c.close,
                "pct_chg": c.pct_chg,
                "turnover_rate": c.turnover_rate,
                "amount": c.amount,
                "float_mv": c.float_mv,
                "consecutive_limit_ups": c.consecutive_limit_ups,
                "sector": c.sector,
                "suggested_position": c.suggested_position,
                "stop_loss": c.stop_loss,
                "entry_low": c.entry_low,
                "entry_high": c.entry_high,
                "factor_contributions": [
                    {
                        "factor_id": fc.factor_id,
                        "factor_label": fc.factor_label,
                        "raw_value": fc.raw_value,
                        "weight": fc.weight,
                        "contribution": round(fc.contribution, 2),
                    }
                    for fc in c.factor_contributions
                ],
                "strategy_hits": c.strategy_hits,
            }
            for c in result.candidates
        ],
        "total_scored": result.total_scored,
        "filtered_out": result.filtered_out,
        "elapsed_ms": round(result.elapsed_ms, 1),
    }


def _serialize_analysis(analysis) -> dict[str, Any]:
    """序列化 StockAnalysis"""
    return {
        "symbol": analysis.symbol,
        "name": analysis.name,
        "analysis_date": analysis.analysis_date,
        "strategy_hits": analysis.strategy_hits,
        "factor_highlights": analysis.factor_highlights,
        "sector_context": analysis.sector_context,
        "phase_at_selection": analysis.phase_at_selection,
        "buy_points": [
            {
                "type": bp.type,
                "price": bp.price,
                "date": bp.date,
                "reason": bp.reason,
                "confidence": bp.confidence,
            }
            for bp in analysis.buy_points
        ],
        "sell_points": [
            {
                "type": sp.type,
                "price": sp.price,
                "reason": sp.reason,
                "severity": sp.severity,
            }
            for sp in analysis.sell_points
        ],
        "key_levels": {
            "support": analysis.key_levels.support,
            "resistance": analysis.key_levels.resistance,
            "ma": analysis.key_levels.ma,
            "stop_loss": analysis.key_levels.stop_loss,
            "take_profit": analysis.key_levels.take_profit,
        },
        "risk": {
            "rsi_level": analysis.risk.rsi_level,
            "rsi_value": analysis.risk.rsi_value,
            "near_resistance": analysis.risk.near_resistance,
            "near_support": analysis.risk.near_support,
            "warnings": analysis.risk.warnings,
        },
        "current_price": analysis.current_price,
        "pnl_pct": round(analysis.pnl_pct, 2) if analysis.pnl_pct is not None else None,
        "distance_to_stop": round(analysis.distance_to_stop, 2) if analysis.distance_to_stop is not None else None,
        "tracking": analysis.tracking,
        "entry_price": analysis.entry_price,
        "track_status": analysis.track_status,
        "alerts": analysis.alerts,
    }
